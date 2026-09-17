"use strict";

const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getFunctions} = require("firebase-admin/functions");
const {logger} = require("firebase-functions");
const {defineSecret, defineString} = require("firebase-functions/params");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onTaskDispatched} = require("firebase-functions/tasks");
const {
  APP_ID,
  checkBudget,
  classifySource,
  createResearchJobId,
  estimateJobCostCents,
  extractUrls,
  getCardPath,
  getManualRetryDecision,
  getNextRunAt,
  getResearchJobPath,
  getUsagePeriodIds,
  isResearchCandidate,
  MAX_TASK_ATTEMPTS,
  normalizeAutomationSettings,
  shouldRetryTaskFailure,
  sourceFingerprint,
} = require("./job-policy");
const {analyzeSource, ExternalServiceError} = require("./providers");
const {describeTaskEnqueueError} = require("./enqueue-errors");
const {
  buildAutoApprovalWrites,
  shouldAutoApproveJob,
} = require("./auto-approval");
const {
  canAcceptInvite,
  createInviteCode,
  getInviteExpiration,
  normalizeEmail,
  normalizeSpaceName,
} = require("./spaces");
const {
  calculateDiaryPrice,
  normalizeDateKey,
  questionForDate,
  TOKEN_POLICY,
} = require("./couple-feature-policy");

initializeApp();

const db = getFirestore();
const REGION = process.env.FUNCTION_REGION || "asia-east1";
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const JINA_API_KEY = defineSecret("JINA_API_KEY");
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
const GEMINI_RESEARCH_MODEL = defineString("GEMINI_RESEARCH_MODEL", {
  default: "gemini-3.5-flash-lite",
});
const OPENROUTER_RESEARCH_MODEL = defineString("OPENROUTER_RESEARCH_MODEL", {
  default: "auto:free",
});
const TERMINAL_JOB_STATUSES = new Set([
  "pending_review",
  "succeeded",
  "discarded",
  "blocked_budget",
  "cancelled_stale",
  "failed_terminal",
]);

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "請先登入。");
  }
  return request.auth.uid;
}

function assertDocumentPart(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.includes("/") || normalized.length > 160) {
    throw new HttpsError("invalid-argument", `${field} 格式不正確。`);
  }
  return normalized;
}

function automationRef(uid) {
  return db.doc(`artifacts/${APP_ID}/automationUsers/${uid}`);
}

function spaceRef(spaceId) {
  return db.doc(`artifacts/${APP_ID}/spaces/${spaceId}`);
}

function spaceMemberRef(spaceId, uid) {
  return spaceRef(spaceId).collection("members").doc(uid);
}

function membershipRef(uid, spaceId) {
  return db.doc(`artifacts/${APP_ID}/users/${uid}/memberships/${spaceId}`);
}

function inviteRef(inviteCode) {
  return db.doc(`artifacts/${APP_ID}/spaceInvites/${inviteCode}`);
}

function coupleSpaceRoot(spaceId) {
  return db.doc(`artifacts/${APP_ID}/users/${spaceId}`);
}

function tokenWalletRef(spaceId, uid) {
  return coupleSpaceRoot(spaceId).collection("tokens").collection("wallets").doc(uid);
}

function tokenLedgerRef(spaceId, ledgerId) {
  return coupleSpaceRoot(spaceId).collection("tokens").collection("ledger").doc(ledgerId);
}

function dailyQuestionRef(spaceId, dateKey) {
  return coupleSpaceRoot(spaceId).collection("dailyQuestions").doc(dateKey);
}

function diaryRef(spaceId, diaryId) {
  return coupleSpaceRoot(spaceId).collection("diaries").doc(diaryId);
}

function todayDateKey(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isRecentDateKey(dateKey, daysBack = 7) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return false;
  const today = todayDateKey();
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const requestedTime = Date.parse(`${normalized}T00:00:00Z`);
  return requestedTime <= todayTime && requestedTime >= todayTime - daysBack * 24 * 60 * 60 * 1000;
}

function requireRecentDateKey(value, field = "dateKey") {
  const normalized = normalizeDateKey(value);
  if (!normalized || !isRecentDateKey(normalized)) {
    throw new HttpsError("invalid-argument", `${field} 必須是最近 7 天內的日期。`);
  }
  return normalized;
}

function normalizeAnswer(value) {
  const answer = String(value || "").trim();
  if (!answer || answer.length > 500) {
    throw new HttpsError("invalid-argument", "回答請填寫 1～500 字。");
  }
  return answer;
}

function normalizeDiaryText(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 2_000) {
    throw new HttpsError("invalid-argument", "日記請填寫 1～2,000 字。");
  }
  return text;
}

async function requireSpaceMember(spaceId, uid) {
  const membership = await spaceMemberRef(spaceId, uid).get();
  if (!membership.exists) {
    throw new HttpsError("permission-denied", "你不是這個共同空間的成員。");
  }
  return membership.data();
}

function researchUsageRef(uid, periodId) {
  return db.doc(`artifacts/${APP_ID}/users/${uid}/researchUsage/${periodId}`);
}

async function getAutomationSettings(uid) {
  const snapshot = await automationRef(uid).get();
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    ...normalizeAutomationSettings(data),
    spaceId: String(data.spaceId || uid),
  };
}

function taskTargetUri() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("找不到 GCLOUD_PROJECT");
  return `https://${REGION}-${projectId}.cloudfunctions.net/runResearchJob`;
}

async function enqueueTask(jobPath) {
  // firebase-admin getFunctions() accepts only an App argument. Passing REGION
  // as a second argument is silently ignored and makes a short queue name fall
  // back to us-central1. Include the location in the function resource name.
  const queue = getFunctions().taskQueue(
    `locations/${REGION}/functions/runResearchJob`,
  );
  await queue.enqueue(
    {jobPath},
    {
      dispatchDeadlineSeconds: 60 * 5,
      uri: taskTargetUri(),
    },
  );
}

async function reserveAndCreateJob({uid, requestedByUid, collectionName, cardId, card, settings}) {
  const urls = extractUrls(card.text);
  if (urls.length !== 1) {
    return {created: false, reason: "requires_single_url"};
  }
  const sourceUrl = urls[0];
  const sourceKind = classifySource(sourceUrl);
  const fingerprint = sourceFingerprint(card);
  const jobId = createResearchJobId({uid, collectionName, cardId, fingerprint});
  const jobPath = getResearchJobPath(uid, jobId);
  const jobRef = db.doc(jobPath);
  const estimatedCostCents = estimateJobCostCents(sourceKind);
  // YouTube is currently a manual NotebookLM handoff. The worker does not read
  // its audio or video, so it must not consume the video-processing allowance.
  const videoMinutes = 0;
  const {dayId, monthId} = getUsagePeriodIds();
  const dayRef = researchUsageRef(uid, dayId);
  const monthRef = researchUsageRef(uid, monthId);

  const result = await db.runTransaction(async (transaction) => {
    const [existingJob, dayUsage, monthUsage] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(dayRef),
      transaction.get(monthRef),
    ]);
    if (existingJob.exists) {
      const existing = existingJob.data();
      const retry = getManualRetryDecision(existing);
      if (retry.allowed) {
        const now = FieldValue.serverTimestamp();
        transaction.set(jobRef, {
          status: "retry_enqueueing",
          attempts: 0,
          manualRetryCount: retry.nextManualRetryCount,
          retryRequestedByUid: requestedByUid || uid,
          retryRequestedAt: now,
          updatedAt: now,
          startedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          result: FieldValue.delete(),
          provider: FieldValue.delete(),
          model: FieldValue.delete(),
          error: FieldValue.delete(),
        }, {merge: true});
        return {
          created: false,
          reason: retry.reason,
          status: "retry_enqueueing",
          jobId,
          jobPath,
          shouldEnqueue: true,
        };
      }
      return {
        created: false,
        reason: retry.reason === "manual_retry_limit" ?
          "manual_retry_limit" :
          "idempotent_existing",
        status: existing.status,
        jobId,
        jobPath,
        shouldEnqueue: false,
      };
    }

    const budget = checkBudget({
      settings,
      dailyUsage: dayUsage.exists ? dayUsage.data() : {},
      monthlyUsage: monthUsage.exists ? monthUsage.data() : {},
      estimatedCostCents,
      videoMinutes,
    });
    const now = FieldValue.serverTimestamp();
    if (!budget.allowed) {
      transaction.set(jobRef, {
        uid,
        requestedByUid: requestedByUid || uid,
        collectionName,
        cardId,
        sourceUrl,
        sourceKind,
        sourceFingerprint: fingerprint,
        approvalMode: settings.approvalMode,
        status: "blocked_budget",
        budgetReason: budget.reason,
        estimatedCostCents,
        createdAt: now,
        updatedAt: now,
      });
      return {created: true, reason: budget.reason, jobId, jobPath, shouldEnqueue: false};
    }

    transaction.set(dayRef, {
      jobs: FieldValue.increment(1),
      videoMinutes: FieldValue.increment(videoMinutes),
      updatedAt: now,
    }, {merge: true});
    transaction.set(monthRef, {
      jobs: FieldValue.increment(1),
      estimatedCostCents: FieldValue.increment(estimatedCostCents),
      videoMinutes: FieldValue.increment(videoMinutes),
      updatedAt: now,
    }, {merge: true});
    transaction.set(jobRef, {
      uid,
      requestedByUid: requestedByUid || uid,
      collectionName,
      cardId,
      sourceUrl,
      sourceKind,
      sourceFingerprint: fingerprint,
      approvalMode: settings.approvalMode,
      status: "queued",
      attempts: 0,
      estimatedCostCents,
      createdAt: now,
      updatedAt: now,
    });
    return {created: true, reason: "queued", jobId, jobPath, shouldEnqueue: true};
  });

  if (result.shouldEnqueue) {
    try {
      await enqueueTask(result.jobPath);
      await jobRef.set({
        taskEnqueuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (error) {
      await jobRef.set({
        status: "enqueue_failed",
        error: {
          code: "task_enqueue_failed",
          message: String(error?.message || "Cloud Tasks enqueue failed").slice(0, 500),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw error;
    }
  }
  return result;
}

exports.ensurePersonalSpace = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const email = normalizeEmail(request.auth.token?.email);
  const displayName = String(request.auth.token?.name || "").trim().slice(0, 80);
  const fallbackName = displayName ? `${displayName} 的空間` : "我的空間";
  const name = normalizeSpaceName(request.data?.name, fallbackName);
  const personalSpaceRef = spaceRef(uid);
  const personalMemberRef = spaceMemberRef(uid, uid);
  const personalMembershipRef = membershipRef(uid, uid);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(personalSpaceRef);
    const now = FieldValue.serverTimestamp();
    if (!snapshot.exists) {
      transaction.set(personalSpaceRef, {
        name,
        ownerUid: uid,
        memberCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    transaction.set(personalMemberRef, {
      uid,
      email,
      displayName,
      role: "owner",
      joinedAt: now,
    }, {merge: true});
    transaction.set(personalMembershipRef, {
      spaceId: uid,
      name: snapshot.exists ? normalizeSpaceName(snapshot.data().name, name) : name,
      ownerUid: uid,
      role: "owner",
      updatedAt: now,
    }, {merge: true});
  });
  return {ok: true, spaceId: uid};
});

exports.createSpaceInvite = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId, "spaceId");
  const invitedEmail = normalizeEmail(request.data?.email);
  if (!invitedEmail) {
    throw new HttpsError("invalid-argument", "請輸入有效的受邀 email。");
  }
  if (invitedEmail === normalizeEmail(request.auth.token?.email)) {
    throw new HttpsError("invalid-argument", "不需要邀請你自己的帳號。");
  }
  const member = await requireSpaceMember(spaceId, uid);
  if (member.role !== "owner") {
    throw new HttpsError("permission-denied", "只有空間擁有者可以邀請成員。");
  }
  const spaceSnapshot = await spaceRef(spaceId).get();
  if (!spaceSnapshot.exists) {
    throw new HttpsError("not-found", "找不到共同空間。");
  }
  if (Number(spaceSnapshot.data().memberCount || 1) >= 2) {
    throw new HttpsError("failed-precondition", "這個空間已經有兩位成員。");
  }
  const inviteCode = createInviteCode();
  await inviteRef(inviteCode).set({
    spaceId,
    spaceName: normalizeSpaceName(spaceSnapshot.data().name),
    invitedEmail,
    invitedByUid: uid,
    status: "pending",
    expiresAt: getInviteExpiration(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, inviteCode, expiresInDays: 7};
});

exports.acceptSpaceInvite = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const inviteCode = assertDocumentPart(request.data?.inviteCode, "inviteCode");
  const email = normalizeEmail(request.auth.token?.email);
  const displayName = String(request.auth.token?.name || "").trim().slice(0, 80);
  const targetInviteRef = inviteRef(inviteCode);

  const initialInvite = await targetInviteRef.get();
  if (!initialInvite.exists) {
    throw new HttpsError("not-found", "邀請碼不存在。");
  }
  const spaceId = assertDocumentPart(initialInvite.data().spaceId, "spaceId");
  const targetSpaceRef = spaceRef(spaceId);
  const targetMemberRef = spaceMemberRef(spaceId, uid);
  const targetMembershipRef = membershipRef(uid, spaceId);

  await db.runTransaction(async (transaction) => {
    const [inviteSnapshot, targetSpaceSnapshot, existingMember] = await Promise.all([
      transaction.get(targetInviteRef),
      transaction.get(targetSpaceRef),
      transaction.get(targetMemberRef),
    ]);
    if (!inviteSnapshot.exists || !targetSpaceSnapshot.exists) {
      throw new HttpsError("not-found", "邀請或共同空間已不存在。");
    }
    const decision = canAcceptInvite(inviteSnapshot.data(), {email});
    if (!decision.allowed) {
      const messages = {
        email_mismatch: "請使用受邀的 Google 帳號登入後再加入。",
        invite_expired: "邀請已過期，請空間擁有者重新建立。",
        invite_not_pending: "這份邀請已經使用或失效。",
      };
      throw new HttpsError("permission-denied", messages[decision.reason] || "無法接受邀請。");
    }
    const now = FieldValue.serverTimestamp();
    const space = targetSpaceSnapshot.data();
    if (!existingMember.exists && Number(space.memberCount || 1) >= 2) {
      throw new HttpsError("failed-precondition", "這個空間已經有兩位成員。");
    }
    transaction.set(targetMemberRef, {
      uid,
      email,
      displayName,
      role: "member",
      joinedAt: now,
    }, {merge: true});
    transaction.set(targetMembershipRef, {
      spaceId,
      name: normalizeSpaceName(space.name),
      ownerUid: space.ownerUid,
      role: "member",
      updatedAt: now,
    }, {merge: true});
    transaction.set(targetInviteRef, {
      status: "accepted",
      acceptedByUid: uid,
      acceptedAt: now,
      updatedAt: now,
    }, {merge: true});
    if (!existingMember.exists) {
      transaction.set(targetSpaceRef, {
        memberCount: FieldValue.increment(1),
        updatedAt: now,
      }, {merge: true});
    }
  });
  return {ok: true, spaceId};
});

exports.removeSpaceMember = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId, "spaceId");
  const memberUid = assertDocumentPart(request.data?.memberUid, "memberUid");
  const requester = await requireSpaceMember(spaceId, uid);
  if (requester.role !== "owner") {
    throw new HttpsError("permission-denied", "只有空間擁有者可以移除成員。");
  }
  if (memberUid === uid) {
    throw new HttpsError("invalid-argument", "空間擁有者不能移除自己。");
  }
  const targetMemberRef = spaceMemberRef(spaceId, memberUid);
  await db.runTransaction(async (transaction) => {
    const memberSnapshot = await transaction.get(targetMemberRef);
    if (!memberSnapshot.exists) return;
    transaction.delete(targetMemberRef);
    transaction.delete(membershipRef(memberUid, spaceId));
    transaction.set(spaceRef(spaceId), {
      memberCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  const removedAutomation = await automationRef(memberUid).get();
  if (removedAutomation.exists && removedAutomation.data().spaceId === spaceId) {
    await removedAutomation.ref.set({
      enabled: false,
      nextRunAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  }
  return {ok: true};
});

exports.renameSpace = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId, "spaceId");
  if (!String(request.data?.name || "").trim()) {
    throw new HttpsError("invalid-argument", "請輸入空間名稱。");
  }
  const requester = await requireSpaceMember(spaceId, uid);
  if (requester.role !== "owner") {
    throw new HttpsError("permission-denied", "只有空間擁有者可以重新命名空間。");
  }
  const name = normalizeSpaceName(request.data.name);
  // The space name is denormalized into every member's membership doc, so both
  // members see the new name without re-reading the space document.
  const memberDocs = await spaceRef(spaceId).collection("members").get();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(spaceRef(spaceId), {name, updatedAt: now}, {merge: true});
  memberDocs.forEach((memberDoc) => {
    batch.set(membershipRef(memberDoc.id, spaceId), {name, updatedAt: now}, {merge: true});
  });
  await batch.commit();
  return {ok: true, spaceId, name};
});

exports.ensureTokenWallet = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const walletRef = tokenWalletRef(spaceId, uid);
  const welcomeLedgerRef = tokenLedgerRef(spaceId, `welcome_${uid}`);
  return db.runTransaction(async (transaction) => {
    const walletSnapshot = await transaction.get(walletRef);
    if (walletSnapshot.exists) {
      return {
        balance: Math.max(0, Number(walletSnapshot.data().balance || 0)),
        initialized: false,
      };
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(walletRef, {
      uid,
      balance: TOKEN_POLICY.welcomeGrant,
      totalEarned: TOKEN_POLICY.welcomeGrant,
      totalSpent: 0,
      welcomeGrantedAt: now,
      updatedAt: now,
    });
    transaction.set(welcomeLedgerRef, {
      uid,
      type: "welcome_grant",
      amount: TOKEN_POLICY.welcomeGrant,
      createdAt: now,
    });
    return {balance: TOKEN_POLICY.welcomeGrant, initialized: true};
  });
});

exports.submitDailyAnswer = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const dateKey = requireRecentDateKey(request.data?.dateKey);
  const answer = normalizeAnswer(request.data?.answer);
  const questionRef = dailyQuestionRef(spaceId, dateKey);
  const answerRef = questionRef.collection("answers").doc(uid);
  const walletRef = tokenWalletRef(spaceId, uid);
  const rewardLedgerRef = tokenLedgerRef(spaceId, `daily_answer_${dateKey}_${uid}`);

  return db.runTransaction(async (transaction) => {
    const [questionSnapshot, answerSnapshot, walletSnapshot, rewardLedgerSnapshot] = await Promise.all([
      transaction.get(questionRef),
      transaction.get(answerRef),
      transaction.get(walletRef),
      transaction.get(rewardLedgerRef),
    ]);
    const now = FieldValue.serverTimestamp();
    const question = questionForDate(dateKey);
    const existingWallet = walletSnapshot.exists ? walletSnapshot.data() : {};
    const initialGrant = walletSnapshot.exists ? 0 : TOKEN_POLICY.welcomeGrant;
    const rewardGranted = !rewardLedgerSnapshot.exists;
    const reward = rewardGranted ? TOKEN_POLICY.dailyAnswerReward : 0;
    const balance = Math.max(0, Number(existingWallet.balance || 0)) + initialGrant + reward;

    transaction.set(questionRef, {
      dateKey,
      prompt: question,
      createdAt: questionSnapshot.exists ? questionSnapshot.data().createdAt || now : now,
      updatedAt: now,
    }, {merge: true});
    transaction.set(answerRef, {
      uid,
      answer,
      answeredAt: now,
      updatedAt: now,
    }, {merge: true});
    if (initialGrant || rewardGranted) {
      transaction.set(walletRef, {
        uid,
        balance,
        totalEarned: Number(existingWallet.totalEarned || 0) + initialGrant + reward,
        totalSpent: Number(existingWallet.totalSpent || 0),
        ...(initialGrant ? {welcomeGrantedAt: now} : {}),
        updatedAt: now,
      }, {merge: true});
    }
    if (initialGrant) {
      transaction.set(tokenLedgerRef(spaceId, `welcome_${uid}`), {
        uid,
        type: "welcome_grant",
        amount: TOKEN_POLICY.welcomeGrant,
        createdAt: now,
      }, {merge: true});
    }
    if (rewardGranted) {
      transaction.set(rewardLedgerRef, {
        uid,
        type: "daily_answer",
        dateKey,
        amount: TOKEN_POLICY.dailyAnswerReward,
        createdAt: now,
      });
    }
    return {dateKey, rewardGranted, balance, answered: true};
  });
});

exports.saveDailyDiary = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const dateKey = requireRecentDateKey(request.data?.dateKey);
  const text = normalizeDiaryText(request.data?.text);
  const diaryId = `${dateKey}_${uid}`;
  const targetRef = diaryRef(spaceId, diaryId);
  const contentRef = targetRef.collection("content").doc("private");
  const rewardLedgerRef = tokenLedgerRef(spaceId, `diary_write_${diaryId}`);
  const walletRef = tokenWalletRef(spaceId, uid);

  return db.runTransaction(async (transaction) => {
    const [diarySnapshot, walletSnapshot, rewardLedgerSnapshot] = await Promise.all([
      transaction.get(targetRef),
      transaction.get(walletRef),
      transaction.get(rewardLedgerRef),
    ]);
    const now = FieldValue.serverTimestamp();
    const price = calculateDiaryPrice(text.length);
    const existingDiary = diarySnapshot.exists ? diarySnapshot.data() : {};
    if (Array.isArray(existingDiary.unlockedByUids) && existingDiary.unlockedByUids.length > 0) {
      throw new HttpsError("failed-precondition", "這篇日記已被解鎖，不能再修改。");
    }
    const existingWallet = walletSnapshot.exists ? walletSnapshot.data() : {};
    const initialGrant = walletSnapshot.exists ? 0 : TOKEN_POLICY.welcomeGrant;
    const rewardGranted = !rewardLedgerSnapshot.exists;
    const reward = rewardGranted ? TOKEN_POLICY.dailyDiaryReward : 0;
    const balance = Math.max(0, Number(existingWallet.balance || 0)) + initialGrant + reward;

    transaction.set(targetRef, {
      dateKey,
      authorUid: uid,
      charCount: text.length,
      price,
      unlockedByUids: Array.isArray(existingDiary.unlockedByUids) ? existingDiary.unlockedByUids : [],
      createdAt: existingDiary.createdAt || now,
      updatedAt: now,
    }, {merge: true});
    transaction.set(contentRef, {
      text,
      updatedAt: now,
    }, {merge: true});
    if (initialGrant || rewardGranted) {
      transaction.set(walletRef, {
        uid,
        balance,
        totalEarned: Number(existingWallet.totalEarned || 0) + initialGrant + reward,
        totalSpent: Number(existingWallet.totalSpent || 0),
        ...(initialGrant ? {welcomeGrantedAt: now} : {}),
        updatedAt: now,
      }, {merge: true});
    }
    if (initialGrant) {
      transaction.set(tokenLedgerRef(spaceId, `welcome_${uid}`), {
        uid,
        type: "welcome_grant",
        amount: TOKEN_POLICY.welcomeGrant,
        createdAt: now,
      }, {merge: true});
    }
    if (rewardGranted) {
      transaction.set(rewardLedgerRef, {
        uid,
        type: "daily_diary",
        dateKey,
        amount: TOKEN_POLICY.dailyDiaryReward,
        createdAt: now,
      });
    }
    return {diaryId, dateKey, price, rewardGranted, balance};
  });
});

exports.unlockDailyDiary = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const diaryId = assertDocumentPart(request.data?.diaryId, "diaryId");
  const targetRef = diaryRef(spaceId, diaryId);
  const unlockRef = targetRef.collection("unlocks").doc(uid);
  const walletRef = tokenWalletRef(spaceId, uid);
  const ledgerRef = tokenLedgerRef(spaceId, `diary_unlock_${diaryId}_${uid}`);

  return db.runTransaction(async (transaction) => {
    const [diarySnapshot, unlockSnapshot, walletSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(targetRef),
      transaction.get(unlockRef),
      transaction.get(walletRef),
      transaction.get(ledgerRef),
    ]);
    if (!diarySnapshot.exists) throw new HttpsError("not-found", "找不到這篇日記。");
    const diary = diarySnapshot.data();
    if (diary.authorUid === uid) {
      throw new HttpsError("invalid-argument", "作者可以直接查看自己的日記。");
    }
    if (unlockSnapshot.exists) {
      return {
        unlocked: true,
        charged: false,
        balance: Math.max(0, Number(walletSnapshot.data()?.balance || 0)),
        diaryId,
      };
    }
    const price = calculateDiaryPrice(diary.charCount);
    const wallet = walletSnapshot.exists ? walletSnapshot.data() : {};
    const initialGrant = walletSnapshot.exists ? 0 : TOKEN_POLICY.welcomeGrant;
    const currentBalance = Math.max(0, Number(wallet.balance || 0)) + initialGrant;
    if (currentBalance < price) {
      throw new HttpsError("failed-precondition", `代幣不足，需要 ${price} 枚，目前有 ${currentBalance} 枚。`);
    }
    const balance = currentBalance - price;
    const now = FieldValue.serverTimestamp();
    transaction.set(walletRef, {
      uid,
      balance,
      totalEarned: Number(wallet.totalEarned || 0) + initialGrant,
      totalSpent: Number(wallet.totalSpent || 0) + price,
      ...(initialGrant ? {welcomeGrantedAt: now} : {}),
      updatedAt: now,
    }, {merge: true});
    if (initialGrant) {
      transaction.set(tokenLedgerRef(spaceId, `welcome_${uid}`), {
        uid,
        type: "welcome_grant",
        amount: TOKEN_POLICY.welcomeGrant,
        createdAt: now,
      }, {merge: true});
    }
    transaction.set(unlockRef, {
      uid,
      price,
      unlockedAt: now,
    });
    transaction.set(targetRef, {
      unlockedByUids: FieldValue.arrayUnion(uid),
      updatedAt: now,
    }, {merge: true});
    transaction.set(ledgerRef, {
      uid,
      type: "diary_unlock",
      diaryId,
      amount: -price,
      createdAt: now,
    });
    return {unlocked: true, charged: true, balance, price, diaryId};
  });
});

exports.saveWeeklyReview = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const weekKey = assertDocumentPart(request.data?.weekKey, "weekKey");
  const content = String(request.data?.content || "").trim();
  if (!content || content.length > 12_000) {
    throw new HttpsError("invalid-argument", "每週回顧內容不可為空，且最多 12,000 字。");
  }
  const reviewRef = coupleSpaceRoot(spaceId).collection("weeklyReviews").doc(weekKey);
  await reviewRef.set({
    weekKey,
    content,
    generatedByUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, weekKey};
});

exports.updateResearchAutomation = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const settings = normalizeAutomationSettings(request.data || {});
  await automationRef(uid).set({
    ...settings,
    uid,
    spaceId,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, settings: {...settings, spaceId}};
});

exports.enqueueCardResearch = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const collectionName = assertDocumentPart(request.data?.collectionName, "collectionName");
  const cardId = assertDocumentPart(request.data?.cardId, "cardId");
  const cardRef = db.doc(getCardPath(spaceId, collectionName, cardId));
  const cardSnapshot = await cardRef.get();
  if (!cardSnapshot.exists) {
    throw new HttpsError("not-found", "找不到卡片。");
  }
  try {
    return await reserveAndCreateJob({
      uid: spaceId,
      requestedByUid: uid,
      collectionName,
      cardId,
      card: cardSnapshot.data(),
      settings: await getAutomationSettings(uid),
    });
  } catch (error) {
    const diagnostic = describeTaskEnqueueError(error);
    logger.error("enqueueCardResearch failed", {
      uid,
      collectionName,
      cardId,
      enqueueErrorCategory: diagnostic.category,
      enqueueErrorCode: diagnostic.errorCode,
      enqueueErrorMessage: diagnostic.errorMessage,
      enqueueErrorDetails: diagnostic.errorDetails,
      enqueueErrorStack: diagnostic.stack,
    });
    throw new HttpsError("internal", diagnostic.clientMessage);
  }
});

exports.resolveResearchReview = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const spaceId = assertDocumentPart(request.data?.spaceId || uid, "spaceId");
  await requireSpaceMember(spaceId, uid);
  const jobId = assertDocumentPart(request.data?.jobId, "jobId");
  const decision = request.data?.decision === "succeeded" ? "succeeded" : "discarded";
  const jobRef = db.doc(getResearchJobPath(spaceId, jobId));
  const snapshot = await jobRef.get();
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "找不到研讀工作。");
  }
  if (snapshot.data().status !== "pending_review") {
    return {ok: true, status: snapshot.data().status, unchanged: true};
  }
  await jobRef.set({
    status: decision,
    reviewDecision: decision === "succeeded" ? "approved" : "discarded",
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, status: decision};
});

async function findCandidateCards(uid, maxJobs) {
  const categorySnapshots = await db
    .collection(`artifacts/${APP_ID}/users/${uid}/categories`)
    .get();
  const collectionNames = new Set(["inbox"]);
  categorySnapshots.forEach((snapshot) => collectionNames.add(snapshot.id));
  const candidates = [];

  for (const collectionName of collectionNames) {
    if (candidates.length >= maxJobs) break;
    const snapshot = await db
      .collection(`artifacts/${APP_ID}/users/${uid}/${collectionName}`)
      .limit(Math.max(20, maxJobs * 2))
      .get();
    snapshot.forEach((cardSnapshot) => {
      if (candidates.length >= maxJobs) return;
      const card = cardSnapshot.data();
      if (isResearchCandidate(card)) {
        candidates.push({
          collectionName,
          cardId: cardSnapshot.id,
          card,
        });
      }
    });
  }
  return candidates;
}

async function autoApproveResearchJob(jobRef) {
  return db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef);
    if (!jobSnapshot.exists) return {status: "missing"};
    const job = jobSnapshot.data();
    if (job.status === "succeeded") return {status: "succeeded", unchanged: true};
    if (job.status !== "auto_approving" || !shouldAutoApproveJob(job)) {
      return {status: job.status, unchanged: true};
    }

    const cardRef = db.doc(getCardPath(job.uid, job.collectionName, job.cardId));
    const noteRef = cardRef.collection("details").doc("note");
    const tagsRef = db.doc(`artifacts/${APP_ID}/users/${job.uid}/settings/tags`);
    const [cardSnapshot, noteSnapshot, tagsSnapshot] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(noteRef),
      transaction.get(tagsRef),
    ]);
    if (!cardSnapshot.exists ||
        sourceFingerprint(cardSnapshot.data()) !== job.sourceFingerprint) {
      transaction.set(jobRef, {
        status: "cancelled_stale",
        error: {
          code: cardSnapshot.exists ? "source_changed" : "card_not_found",
          message: cardSnapshot.exists ?
            "卡片內容已變更，自動寫入已取消。" :
            "卡片已不存在。",
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return {status: "cancelled_stale"};
    }

    const writes = buildAutoApprovalWrites({
      card: cardSnapshot.data(),
      noteData: noteSnapshot.exists ? noteSnapshot.data().data : null,
      tags: tagsSnapshot.exists ? tagsSnapshot.data().items : [],
      result: job.result,
    });
    transaction.set(noteRef, {
      data: writes.noteData,
      updatedAt: writes.cardData.updatedAt,
    }, {merge: true});
    transaction.set(cardRef, writes.cardData, {merge: true});
    transaction.set(tagsRef, {
      items: writes.tags,
      updatedAt: writes.tagsUpdatedAt,
    }, {merge: true});
    transaction.set(jobRef, {
      status: "succeeded",
      reviewDecision: "auto_approved",
      autoApprovedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    }, {merge: true});
    return {status: "succeeded"};
  });
}

async function markAutoApprovalFailedTerminal(jobRef, error) {
  return db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef);
    if (!jobSnapshot.exists) return {status: "missing"};
    const status = jobSnapshot.data().status;
    if (status !== "auto_approving") {
      return {status, unchanged: true};
    }
    transaction.set(jobRef, {
      status: "failed_terminal",
      error: {
        code: "auto_approval_failed",
        provider: "firestore",
        status: 0,
        retryAfterSeconds: 0,
        message: String(error?.message || "automatic approval failed").slice(0, 500),
        details: "",
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {status: "failed_terminal"};
  });
}

exports.discoverDueResearchJobs = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "Asia/Taipei",
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const usersSnapshot = await db
    .collection(`artifacts/${APP_ID}/automationUsers`)
    .where("enabled", "==", true)
    .limit(50)
    .get();

  const dueUsers = usersSnapshot.docs
    .filter((snapshot) => Number(snapshot.data().nextRunAt) <= Date.now())
    .slice(0, 20);
  for (const userSnapshot of dueUsers) {
    const uid = userSnapshot.id;
    const settings = normalizeAutomationSettings(userSnapshot.data());
    const spaceId = String(userSnapshot.data().spaceId || uid);
    try {
      const memberSnapshot = await spaceMemberRef(spaceId, uid).get();
      if (!memberSnapshot.exists) throw new Error("automation user is not a space member");
      const candidates = await findCandidateCards(spaceId, settings.maxJobsPerRun);
      for (const candidate of candidates) {
        await reserveAndCreateJob({
          uid: spaceId,
          requestedByUid: uid,
          settings,
          ...candidate,
        });
      }
      await userSnapshot.ref.set({
        lastRunAt: FieldValue.serverTimestamp(),
        nextRunAt: getNextRunAt(settings.interval),
        lastRunCandidateCount: candidates.length,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (error) {
      logger.error("scheduled research discovery failed", {
        uid,
        message: error?.message,
      });
      await userSnapshot.ref.set({
        lastError: String(error?.message || "unknown").slice(0, 500),
        lastErrorAt: FieldValue.serverTimestamp(),
        nextRunAt: Date.now() + 60 * 60 * 1000,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  }
});

exports.runResearchJob = onTaskDispatched({
  region: REGION,
  secrets: [GEMINI_API_KEY, JINA_API_KEY, OPENROUTER_API_KEY],
  memory: "512MiB",
  minInstances: 0,
  maxInstances: 1,
  timeoutSeconds: 300,
  retryConfig: {
    maxAttempts: MAX_TASK_ATTEMPTS,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3600,
    maxRetrySeconds: 24 * 60 * 60,
  },
  rateLimits: {
    maxConcurrentDispatches: 1,
  },
}, async (request) => {
  const jobPath = String(request.data?.jobPath || "");
  if (!/^artifacts\/[^/]+\/users\/[^/]+\/researchJobs\/[^/]+$/.test(jobPath)) {
    throw new Error("Invalid jobPath");
  }
  const jobRef = db.doc(jobPath);
  const jobSnapshot = await jobRef.get();
  if (!jobSnapshot.exists) return;
  const job = jobSnapshot.data();
  if (TERMINAL_JOB_STATUSES.has(job.status)) return;
  const attemptNumber = Number(job.attempts || 0) + 1;

  if (job.status === "auto_approving" && shouldAutoApproveJob(job) && job.result) {
    await jobRef.set({
      attempts: FieldValue.increment(1),
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    try {
      await autoApproveResearchJob(jobRef);
    } catch (error) {
      const shouldRetry = shouldRetryTaskFailure({
        retryable: true,
        attempts: attemptNumber,
      });
      logger.error("automatic research approval retry failed", {
        jobPath,
        attemptNumber,
        shouldRetry,
        message: String(error?.message || "auto approval failed").slice(0, 500),
      });
      if (shouldRetry) throw error;
      await markAutoApprovalFailedTerminal(jobRef, error);
    }
    return;
  }

  const cardRef = db.doc(getCardPath(job.uid, job.collectionName, job.cardId));
  const cardSnapshot = await cardRef.get();
  if (!cardSnapshot.exists) {
    await jobRef.set({
      status: "failed_terminal",
      error: {code: "card_not_found", message: "卡片已不存在。"},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return;
  }
  const currentFingerprint = sourceFingerprint(cardSnapshot.data());
  if (currentFingerprint !== job.sourceFingerprint) {
    await jobRef.set({
      status: "cancelled_stale",
      error: {code: "source_changed", message: "卡片內容已變更，舊工作已取消。"},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return;
  }

  await jobRef.set({
    status: "running",
    attempts: FieldValue.increment(1),
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  let autoApprovalPending = false;
  try {
    const result = await analyzeSource({
      sourceUrl: job.sourceUrl,
      sourceKind: job.sourceKind,
      geminiApiKey: GEMINI_API_KEY.value(),
      jinaApiKey: JINA_API_KEY.value(),
      model: GEMINI_RESEARCH_MODEL.value(),
      openRouterApiKey: OPENROUTER_API_KEY.value(),
      openRouterModel: OPENROUTER_RESEARCH_MODEL.value(),
    });
    const {
      provider: resultProvider,
      model: resultModel,
      ...resultPayload
    } = result;
    const autoApprove = shouldAutoApproveJob(job);
    if (autoApprove) autoApprovalPending = true;
    await jobRef.set({
      status: autoApprove ? "auto_approving" : "pending_review",
      result: resultPayload,
      provider: resultProvider || (job.sourceKind === "youtube" ?
        "notebooklm-manual" :
        "jina+openrouter"),
      model: resultModel || "",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    }, {merge: true});
    if (autoApprove) {
      await autoApproveResearchJob(jobRef);
      autoApprovalPending = false;
    }
  } catch (error) {
    if (autoApprovalPending) {
      // The transaction is the idempotency boundary. Do not write the job back
      // to auto_approving here: a lost commit acknowledgement could otherwise
      // regress an already-succeeded job and append the result twice on retry.
      logger.error("automatic research approval failed", {
        jobPath,
        attemptNumber,
        message: String(error?.message || "auto approval failed").slice(0, 500),
      });
      const shouldRetry = shouldRetryTaskFailure({
        retryable: true,
        attempts: attemptNumber,
      });
      if (shouldRetry) throw error;
      await markAutoApprovalFailedTerminal(jobRef, error);
      return;
    }
    const retryable = error instanceof ExternalServiceError && error.retryable;
    const shouldRetry = shouldRetryTaskFailure({
      retryable,
      attempts: attemptNumber,
    });
    await jobRef.set({
      status: shouldRetry ? "retry_wait" : "failed_terminal",
      error: {
        code: error?.reason ||
          (shouldRetry ? "external_retryable" : "external_terminal"),
        provider: error?.provider || "unknown",
        status: error?.status || 0,
        retryAfterSeconds: error?.retryAfterSeconds || 0,
        message: String(error?.message || "research failed").slice(0, 500),
        details: String(error?.details || "").slice(0, 1000),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (shouldRetry) throw error;
  }
});
