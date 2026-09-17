        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, collection, query, where, addDoc, onSnapshot, deleteDoc, deleteField, doc, updateDoc, getDoc, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
        import { createLayerStack, attachKeyboardManager } from './js/keyboard-layers.js';
        import { attachMdShortcuts } from './js/md-shortcuts.js';
        import { groupCardsBySearch } from './card-search.mjs';
        import { PLAN_KINDS, parseDateKey, dateKey, getPlanKind, getCalendarEntries, getUpcomingAnniversaries, normalizeCalendarEvent, normalizePlannerCard } from './couple-planner.mjs';
        import {
            buildTagUsageCounts,
            groupCardsByTagFilter,
            groupResearchBackfillCandidates
        } from './tag-filter.mjs';
        import {
            readResearchReviews,
            removeResearchReview,
            upsertResearchReview
        } from './research-review.mjs';
        import {
            appendResearchLog,
            classifyResearchFailure,
            clearResearchLogs,
            readResearchLogs
        } from './research-runtime.mjs';
        import {
            clearAutoResearchFailure,
            getAutoResearchDue,
            readAutoResearchState,
            recordAutoResearchFailure,
            selectAutoResearchCandidates,
            writeAutoResearchState
        } from './auto-research-schedule.mjs';
        import {
            buildCloudAutomationPayload,
            mapCloudResearchJobToReview,
            mergeResearchReviews
        } from './cloud-research.mjs';
        import {
            DEFAULT_MISTRAL_RESEARCH_MODEL,
            DEFAULT_WEB_RESEARCH_MODEL,
            DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT,
            buildMistralResearchRequest,
            buildUnparsedVideoResearchResult,
            buildWebResearchAppendData,
            buildGeminiResearchRequest,
            buildCardMoveData,
            buildCardSearchFields,
            buildJinaReaderRequest,
            canUseWebResearch,
            classifyJinaResearchSource,
            describeGeminiApiError,
            describeGeminiResponseIssue,
            describeMistralApiError,
            extractGeminiResponseText,
            extractUrls,
            findSuspiciousTagIds,
            getNotebookLmSourceUrl,
            getWebResearchCooldownRemaining,
            getWebResearchModelOptions,
            isInteractiveCardTarget,
            isDirectVideoPageUrl,
            normalizeHttpUrl,
            normalizeSourceText,
            parseGeminiResearchResult,
            parseJinaReaderResponse,
            readWebResearchCache,
            readWebResearchModelVerification,
            resolveSelectedTags,
            writeWebResearchModelVerification,
            writeWebResearchCache
        } from './web-research.mjs';

        // --- Firebase 初始化 ---
        let firebaseConfig;
        let appId = 'stay-with-me';
        if (typeof __firebase_config !== 'undefined') {
            firebaseConfig = JSON.parse(__firebase_config);
            appId = typeof __app_id !== 'undefined' ? __app_id : appId;
        } else {
            firebaseConfig = {
                apiKey: "AIzaSyDh4lQG2T1crYwSCQCfTtBvIDjQ1enc2i0",
                authDomain: "dating-with-viola.firebaseapp.com",
                projectId: "dating-with-viola",
                storageBucket: "dating-with-viola.firebasestorage.app",
                messagingSenderId: "1060778384338",
                appId: "1:1060778384338:web:a89a535bbaadb12b5cc60b"
            };
        }

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const provider = new GoogleAuthProvider();
        const db = getFirestore(app);
        const cloudFunctions = getFunctions(app, 'asia-east1');
        const updateResearchAutomationCallable = httpsCallable(cloudFunctions, 'updateResearchAutomation');
        const enqueueCardResearchCallable = httpsCallable(cloudFunctions, 'enqueueCardResearch');
        const resolveResearchReviewCallable = httpsCallable(cloudFunctions, 'resolveResearchReview');
        const ensurePersonalSpaceCallable = httpsCallable(cloudFunctions, 'ensurePersonalSpace');
        const createSpaceInviteCallable = httpsCallable(cloudFunctions, 'createSpaceInvite');
        const acceptSpaceInviteCallable = httpsCallable(cloudFunctions, 'acceptSpaceInvite');
        const removeSpaceMemberCallable = httpsCallable(cloudFunctions, 'removeSpaceMember');
        const renameSpaceCallable = httpsCallable(cloudFunctions, 'renameSpace');

        let currentUser = null;
        let currentSpaceId = null;
        let currentSpaces = [];
        let currentSpaceMembers = [];
        let unsubscribeSpaceMemberships = null;
        let unsubscribeSpaceMembers = null;
        let initializedSpaceId = null;
        let currentCategories = [];
        let currentTags = [];
        let draftTags = [];
        let currentInboxItems = []; 
        const currentItemsByCollection = new Map();
        let currentAnniversaries = [];
        let unsubscribeAnniversaries = null;
        let currentCalendarEvents = [];
        let unsubscribeCalendarEvents = null;
        let activePlannerEntry = null;
        let activeAnniversaryId = null;
        let plannerMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let plannerSelectedDate = dateKey(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
        let plannerLastSyncedAt = null;
        let plannerSyncRetryBusy = false;
        const plannerSyncState = {
            anniversaries: 'syncing',
            calendarEvents: 'syncing',
            plans: 'syncing'
        };
        const plannerSyncErrors = new Map();
        const plannerTodoCollectionIds = new Set();
        const plannerTodoSyncStates = new Map();
        const plannerCategoryUnsubscribes = new Map();
        const selectedTagFilterIds = new Set();
        const selectedResearchBackfillKeys = new Set();
        let tagMatchMode = 'all';
        let tagBrowserView = 'tags';
        let globalSearchQuery = '';
        let researchBackfillQueue = [];
        let researchBackfillIndex = 0;
        let activeResearchBackfillKey = null;
        let researchBackfillWaitTimer = null;
        let researchBackfillCountdownTimer = null;
        let researchBackfillWakeLock = null;
        let researchBackfillStatusMessage = '';
        let researchBackfillCompleted = 0;
        let researchBackfillFailed = 0;
        let researchBackfillQuotaFailures = 0;
        const researchBackfillRetryAttempts = new Map();
        let researchReviewItems = [];
        let cloudResearchReviewItems = [];
        let cloudAutomationSettings = null;
        let cloudResearchListenerError = '';
        let unsubscribeCloudResearchJobs = null;
        let unsubscribeCloudAutomation = null;
        let researchLogFilter = 'all';
        let researchBackfillApprovalMode = localStorage.getItem('researchBackfillApprovalMode') === 'auto' ? 'auto' : 'manual';
        let researchBackfillOrigin = 'manual';
        let automaticResearchCheckTimer = null;
        let automaticResearchPollTimer = null;

        function getActiveSpaceId() {
            return currentSpaceId || currentUser?.uid || null;
        }

        function getActiveSpace() {
            return currentSpaces.find(space => space.spaceId === getActiveSpaceId()) || null;
        }

        function getSpaceStorageKey() {
            return currentUser ? `activeSpace:${currentUser.uid}` : 'activeSpace:anonymous';
        }
        let automaticResearchInboxLoaded = false;
        let automaticResearchCategoriesLoaded = false;
        const automaticResearchLoadedCollections = new Set();
        let currentTodoItems = [];
        let pendingDeleteTarget = null;
        let pendingMoveTarget = null;
        let pendingEditTarget = null;
        let isHideCompleted = false;
        let isSorting = false; 
        let isInitialInboxLoad = true; 
        let justDropped = false;

        // --- History Manager for Undo/Redo ---
        class HistoryManager {
            constructor() {
                this.undoStack = [];
                this.redoStack = [];
            }
            push(action) {
                this.undoStack.push(action);
                this.redoStack = [];
                if (this.undoStack.length > 50) this.undoStack.shift();
            }
            async undo() {
                if (this.undoStack.length === 0) {
                    showToast('沒有可還原的操作', 'fas fa-info-circle');
                    return;
                }
                const action = this.undoStack.pop();
                try {
                    await action.undo();
                    this.redoStack.push(action);
                } catch (e) {
                    console.error("Undo failed:", e);
                    showToast('還原操作失敗', 'fas fa-exclamation-triangle');
                }
            }
            async redo() {
                if (this.redoStack.length === 0) {
                    showToast('沒有可重做的操作', 'fas fa-info-circle');
                    return;
                }
                const action = this.redoStack.pop();
                try {
                    await action.redo();
                    this.undoStack.push(action);
                } catch (e) {
                    console.error("Redo failed:", e);
                    showToast('重做操作失敗', 'fas fa-exclamation-triangle');
                }
            }
        }
        const historyManager = new HistoryManager();

        const keyLayers = createLayerStack();
        attachKeyboardManager(keyLayers);

        keyLayers.push({
            name: 'base',
            keys: {
                'mod+z': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.undo(); } },
                'mod+y': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.redo(); } },
                'mod+shift+z': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.redo(); } },
                'mod+k': (e) => { e.preventDefault(); openGlobalSearch(); }
            }
        });

        const modalKeys = (closeFn) => ({
            'Escape': (e) => { e.preventDefault(); closeFn(); },
            'mod+a': (e, ctx) => { if (!ctx.editableFocus) e.preventDefault(); }
        });

        async function copyCardDetails(oldCol, newCol, oldId, newId) {
            try {
                const oldNoteRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, oldId, 'details', 'note');
                const oldNoteSnap = await getDoc(oldNoteRef);
                if (oldNoteSnap.exists()) {
                    const newNoteRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), newCol, newId, 'details', 'note');
                    await setDoc(newNoteRef, oldNoteSnap.data());
                    await deleteDoc(oldNoteRef);
                }
            } catch (e) {
                console.error("Failed to copy card details:", e);
            }
        }

        function getCollectionName(colId) {
            if (colId === 'inbox') return '收件匣';
            if (colId === 'todos') return '待辦事項';
            if (colId === 'learning') return '學習筆記';
            if (colId === 'ideas') return '靈感與想法';
            if (colId === 'bookmarks') return '稍後閱讀';
            const cat = currentCategories.find(c => c.id === colId);
            return cat ? cat.name : '未知分類';
        }

        function getShortText(text, maxLen = 10) {
            const cleanText = (text || '').trim();
            if (!cleanText) return '空內容';
            return cleanText.length > maxLen ? cleanText.substring(0, maxLen) + '...' : cleanText;
        }

        let stagedImageFile = null;

        const confirmModal = document.getElementById('confirm-modal');
        const moveModal = document.getElementById('move-modal');
        const editModal = document.getElementById('edit-modal');
        const editInput = document.getElementById('edit-input');
        let editPreviousFocus = null;

        function trapDialogTab(dialog, event) {
            if (event.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('button, input, select, textarea')]
                .filter(element => !element.disabled && element.getClientRects().length > 0);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }

        function openEditCardModal() {
            editPreviousFocus = document.activeElement;
            editModal.classList.remove('hidden');
            keyLayers.push({ name: 'edit', keys: modalKeys(closeEditCardModal) });
            editInput.focus();
        }
        function closeEditCardModal() {
            editModal.classList.add('hidden');
            pendingEditTarget = null;
            keyLayers.pop('edit');
            editPreviousFocus?.focus?.();
        }
        editModal.addEventListener('keydown', event => trapDialogTab(editModal, event));

        const getOrder = (item) => item.order !== undefined ? item.order : item.createdAt;

        
        async function saveCategory(categoryData) {
            if (!currentUser) return;
            const catCol = collection(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'categories');
            if (categoryData.id) {
                const { id, ...data } = categoryData;
                await updateDoc(doc(catCol, id), data);
            } else {
                await addDoc(catCol, categoryData);
            }
        }

        async function deleteCategoryFunc(id) {
            if (!currentUser) return;
            await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'categories', id));
            showToast('已刪除分類');
        }

        function cleanupPlannerCategoryListeners() {
            plannerCategoryUnsubscribes.forEach(unsubscribe => unsubscribe?.());
            plannerCategoryUnsubscribes.clear();
        }

        function setupPlannerCollectionListeners(spaceId) {
            unsubscribeAnniversaries?.();
            unsubscribeCalendarEvents?.();
            currentAnniversaries = [];
            currentCalendarEvents = [];
            resetPlannerSyncState();
            renderCouplePlanner();
            const anniversariesRef = collection(db, 'artifacts', appId, 'users', spaceId, 'anniversaries');
            unsubscribeAnniversaries = onSnapshot(
                anniversariesRef,
                { includeMetadataChanges: true },
                snapshot => {
                    if (spaceId !== getActiveSpaceId()) return;
                    currentAnniversaries = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
                    updatePlannerSyncState('anniversaries', plannerSnapshotState(snapshot));
                    markPlannerSnapshotSynced(snapshot);
                    renderCouplePlanner();
                },
                error => {
                    console.error('載入紀念日失敗', error);
                    updatePlannerSyncState('anniversaries', 'error', error.message);
                }
            );
            const calendarEventsRef = collection(db, 'artifacts', appId, 'users', spaceId, 'calendarEvents');
            unsubscribeCalendarEvents = onSnapshot(
                calendarEventsRef,
                { includeMetadataChanges: true },
                snapshot => {
                    if (spaceId !== getActiveSpaceId()) return;
                    currentCalendarEvents = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
                    updatePlannerSyncState('calendarEvents', plannerSnapshotState(snapshot));
                    markPlannerSnapshotSynced(snapshot);
                    renderCouplePlanner();
                },
                error => {
                    console.error('載入行程失敗', error);
                    updatePlannerSyncState('calendarEvents', 'error', error.message);
                }
            );
        }

        async function retryPlannerSync() {
            if (plannerSyncRetryBusy || !currentUser || !getActiveSpaceId()) return;
            plannerSyncRetryBusy = true;
            renderPlannerSyncStatus();
            try {
                const spaceId = getActiveSpaceId();
                cleanupPlannerCategoryListeners();
                setupPlannerCollectionListeners(spaceId);
                renderMainGrid(currentCategories);
                showToast('已重新連線共同計畫', 'fas fa-rotate');
            } catch (error) {
                console.error('重試共同計畫同步失敗', error);
                updatePlannerSyncState('plans', 'error', error.message);
            } finally {
                plannerSyncRetryBusy = false;
                renderPlannerSyncStatus();
            }
        }

        document.getElementById('planner-sync-retry').addEventListener('click', () => void retryPlannerSync());

        function setupCategoryListener(catId, catType, catName, catIcon) {
            const listEl = document.getElementById(`list-${catId}`);
            if (!listEl) return;
            plannerCategoryUnsubscribes.get(catId)?.();
            const listenedSpaceId = getActiveSpaceId();
            const unsubscribe = onSnapshot(
                collection(db, 'artifacts', appId, 'users', listenedSpaceId, catId),
                { includeMetadataChanges: true },
                snapshot => {
                    if (listenedSpaceId !== getActiveSpaceId()) return;
                    const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                    items.sort((a, b) => getOrder(b) - getOrder(a));
                    currentItemsByCollection.set(catId, items);
                    automaticResearchLoadedCollections.add(String(catId));
                    if (catType === 'todo') {
                        updatePlannerTodoSyncState(catId, plannerSnapshotState(snapshot));
                        markPlannerSnapshotSynced(snapshot);
                    }
                    const countEl = document.getElementById(`count-${catId}`);
                    if (countEl) countEl.innerText = items.length;
                    if (catType === 'todo') {
                        renderTodos(items, listEl, catId);
                    } else if (catType === 'bookmark') {
                        renderBookmarks(items, listEl, catId);
                    } else {
                        renderList(items, listEl, catId, `${catIcon} text-slate-400`);
                    }
                    refreshOpenTagBrowser();
                    renderCouplePlanner();
                    renderAutomaticResearchScheduleStatus();
                    if (isAutomaticResearchDataReady()) scheduleAutomaticResearchCheck();
                },
                error => {
                    console.error(`載入${catName || catId}失敗`, error);
                    if (catType === 'todo') updatePlannerTodoSyncState(catId, 'error');
                }
            );
            plannerCategoryUnsubscribes.set(catId, unsubscribe);
        }

        function getPlannerTodoGroups() {
            return currentCategories.filter(category => category.type === 'todo')
                .map(category => ({ id: category.id, items: currentItemsByCollection.get(category.id) || [] }));
        }

        function getPlannerEntrySource(entry) {
            if (entry.kind === 'event') {
                return currentCalendarEvents.find(item => item.id === entry.id) || null;
            }
            if (entry.kind === 'anniversary') {
                return currentAnniversaries.find(item => item.id === entry.id) || null;
            }
            return currentItemsByCollection.get(entry.collectionId)?.find(item => item.id === entry.id) || null;
        }

        function getPlannerCreatorName(uid) {
            if (!uid) return '未記錄';
            if (currentUser?.uid === uid) return currentUser.displayName || currentUser.email || '我';
            const member = currentSpaceMembers.find(item => item.uid === uid);
            return member?.displayName || member?.email || '共同空間成員';
        }

        function formatPlannerDate(date) {
            const parsed = parseDateKey(date);
            if (!parsed) return '未排日期';
            return new Intl.DateTimeFormat('zh-TW', {
                month: 'long', day: 'numeric', weekday: 'short'
            }).format(new Date(parsed.year, parsed.month - 1, parsed.day));
        }

        function setPlannerSelectedDate(date, { updateMonth = true } = {}) {
            if (!parseDateKey(date)) return false;
            plannerSelectedDate = date;
            if (updateMonth) {
                const parsed = parseDateKey(date);
                plannerMonth = new Date(parsed.year, parsed.month - 1, 1);
            }
            return true;
        }

        function plannerSnapshotState(snapshot) {
            return snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites ? 'syncing' : 'synced';
        }

        function renderPlannerSyncStatus() {
            const status = document.getElementById('planner-sync-status');
            const retry = document.getElementById('planner-sync-retry');
            if (!status || !retry) return;
            const states = [...Object.values(plannerSyncState)];
            const hasError = states.includes('error');
            const isSyncing = states.includes('syncing');
            const summary = hasError ? 'error' : isSyncing ? 'syncing' : 'synced';
            const statusCopy = {
                syncing: '同步中…',
                synced: '已同步',
                error: '同步失敗'
            };
            const statusStyles = {
                syncing: ['bg-amber-50', 'text-amber-700'],
                synced: ['bg-emerald-50', 'text-emerald-700'],
                error: ['bg-rose-50', 'text-rose-700']
            };
            status.dataset.state = summary;
            status.textContent = statusCopy[summary];
            status.className = `rounded-full px-2.5 py-1 font-semibold ${statusStyles[summary][0]} ${statusStyles[summary][1]}`;
            retry.classList.toggle('hidden', summary !== 'error');
            retry.disabled = plannerSyncRetryBusy;
            retry.textContent = plannerSyncRetryBusy ? '重試中…' : '重試同步';
        }

        function updatePlannerSyncState(key, state, error = '') {
            if (!(key in plannerSyncState)) return;
            plannerSyncState[key] = state;
            if (state === 'error' && error) plannerSyncErrors.set(key, error);
            else plannerSyncErrors.delete(key);
            renderPlannerSyncStatus();
        }

        function updatePlannerTodoSyncState(collectionId, snapshotState) {
            if (!plannerTodoCollectionIds.has(collectionId)) return;
            plannerTodoSyncStates.set(collectionId, snapshotState);
            const states = [...plannerTodoCollectionIds].map(id => plannerTodoSyncStates.get(id) || 'syncing');
            updatePlannerSyncState('plans', states.includes('error') ? 'error' : states.every(state => state === 'synced') ? 'synced' : 'syncing');
        }

        function resetPlannerSyncState() {
            plannerSyncErrors.clear();
            plannerSyncState.anniversaries = 'syncing';
            plannerSyncState.calendarEvents = 'syncing';
            plannerSyncState.plans = plannerTodoCollectionIds.size === 0 ? 'synced' : 'syncing';
            plannerTodoSyncStates.clear();
            plannerLastSyncedAt = null;
            renderPlannerSyncStatus();
            renderPlannerCollaborationMeta();
        }

        function markPlannerSnapshotSynced(snapshot) {
            if (!snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites) {
                plannerLastSyncedAt = Date.now();
                renderPlannerCollaborationMeta();
            }
        }

        function renderPlannerCollaborationMeta() {
            const collaborators = document.getElementById('planner-collaborators');
            const lastSynced = document.getElementById('planner-last-synced');
            if (collaborators) {
                const names = currentSpaceMembers
                    .map(member => member.displayName || member.email)
                    .filter(Boolean);
                collaborators.textContent = names.length
                    ? `共編者：${names.slice(0, 2).join('、')}${names.length > 2 ? ` 等 ${names.length} 人` : ''}`
                    : currentUser ? '共編者：目前空間' : '共編者：登入後顯示';
            }
            if (lastSynced) {
                lastSynced.textContent = plannerLastSyncedAt
                    ? `最近同步：${new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(plannerLastSyncedAt)}`
                    : '最近同步：尚未同步';
            }
        }

        function renderPlannerAgenda(entries) {
            const agenda = document.getElementById('planner-agenda-list');
            const dateInput = document.getElementById('planner-agenda-date');
            if (!agenda || !dateInput) return;
            dateInput.value = plannerSelectedDate || '';
            const dayEntries = entries.filter(entry => entry.date === plannerSelectedDate);
            if (!dayEntries.length) {
                agenda.innerHTML = `<div class="rounded-lg border border-dashed border-indigo-200 bg-white/70 px-3 py-5 text-center text-sm text-slate-500">${escapeHtml(formatPlannerDate(plannerSelectedDate))} 還沒有安排。<br><span class="text-xs text-slate-400">可以先把下一件想一起做的事排進來。</span></div>`;
                return;
            }
            agenda.innerHTML = dayEntries.map(entry => {
                const source = getPlannerEntrySource(entry);
                const creator = getPlannerCreatorName(source?.createdByUid);
                const detail = entry.kind === 'event'
                    ? [entry.startTime, entry.endTime, entry.location].filter(Boolean).join(' · ') || '未設定時間'
                    : entry.kind === 'anniversary'
                        ? '每年重複'
                        : entry.completed ? '已完成' : '共同計畫';
                const tone = entry.kind === 'anniversary'
                    ? 'border-rose-100 bg-rose-50 text-rose-800'
                    : entry.kind === 'event'
                        ? 'border-teal-100 bg-teal-50 text-teal-800'
                        : entry.completed ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-indigo-100 bg-white text-indigo-800';
                const className = entry.kind === 'anniversary' ? 'planner-agenda-anniversary' : entry.kind === 'event' ? 'planner-agenda-event' : 'planner-agenda-entry';
                const planAttrs = entry.kind === 'event' || entry.kind === 'anniversary'
                    ? ''
                    : `data-col="${escapeHtml(entry.collectionId)}"`;
                return `<button type="button" class="${className} flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left ${tone} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" data-id="${escapeHtml(entry.id)}" ${planAttrs} aria-label="開啟${escapeHtml(entry.kind === 'anniversary' ? '紀念日' : '共同計畫')}：${escapeHtml(entry.title)}"><span class="min-w-0"><span class="block truncate font-bold">${escapeHtml(entry.kind === 'anniversary' ? '♥' : entry.kind === 'event' ? '行程' : PLAN_KINDS[entry.kind])} · ${escapeHtml(entry.title)}</span><span class="mt-1 block text-xs opacity-75">${escapeHtml(detail)}</span></span><span class="shrink-0 text-[11px] opacity-70">建立者：${escapeHtml(creator)}</span></button>`;
            }).join('');
        }

        function renderCouplePlanner() {
            const calendar = document.getElementById('planner-calendar');
            const wishes = document.getElementById('planner-wishes');
            const upcoming = document.getElementById('planner-upcoming');
            const anniversaryList = document.getElementById('anniversary-list');
            const year = plannerMonth.getFullYear();
            const month = plannerMonth.getMonth() + 1;
            document.getElementById('planner-month-label').textContent = `${year} 年 ${month} 月`;
            document.getElementById('planner-add-event').disabled = !currentUser;
            renderPlannerSyncStatus();
            renderPlannerCollaborationMeta();
            if (!currentUser) {
                calendar.innerHTML = '';
                wishes.innerHTML = '';
                document.getElementById('planner-agenda-list').innerHTML = '';
                upcoming.textContent = '登入後即可查看共同日曆與紀念日。';
                anniversaryList.innerHTML = '';
                return;
            }

            const today = new Date();
            const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
            if (!parseDateKey(plannerSelectedDate)) setPlannerSelectedDate(todayKey);
            const soon = getUpcomingAnniversaries(currentAnniversaries, todayKey);
            upcoming.textContent = soon.length
                ? `即將到來：${soon.map(item => `${item.occurrence} ${item.title}`).join('、')}`
                : '未來 30 天沒有紀念日。';
            anniversaryList.innerHTML = currentAnniversaries.length
                ? currentAnniversaries.map(item => `<span class="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-rose-700"><span>${escapeHtml(item.title)} · ${escapeHtml(item.date)} 每年</span><button type="button" class="edit-anniversary hover:text-rose-900" data-id="${escapeHtml(item.id)}" aria-label="編輯 ${escapeHtml(item.title)}"><i class="fas fa-pen text-[10px]" aria-hidden="true"></i></button><button type="button" class="delete-anniversary hover:text-rose-900" data-id="${escapeHtml(item.id)}" aria-label="刪除 ${escapeHtml(item.title)}"><i class="fas fa-xmark text-[10px]" aria-hidden="true"></i></button></span>`).join('')
                : '<span class="text-slate-400">尚未加入紀念日</span>';

            const groups = getPlannerTodoGroups();
            const unscheduledWishes = groups.flatMap(group => group.items
                .filter(item => getPlanKind(item) === 'wish' && !parseDateKey(item.planDate) && !item.completed)
                .map(item => ({ ...item, collectionId: group.id })));
            wishes.innerHTML = unscheduledWishes.length
                ? unscheduledWishes.map(item => `<button type="button" class="planner-entry max-w-full truncate rounded-full bg-amber-50 px-3 py-1.5 text-left text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" data-col="${escapeHtml(item.collectionId)}" data-id="${escapeHtml(item.id)}" title="開啟願望卡片">${escapeHtml(item.text || '無標題')}</button>`).join('')
                : '<span class="text-xs text-slate-400">還沒有未排期的願望</span>';
            const entries = getCalendarEntries(groups, currentAnniversaries, year, month, currentCalendarEvents);
            renderPlannerAgenda(entries);
            const byDate = new Map();
            for (const entry of entries) {
                if (!byDate.has(entry.date)) byDate.set(entry.date, []);
                byDate.get(entry.date).push(entry);
            }
            const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
            const daysInMonth = new Date(year, month, 0).getDate();
            const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
            calendar.innerHTML = weekdays.map(day => `<div class="py-1 text-center text-xs font-bold text-slate-400">${day}</div>`).join('')
                + Array.from({ length: firstWeekday }, () => '<div aria-hidden="true"></div>').join('')
                + Array.from({ length: daysInMonth }, (_, index) => {
                    const day = index + 1;
                    const key = dateKey(year, month, day);
                    const items = (byDate.get(key) || []).map(entry => {
                        const source = getPlannerEntrySource(entry);
                        const creator = getPlannerCreatorName(source?.createdByUid);
                        if (entry.kind === 'anniversary') {
                            return `<button type="button" class="calendar-anniversary-entry block w-full truncate rounded bg-rose-100 px-1.5 py-1 text-left text-[11px] text-rose-700 hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" data-id="${escapeHtml(entry.id)}" title="編輯紀念日：${escapeHtml(entry.title)}">♥ ${escapeHtml(entry.title)}</button>`;
                        }
                        if (entry.kind === 'event') {
                            const time = entry.startTime ? `${entry.startTime} ` : '';
                            const description = [entry.title, entry.startTime, entry.endTime, entry.location, `建立者：${creator}`].filter(Boolean).join(' · ');
                            return `<button type="button" class="calendar-event-entry block w-full truncate rounded bg-teal-50 px-1.5 py-1 text-left text-xs text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(description)}">${escapeHtml(time)}${escapeHtml(entry.title)}</button>`;
                        }
                        return `<button type="button" class="planner-entry block w-full truncate rounded px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${entry.completed ? 'bg-slate-100 text-slate-500 line-through' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}" data-col="${escapeHtml(entry.collectionId)}" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.title)} · 建立者：${escapeHtml(creator)}">${escapeHtml(PLAN_KINDS[entry.kind])} · ${escapeHtml(entry.title)}</button>`;
                    }).join('');
                    return `<div class="planner-calendar-day min-h-20 min-w-0 cursor-pointer rounded-lg border ${key === todayKey ? 'border-rose-300 bg-rose-50/30' : 'border-slate-100'} p-1 hover:bg-indigo-50/50" data-date="${key}"><button type="button" class="planner-day mb-1 rounded px-1 text-xs font-bold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" data-date="${key}" aria-label="在 ${year} 年 ${month} 月 ${day} 日排行程">${day}</button><div class="space-y-1">${items}</div></div>`;
                }).join('');
        }

        const monthJumpContainer = document.getElementById('planner-month-jump-container');
        const monthJumpToggle = document.getElementById('planner-month-toggle');
        const monthJumpForm = document.getElementById('planner-month-jump');
        const monthJumpInput = document.getElementById('planner-month-input');

        function closeMonthJump(restoreFocus = false) {
            monthJumpForm.hidden = true;
            monthJumpToggle.setAttribute('aria-expanded', 'false');
            if (restoreFocus) monthJumpToggle.focus();
        }

        monthJumpToggle.addEventListener('click', () => {
            if (!monthJumpForm.hidden) { closeMonthJump(); return; }
            monthJumpInput.value = dateKey(plannerMonth.getFullYear(), plannerMonth.getMonth() + 1, 1).slice(0, 7);
            monthJumpForm.hidden = false;
            monthJumpToggle.setAttribute('aria-expanded', 'true');
            monthJumpInput.focus();
        });
        document.getElementById('planner-month-cancel').addEventListener('click', () => closeMonthJump(true));
        monthJumpForm.addEventListener('submit', event => {
            event.preventDefault();
            const selected = parseDateKey(`${monthJumpInput.value}-01`);
            if (!selected) { monthJumpInput.setCustomValidity('請選擇有效年月'); monthJumpInput.reportValidity(); return; }
            monthJumpInput.setCustomValidity('');
            setPlannerSelectedDate(dateKey(selected.year, selected.month, 1));
            closeMonthJump(true);
            renderCouplePlanner();
        });
        monthJumpInput.addEventListener('input', () => monthJumpInput.setCustomValidity(''));
        document.addEventListener('pointerdown', event => {
            if (!monthJumpForm.hidden && !monthJumpContainer.contains(event.target)) closeMonthJump();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !monthJumpForm.hidden) { event.preventDefault(); closeMonthJump(true); }
        });
        document.getElementById('planner-prev-month').addEventListener('click', () => {
            closeMonthJump();
            setPlannerSelectedDate(dateKey(plannerMonth.getFullYear(), plannerMonth.getMonth(), 1));
            renderCouplePlanner();
        });
        document.getElementById('planner-next-month').addEventListener('click', () => {
            closeMonthJump();
            setPlannerSelectedDate(dateKey(plannerMonth.getFullYear(), plannerMonth.getMonth() + 2, 1));
            renderCouplePlanner();
        });
        document.getElementById('planner-today').addEventListener('click', () => {
            closeMonthJump();
            const today = new Date();
            setPlannerSelectedDate(dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate()));
            renderCouplePlanner();
        });
        document.getElementById('planner-agenda-date').addEventListener('change', event => {
            if (!setPlannerSelectedDate(event.target.value)) {
                event.target.value = plannerSelectedDate;
                return;
            }
            renderCouplePlanner();
        });
        function movePlannerAgendaDate(offset) {
            const parsed = parseDateKey(plannerSelectedDate);
            if (!parsed) return;
            const next = new Date(parsed.year, parsed.month - 1, parsed.day + offset);
            setPlannerSelectedDate(dateKey(next.getFullYear(), next.getMonth() + 1, next.getDate()));
            renderCouplePlanner();
        }
        document.getElementById('planner-agenda-prev').addEventListener('click', () => movePlannerAgendaDate(-1));
        document.getElementById('planner-agenda-next').addEventListener('click', () => movePlannerAgendaDate(1));
        document.getElementById('planner-agenda-add').addEventListener('click', () => {
            openPlannerEntryModal(null, '', plannerSelectedDate, 'event');
        });
        function openAnniversaryEditor(id) {
            const item = currentAnniversaries.find(value => value.id === id);
            if (!item) return;
            activeAnniversaryId = item.id;
            document.getElementById('anniversary-title').value = item.title || '';
            document.getElementById('anniversary-date').value = item.date || '';
            document.getElementById('anniversary-submit').textContent = '儲存紀念日';
            document.getElementById('anniversary-cancel-edit').classList.remove('hidden');
            document.getElementById('anniversary-title').focus();
        }
        function closeAnniversaryEditor() {
            activeAnniversaryId = null;
            document.getElementById('anniversary-form').reset();
            document.getElementById('anniversary-submit').textContent = '新增紀念日';
            document.getElementById('anniversary-cancel-edit').classList.add('hidden');
        }
        function openPlannerEntry(event) {
            const anniversaryButton = event.target.closest('.calendar-anniversary-entry');
            if (anniversaryButton) {
                openAnniversaryEditor(anniversaryButton.dataset.id);
                return;
            }
            const calendarEventButton = event.target.closest('.calendar-event-entry');
            if (calendarEventButton) {
                const item = currentCalendarEvents.find(value => value.id === calendarEventButton.dataset.id);
                if (item) {
                    setPlannerSelectedDate(item.date);
                    openPlannerEntryModal(item, 'calendarEvents');
                }
                return;
            }
            const dayButton = event.target.closest('.planner-day');
            if (dayButton) {
                setPlannerSelectedDate(dayButton.dataset.date);
                openPlannerEntryModal(null, '', dayButton.dataset.date, 'event');
                return;
            }
            const button = event.target.closest('.planner-entry');
            if (button) {
                const item = currentItemsByCollection.get(button.dataset.col)?.find(value => value.id === button.dataset.id);
                if (item) {
                    if (item.planDate) setPlannerSelectedDate(item.planDate);
                    openPlannerEntryModal(item, button.dataset.col);
                }
                return;
            }
            const dayCell = event.target.closest('.planner-calendar-day');
            if (dayCell) {
                setPlannerSelectedDate(dayCell.dataset.date);
                openPlannerEntryModal(null, '', dayCell.dataset.date, 'event');
            }
        }
        document.getElementById('planner-calendar').addEventListener('click', openPlannerEntry);
        document.getElementById('planner-wishes').addEventListener('click', openPlannerEntry);
        document.getElementById('planner-agenda-list').addEventListener('click', event => {
            const anniversaryButton = event.target.closest('.planner-agenda-anniversary');
            if (anniversaryButton) {
                openAnniversaryEditor(anniversaryButton.dataset.id);
                return;
            }
            const eventButton = event.target.closest('.planner-agenda-event');
            if (eventButton) {
                const item = currentCalendarEvents.find(value => value.id === eventButton.dataset.id);
                if (item) openPlannerEntryModal(item, 'calendarEvents');
                return;
            }
            const planButton = event.target.closest('.planner-agenda-entry');
            if (planButton) {
                const item = currentItemsByCollection.get(planButton.dataset.col)?.find(value => value.id === planButton.dataset.id);
                if (item) openPlannerEntryModal(item, planButton.dataset.col);
            }
        });
        document.getElementById('planner-add-event').addEventListener('click', () => {
            const today = new Date();
            const visibleMonth = plannerMonth.getMonth() === today.getMonth() && plannerMonth.getFullYear() === today.getFullYear();
            openPlannerEntryModal(null, '', parseDateKey(plannerSelectedDate) && visibleMonth
                ? plannerSelectedDate
                : visibleMonth
                ? dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate())
                : dateKey(plannerMonth.getFullYear(), plannerMonth.getMonth() + 1, 1), 'event');
        });

        const calendarEventModal = document.getElementById('calendar-event-modal');
        const calendarEventForm = document.getElementById('calendar-event-form');
        const plannerEntryType = document.getElementById('planner-entry-type');
        const plannerEntryCategory = document.getElementById('planner-entry-category');
        const plannerEntryPlanFields = document.getElementById('planner-entry-plan-fields');
        const plannerEntryEventFields = document.getElementById('planner-entry-event-fields');
        const plannerEntryDate = document.getElementById('calendar-event-date');
        let plannerEntryPreviousFocus = null;
        let plannerEntryBusy = false;

        function showPlannerEntryError(message) {
            const error = document.getElementById('calendar-event-error');
            error.textContent = message;
            error.classList.toggle('hidden', !message);
        }

        function populatePlannerEntryCategories(selectedId = '') {
            const todoCategories = currentCategories.filter(category => category.type === 'todo');
            plannerEntryCategory.innerHTML = '';
            if (!todoCategories.length) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '尚無可用的待辦分類';
                plannerEntryCategory.appendChild(option);
                plannerEntryCategory.disabled = true;
                return;
            }
            todoCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name || category.id;
                plannerEntryCategory.appendChild(option);
            });
            plannerEntryCategory.disabled = false;
            plannerEntryCategory.value = todoCategories.some(category => category.id === selectedId)
                ? selectedId : todoCategories[0].id;
        }

        function setPlannerEntryTypeOptions(storageType, selectedKind) {
            const kinds = storageType === 'event'
                ? ['event']
                : storageType === 'plan'
                    ? ['task', 'wish', 'date']
                    : ['event', 'task', 'wish', 'date'];
            plannerEntryType.innerHTML = kinds.map(kind => `<option value="${kind}">${kind === 'event' ? '行程' : escapeHtml(PLAN_KINDS[kind])}</option>`).join('');
            plannerEntryType.value = kinds.includes(selectedKind) ? selectedKind : kinds[0];
        }

        function updatePlannerEntryForm() {
            const kind = plannerEntryType.value;
            const isEvent = kind === 'event';
            const isPlan = !isEvent;
            const isDate = kind === 'date';
            plannerEntryPlanFields.classList.toggle('hidden', !isPlan);
            plannerEntryEventFields.classList.toggle('hidden', !isEvent);
            plannerEntryCategory.required = isPlan;
            plannerEntryDate.required = isEvent || isDate;
            document.getElementById('planner-entry-date-hint').textContent = plannerEntryDate.required ? '（必填）' : '（可不填）';
            document.getElementById('calendar-event-title').placeholder = isEvent ? '例如：週末看電影' : '例如：一起完成這件事';
            document.getElementById('calendar-event-modal-title').textContent = activePlannerEntry
                ? (isEvent ? '編輯行程' : '編輯共同計畫')
                : '新增共同計畫';
            document.getElementById('planner-entry-intro').textContent = isEvent
                ? '記下時間、地點與備註，讓下一次見面有清楚安排。'
                : '把一起要做的事、想去的地方或約會放在同一份計畫裡。';
            document.getElementById('planner-entry-mode-badge').textContent = activePlannerEntry ? '編輯中' : '共同入口';
            document.getElementById('calendar-event-delete').textContent = isEvent ? '刪除行程' : '刪除計畫';
            document.getElementById('calendar-event-save').textContent = isEvent ? '儲存行程' : '儲存計畫';
            document.getElementById('planner-entry-open-editor').classList.toggle('hidden', !(activePlannerEntry?.storageType === 'plan' && isPlan));
        }

        function buildPlannerCardData(fields) {
            const data = {
                text: fields.title,
                cardSearchText: fields.title.toLocaleLowerCase('zh-Hant'),
                planKind: fields.planKind
            };
            if (fields.planDate) data.planDate = fields.planDate;
            return data;
        }

        async function savePlannerCard(fields) {
            const targetCollection = fields.categoryId;
            const data = buildPlannerCardData(fields);
            const activePlan = activePlannerEntry?.storageType === 'plan' ? activePlannerEntry : null;
            if (!activePlan) {
                const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection), {
                    ...data, createdAt: Date.now(), createdByUid: currentUser.uid, order: Date.now()
                });
                return { wasEditing: false, id: docRef.id };
            }

            const sourceRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), activePlan.collectionId, activePlan.id);
            const sourceSnap = await getDoc(sourceRef);
            if (!sourceSnap.exists()) throw new Error('找不到這筆共同計畫，請重新整理後再試');
            const nextData = { ...sourceSnap.data(), ...data };
            if (!fields.planDate) delete nextData.planDate;
            if (targetCollection === activePlan.collectionId) {
                await setDoc(sourceRef, nextData);
            } else {
                await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection, activePlan.id), nextData);
                await copyCardDetails(activePlan.collectionId, targetCollection, activePlan.id, activePlan.id);
                await deleteDoc(sourceRef);
            }
            return { wasEditing: true, moved: targetCollection !== activePlan.collectionId, id: activePlan.id };
        }

        function openPlannerEntryModal(item = null, collectionId = '', initialDate = '', defaultKind = 'event') {
            if (!currentUser) { showToast('請先登入', 'fas fa-right-to-bracket'); return; }
            plannerEntryPreviousFocus = document.activeElement;
            const storageType = item ? (collectionId === 'calendarEvents' ? 'event' : 'plan') : null;
            activePlannerEntry = item
                ? { id: item.id, item, storageType, collectionId: storageType === 'event' ? 'calendarEvents' : collectionId }
                : null;
            calendarEventForm.reset();
            const selectedKind = item
                ? storageType === 'event' ? 'event' : getPlanKind(item)
                : defaultKind;
            setPlannerEntryTypeOptions(storageType, selectedKind);
            populatePlannerEntryCategories(storageType === 'plan' ? collectionId : collectionId);
            document.getElementById('calendar-event-title').value = item?.title || item?.text || '';
            plannerEntryDate.value = item?.date || item?.planDate || initialDate;
            document.getElementById('calendar-event-start').value = item?.startTime || '';
            document.getElementById('calendar-event-end').value = item?.endTime || '';
            document.getElementById('calendar-event-location').value = item?.location || '';
            document.getElementById('calendar-event-notes').value = item?.notes || '';
            document.getElementById('calendar-event-delete').classList.toggle('hidden', !item);
            showPlannerEntryError('');
            updatePlannerEntryForm();
            calendarEventModal.classList.remove('hidden');
            keyLayers.push({ name: 'calendar-event', keys: modalKeys(closePlannerEntryModal) });
            document.getElementById('calendar-event-title').focus();
        }

        function closePlannerEntryModal() {
            if (plannerEntryBusy) return;
            calendarEventModal.classList.add('hidden');
            keyLayers.pop('calendar-event');
            activePlannerEntry = null;
            plannerEntryPreviousFocus?.focus?.();
        }

        calendarEventModal.addEventListener('keydown', event => trapDialogTab(calendarEventModal, event));
        calendarEventModal.addEventListener('click', event => {
            if (event.target === calendarEventModal) closePlannerEntryModal();
        });
        plannerEntryType.addEventListener('change', updatePlannerEntryForm);
        document.getElementById('calendar-event-cancel').addEventListener('click', closePlannerEntryModal);
        document.getElementById('planner-entry-open-editor').addEventListener('click', () => {
            if (!activePlannerEntry || activePlannerEntry.storageType !== 'plan') return;
            const { id, item, collectionId } = activePlannerEntry;
            closePlannerEntryModal();
            void openEditor(id, item.text, collectionId);
        });
        calendarEventForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (!currentUser || plannerEntryBusy) return;
            const kind = plannerEntryType.value;
            let fields;
            try {
                if (kind === 'event') {
                    fields = normalizeCalendarEvent({
                        title: document.getElementById('calendar-event-title').value,
                        date: plannerEntryDate.value,
                        startTime: document.getElementById('calendar-event-start').value,
                        endTime: document.getElementById('calendar-event-end').value,
                        location: document.getElementById('calendar-event-location').value,
                        notes: document.getElementById('calendar-event-notes').value
                    });
                } else {
                    fields = normalizePlannerCard({
                        title: document.getElementById('calendar-event-title').value,
                        planKind: kind,
                        planDate: plannerEntryDate.value,
                        categoryId: plannerEntryCategory.value
                    });
                }
            } catch (error) { showPlannerEntryError(error.message); return; }
            const button = document.getElementById('calendar-event-save');
            const deleteButton = document.getElementById('calendar-event-delete');
            plannerEntryBusy = true;
            button.disabled = true;
            deleteButton.disabled = true;
            showPlannerEntryError('');
            try {
                const spaceId = getActiveSpaceId();
                const wasEditing = Boolean(activePlannerEntry);
                let result;
                if (kind === 'event') {
                    if (activePlannerEntry?.storageType === 'event') {
                        const eventRef = doc(db, 'artifacts', appId, 'users', spaceId, 'calendarEvents', activePlannerEntry.id);
                        const oldSnapshot = await getDoc(eventRef);
                        if (!oldSnapshot.exists()) throw new Error('找不到這筆行程，請重新整理後再試');
                        const oldData = oldSnapshot.data();
                        const newData = { ...oldData, ...fields };
                        await updateDoc(eventRef, fields);
                        historyManager.push({
                            undo: async () => { await setDoc(eventRef, oldData); showToast('行程修改已復原', 'fas fa-undo'); },
                            redo: async () => { await setDoc(eventRef, newData); showToast('行程修改已重做', 'fas fa-redo'); }
                        });
                    } else {
                        const data = { ...fields, createdAt: Date.now(), createdByUid: currentUser.uid };
                        const eventRef = await addDoc(collection(db, 'artifacts', appId, 'users', spaceId, 'calendarEvents'), data);
                        historyManager.push({
                            undo: async () => { await deleteDoc(eventRef); showToast('新增行程已復原', 'fas fa-undo'); },
                            redo: async () => { await setDoc(eventRef, data); showToast('行程已重做', 'fas fa-redo'); }
                        });
                    }
                    result = { wasEditing };
                } else {
                    result = await savePlannerCard(fields);
                }
                plannerEntryBusy = false;
                closePlannerEntryModal();
                if (kind === 'event') showToast(result.wasEditing ? '行程已更新' : '行程已排入日曆', 'fas fa-calendar-days');
                else showToast(result.wasEditing ? (result.moved ? '共同計畫已更新並移動分類' : '共同計畫已更新') : '共同計畫已建立', 'fas fa-list-check');
            } catch (error) {
                console.error('儲存共同計畫失敗', error);
                showPlannerEntryError('儲存失敗，請重試。');
            } finally { plannerEntryBusy = false; button.disabled = false; deleteButton.disabled = false; }
        });
        document.getElementById('calendar-event-delete').addEventListener('click', async () => {
            if (!currentUser || plannerEntryBusy || !activePlannerEntry || !confirm(`刪除這筆${activePlannerEntry.storageType === 'event' ? '行程' : '共同計畫'}？`)) return;
            const button = document.getElementById('calendar-event-delete');
            const saveButton = document.getElementById('calendar-event-save');
            const deletedStorageType = activePlannerEntry.storageType;
            const spaceId = getActiveSpaceId();
            plannerEntryBusy = true;
            button.disabled = true;
            saveButton.disabled = true;
            try {
                const collectionName = activePlannerEntry.storageType === 'event' ? 'calendarEvents' : activePlannerEntry.collectionId;
                const deletedRef = doc(db, 'artifacts', appId, 'users', spaceId, collectionName, activePlannerEntry.id);
                const oldSnapshot = await getDoc(deletedRef);
                if (!oldSnapshot.exists()) throw new Error('找不到要刪除的項目');
                const oldData = oldSnapshot.data();
                await deleteDoc(deletedRef);
                historyManager.push({
                    undo: async () => { await setDoc(deletedRef, oldData); showToast('項目已復原', 'fas fa-undo'); },
                    redo: async () => { await deleteDoc(deletedRef); showToast('項目已再次刪除', 'fas fa-redo'); }
                });
                plannerEntryBusy = false;
                closePlannerEntryModal();
                showToast(deletedStorageType === 'event' ? '行程已刪除' : '共同計畫已刪除', 'fas fa-trash-alt', { label: '復原', onClick: () => historyManager.undo() });
            } catch (error) {
                console.error('刪除共同計畫失敗', error);
                showPlannerEntryError('刪除失敗，請重試。');
            } finally { plannerEntryBusy = false; button.disabled = false; saveButton.disabled = false; }
        });
        document.getElementById('anniversary-list').addEventListener('click', async event => {
            const editButton = event.target.closest('.edit-anniversary');
            if (editButton) {
                openAnniversaryEditor(editButton.dataset.id);
                return;
            }
            const button = event.target.closest('.delete-anniversary');
            if (!button || !currentUser || !confirm('刪除這個紀念日？')) return;
            const spaceId = getActiveSpaceId();
            const anniversaryRef = doc(db, 'artifacts', appId, 'users', spaceId, 'anniversaries', button.dataset.id);
            try {
                const snapshot = await getDoc(anniversaryRef);
                if (!snapshot.exists()) throw new Error('找不到這個紀念日');
                const oldData = snapshot.data();
                await deleteDoc(anniversaryRef);
                historyManager.push({
                    undo: async () => {
                        await setDoc(anniversaryRef, oldData);
                        showToast('紀念日已復原', 'fas fa-undo');
                    },
                    redo: async () => {
                        await deleteDoc(anniversaryRef);
                        showToast('紀念日已再次刪除', 'fas fa-redo');
                    }
                });
                showToast('紀念日已刪除', 'fas fa-trash-alt', { label: '復原', onClick: () => historyManager.undo() });
            } catch (error) {
                console.error('刪除紀念日失敗', error);
                showToast('刪除紀念日失敗', 'fas fa-triangle-exclamation');
            }
        });
        document.getElementById('anniversary-cancel-edit').addEventListener('click', closeAnniversaryEditor);
        document.getElementById('anniversary-form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            if (!currentUser) { showToast('請先登入', 'fas fa-right-to-bracket'); return; }
            const title = document.getElementById('anniversary-title').value.trim();
            const date = document.getElementById('anniversary-date').value;
            if (!title || !parseDateKey(date)) return;
            const button = document.getElementById('anniversary-submit');
            const editingId = activeAnniversaryId;
            const spaceId = getActiveSpaceId();
            button.disabled = true;
            try {
                if (editingId) {
                    const anniversaryRef = doc(db, 'artifacts', appId, 'users', spaceId, 'anniversaries', editingId);
                    const oldSnapshot = await getDoc(anniversaryRef);
                    if (!oldSnapshot.exists()) throw new Error('找不到這個紀念日');
                    const oldData = oldSnapshot.data();
                    const newData = { ...oldData, title, date };
                    await updateDoc(anniversaryRef, { title, date });
                    historyManager.push({
                        undo: async () => { await setDoc(anniversaryRef, oldData); showToast('紀念日修改已復原', 'fas fa-undo'); },
                        redo: async () => { await setDoc(anniversaryRef, newData); showToast('紀念日修改已重做', 'fas fa-redo'); }
                    });
                    closeAnniversaryEditor();
                    showToast('紀念日已更新', 'fas fa-pen');
                } else {
                    const data = { title, date, createdAt: Date.now(), createdByUid: currentUser.uid };
                    const anniversaryRef = await addDoc(collection(db, 'artifacts', appId, 'users', spaceId, 'anniversaries'), data);
                    historyManager.push({
                        undo: async () => { await deleteDoc(anniversaryRef); showToast('新增紀念日已復原', 'fas fa-undo'); },
                        redo: async () => { await setDoc(anniversaryRef, data); showToast('紀念日已重做', 'fas fa-redo'); }
                    });
                    closeAnniversaryEditor();
                    showToast('已新增每年重複的紀念日', 'fas fa-heart');
                }
            } catch (error) {
                console.error('儲存紀念日失敗', error);
                showToast('儲存紀念日失敗', 'fas fa-triangle-exclamation');
            } finally { button.disabled = false; }
        });

        const initDragAndDrop = () => {
            document.querySelectorAll('.sortable-list').forEach(list => {
                new Sortable(list, {
                    group: 'shared', animation: 150, delay: 150, delayOnTouchOnly: true, fallbackTolerance: 5, forceFallback: true, fallbackClass: 'sortable-fallback',
                    ghostClass: 'sortable-ghost', dragClass: 'sortable-drag', filter: '.ignore-drag',
                    onStart: function () { document.body.classList.add('is-dragging'); },
                    onChange: function (evt) {
                        document.querySelectorAll('.is-dragover').forEach(el => el.classList.remove('is-dragover'));
                        if(evt.to && evt.to !== evt.from) {
                            const wrapper = evt.to.closest('.category-wrapper');
                            if(wrapper) wrapper.classList.add('is-dragover');
                        }
                    },
                    onLeave: function (evt) {
                        const listEl = evt.el || evt.from;
                        if (listEl) {
                            const wrapper = listEl.closest('.category-wrapper');
                            if (wrapper) wrapper.classList.remove('is-dragover');
                        }
                    },
                    onEnd: async function (evt) {
                        document.body.classList.remove('is-dragging');
                        document.querySelectorAll('.is-dragover').forEach(el => el.classList.remove('is-dragover'));
                        
                        justDropped = true; setTimeout(() => justDropped = false, 100);
                        
                        const itemEl = evt.item; const id = itemEl.getAttribute('data-id');
                        const oldCol = evt.from.getAttribute('data-col'); 
                        let newCol = evt.to.getAttribute('data-col');
                        let droppedOnSidebar = false;

                        if (evt.originalEvent) {
                            const touch = evt.originalEvent.touches ? (evt.originalEvent.touches[0] || evt.originalEvent.changedTouches[0]) : evt.originalEvent;
                            if (touch) {
                                const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
                                const sidebarLink = targetEl ? targetEl.closest('.sidebar-link') : null;
                                if (sidebarLink) {
                                    const targetCol = sidebarLink.getAttribute('data-target');
                                    if (targetCol && targetCol !== oldCol) {
                                        newCol = targetCol;
                                        droppedOnSidebar = true;
                                        itemEl.remove();
                                    } else if (targetCol === oldCol) {
                                        return;
                                    }
                                }
                            }
                        }

                        if(!id || !currentUser) return;

                        let newOrder = Date.now(); 
                        if (!droppedOnSidebar) {
                            const prevEl = itemEl.previousElementSibling; const nextEl = itemEl.nextElementSibling;
                            const isValid = (el) => el && el.hasAttribute('data-order');
                            const prevOrder = isValid(prevEl) ? parseFloat(prevEl.getAttribute('data-order')) : null;
                            const nextOrder = isValid(nextEl) ? parseFloat(nextEl.getAttribute('data-order')) : null;

                            if (prevOrder !== null && nextOrder !== null) newOrder = (prevOrder + nextOrder) / 2;
                            else if (prevOrder !== null) newOrder = prevOrder - 1000;
                            else if (nextOrder !== null) newOrder = nextOrder + 1000;
                        }

                        try {
                            const docRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id);
                            if (oldCol === newCol) {
                                if (evt.oldIndex !== evt.newIndex) await updateDoc(docRef, { order: newOrder });
                            } else {
                                const oldSnap = await getDoc(docRef);
                                if (oldSnap.exists()) {
                                    let data = oldSnap.data(); data.order = newOrder;
                                    const targetCat = currentCategories.find(c => c.id === newCol);
                                    const isTodoCol = newCol === 'todos' || (targetCat && targetCat.type === 'todo');
                                    if(!isTodoCol) delete data.completed;
                                    
                                    const oldData = oldSnap.data();
                                    const oldOrder = oldData.order || Date.now();
                                    const shortText = getShortText(data.text);
                                    const oldName = getCollectionName(oldCol);
                                    const newName = getCollectionName(newCol);
                                    
                                    historyManager.push({
                                        undo: async () => {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id), oldData);
                                            await copyCardDetails(newCol, oldCol, id, id);
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), newCol, id));
                                            showToast(`已還原：將「${shortText}」放回 [${oldName}]`, 'fas fa-undo');
                                        },
                                        redo: async () => {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), newCol, id), data);
                                            await copyCardDetails(oldCol, newCol, id, id);
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id));
                                            showToast(`已重做：將「${shortText}」移至 [${newName}]`, 'fas fa-redo');
                                        }
                                    });

                                    await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), newCol, id), data);
                                    await copyCardDetails(oldCol, newCol, id, id);
                                    await deleteDoc(docRef);
                                    showToast(`已將「${shortText}」移至 [${newName}]`, 'fas fa-exchange-alt');
                                }
                            }
                        } catch(err) { console.error(err); }
                    }
                });
            });
        };
        initDragAndDrop();


        const initAuth = async () => { if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) try { await signInWithCustomToken(auth, __initial_auth_token); } catch (e) {} };
        initAuth();

        document.getElementById('login-btn').addEventListener('click', async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert("登入失敗：" + e.message); } });
        document.getElementById('logout-btn').addEventListener('click', async () => { try { await signOut(auth); window.location.reload(); } catch (e) {} });


        const categoryModal = document.getElementById('category-manager-modal');
        const catIcons = [
            'fas fa-folder', 'fas fa-star', 'fas fa-heart', 'fas fa-bolt', 'fas fa-check-square', 'fas fa-lightbulb', 'fas fa-bookmark', 'fas fa-book',
            'fas fa-briefcase', 'fas fa-graduation-cap', 'fas fa-laptop-code', 'fas fa-chart-line', 'fas fa-bullseye', 'fas fa-code', 'fas fa-server', 'fas fa-robot',
            'fas fa-shopping-cart', 'fas fa-shirt', 'fas fa-glasses', 'fas fa-shopping-bag', 'fas fa-tag', 'fas fa-wallet', 'fas fa-dollar-sign',
            'fas fa-plane', 'fas fa-music', 'fas fa-video', 'fas fa-gamepad', 'fas fa-dumbbell', 'fas fa-utensils', 'fas fa-coffee',
            'fas fa-pen', 'fas fa-sticky-note', 'fas fa-list', 'fas fa-focus-open', 'fas fa-tasks', 'fas fa-calendar-alt', 'fas fa-clock', 'fas fa-microphone', 'fas fa-camera',
            'fas fa-piggy-bank', 'fas fa-car', 'fas fa-house', 'fas fa-gift', 'fas fa-paw', 'fas fa-seedling', 'fas fa-map-marker-alt', 'fas fa-fire',
            'fas fa-headphones', 'fas fa-tv', 'fas fa-film', 'fas fa-heartbeat', 'fas fa-pills', 'fas fa-apple-alt', 'fas fa-key', 'fas fa-database',
            'fas fa-mobile-alt', 'fas fa-wifi', 'fas fa-tools', 'fas fa-user', 'fas fa-users', 'fas fa-comments', 'fas fa-sun', 'fas fa-moon', 'fas fa-cloud'
        ];
        
        function closeCategoryModal() {
            categoryModal.classList.add('hidden');
            keyLayers.pop('category');
        }

        document.getElementById('manage-categories-btn').addEventListener('click', () => {
            closeSidebar();
            categoryModal.classList.remove('hidden');
            keyLayers.push({ name: 'category', keys: modalKeys(closeCategoryModal) });
            resetCategoryForm();
        });
        document.getElementById('close-category-modal-btn').addEventListener('click', () => closeCategoryModal());
        document.getElementById('cat-cancel-btn').addEventListener('click', () => {
            resetCategoryForm();
            closeCategoryModal();
        });
        categoryModal.addEventListener('click', (e) => {
            if (e.target === categoryModal) {
                closeCategoryModal();
            }
        });
        document.getElementById('add-category-btn').addEventListener('click', resetCategoryForm);

        function renderIconPicker() {
            const picker = document.getElementById('cat-icon-picker');
            picker.innerHTML = '';
            catIcons.forEach(icon => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `aspect-square w-full sm:max-w-[3rem] mx-auto rounded-xl border flex items-center justify-center text-xl transition-all ${document.getElementById('cat-icon-input').value === icon ? 'bg-indigo-100 border-indigo-500 text-indigo-600 shadow-sm scale-110 z-10' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105'}`;
                btn.innerHTML = `<i class="${icon}"></i>`;
                btn.onclick = () => {
                    document.getElementById('cat-icon-input').value = icon;
                    renderIconPicker();
                };
                picker.appendChild(btn);
            });
        }

        document.querySelectorAll('.cat-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.cat-type-btn').forEach(b => {
                    b.classList.remove('border-indigo-500', 'bg-indigo-50', 'text-indigo-600', 'active-type');
                    b.classList.add('border-slate-200', 'text-slate-600');
                });
                const target = e.currentTarget;
                target.classList.remove('border-slate-200', 'text-slate-600');
                target.classList.add('border-indigo-500', 'bg-indigo-50', 'text-indigo-600', 'active-type');
                document.getElementById('cat-type-input').value = target.getAttribute('data-type');
            });
        });

        function resetCategoryForm() {
            document.getElementById('cat-id-input').value = '';
            document.getElementById('cat-name-input').value = '';
            document.getElementById('cat-prompt-rule-input').value = '';
            document.getElementById('cat-icon-input').value = 'fas fa-folder';
            document.getElementById('cat-delete-btn').classList.add('hidden');
            document.getElementById('category-form-title').innerText = '新增分類';
            document.querySelector('.cat-type-btn[data-type="text"]').click();
            renderIconPicker();
        }

        document.getElementById('cat-save-btn').addEventListener('click', async (e) => {
            const name = document.getElementById('cat-name-input').value;
            if (!name) return alert('請輸入分類名稱');
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<div class="loader w-4 h-4 border-t-white border-2"></div>';
            
            const id = document.getElementById('cat-id-input').value;
            const data = {
                name,
                icon: document.getElementById('cat-icon-input').value,
                type: document.getElementById('cat-type-input').value,
                promptRule: document.getElementById('cat-prompt-rule-input').value,
                order: id ? currentCategories.find(c => c.id === id).order : Date.now()
            };
            if(id) data.id = id;
            
            await saveCategory(data);
            resetCategoryForm();
            btn.disabled = false;
            btn.innerText = '儲存';
        });

        document.getElementById('cat-delete-btn').addEventListener('click', async () => {
            if(!confirm('確定要刪除這個分類嗎？該分類底下的筆記將不會被刪除，但會需要重新分類。')) return;
            const id = document.getElementById('cat-id-input').value;
            await deleteCategoryFunc(id);
            resetCategoryForm();
        });

        function renderCategoryManagerList(categories) {
            const listEl = document.getElementById('category-manager-list');
            listEl.innerHTML = '';
            categories.forEach(cat => {
                const li = document.createElement('li');
                li.className = 'p-3 bg-slate-50 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-100 border border-slate-200';
                li.innerHTML = `<span><i class="${cat.icon} mr-2 text-slate-500"></i> ${escapeHtml(cat.name)}</span> <i class="fas fa-edit text-slate-400"></i>`;
                li.addEventListener('click', () => populateCategoryForm(cat));
                listEl.appendChild(li);
            });
            // We should ideally add SortableJS here to manage category order, but for simplicity we rely on manual list for now.
            // Let's initialize Sortable on the manager list
            new Sortable(listEl, {
                animation: 150, delay: 150, delayOnTouchOnly: true, fallbackTolerance: 5, forceFallback: true, fallbackClass: 'sortable-fallback',
                onEnd: async function(evt) {
                    const itemEl = evt.item;
                    const oldIndex = evt.oldIndex;
                    const newIndex = evt.newIndex;
                    if (oldIndex === newIndex) return;
                    
                    // Update all orders sequentially for simplicity
                    const newOrderList = Array.from(listEl.children);
                    for (let i = 0; i < newOrderList.length; i++) {
                        const catName = newOrderList[i].querySelector('span').innerText.trim();
                        const cat = currentCategories.find(c => c.name === catName);
                        if(cat) await saveCategory({id: cat.id, order: i * 1000});
                    }
                }
            });
        }

        // ✨ Sidebar Index
        function renderSidebar(categories) {
            const nav = document.getElementById('sidebar-nav');
            if (!nav) return;
            nav.innerHTML = '';

            // Shared planning is the first-level home destination.
            nav.appendChild(createSidebarLink('couple-planner', 'fas fa-calendar-days', '共同計畫'));

            // Static: Inbox
            nav.appendChild(createSidebarLink('inbox', 'fas fa-inbox', '收件匣'));
            nav.appendChild(createSearchSidebarLink());
            nav.appendChild(createTagBrowserSidebarLink());
            nav.appendChild(createResearchLogSidebarLink());
            nav.appendChild(createHelpSidebarLink());

            // Divider
            if (categories.length > 0) {
                const divider = document.createElement('div');
                divider.className = 'my-2 border-t border-slate-100';
                nav.appendChild(divider);
            }

            // Dynamic categories
            categories.forEach(cat => {
                nav.appendChild(createSidebarLink(cat.id, cat.icon, cat.name));
            });
        }

        function createSidebarLink(targetId, iconClass, labelText) {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', targetId);
            const icon = document.createElement('i');
            iconClass.split(' ').filter(Boolean).forEach(cls => icon.classList.add(cls));
            icon.classList.add('sidebar-link-icon');
            const span = document.createElement('span');
            span.className = 'sidebar-link-text';
            span.textContent = labelText;
            btn.appendChild(icon);
            btn.appendChild(span);
            btn.addEventListener('click', () => {
                const targetEl = targetId === 'couple-planner'
                    ? document.getElementById('couple-planner')
                    : targetId === 'inbox'
                        ? document.querySelector('[data-col="inbox"]')?.closest('.category-wrapper')
                        : document.getElementById(`list-${targetId}`)?.closest('.category-wrapper');
                if (targetEl) {
                    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
                    targetEl.scrollIntoView({ behavior, block: 'start' });
                }
                closeSidebar();
            });
            return btn;
        }

        function createTagBrowserSidebarLink() {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', 'tag-browser');
            btn.innerHTML = '<i class="fas fa-tags sidebar-link-icon"></i><span class="sidebar-link-text">Tag 瀏覽</span>';
            btn.addEventListener('click', () => {
                closeSidebar();
                openTagBrowser();
            });
            return btn;
        }

        function createSearchSidebarLink() {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', 'global-search');
            btn.innerHTML = '<i class="fas fa-search sidebar-link-icon"></i><span class="sidebar-link-text">搜尋</span>';
            btn.addEventListener('click', () => {
                closeSidebar();
                openGlobalSearch();
            });
            return btn;
        }

        function createHelpSidebarLink() {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', 'help-center');
            btn.innerHTML = '<i class="fas fa-circle-question sidebar-link-icon"></i><span class="sidebar-link-text">使用說明</span>';
            btn.addEventListener('click', () => {
                closeSidebar();
                openHelpCenter();
            });
            return btn;
        }

        function createResearchLogSidebarLink() {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', 'research-log');
            btn.innerHTML = '<i class="fas fa-clock-rotate-left sidebar-link-icon"></i><span class="sidebar-link-text">研讀紀錄</span>';
            btn.addEventListener('click', () => {
                closeSidebar();
                openResearchLog();
            });
            return btn;
        }

        function getTagNameMap() {
            return new Map(currentTags.map(tag => [tag.id, tag.name]));
        }

        function renderTagFilterOptions() {
            const container = document.getElementById('tag-filter-options');
            const counts = buildTagUsageCounts({
                inboxItems: currentInboxItems,
                itemsByCollection: currentItemsByCollection
            });
            container.replaceChildren();
            currentTags.forEach(tag => {
                const selected = selectedTagFilterIds.has(tag.id);
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('data-tag-filter-id', tag.id);
                button.setAttribute('aria-pressed', String(selected));
                button.className = selected
                    ? 'inline-flex min-h-11 items-center gap-2 rounded-full border border-indigo-600 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300'
                    : 'inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';
                const name = document.createElement('span');
                name.textContent = tag.name;
                const count = document.createElement('span');
                count.className = selected
                    ? 'rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] text-white'
                    : 'rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500';
                count.textContent = String(counts.get(tag.id) || 0);
                button.append(name, count);
                button.addEventListener('click', () => {
                    if (selectedTagFilterIds.has(tag.id)) selectedTagFilterIds.delete(tag.id);
                    else selectedTagFilterIds.add(tag.id);
                    renderTagBrowser();
                });
                container.appendChild(button);
            });
            if (currentTags.length === 0) {
                const message = document.createElement('p');
                message.className = 'py-2 text-sm text-slate-400';
                message.textContent = '尚未建立 Tag；完成一次 AI 研讀並確認 Tag 後就會出現在這裡。';
                container.appendChild(message);
            }
            const clearButton = document.getElementById('clear-tag-filter-btn');
            clearButton.disabled = selectedTagFilterIds.size === 0;
            clearButton.classList.toggle('hidden', clearButton.disabled);
        }

        function renderTagMatchModeButtons() {
            document.querySelectorAll('[data-tag-match-mode]').forEach(button => {
                const active = button.getAttribute('data-tag-match-mode') === tagMatchMode;
                button.setAttribute('aria-pressed', String(active));
                button.classList.toggle('bg-white', active);
                button.classList.toggle('text-indigo-700', active);
                button.classList.toggle('shadow-sm', active);
                button.classList.toggle('text-slate-500', !active);
            });
        }

        function renderTagBrowserCard(item, group) {
            const tagNames = getTagNameMap();
            const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
            const card = document.createElement('li');
            card.className = 'group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md';
            card.setAttribute('data-tag-browser-card', '');
            card.setAttribute('data-id', item.id);
            const visibleTags = (Array.isArray(item.tagIds) ? item.tagIds : [])
                .map(id => tagNames.get(String(id)))
                .filter(Boolean);
            const tagsHtml = visibleTags.length > 0
                ? `<div class="flex flex-wrap gap-1.5">${visibleTags.map(name => `<span class="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">${escapeHtml(name)}</span>`).join('')}</div>`
                : '';
            const completedHtml = group.type === 'todo' && item.completed
                ? '<span class="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700"><i class="fas fa-check mr-1"></i>已完成</span>'
                : '';
            card.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <button type="button" data-tag-card-open class="line-clamp-3 min-h-11 flex-1 whitespace-pre-wrap break-all text-left font-medium leading-relaxed hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">${escapeHtml(textWithoutUrl || item.text || '無標題')}</button>
                    ${completedHtml}
                </div>
                ${tagsHtml}
                ${getImageHTML(item.imageUrl)}
                ${previewHTML}
                ${getWebResearchButtonHTML(item)}
            `;
            attachItemListeners(card, item, group.id);
            card.querySelector('[data-tag-card-open]').addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                openEditor(item.id, item.text, group.id);
            });
            card.addEventListener('click', event => {
                if (isInteractiveCardTarget(event.target)) return;
                openEditor(item.id, item.text, group.id);
            });
            return card;
        }

        function renderSearchCard(item, group) {
            const card = renderTagBrowserCard(item, group);
            card.removeAttribute('data-tag-browser-card');
            card.setAttribute('data-search-card', '');
            const matchLabels = { title: '卡片文字', research: 'AI 詳細筆記', tag: 'Tag' };
            const matches = document.createElement('div');
            matches.className = 'flex flex-wrap items-center gap-1.5';
            (item.searchMatchTypes || []).forEach(type => {
                const badge = document.createElement('span');
                badge.className = type === 'research'
                    ? 'rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700'
                    : type === 'tag'
                        ? 'rounded-full bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700'
                        : 'rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700';
                badge.textContent = `符合：${matchLabels[type] || type}`;
                matches.appendChild(badge);
            });
            const firstRow = card.firstElementChild;
            if (firstRow) firstRow.after(matches);
            if (item.searchSnippet) {
                const snippet = document.createElement('p');
                snippet.className = 'line-clamp-3 whitespace-pre-wrap break-words rounded-lg bg-emerald-50/60 px-3 py-2 text-xs leading-relaxed text-slate-600';
                snippet.textContent = item.searchSnippet;
                matches.after(snippet);
            }
            return card;
        }

        function renderGlobalSearch() {
            const input = document.getElementById('global-search-input');
            globalSearchQuery = input ? input.value : globalSearchQuery;
            const groups = groupCardsBySearch({
                categories: currentCategories,
                inboxItems: currentInboxItems,
                itemsByCollection: currentItemsByCollection,
                tags: currentTags,
                query: globalSearchQuery
            });
            const results = document.getElementById('global-search-results');
            results.replaceChildren();
            let total = 0;
            groups.forEach(group => {
                total += group.items.length;
                const section = document.createElement('section');
                section.setAttribute('data-search-group', group.id);
                section.className = 'rounded-2xl border border-slate-200 bg-white/70 p-4 md:p-5';
                const header = document.createElement('div');
                header.className = 'mb-3 flex items-center gap-2 text-base font-bold text-slate-700';
                const icon = document.createElement('i');
                icon.className = `${group.icon} text-indigo-500`;
                const name = document.createElement('span');
                name.textContent = group.name;
                const count = document.createElement('span');
                count.className = 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700';
                count.textContent = String(group.items.length);
                header.append(icon, name, count);
                const list = document.createElement('ul');
                list.className = 'grid grid-cols-1 gap-3 md:grid-cols-2';
                group.items.forEach(item => list.appendChild(renderSearchCard(item, group)));
                section.append(header, list);
                results.appendChild(section);
            });

            const hasQuery = globalSearchQuery.trim().length > 0;
            document.getElementById('clear-global-search-btn').classList.toggle('hidden', !hasQuery);
            document.getElementById('global-search-summary').textContent = !hasQuery
                ? '輸入關鍵字開始搜尋。'
                : `找到 ${total} 張卡片，分布在 ${groups.length} 個分類。`;
            document.getElementById('global-search-empty').classList.toggle('hidden', groups.length > 0);
            document.getElementById('global-search-empty-icon').className = hasQuery
                ? 'fas fa-search-minus mb-3 text-3xl text-slate-300'
                : 'fas fa-magnifying-glass mb-3 text-3xl text-slate-300';
            document.getElementById('global-search-empty-title').textContent = hasQuery
                ? '找不到符合的卡片'
                : '開始搜尋你的知識庫';
            document.getElementById('global-search-empty-detail').textContent = hasQuery
                ? '試著縮短關鍵字，或改用 Tag 名稱搜尋。'
                : '可搜尋網址、標題、AI 研讀內容與 Tag 名稱。';
        }

        function openGlobalSearch({ fromHistory = false } = {}) {
            const modal = document.getElementById('global-search-modal');
            const input = document.getElementById('global-search-input');
            input.value = globalSearchQuery;
            renderGlobalSearch();
            modal.classList.remove('hidden');
            keyLayers.push({ name: 'global-search', keys: modalKeys(closeGlobalSearch) });
            if (!fromHistory) history.pushState({ overlay: 'global-search' }, '', window.location.href);
            setTimeout(() => input.focus(), 0);
        }

        function closeGlobalSearch({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'global-search') {
                history.back();
                return;
            }
            document.getElementById('global-search-modal').classList.add('hidden');
            keyLayers.pop('global-search');
        }

        function setActiveHelpSection(targetId) {
            document.querySelectorAll('[data-help-target]').forEach(button => {
                const active = button.dataset.helpTarget === targetId;
                button.classList.toggle('bg-emerald-50', active);
                button.classList.toggle('text-emerald-700', active);
                button.classList.toggle('font-bold', active);
                button.classList.toggle('text-slate-600', !active);
                button.classList.toggle('font-semibold', !active);
            });
        }

        function openHelpCenter({ fromHistory = false } = {}) {
            const modal = document.getElementById('help-center-modal');
            modal.classList.remove('hidden');
            keyLayers.push({ name: 'help-center', keys: modalKeys(closeHelpCenter) });
            setActiveHelpSection('help-overview');
            if (!fromHistory) {
                document.getElementById('help-center-content').scrollTop = 0;
                history.pushState({ overlay: 'help-center' }, '', window.location.href);
            }
            setTimeout(() => document.getElementById('close-help-center-btn').focus(), 0);
        }

        function closeHelpCenter({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'help-center') {
                history.back();
                return;
            }
            document.getElementById('help-center-modal').classList.add('hidden');
            keyLayers.pop('help-center');
        }

        const getResearchBackfillKey = (collectionId, itemId) => `${collectionId}/${itemId}`;

        function getResearchBackfillGroups() {
            const pendingKeys = new Set(
                researchReviewItems.map(item => getResearchBackfillKey(item.collectionName, item.itemId))
            );
            return groupResearchBackfillCandidates({
                categories: currentCategories,
                inboxItems: currentInboxItems,
                itemsByCollection: currentItemsByCollection
            }).map(group => ({
                ...group,
                items: group.items.filter(item => !pendingKeys.has(getResearchBackfillKey(group.id, item.id)))
            })).filter(group => group.items.length > 0);
        }

        function getAutomaticResearchUserId() {
            return getActiveSpaceId() || 'anonymous';
        }

        function readCurrentAutomaticResearchState() {
            return readAutoResearchState(localStorage, getAutomaticResearchUserId());
        }

        function saveCurrentAutomaticResearchState(state) {
            try {
                return writeAutoResearchState(localStorage, getAutomaticResearchUserId(), state);
            } catch (error) {
                console.warn('無法保存自動研讀排程狀態：', error);
                return state;
            }
        }

        function formatAutomaticResearchTime(timestamp) {
            return timestamp ? new Date(timestamp).toLocaleString('zh-TW') : '尚未執行';
        }

        function getAutomaticResearchSelection() {
            return selectAutoResearchCandidates(getResearchBackfillGroups(), readCurrentAutomaticResearchState());
        }

        function isCloudResearchEnabled() {
            const settingsOpen = !document.getElementById('settings-modal')?.classList.contains('hidden');
            const toggle = document.getElementById('cloud-research-enabled-toggle');
            return settingsOpen && toggle
                ? toggle.checked
                : localStorage.getItem('cloudResearchEnabled') === 'on';
        }

        function firestoreTimeToMillis(value) {
            if (typeof value?.toMillis === 'function') return value.toMillis();
            if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function getCloudResearchApprovalMode() {
            const settingsOpen = !document.getElementById('settings-modal')?.classList.contains('hidden');
            if (settingsOpen) {
                return document.querySelector('input[name="cloud-research-approval-mode"]:checked')?.value === 'auto'
                    ? 'auto'
                    : 'manual';
            }
            if (cloudAutomationSettings) {
                return cloudAutomationSettings.approvalMode === 'auto' ? 'auto' : 'manual';
            }
            return localStorage.getItem('cloudResearchApprovalMode') === 'auto' ? 'auto' : 'manual';
        }

        function renderAutomaticResearchScheduleStatus() {
            const status = document.getElementById('auto-research-schedule-status');
            if (!status) return;
            const settingsOpen = !document.getElementById('settings-modal')?.classList.contains('hidden');
            const interval = settingsOpen
                ? document.getElementById('auto-research-interval-select')?.value || 'off'
                : localStorage.getItem('autoResearchInterval') || 'off';
            const cloudEnabled = isCloudResearchEnabled();
            if (cloudEnabled) {
                const pendingCount = cloudResearchReviewItems.length;
                const approvalMode = getCloudResearchApprovalMode();
                const lines = ['執行位置：Google Cloud（關閉網頁後仍會繼續）。'];
                if (cloudResearchListenerError) {
                    lines.push(`雲端狀態讀取失敗：${cloudResearchListenerError}`);
                } else if (interval === 'off' || cloudAutomationSettings?.enabled === false) {
                    lines.push('自動排程目前關閉；仍可在卡片按「雲端研讀」。');
                } else if (cloudAutomationSettings) {
                    lines.push(`上次檢查：${formatAutomaticResearchTime(firestoreTimeToMillis(cloudAutomationSettings.lastRunAt))}`);
                    lines.push(`下次檢查：約 ${formatAutomaticResearchTime(firestoreTimeToMillis(cloudAutomationSettings.nextRunAt))}`);
                } else {
                    lines.push('雲端排程設定同步中。');
                }
                lines.push(approvalMode === 'auto'
                    ? `一般網址完成後自動寫入；既有待審核 ${pendingCount} 筆。`
                    : `雲端待審核 ${pendingCount} 筆。`);
                lines.push('每分鐘最多處理 1 張。');
                status.textContent = lines.join(' ');
                const resetButton = document.getElementById('reset-auto-research-failures-btn');
                if (resetButton) {
                    resetButton.disabled = true;
                    resetButton.textContent = '雲端失敗由工作佇列管理';
                }
                return;
            }
            const state = readCurrentAutomaticResearchState();
            const due = getAutoResearchDue({ interval, lastRunAt: state.lastRunAt });
            const { runnable, blocked } = getAutomaticResearchSelection();
            const lines = [];
            if (!due.enabled) {
                lines.push('目前關閉，只會在你手動啟動時研讀。');
            } else {
                lines.push(`上次啟動：${formatAutomaticResearchTime(state.lastRunAt)}`);
                lines.push(`下次檢查：${due.due ? '資料載入完成後立即執行' : formatAutomaticResearchTime(due.nextRunAt)}`);
            }
            lines.push(`目前可自動回補 ${runnable.length} 張；隔離 ${blocked.length} 張。`);
            status.textContent = lines.join(' ');
            const resetButton = document.getElementById('reset-auto-research-failures-btn');
            if (resetButton) {
                resetButton.disabled = blocked.length === 0 && Object.keys(state.failures).length === 0;
                resetButton.textContent = blocked.length > 0 ? `重新嘗試隔離卡片（${blocked.length}）` : '清除失敗紀錄';
            }
        }

        function isAutomaticResearchDataReady() {
            if (!currentUser || !automaticResearchInboxLoaded || !automaticResearchCategoriesLoaded) return false;
            return currentCategories.every(category => automaticResearchLoadedCollections.has(String(category.id)));
        }

        function scheduleAutomaticResearchCheck(delay = 1200) {
            clearTimeout(automaticResearchCheckTimer);
            automaticResearchCheckTimer = setTimeout(() => {
                automaticResearchCheckTimer = null;
                void checkAutomaticResearchSchedule();
            }, delay);
        }

        function clearScheduledResearchFailure(key) {
            const state = readCurrentAutomaticResearchState();
            if (!state.failures[key]) return;
            saveCurrentAutomaticResearchState(clearAutoResearchFailure(state, key));
            renderAutomaticResearchScheduleStatus();
        }

        function recordScheduledResearchFailure(entry, reason) {
            const state = readCurrentAutomaticResearchState();
            const result = recordAutoResearchFailure(state, {
                key: entry.key,
                sourceText: entry.item.text,
                reason
            });
            saveCurrentAutomaticResearchState(result.state);
            if (result.blocked) {
                recordResearchLog({
                    level: 'error',
                    stage: 'schedule',
                    provider: '自動排程',
                    status: 'unchanged_card_blocked',
                    action: 'isolate',
                    title: '卡片已從自動排程隔離',
                    cardTitle: getShortText(entry.item.text, 160),
                    sourceUrl: extractUrls(entry.item.text || '')[0] || '',
                    collectionName: entry.group.id,
                    itemId: entry.item.id,
                    detail: `相同卡片內容已連續排程失敗 ${result.attempts} 次。${reason ? ` 最近原因：${reason}` : ''}`,
                    resolution: '請確認網址公開可讀、卡片只含一個網址且不要混入登入牆內容；修改卡片文字後會自動解除隔離。'
                });
                showToast('有卡片連續研讀失敗，已隔離；請在研讀紀錄查看調整方式。', 'fas fa-triangle-exclamation');
            }
            renderAutomaticResearchScheduleStatus();
        }

        function beginResearchBackfillQueue(entries, origin = 'manual') {
            researchBackfillQueue = Array.isArray(entries) ? entries : [];
            researchBackfillOrigin = origin === 'schedule' ? 'schedule' : 'manual';
            researchBackfillIndex = 0;
            activeResearchBackfillKey = null;
            researchBackfillCompleted = 0;
            researchBackfillFailed = 0;
            researchBackfillQuotaFailures = 0;
            researchBackfillRetryAttempts.clear();
            researchBackfillStatusMessage = '';
            if (researchBackfillQueue.length === 0) {
                renderResearchBackfillPanel();
                return false;
            }
            renderResearchBackfillPanel();
            void requestResearchBackfillWakeLock();
            void processNextResearchBackfill();
            return true;
        }

        function startAutomaticResearchBackfillQueue(entries) {
            const started = beginResearchBackfillQueue(entries, 'schedule');
            if (started) {
                showToast(`自動排程已啟動，共 ${entries.length} 張。`, 'fas fa-clock-rotate-left');
            }
            return started;
        }

        async function checkAutomaticResearchSchedule({ force = false } = {}) {
            renderAutomaticResearchScheduleStatus();
            if (!currentUser) {
                if (force) showToast('請先登入，才能執行自動研讀。', 'fas fa-user-lock');
                return false;
            }
            if (isCloudResearchEnabled()) {
                if (!force) return false;
                if (!isAutomaticResearchDataReady()) {
                    showToast('卡片資料仍在載入，請稍後再試。', 'fas fa-spinner');
                    return false;
                }
                return enqueueCloudResearchSelection(getAutomaticResearchSelection().runnable);
            }
            if (researchBackfillQueue.length > 0) {
                if (force) showToast('目前已有研讀佇列執行中。', 'fas fa-list-check');
                return false;
            }
            if (!isAutomaticResearchDataReady()) {
                if (force) showToast('卡片資料仍在載入，完成後會自動檢查。', 'fas fa-spinner');
                scheduleAutomaticResearchCheck();
                return false;
            }
            if (!force && document.visibilityState === 'hidden') return false;
            const interval = localStorage.getItem('autoResearchInterval') || 'off';
            const state = readCurrentAutomaticResearchState();
            const due = getAutoResearchDue({ interval, lastRunAt: state.lastRunAt });
            if (!force && (!due.enabled || !due.due)) return false;

            const { runnable, blocked } = getAutomaticResearchSelection();
            state.lastRunAt = Date.now();
            saveCurrentAutomaticResearchState(state);
            renderAutomaticResearchScheduleStatus();
            if (runnable.length === 0) {
                showToast(
                    blocked.length > 0 ? `沒有可執行卡片；${blocked.length} 張因連續失敗已隔離。` : '目前沒有尚未研讀的網址卡片。',
                    blocked.length > 0 ? 'fas fa-triangle-exclamation' : 'fas fa-circle-check'
                );
                return false;
            }
            return startAutomaticResearchBackfillQueue(runnable);
        }

        function refreshMergedResearchReviews() {
            const localReviews = currentUser
                ? readResearchReviews(localStorage, getActiveSpaceId())
                : [];
            researchReviewItems = mergeResearchReviews(localReviews, cloudResearchReviewItems);
            renderResearchReviewPanel();
            renderResearchBackfillPanel();
        }

        function loadResearchReviews() {
            cloudResearchReviewItems = [];
            refreshMergedResearchReviews();
        }

        function saveResearchReview(payload) {
            if (!currentUser) throw new Error('使用者尚未登入');
            const reviewId = getResearchBackfillKey(payload.collectionName, payload.itemId);
            upsertResearchReview(localStorage, getActiveSpaceId(), {
                id: reviewId,
                ...payload,
                createdAt: Date.now()
            });
            refreshMergedResearchReviews();
            return reviewId;
        }

        async function deleteResearchReview(reviewId, decision = 'discarded') {
            if (!currentUser) return false;
            try {
                const review = researchReviewItems.find(item => item.id === reviewId);
                if (review?.cloudManaged && review.cloudJobId) {
                    await resolveResearchReviewCallable({
                        jobId: review.cloudJobId,
                        spaceId: getActiveSpaceId(),
                        decision: decision === 'succeeded' ? 'succeeded' : 'discarded'
                    });
                    cloudResearchReviewItems = cloudResearchReviewItems.filter(item => item.id !== reviewId);
                } else {
                    removeResearchReview(localStorage, getActiveSpaceId(), reviewId);
                }
                refreshMergedResearchReviews();
                return true;
            } catch (error) {
                console.error('無法移除待審核研讀結果：', error);
                showToast('無法更新待審核清單，請稍後重試。', 'fas fa-exclamation-triangle');
                return false;
            }
        }

        function cleanupCloudResearchListeners() {
            unsubscribeCloudResearchJobs?.();
            unsubscribeCloudAutomation?.();
            unsubscribeCloudResearchJobs = null;
            unsubscribeCloudAutomation = null;
            cloudResearchReviewItems = [];
            cloudAutomationSettings = null;
            cloudResearchListenerError = '';
        }

        function setupCloudResearchListeners(spaceId) {
            cleanupCloudResearchListeners();
            unsubscribeCloudAutomation = onSnapshot(
                doc(db, 'artifacts', appId, 'automationUsers', currentUser.uid),
                snapshot => {
                    cloudAutomationSettings = snapshot.exists() ? snapshot.data() : null;
                    renderAutomaticResearchScheduleStatus();
                },
                error => {
                    console.error('無法讀取雲端研讀排程：', error);
                    cloudResearchListenerError = error?.message || '權限或網路錯誤';
                    renderAutomaticResearchScheduleStatus();
                }
            );
            unsubscribeCloudResearchJobs = onSnapshot(
                query(
                    collection(db, 'artifacts', appId, 'users', spaceId, 'researchJobs'),
                    where('status', '==', 'pending_review')
                ),
                async snapshot => {
                    try {
                        const jobs = snapshot.docs
                            .map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
                        const reviews = await Promise.all(jobs.map(async job => {
                            const cachedCard = currentItemsByCollection
                                .get(job.collectionName)
                                ?.find(item => item.id === job.cardId);
                            let card = cachedCard;
                            if (!card) {
                                const cardSnapshot = await getDoc(
                                    doc(db, 'artifacts', appId, 'users', spaceId, job.collectionName, job.cardId)
                                );
                                card = cardSnapshot.exists() ? cardSnapshot.data() : {};
                            }
                            return mapCloudResearchJobToReview({
                                jobId: job.id,
                                job,
                                card,
                                tags: currentTags
                            });
                        }));
                        if (getActiveSpaceId() !== spaceId) return;
                        cloudResearchReviewItems = reviews;
                        cloudResearchListenerError = '';
                        refreshMergedResearchReviews();
                        renderAutomaticResearchScheduleStatus();
                    } catch (error) {
                        console.error('無法載入雲端待審核研讀：', error);
                        cloudResearchListenerError = error?.message || '權限或網路錯誤';
                        renderAutomaticResearchScheduleStatus();
                    }
                },
                error => {
                    console.error('無法監聽雲端研讀工作：', error);
                    cloudResearchListenerError = error?.message || '權限或網路錯誤';
                    renderAutomaticResearchScheduleStatus();
                }
            );
        }

        async function syncCloudAutomationSettings(interval, approvalMode = getCloudResearchApprovalMode()) {
            const response = await updateResearchAutomationCallable(
                {
                    ...buildCloudAutomationPayload(interval, { approvalMode }),
                    spaceId: getActiveSpaceId()
                }
            );
            cloudAutomationSettings = response.data?.settings || cloudAutomationSettings;
            renderAutomaticResearchScheduleStatus();
            return response.data;
        }

        function describeCloudEnqueueResult(result = {}) {
            if (result.reason === 'queued') return '已送入雲端佇列，完成後會出現在待審核。';
            if (result.reason === 'manual_retry') return '已重新送入雲端研讀；本次不會重複計入工作額度。';
            if (result.reason === 'enqueue_retry') return '先前送入佇列失敗，現在已重新送出。';
            if (result.reason === 'manual_retry_limit') return '這份內容已達手動重試上限；請確認來源或修改卡片後再建立新工作。';
            if (result.reason === 'idempotent_existing') {
                const statusLabels = {
                    queued: '已在雲端排隊',
                    retry_enqueueing: '正在重新送入雲端佇列',
                    running: '正在雲端研讀',
                    retry_wait: '暫時失敗，等待自動重試',
                    pending_review: '結果已在待審核',
                    succeeded: '這份卡片內容已完成研讀',
                    discarded: '這份卡片內容的結果已捨棄',
                    failed_terminal: '先前研讀失敗；再按一次可安全重試',
                    blocked_budget: '已被每日或每月預算上限阻擋'
                };
                return statusLabels[result.status] || '相同內容已有雲端工作，不會重複計費。';
            }
            if (String(result.reason || '').includes('limit')) return '已達雲端安全用量上限，沒有送出。';
            return '雲端工作已建立。';
        }

        async function enqueueCloudCardResearch(item, collectionName, button = null) {
            if (!currentUser) {
                showToast('請先登入，才能使用雲端研讀。', 'fas fa-user-lock');
                return false;
            }
            const restoreButton = setButtonLoading(
                button,
                '<div class="loader h-4 w-4 border-2 border-t-transparent"></div><span>送入中…</span>'
            );
            try {
                const response = await enqueueCardResearchCallable({
                    spaceId: getActiveSpaceId(),
                    collectionName,
                    cardId: item.id
                });
                showToast(describeCloudEnqueueResult(response.data), 'fas fa-cloud-arrow-up');
                return response.data;
            } catch (error) {
                console.error('送入雲端研讀失敗：', error);
                showToast(`雲端研讀送出失敗：${error?.message || '未知錯誤'}`, 'fas fa-exclamation-triangle');
                return false;
            } finally {
                restoreButton();
            }
        }

        async function enqueueCloudResearchSelection(entries) {
            const selected = (Array.isArray(entries) ? entries : []).slice(0, 20);
            if (selected.length === 0) {
                showToast('目前沒有尚未研讀的單一網址卡片。', 'fas fa-circle-check');
                return false;
            }
            showToast(`正在把 ${selected.length} 張卡片送入雲端佇列…`, 'fas fa-cloud-arrow-up');
            let accepted = 0;
            for (const entry of selected) {
                const result = await enqueueCloudCardResearch(entry.item, entry.group.id);
                if (result) accepted += 1;
            }
            showToast(`已檢查 ${selected.length} 張，其中 ${accepted} 張完成雲端排程。`, 'fas fa-list-check');
            return accepted > 0;
        }

        function renderResearchReviewPanel() {
            const count = document.getElementById('tag-review-count');
            const results = document.getElementById('tag-review-results');
            const empty = document.getElementById('tag-review-empty');
            if (!count || !results || !empty) return;
            count.textContent = String(researchReviewItems.length);
            results.replaceChildren();
            researchReviewItems.forEach(review => {
                const card = document.createElement('article');
                card.className = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
                card.setAttribute('data-research-review', review.id);
                const row = document.createElement('div');
                row.className = 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between';
                const content = document.createElement('div');
                content.className = 'min-w-0 flex-1';
                const source = document.createElement('div');
                source.className = 'break-all text-sm font-bold text-slate-800';
                source.textContent = review.sourceTitle || review.sourceText;
                const sourceUrl = document.createElement('a');
                sourceUrl.className = 'mt-1 block break-all text-xs font-semibold text-blue-600 hover:underline';
                const normalizedSourceUrl = normalizeHttpUrl(review.sourceUrl || extractUrls(review.sourceText)[0]);
                sourceUrl.href = normalizedSourceUrl || '#';
                sourceUrl.target = '_blank';
                sourceUrl.rel = 'noopener noreferrer';
                sourceUrl.textContent = normalizedSourceUrl || '原網址無法辨識';
                sourceUrl.addEventListener('click', event => event.stopPropagation());
                const preview = document.createElement('p');
                preview.className = 'mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600';
                preview.textContent = review.result.note;
                const meta = document.createElement('div');
                meta.className = 'mt-2 text-xs text-slate-400';
                meta.textContent = `${getCollectionName(review.collectionName)} · ${new Date(review.createdAt).toLocaleString('zh-TW')}`;
                content.append(source, sourceUrl, preview, meta);
                const actions = document.createElement('div');
                actions.className = 'flex shrink-0 gap-2';
                const reviewButton = document.createElement('button');
                reviewButton.type = 'button';
                reviewButton.className = 'min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';
                reviewButton.textContent = '審核';
                reviewButton.setAttribute('data-review-open', review.id);
                reviewButton.addEventListener('click', () => {
                    openWebResearchPreview({ ...review, reviewId: review.id });
                });
                const discardButton = document.createElement('button');
                discardButton.type = 'button';
                discardButton.className = 'min-h-10 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300';
                discardButton.textContent = '捨棄';
                discardButton.setAttribute('data-review-discard', review.id);
                discardButton.addEventListener('click', async () => {
                    if (!window.confirm('確定捨棄這筆待審核研讀結果？卡片不會被修改。')) return;
                    discardButton.disabled = true;
                    await deleteResearchReview(review.id, 'discarded');
                    discardButton.disabled = false;
                });
                actions.append(reviewButton, discardButton);
                row.append(content, actions);
                card.appendChild(row);
                results.appendChild(card);
            });
            results.classList.toggle('hidden', researchReviewItems.length === 0);
            empty.classList.toggle('hidden', researchReviewItems.length > 0);
        }

        function clearResearchBackfillTimers() {
            if (researchBackfillWaitTimer) clearTimeout(researchBackfillWaitTimer);
            if (researchBackfillCountdownTimer) clearInterval(researchBackfillCountdownTimer);
            researchBackfillWaitTimer = null;
            researchBackfillCountdownTimer = null;
        }

        async function requestResearchBackfillWakeLock() {
            if (!('wakeLock' in navigator) || researchBackfillQueue.length === 0 || document.visibilityState !== 'visible') return;
            try {
                researchBackfillWakeLock = await navigator.wakeLock.request('screen');
                researchBackfillWakeLock.addEventListener('release', () => {
                    researchBackfillWakeLock = null;
                });
            } catch (error) {
                console.warn('無法啟用回補期間的螢幕喚醒鎖定：', error);
            }
        }

        function releaseResearchBackfillWakeLock() {
            if (researchBackfillWakeLock) void researchBackfillWakeLock.release();
            researchBackfillWakeLock = null;
        }

        function updateResearchBackfillStatus(message) {
            researchBackfillStatusMessage = message;
            const status = document.getElementById('tag-backfill-status');
            if (status) status.textContent = message;
            const floatingText = document.getElementById('research-queue-floating-text');
            if (floatingText) floatingText.textContent = message;
            document.getElementById('research-queue-floating-status')?.classList.toggle('hidden', researchBackfillQueue.length === 0);
        }

        function renderResearchBackfillApprovalMode() {
            document.querySelectorAll('[data-backfill-approval-mode]').forEach(button => {
                const active = button.dataset.backfillApprovalMode === researchBackfillApprovalMode;
                button.classList.toggle('bg-amber-600', active);
                button.classList.toggle('text-white', active);
                button.classList.toggle('shadow-sm', active);
                button.classList.toggle('text-amber-800', !active);
                button.setAttribute('aria-pressed', String(active));
                button.disabled = researchBackfillQueue.length > 0;
            });
        }

        function renderResearchBackfillPanel() {
            const groups = getResearchBackfillGroups();
            const entries = groups.flatMap(group => group.items.map(item => ({
                key: getResearchBackfillKey(group.id, item.id),
                group,
                item
            })));
            const availableKeys = new Set(entries.map(entry => entry.key));
            [...selectedResearchBackfillKeys].forEach(key => {
                if (!availableKeys.has(key)) selectedResearchBackfillKeys.delete(key);
            });

            document.getElementById('tag-backfill-count').textContent = String(entries.length);
            const results = document.getElementById('tag-backfill-results');
            results.replaceChildren();
            groups.forEach(group => {
                const section = document.createElement('section');
                section.className = 'rounded-2xl border border-slate-200 bg-white p-4';
                const header = document.createElement('div');
                header.className = 'mb-3 flex items-center gap-2 font-bold text-slate-700';
                const icon = document.createElement('i');
                icon.className = `${group.icon} text-amber-600`;
                const name = document.createElement('span');
                name.textContent = group.name;
                const count = document.createElement('span');
                count.className = 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800';
                count.textContent = String(group.items.length);
                header.append(icon, name, count);
                const list = document.createElement('div');
                list.className = 'space-y-2';
                group.items.forEach(item => {
                    const key = getResearchBackfillKey(group.id, item.id);
                    const label = document.createElement('label');
                    label.className = 'flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-amber-300 hover:bg-amber-50/50';
                    label.setAttribute('data-backfill-card', key);
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = selectedResearchBackfillKeys.has(key);
                    checkbox.disabled = researchBackfillQueue.length > 0;
                    checkbox.className = 'mt-1 h-5 w-5 shrink-0 accent-amber-600';
                    checkbox.setAttribute('data-backfill-select', key);
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) selectedResearchBackfillKeys.add(key);
                        else selectedResearchBackfillKeys.delete(key);
                        researchBackfillStatusMessage = '';
                        renderResearchBackfillPanel();
                    });
                    const content = document.createElement('span');
                    content.className = 'min-w-0 flex-1';
                    const text = document.createElement('span');
                    text.className = 'block break-all text-sm font-medium leading-relaxed text-slate-700';
                    text.textContent = item.text || '無標題';
                    const reasons = document.createElement('span');
                    reasons.className = 'mt-2 flex flex-wrap gap-1.5';
                    item.backfillReasons.forEach(reason => {
                        const badge = document.createElement('span');
                        badge.className = reason === '無 Tag'
                            ? 'rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700'
                            : 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800';
                        badge.textContent = reason;
                        reasons.appendChild(badge);
                    });
                    content.append(text, reasons);
                    label.append(checkbox, content);
                    list.appendChild(label);
                });
                section.append(header, list);
                results.appendChild(section);
            });

            const queueActive = researchBackfillQueue.length > 0;
            renderResearchBackfillApprovalMode();
            const allSelected = entries.length > 0 && entries.every(entry => selectedResearchBackfillKeys.has(entry.key));
            const selectAllButton = document.getElementById('select-all-tag-backfill-btn');
            selectAllButton.textContent = allSelected ? '取消全選' : '全選';
            selectAllButton.disabled = queueActive || entries.length === 0;
            const startButton = document.getElementById('start-tag-backfill-btn');
            startButton.disabled = queueActive || selectedResearchBackfillKeys.size === 0;
            document.getElementById('cancel-tag-backfill-btn').classList.toggle('hidden', !queueActive);
            document.getElementById('tag-backfill-empty').classList.toggle('hidden', entries.length > 0);
            results.classList.toggle('hidden', entries.length === 0);
            if (!researchBackfillStatusMessage) {
                updateResearchBackfillStatus(entries.length === 0
                    ? '所有可研讀的網址卡片目前都有 Tag 與研讀索引。'
                    : `待回補 ${entries.length} 張，已選 ${selectedResearchBackfillKeys.size} 張。`);
            }
        }

        function updateTagBrowserView() {
            const showingBackfill = tagBrowserView === 'backfill';
            const showingReviews = tagBrowserView === 'reviews';
            const showingTags = tagBrowserView === 'tags';
            document.getElementById('tag-filter-controls').classList.toggle('hidden', !showingTags);
            document.getElementById('tag-backfill-panel').classList.toggle('hidden', !showingBackfill);
            document.getElementById('tag-review-panel').classList.toggle('hidden', !showingReviews);
            document.getElementById('tag-browser-summary').classList.toggle('hidden', !showingTags);
            document.getElementById('tag-browser-results').classList.toggle('hidden', !showingTags);
            document.getElementById('tag-browser-empty').classList.toggle('hidden', !showingTags || document.querySelectorAll('[data-tag-browser-group]').length > 0);
            document.getElementById('tag-backfill-toggle-btn').setAttribute('aria-expanded', String(showingBackfill));
            document.getElementById('tag-review-toggle-btn').setAttribute('aria-expanded', String(showingReviews));
        }

        function cancelResearchBackfillQueue(message = '回補佇列已停止。') {
            const wasScheduled = researchBackfillOrigin === 'schedule';
            clearResearchBackfillTimers();
            releaseResearchBackfillWakeLock();
            researchBackfillQueue = [];
            researchBackfillIndex = 0;
            activeResearchBackfillKey = null;
            researchBackfillQuotaFailures = 0;
            researchBackfillRetryAttempts.clear();
            researchBackfillOrigin = 'manual';
            updateResearchBackfillStatus(message);
            renderResearchBackfillPanel();
            if (wasScheduled) renderAutomaticResearchScheduleStatus();
            document.getElementById('research-queue-floating-status')?.classList.add('hidden');
        }

        function finishResearchBackfillQueue() {
            const wasScheduled = researchBackfillOrigin === 'schedule';
            const completed = researchBackfillCompleted;
            const failed = researchBackfillFailed;
            clearResearchBackfillTimers();
            releaseResearchBackfillWakeLock();
            researchBackfillQueue = [];
            researchBackfillIndex = 0;
            activeResearchBackfillKey = null;
            researchBackfillQuotaFailures = 0;
            researchBackfillRetryAttempts.clear();
            researchBackfillOrigin = 'manual';
            selectedResearchBackfillKeys.clear();
            const destination = researchBackfillApprovalMode === 'auto' ? '筆已自動通過' : '筆已送往待審核';
            updateResearchBackfillStatus(`佇列完成：${completed} ${destination}${failed ? `，${failed} 筆失敗或轉待審` : ''}。`);
            renderResearchBackfillPanel();
            renderResearchReviewPanel();
            if (wasScheduled) {
                const state = readCurrentAutomaticResearchState();
                state.lastCompletedAt = Date.now();
                saveCurrentAutomaticResearchState(state);
                renderAutomaticResearchScheduleStatus();
            }
            document.getElementById('research-queue-floating-status')?.classList.add('hidden');
        }

        function scheduleResearchBackfillRetry(remaining, { quota = false, provider = '', reason = '' } = {}) {
            clearResearchBackfillTimers();
            const retryAt = Date.now() + Math.max(remaining, 1000) + 250;
            const updateCountdown = () => {
                const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
                const waitText = seconds >= 60
                    ? `${Math.ceil(seconds / 60)} 分鐘`
                    : `${seconds} 秒`;
                const prefix = reason || (quota ? `${provider || '模型'} 配額暫停` : '冷卻中');
                updateResearchBackfillStatus(`${prefix}；保留第 ${researchBackfillIndex + 1} / ${researchBackfillQueue.length} 張，${waitText}後重試。`);
            };
            updateCountdown();
            researchBackfillCountdownTimer = setInterval(updateCountdown, 1000);
            researchBackfillWaitTimer = setTimeout(() => {
                clearResearchBackfillTimers();
                processNextResearchBackfill();
            }, Math.max(remaining, 1000) + 250);
        }

        async function processNextResearchBackfill() {
            if (researchBackfillQueue.length === 0) return;
            if (researchBackfillIndex >= researchBackfillQueue.length) {
                finishResearchBackfillQueue();
                return;
            }
            const entry = researchBackfillQueue[researchBackfillIndex];
            activeResearchBackfillKey = entry.key;
            updateResearchBackfillStatus(`正在研讀第 ${researchBackfillIndex + 1} / ${researchBackfillQueue.length} 張：${getShortText(entry.item.text, 24)}`);
            const outcome = await runCardWebResearch(entry.item, entry.group.id, null, {
                fromBackfill: true,
                deferPreview: true,
                attempt: researchBackfillRetryAttempts.get(entry.key) || 0
            });
            if (researchBackfillQueue.length === 0) return;
            if (outcome?.status === 'ready') {
                researchBackfillQuotaFailures = 0;
                researchBackfillRetryAttempts.delete(entry.key);
                if (researchBackfillOrigin === 'schedule') clearScheduledResearchFailure(entry.key);
                let completionMessage = '';
                if (researchBackfillApprovalMode === 'auto') {
                    const allSuggestionIds = [
                        ...(outcome.payload.result.matchedTags || []),
                        ...(outcome.payload.result.suggestedTags || [])
                    ].map(tag => tag.id);
                    try {
                        await persistWebResearchPayload(outcome.payload, allSuggestionIds);
                        researchBackfillCompleted += 1;
                        completionMessage = `已自動通過 ${researchBackfillCompleted} / ${researchBackfillQueue.length}；準備下一張。`;
                    } catch (error) {
                        console.error('自動通過研讀結果失敗：', error);
                        researchBackfillFailed += 1;
                        const decision = classifyResearchFailure({ stage: 'firestore', error });
                        recordResearchLog({
                            level: decision.action === 'stop' ? 'error' : 'warning', stage: 'firestore',
                            provider: 'Firebase', status: decision.category, action: 'fallback',
                            title: decision.title, cardTitle: getShortText(entry.item.text, 160),
                            sourceUrl: outcome.payload.sourceUrl, collectionName: entry.group.id, itemId: entry.item.id,
                            detail: decision.detail,
                            resolution: '自動寫入失敗，已改存本機待審核，避免結果遺失。'
                        });
                        try {
                            saveResearchReview(outcome.payload);
                            if (decision.action === 'stop') {
                                cancelResearchBackfillQueue(`${decision.userMessage} 本次結果已保存到待審核。`);
                                renderResearchReviewPanel();
                                return;
                            }
                            completionMessage = '自動寫入失敗，結果已送往待審核；準備下一張。';
                        } catch (storageError) {
                            console.error('無法保存待審核研讀結果：', storageError);
                            const storageDecision = classifyResearchFailure({ stage: 'storage', error: storageError });
                            recordResearchLog({
                                level: 'error', stage: 'storage', provider: '瀏覽器儲存空間',
                                status: storageDecision.category, action: 'stop', title: storageDecision.title,
                                cardTitle: getShortText(entry.item.text, 160), sourceUrl: outcome.payload.sourceUrl,
                                detail: storageDecision.detail, resolution: storageDecision.resolution
                            });
                            cancelResearchBackfillQueue('自動寫入與待審保存皆失敗，佇列已停止以避免遺失資料。');
                            return;
                        }
                    }
                } else {
                    try {
                        saveResearchReview(outcome.payload);
                        researchBackfillCompleted += 1;
                        completionMessage = `已完成 ${researchBackfillCompleted} / ${researchBackfillQueue.length}，結果已送往待審核；準備下一張。`;
                    } catch (error) {
                        console.error('無法保存待審核研讀結果：', error);
                        const decision = classifyResearchFailure({ stage: 'storage', error });
                        recordResearchLog({
                            level: 'error', stage: 'storage', provider: '瀏覽器儲存空間',
                            status: decision.category, action: 'stop', title: decision.title,
                            cardTitle: getShortText(entry.item.text, 160), sourceUrl: outcome.payload.sourceUrl,
                            detail: decision.detail, resolution: decision.resolution
                        });
                        cancelResearchBackfillQueue('瀏覽器無法保存待審核結果，佇列已停止以避免遺失資料。');
                        return;
                    }
                }
                activeResearchBackfillKey = null;
                researchBackfillIndex += 1;
                updateResearchBackfillStatus(completionMessage);
                renderResearchReviewPanel();
                renderResearchBackfillPanel();
                setTimeout(processNextResearchBackfill, 350);
                return;
            }
            if (outcome?.status === 'cooldown') {
                scheduleResearchBackfillRetry(outcome.remaining);
                return;
            }
            if (outcome?.status === 'blocked') {
                cancelResearchBackfillQueue(outcome.message || `${outcome.provider || '網址研讀服務'} 無法繼續，請完成設定後重新啟動回補。`);
                return;
            }
            if (outcome?.status === 'quota') {
                researchBackfillQuotaFailures += 1;
                const backoffSchedule = [5 * 60_000, 15 * 60_000, 60 * 60_000];
                if (researchBackfillQuotaFailures > backoffSchedule.length) {
                    recordResearchLog({
                        level: 'error', stage: 'provider', provider: outcome.provider,
                        model: outcome.model, status: 'quota_retry_exhausted', action: 'stop',
                        title: `${outcome.provider || '模型'} 配額重試已達上限`,
                        cardTitle: getShortText(entry.item.text, 160),
                        sourceUrl: extractUrls(entry.item.text || '')[0] || '',
                        collectionName: entry.group.id, itemId: entry.item.id,
                        detail: '同一張卡已完成 3 次配額退避重試，服務仍回傳 429。',
                        resolution: '佇列已停止；更換整理服務／Key，或等待額度重置後重新啟動。'
                    });
                    cancelResearchBackfillQueue(`${outcome.provider || '模型'} 連續 3 次配額退避後仍無法使用，佇列已停止，避免無限重送。`);
                    return;
                }
                const backoff = backoffSchedule[Math.min(researchBackfillQuotaFailures - 1, backoffSchedule.length - 1)];
                scheduleResearchBackfillRetry(Math.max(outcome.remaining || 0, backoff), {
                    quota: true,
                    provider: outcome.provider
                });
                return;
            }
            if (outcome?.status === 'pause') {
                const pauseAttempts = (researchBackfillRetryAttempts.get(entry.key) || 0) + 1;
                researchBackfillRetryAttempts.set(entry.key, pauseAttempts);
                if (pauseAttempts > 3) {
                    recordResearchLog({
                        level: 'error', stage: 'jina', provider: outcome.provider,
                        status: 'pause_retry_exhausted', action: 'stop',
                        title: `${outcome.provider || '來源服務'} 限制重試已達上限`,
                        cardTitle: getShortText(entry.item.text, 160),
                        sourceUrl: extractUrls(entry.item.text || '')[0] || '',
                        collectionName: entry.group.id, itemId: entry.item.id,
                        detail: '同一張卡已等待並重試 3 次，來源服務仍限制存取。',
                        resolution: '佇列已停止；設定／更換 Jina Key，或等待限制解除後重新啟動。'
                    });
                    cancelResearchBackfillQueue(`${outcome.provider || '來源服務'} 等待重試 3 次後仍受限制，佇列已停止，避免無限重送。`);
                    return;
                }
                scheduleResearchBackfillRetry(outcome.remaining || 5 * 60_000, {
                    provider: outcome.provider,
                    reason: outcome.reason || `${outcome.provider || '來源服務'} 暫停`
                });
                return;
            }
            if (outcome?.status === 'retry') {
                researchBackfillRetryAttempts.set(entry.key, (researchBackfillRetryAttempts.get(entry.key) || 0) + 1);
                scheduleResearchBackfillRetry(outcome.remaining || 15_000, {
                    provider: outcome.provider,
                    reason: outcome.reason || `${outcome.provider || '研讀服務'} 暫時異常`
                });
                return;
            }
            researchBackfillFailed += 1;
            if (researchBackfillOrigin === 'schedule') {
                recordScheduledResearchFailure(entry, outcome?.reason || outcome?.error?.message || '來源或模型無法處理');
            }
            researchBackfillRetryAttempts.delete(entry.key);
            activeResearchBackfillKey = null;
            researchBackfillIndex += 1;
            updateResearchBackfillStatus(`上一張無法研讀，已跳過；準備下一張。`);
            setTimeout(processNextResearchBackfill, 400);
        }

        function startResearchBackfillQueue() {
            const selected = selectedResearchBackfillKeys;
            const entries = getResearchBackfillGroups().flatMap(group => group.items.flatMap(item => {
                const key = getResearchBackfillKey(group.id, item.id);
                return selected.has(key) ? [{ key, group, item }] : [];
            }));
            beginResearchBackfillQueue(entries, 'manual');
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && researchBackfillQueue.length > 0 && !researchBackfillWakeLock) {
                void requestResearchBackfillWakeLock();
            }
        });

        function renderTagBrowser() {
            const knownTagIds = new Set(currentTags.map(tag => tag.id));
            [...selectedTagFilterIds].forEach(id => {
                if (!knownTagIds.has(id)) selectedTagFilterIds.delete(id);
            });
            renderTagFilterOptions();
            renderTagMatchModeButtons();
            const groups = groupCardsByTagFilter({
                categories: currentCategories,
                inboxItems: currentInboxItems,
                itemsByCollection: currentItemsByCollection,
                selectedTagIds: [...selectedTagFilterIds],
                matchMode: tagMatchMode
            });
            const results = document.getElementById('tag-browser-results');
            results.replaceChildren();
            let total = 0;
            groups.forEach(group => {
                total += group.items.length;
                const section = document.createElement('section');
                section.setAttribute('data-tag-browser-group', group.id);
                section.className = 'rounded-2xl border border-slate-200 bg-white/60 p-4 md:p-5';
                const header = document.createElement('div');
                header.className = 'mb-3 flex items-center gap-2 text-base font-bold text-slate-700';
                const icon = document.createElement('i');
                icon.className = `${group.icon} text-indigo-500`;
                const name = document.createElement('span');
                name.textContent = group.name;
                const count = document.createElement('span');
                count.className = 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700';
                count.textContent = String(group.items.length);
                header.append(icon, name, count);
                const list = document.createElement('ul');
                list.className = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';
                group.items.forEach(item => list.appendChild(renderTagBrowserCard(item, group)));
                section.append(header, list);
                results.appendChild(section);
            });
            const selectionDescription = selectedTagFilterIds.size === 0
                ? '所有有 Tag 的卡片'
                : `${selectedTagFilterIds.size} 個 Tag · ${tagMatchMode === 'all' ? '符合全部' : '符合任一'}`;
            document.getElementById('tag-browser-summary').textContent = `${selectionDescription}｜${total} 張卡片，${groups.length} 個分類`;
            document.getElementById('tag-browser-empty').classList.toggle('hidden', groups.length > 0);
            renderResearchBackfillPanel();
            updateTagBrowserView();
            renderResearchReviewPanel();
        }

        function refreshOpenTagBrowser() {
            const modal = document.getElementById('tag-browser-modal');
            if (modal && !modal.classList.contains('hidden')) renderTagBrowser();
            const searchModal = document.getElementById('global-search-modal');
            if (searchModal && !searchModal.classList.contains('hidden')) renderGlobalSearch();
        }

        function openTagBrowser({ fromHistory = false } = {}) {
            renderTagBrowser();
            document.getElementById('tag-browser-modal').classList.remove('hidden');
            keyLayers.push({ name: 'tag-browser', keys: modalKeys(closeTagBrowser) });
            if (!fromHistory) history.pushState({ overlay: 'tag-browser' }, '', window.location.href);
        }

        function closeTagBrowser({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'tag-browser') {
                history.back();
                return;
            }
            document.getElementById('tag-browser-modal').classList.add('hidden');
            keyLayers.pop('tag-browser');
        }

        function getResearchLogUserId() {
            return getActiveSpaceId() || 'anonymous';
        }

        function updateResearchLogCount() {
            const logs = readResearchLogs(localStorage, getResearchLogUserId());
            const count = document.getElementById('research-log-count');
            if (count) count.textContent = String(logs.length);
            return logs;
        }

        function recordResearchLog(entry) {
            try {
                const logs = appendResearchLog(localStorage, getResearchLogUserId(), entry);
                const count = document.getElementById('research-log-count');
                if (count) count.textContent = String(logs.length);
                const modal = document.getElementById('research-log-modal');
                if (modal && !modal.classList.contains('hidden')) renderResearchLogs();
            } catch (error) {
                console.warn('無法保存研讀紀錄：', error);
            }
        }

        function renderResearchLogs() {
            const logs = updateResearchLogCount();
            const filtered = researchLogFilter === 'all'
                ? logs
                : logs.filter(entry => entry.level === researchLogFilter);
            const results = document.getElementById('research-log-results');
            const empty = document.getElementById('research-log-empty');
            results.replaceChildren();
            empty.classList.toggle('hidden', filtered.length > 0);
            document.getElementById('research-log-summary').textContent = `共 ${logs.length} 筆；目前顯示 ${filtered.length} 筆。紀錄只存在這台瀏覽器。`;

            document.querySelectorAll('[data-research-log-filter]').forEach(button => {
                const selected = button.dataset.researchLogFilter === researchLogFilter;
                button.classList.toggle('bg-white', selected);
                button.classList.toggle('text-slate-800', selected);
                button.classList.toggle('shadow-sm', selected);
                button.classList.toggle('text-slate-600', !selected);
                button.setAttribute('aria-pressed', String(selected));
            });

            const styles = {
                success: { icon: 'fa-circle-check', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', label: '成功' },
                warning: { icon: 'fa-clock', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800', label: '等待／重試' },
                error: { icon: 'fa-circle-exclamation', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-700', label: '錯誤／停止' },
                info: { icon: 'fa-circle-info', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-700', label: '資訊' }
            };
            filtered.forEach(entry => {
                const style = styles[entry.level] || styles.info;
                const article = document.createElement('article');
                article.className = `rounded-2xl border ${style.border} bg-white p-4 shadow-sm`;
                const heading = document.createElement('div');
                heading.className = 'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between';
                const titleWrap = document.createElement('div');
                titleWrap.className = 'min-w-0';
                const title = document.createElement('h3');
                title.className = 'font-bold text-slate-800';
                const icon = document.createElement('i');
                icon.className = `fas ${style.icon} mr-2`;
                title.append(icon, document.createTextNode(entry.title || entry.status || '研讀事件'));
                const context = document.createElement('p');
                context.className = 'mt-1 break-words text-xs text-slate-500';
                context.textContent = [entry.provider, entry.model, entry.stage].filter(Boolean).join(' · ');
                titleWrap.append(title, context);
                const meta = document.createElement('div');
                meta.className = 'flex shrink-0 items-center gap-2';
                const badge = document.createElement('span');
                badge.className = `rounded-full px-2 py-1 text-[11px] font-bold ${style.badge}`;
                badge.textContent = `${style.label}${entry.action ? ` · ${entry.action}` : ''}`;
                const time = document.createElement('time');
                time.className = 'text-xs text-slate-400';
                time.dateTime = new Date(entry.timestamp).toISOString();
                time.textContent = new Date(entry.timestamp).toLocaleString('zh-TW');
                meta.append(badge, time);
                heading.append(titleWrap, meta);
                article.appendChild(heading);

                if (entry.cardTitle) {
                    const card = document.createElement('p');
                    card.className = 'mt-3 break-words rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700';
                    card.textContent = entry.cardTitle;
                    article.appendChild(card);
                }
                if (entry.sourceUrl) {
                    const link = document.createElement('a');
                    link.className = 'mt-2 block break-all text-xs font-medium text-indigo-600 hover:underline';
                    link.href = entry.sourceUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = entry.sourceUrl;
                    article.appendChild(link);
                }
                [entry.detail, entry.resolution].filter(Boolean).forEach((text, index) => {
                    const paragraph = document.createElement('p');
                    paragraph.className = `mt-2 break-words text-sm leading-6 ${index === 0 ? 'text-slate-600' : 'font-medium text-slate-700'}`;
                    paragraph.textContent = index === 0 ? text : `處理方式：${text}`;
                    article.appendChild(paragraph);
                });
                if (entry.retryAt > Date.now()) {
                    const retry = document.createElement('p');
                    retry.className = 'mt-2 text-xs font-bold text-amber-700';
                    retry.textContent = `預計重試：${new Date(entry.retryAt).toLocaleString('zh-TW')}`;
                    article.appendChild(retry);
                }
                results.appendChild(article);
            });
        }

        function openResearchLog({ fromHistory = false } = {}) {
            renderResearchLogs();
            document.getElementById('research-log-modal').classList.remove('hidden');
            keyLayers.push({ name: 'research-log', keys: modalKeys(closeResearchLog) });
            if (!fromHistory) history.pushState({ overlay: 'research-log' }, '', window.location.href);
        }

        function closeResearchLog({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'research-log') {
                history.back();
                return;
            }
            document.getElementById('research-log-modal').classList.add('hidden');
            keyLayers.pop('research-log');
        }

        document.getElementById('global-search-btn').addEventListener('click', () => openGlobalSearch());
        document.getElementById('close-global-search-btn').addEventListener('click', () => closeGlobalSearch());
        document.getElementById('global-search-input').addEventListener('input', renderGlobalSearch);
        document.getElementById('clear-global-search-btn').addEventListener('click', () => {
            const input = document.getElementById('global-search-input');
            input.value = '';
            renderGlobalSearch();
            input.focus();
        });
        document.getElementById('global-search-modal').addEventListener('click', event => {
            if (event.target === event.currentTarget) closeGlobalSearch();
        });
        document.getElementById('tag-browser-btn').addEventListener('click', () => openTagBrowser());
        document.getElementById('close-tag-browser-btn').addEventListener('click', () => closeTagBrowser());
        document.getElementById('research-log-btn').addEventListener('click', () => openResearchLog());
        document.getElementById('close-research-log-btn').addEventListener('click', () => closeResearchLog());
        document.getElementById('research-log-modal').addEventListener('click', event => {
            if (event.target === event.currentTarget) closeResearchLog();
        });
        document.querySelectorAll('[data-research-log-filter]').forEach(button => {
            button.addEventListener('click', () => {
                researchLogFilter = button.dataset.researchLogFilter || 'all';
                renderResearchLogs();
            });
        });
        document.getElementById('clear-research-log-btn').addEventListener('click', () => {
            if (!window.confirm('確定清除這台瀏覽器的全部研讀紀錄？')) return;
            clearResearchLogs(localStorage, getResearchLogUserId());
            renderResearchLogs();
        });
        document.getElementById('help-center-btn').addEventListener('click', () => openHelpCenter());
        document.getElementById('close-help-center-btn').addEventListener('click', () => closeHelpCenter());
        document.getElementById('help-center-modal').addEventListener('click', event => {
            if (event.target === event.currentTarget) closeHelpCenter();
        });
        document.querySelectorAll('[data-help-target]').forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.dataset.helpTarget;
                document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveHelpSection(targetId);
            });
        });
        document.getElementById('tag-backfill-toggle-btn').addEventListener('click', () => {
            tagBrowserView = tagBrowserView === 'backfill' ? 'tags' : 'backfill';
            renderTagBrowser();
        });
        document.getElementById('tag-review-toggle-btn').addEventListener('click', () => {
            tagBrowserView = tagBrowserView === 'reviews' ? 'tags' : 'reviews';
            renderTagBrowser();
        });
        document.getElementById('select-all-tag-backfill-btn').addEventListener('click', () => {
            const entries = getResearchBackfillGroups().flatMap(group => group.items.map(item => (
                getResearchBackfillKey(group.id, item.id)
            )));
            const allSelected = entries.length > 0 && entries.every(key => selectedResearchBackfillKeys.has(key));
            entries.forEach(key => {
                if (allSelected) selectedResearchBackfillKeys.delete(key);
                else selectedResearchBackfillKeys.add(key);
            });
            researchBackfillStatusMessage = '';
            renderResearchBackfillPanel();
        });
        document.getElementById('start-tag-backfill-btn').addEventListener('click', startResearchBackfillQueue);
        document.getElementById('cancel-tag-backfill-btn').addEventListener('click', () => cancelResearchBackfillQueue());
        document.querySelectorAll('[data-backfill-approval-mode]').forEach(button => {
            button.addEventListener('click', () => {
                if (researchBackfillQueue.length > 0) return;
                researchBackfillApprovalMode = button.dataset.backfillApprovalMode === 'auto' ? 'auto' : 'manual';
                localStorage.setItem('researchBackfillApprovalMode', researchBackfillApprovalMode);
                renderResearchBackfillApprovalMode();
            });
        });
        document.getElementById('research-queue-floating-status').addEventListener('click', () => {
            tagBrowserView = 'backfill';
            if (document.getElementById('tag-browser-modal').classList.contains('hidden')) openTagBrowser();
            else renderTagBrowser();
        });
        document.getElementById('clear-tag-filter-btn').addEventListener('click', () => {
            selectedTagFilterIds.clear();
            renderTagBrowser();
        });
        document.querySelectorAll('[data-tag-match-mode]').forEach(button => {
            button.addEventListener('click', () => {
                tagMatchMode = button.getAttribute('data-tag-match-mode') === 'any' ? 'any' : 'all';
                renderTagBrowser();
            });
        });
        document.getElementById('tag-browser-modal').addEventListener('click', event => {
            if (event.target === event.currentTarget) closeTagBrowser();
        });

        function openSidebar() {
            document.getElementById('sidebar')?.classList.add('is-open');
            document.getElementById('sidebar-backdrop')?.classList.remove('hidden');
        }

        function closeSidebar() {
            document.getElementById('sidebar')?.classList.remove('is-open');
            document.getElementById('sidebar-backdrop')?.classList.add('hidden');
        }

        let sidebarObserver = null;

        function initSidebarObserver() {
            if (sidebarObserver) sidebarObserver.disconnect();

            const wrappers = document.querySelectorAll('.category-wrapper, #couple-planner');
            if (wrappers.length === 0) return;

            sidebarObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const listEl = entry.target.querySelector('[data-col]');
                    const colId = listEl?.getAttribute('data-col') || entry.target.id;
                    if (!colId) return;

                    document.querySelectorAll('.sidebar-link').forEach(link => {
                        link.classList.toggle('is-active', link.getAttribute('data-target') === colId);
                    });
                });
            }, {
                rootMargin: '-10% 0px -60% 0px',
                threshold: 0
            });

            wrappers.forEach(wrapper => sidebarObserver.observe(wrapper));
        }

        document.getElementById('sidebar-toggle-btn')?.addEventListener('click', openSidebar);
        document.getElementById('sidebar-close-btn')?.addEventListener('click', closeSidebar);
        document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);

        function populateCategoryForm(cat) {
            document.getElementById('category-form-title').innerText = '編輯分類';
            document.getElementById('cat-id-input').value = cat.id;
            document.getElementById('cat-name-input').value = cat.name;
            document.getElementById('cat-icon-input').value = cat.icon;
            document.querySelector(`.cat-type-btn[data-type="${cat.type}"]`).click();
            document.getElementById('cat-prompt-rule-input').value = cat.promptRule || '';
            document.getElementById('cat-delete-btn').classList.remove('hidden');
            renderIconPicker();
        }

        document.getElementById('ai-suggest-rule-btn').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const catName = document.getElementById('cat-name-input').value;
            if(!catName) return alert('請先輸入分類名稱！');
            
            const apiKey = document.getElementById('api-key-input').value || localStorage.getItem('geminiApiKey');
            if (!apiKey) return alert("請先設定 Gemini API Key！");
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            try {
                const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `你是一個 AI 助理。請為一個名為「${catName}」的筆記本分類，寫出一句簡短的分類判斷規則。例如：「只要提到買、補貨、超市、五金行，就放這裡。」。請直接輸出規則字串，不要加引號。` }] }]
                    })
                });
                const data = await response.json();
                if(data.error) throw new Error(data.error.message);
                const rule = data.candidates[0].content.parts[0].text.trim();
                document.getElementById('cat-prompt-rule-input').value = rule;
            } catch(err) {
                alert('生成失敗：' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sparkles"></i> AI 幫我寫';
            }
        });

        function renderMainGrid(categories) {
            const grid = document.getElementById('main-grid-container');
            grid.innerHTML = '';
            categories.forEach(cat => {
                const wrapper = document.createElement('div');
                wrapper.className = 'category-wrapper bg-surface border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full';
                wrapper.setAttribute('data-name', cat.name);
                
                const header = document.createElement('h2');
                header.className = 'text-lg font-bold text-slate-800 mb-4 flex items-center justify-between';
                
                const addBtnHtml = `
                    <button type="button" aria-label="在 ${escapeHtml(cat.name || '此分類')} 新增" class="add-item-btn-dynamic text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 border border-slate-200 w-7 h-7 rounded-md transition-colors flex flex-shrink-0 items-center justify-center focus:outline-none shadow-sm" data-col="${cat.id}" data-name="${escapeHtml(cat.name || '')}" title="在此分類新增">
                        <i class="fas fa-plus text-xs"></i>
                    </button>
                `;

                let controlsHtml = '';
                if (cat.type === 'todo') {
                    controlsHtml = `
                    <div class="flex items-center gap-2">
                        ${addBtnHtml}
                        <button type="button" aria-label="切換 ${escapeHtml(cat.name || '待辦')} 的完成項目顯示" class="toggle-completed-btn-dynamic text-xs font-normal text-slate-500 hover:text-indigo-600 bg-slate-50 border border-slate-200 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors flex items-center gap-1 focus:outline-none shadow-sm" data-col="${cat.id}">
                            <i class="fas fa-eye-slash toggle-icon"></i> <span class="hidden sm:inline toggle-text">隱藏已完成</span>
                        </button>
                        <button type="button" aria-label="清空 ${escapeHtml(cat.name || '待辦')} 的已完成項目" class="delete-completed-btn-dynamic text-xs font-normal text-rose-500 hover:text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-2 py-1 rounded-md transition-colors flex items-center gap-1 focus:outline-none shadow-sm" data-col="${cat.id}">
                            <i class="fas fa-trash-alt"></i> <span class="hidden sm:inline">清空已完成</span>
                        </button>
                    </div>`;
                } else {
                    controlsHtml = `<div class="flex items-center gap-2">${addBtnHtml}</div>`;
                }
                
                let titleHtml = `<div class="flex items-center"><i class="${cat.icon || 'fas fa-folder'} text-indigo-500 mr-2 text-xl"></i>${escapeHtml(cat.name || '')} <span id="count-${cat.id}" class="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full font-bold ml-2">0</span></div>` + controlsHtml;
                header.innerHTML = titleHtml;
                wrapper.appendChild(header);
                
                const list = document.createElement('ul');
                list.id = `list-${cat.id}`;
                list.className = 'sortable-list space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2 flex-1';
                list.setAttribute('data-col', cat.id);
                list.setAttribute('data-name', cat.name);
                wrapper.appendChild(list);
                
                grid.appendChild(wrapper);
                setupCategoryListener(cat.id, cat.type, cat.name, cat.icon);
                
                if (cat.type === 'todo') {
                    const toggleBtn = wrapper.querySelector('.toggle-completed-btn-dynamic');
                    if (toggleBtn) {
                        let isHidden = false;
                        toggleBtn.addEventListener('click', () => {
                            isHidden = !isHidden;
                            const icon = toggleBtn.querySelector('.toggle-icon');
                            const text = toggleBtn.querySelector('.toggle-text');
                            if (isHidden) {
                                list.classList.add('hide-completed-mode');
                                icon.className = 'fas fa-eye text-indigo-500 toggle-icon';
                                text.innerText = '顯示已完成';
                                text.classList.add('text-indigo-600', 'font-semibold');
                            } else {
                                list.classList.remove('hide-completed-mode');
                                icon.className = 'fas fa-eye-slash toggle-icon';
                                text.innerText = '隱藏已完成';
                                text.classList.remove('text-indigo-600', 'font-semibold');
                            }
                        });
                    }

                    const delBtn = wrapper.querySelector('.delete-completed-btn-dynamic');
                    if(delBtn) {
                        delBtn.addEventListener('click', async () => {
                            if(!confirm('清空所有已完成的項目？')) return;
                            const itemsEl = list.querySelectorAll('.todo-item-completed');
                            const count = itemsEl.length;
                            if (count === 0) {
                                showToast('沒有已完成的項目可以刪除', 'fas fa-info-circle');
                                return;
                            }
                            
                            const itemsToDelete = [];
                            for(const el of itemsEl) {
                                const itemId = el.getAttribute('data-id');
                                const docRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), cat.id, itemId);
                                const docSnap = await getDoc(docRef);
                                if (docSnap.exists()) {
                                    itemsToDelete.push({ id: itemId, data: docSnap.data() });
                                }
                                await deleteDoc(docRef);
                            }
                            
                            if (itemsToDelete.length > 0) {
                                historyManager.push({
                                    undo: async () => {
                                        for (const item of itemsToDelete) {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), cat.id, item.id), item.data);
                                        }
                                        showToast(`已還原：放回 ${itemsToDelete.length} 個已完成項目`, 'fas fa-undo');
                                    },
                                    redo: async () => {
                                        for (const item of itemsToDelete) {
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), cat.id, item.id));
                                        }
                                        showToast(`已重做：刪除 ${itemsToDelete.length} 個已完成項目`, 'fas fa-redo');
                                    }
                                });
                            }
                            showToast(`已清空已完成項目，共刪除 ${count} 項`, 'fas fa-trash-alt');
                        });
                    }
                }
                
                const addBtn = wrapper.querySelector('.add-item-btn-dynamic');
                if (addBtn) {
                    addBtn.addEventListener('click', () => {
                        const colId = addBtn.getAttribute('data-col');
                        const colName = addBtn.getAttribute('data-name');
                        if (cat.type === 'todo') {
                            openPlannerEntryModal(null, colId, '', 'task');
                        } else {
                            openAddCardModal(colId, colName);
                        }
                    });
                }
            });
            
            // Re-init sortable for new lists
            initDragAndDrop();
        }

        function setupCustomSelect() {
            const btn = document.getElementById('custom-category-btn');
            const menu = document.getElementById('custom-category-menu');
            
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('hidden');
            });
            
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target) && !btn.contains(e.target)) {
                    menu.classList.add('hidden');
                }
            });
            
            menu.addEventListener('click', (e) => {
                const optionBtn = e.target.closest('button[data-value]');
                if (optionBtn) {
                    const value = optionBtn.getAttribute('data-value');
                    const text = optionBtn.querySelector('span').innerText;
                    const iconClass = optionBtn.querySelector('i').className;
                    
                    document.getElementById('category-select').value = value;
                    document.getElementById('custom-category-text').innerText = text;
                    document.getElementById('custom-category-btn').querySelector('i').className = iconClass;
                    
                    menu.classList.add('hidden');
                }
            });
        }
        setupCustomSelect();

        function updateCategorySelectOptions(categories) {
            const select = document.getElementById('category-select');
            const menu = document.getElementById('custom-category-menu');
            const val = select.value;
            
            let html = `
                <button type="button" class="w-full text-left px-4 py-2 hover:bg-indigo-50 text-slate-700 flex items-center gap-2 text-sm transition-colors" data-value="inbox">
                    <i class="fas fa-inbox text-indigo-500 w-4 text-center"></i> <span>收件匣 (由 AI 分類)</span>
                </button>
            `;
            
            categories.forEach(cat => {
                const icon = cat.icon || 'fas fa-folder';
                html += `
                    <button type="button" class="w-full text-left px-4 py-2 hover:bg-indigo-50 text-slate-700 flex items-center gap-2 text-sm transition-colors" data-value="${cat.id}">
                        <i class="${icon} text-indigo-500 w-4 text-center"></i> <span>${escapeHtml(cat.name)}</span>
                    </button>
                `;
            });
            
            menu.innerHTML = html;
            
            const selectedBtn = menu.querySelector(`button[data-value="${val}"]`) || menu.querySelector(`button[data-value="inbox"]`);
            if (selectedBtn) {
                select.value = selectedBtn.getAttribute('data-value');
                document.getElementById('custom-category-text').innerText = selectedBtn.querySelector('span').innerText;
                document.getElementById('custom-category-btn').querySelector('i').className = selectedBtn.querySelector('i').className;
            }
        }

        async function handleIncomingShare() {
            const params = new URLSearchParams(window.location.search);
            const title = params.get('title');
            const text = params.get('text');
            const url = params.get('url');
            
            if (title || text || url) {
                let sharedContent = '';
                if (title) sharedContent += `${title}\n`;
                if (text) sharedContent += `${text}\n`;
                if (url) sharedContent += url;
                sharedContent = sharedContent.trim();
                if (localStorage.getItem('autoNewlineAfterUrl') !== 'off') {
                    sharedContent = insertNewlineAfterGluedUrls(sharedContent);
                }
                
                if (sharedContent) {
                    const inputArea = document.getElementById('idea-input');
                    if (inputArea) {
                        inputArea.value = sharedContent;
                        inputArea.style.height = 'auto';
                        inputArea.style.height = inputArea.scrollHeight + 'px';
                        inputArea.focus();
                        showToast('已匯入分享內容到輸入框，可編輯後送出！', 'fas fa-share-alt');
                    } else {
                        localStorage.setItem('pendingShare', sharedContent);
                    }
                }
                
                const cleanUrl = window.location.origin + window.location.pathname;
                window.history.replaceState({}, document.title, cleanUrl);
            }
        }

        async function processPendingShare() {
            const pendingShare = localStorage.getItem('pendingShare');
            if (pendingShare) {
                localStorage.removeItem('pendingShare');
                const inputArea = document.getElementById('idea-input');
                if (inputArea) {
                    inputArea.value = pendingShare;
                    inputArea.style.height = 'auto';
                    inputArea.style.height = inputArea.scrollHeight + 'px';
                    inputArea.focus();
                    showToast('已自動載入先前分享的內容！', 'fas fa-share-alt');
                }
            }
        }

        function renderSpaceControls() {
            const select = document.getElementById('space-select');
            const statusButton = document.getElementById('space-status-btn');
            const activeName = document.getElementById('active-space-name');
            const ownerControls = document.getElementById('space-owner-controls');
            const activeSpace = getActiveSpace();
            select.innerHTML = '';
            currentSpaces.forEach(space => {
                const option = document.createElement('option');
                option.value = space.spaceId;
                option.textContent = `${space.name || '未命名空間'}${space.role === 'owner' ? '（擁有者）' : ''}`;
                option.selected = space.spaceId === getActiveSpaceId();
                select.appendChild(option);
            });
            select.disabled = currentSpaces.length < 2;
            activeName.textContent = activeSpace?.name || '我的空間';
            statusButton.classList.toggle('hidden', !currentUser);
            statusButton.classList.toggle('flex', Boolean(currentUser));
            const isOwner = activeSpace?.role === 'owner';
            // A space is capped at two members, so the invite form only makes
            // sense while the owner is still unpaired.
            const isPaired = currentSpaceMembers.length >= 2;
            ownerControls.classList.toggle('hidden', !isOwner || isPaired);
            const renameRow = document.getElementById('space-rename-row');
            renameRow.classList.toggle('hidden', !isOwner);
            const renameInput = document.getElementById('space-rename-input');
            if (document.activeElement !== renameInput) {
                renameInput.value = activeSpace?.name || '';
            }
            renderSpacePairStatus(isPaired);
            renderSpaceMembers();
        }

        function renderSpacePairStatus(isPaired) {
            const status = document.getElementById('space-pair-status');
            if (!currentUser) {
                status.textContent = '登入後顯示綁定狀態。';
                return;
            }
            if (isPaired) {
                const partner = currentSpaceMembers.find(member => member.uid !== currentUser.uid);
                const partnerName = partner?.displayName || partner?.email || '伴侶';
                status.textContent = `已與 ${partnerName} 綁定，這個空間已滿（上限兩人）。`;
                return;
            }
            status.textContent = getActiveSpace()?.role === 'owner'
                ? '尚未綁定伴侶。建立邀請碼並請對方在自己的設定裡貼上加入。'
                : '尚未綁定伴侶。';
        }

        function renderSpaceMembers() {
            const container = document.getElementById('space-member-list');
            container.replaceChildren();
            if (currentSpaceMembers.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rounded-lg bg-white/70 px-3 py-2';
                empty.textContent = currentUser ? '正在載入成員…' : '登入後載入成員';
                container.appendChild(empty);
                return;
            }
            const canRemove = getActiveSpace()?.role === 'owner';
            currentSpaceMembers.forEach(member => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between gap-3 rounded-lg bg-white/80 px-3 py-2';
                const identity = document.createElement('div');
                identity.className = 'min-w-0';
                const name = document.createElement('div');
                name.className = 'truncate font-bold text-slate-800';
                name.textContent = member.displayName || member.email || '未命名成員';
                const detail = document.createElement('div');
                detail.className = 'truncate text-[11px] text-slate-500';
                detail.textContent = `${member.email || ''}${member.role === 'owner' ? ' · 擁有者' : ' · 成員'}`;
                identity.append(name, detail);
                row.appendChild(identity);
                if (canRemove && member.role !== 'owner') {
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.className = 'shrink-0 rounded-md px-2 py-1 font-bold text-rose-600 hover:bg-rose-50';
                    remove.textContent = '移除';
                    remove.addEventListener('click', () => void removeSpaceMember(member));
                    row.appendChild(remove);
                }
                container.appendChild(row);
            });
        }

        function setupSpaceMembersListener(spaceId) {
            unsubscribeSpaceMembers?.();
            unsubscribeSpaceMembers = onSnapshot(
                collection(db, 'artifacts', appId, 'spaces', spaceId, 'members'),
                snapshot => {
                    currentSpaceMembers = snapshot.docs.map(item => ({uid: item.id, ...item.data()}));
                    currentSpaceMembers.sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1));
                    // Pair status and the invite form both depend on member
                    // count, so refresh the whole panel rather than the list.
                    renderSpaceControls();
                    renderPlannerCollaborationMeta();
                },
                error => {
                    console.error('無法載入空間成員：', error);
                    currentSpaceMembers = [];
                    renderSpaceControls();
                    renderPlannerCollaborationMeta();
                }
            );
        }

        function openRequestedEditorForSpace(spaceId) {
            const urlParams = new URLSearchParams(window.location.search);
            const editorId = urlParams.get('editor');
            const editorCol = urlParams.get('col');
            if (!editorId || !editorCol) return;
            getDoc(doc(db, 'artifacts', appId, 'users', spaceId, editorCol, editorId))
                .then(docSnap => {
                    if (docSnap.exists()) {
                        const editorUrl = `${window.location.pathname}?editor=${encodeURIComponent(editorId)}&col=${encodeURIComponent(editorCol)}`;
                        history.replaceState({ overlay: null }, '', window.location.pathname);
                        history.pushState({ overlay: 'editor', itemId: editorId, collectionName: editorCol }, '', editorUrl);
                        openEditor(editorId, docSnap.data().text || '無標題', editorCol, { fromHistory: true });
                    } else {
                        history.replaceState({ overlay: null }, '', window.location.pathname);
                    }
                }).catch(err => console.error(err));
        }

        function startSpaceDataListeners(spaceId) {
            if (!currentUser || !spaceId || initializedSpaceId === spaceId) return;
            initializedSpaceId = spaceId;
            cleanupPlannerCategoryListeners();
            currentItemsByCollection.clear();
            plannerTodoCollectionIds.clear();
            setupPlannerCollectionListeners(spaceId);
            loadResearchReviews();
            updateResearchLogCount();
            setupSpaceMembersListener(spaceId);
            setupRealtimeListeners(spaceId);
            setupCloudResearchListeners(spaceId);
            openRequestedEditorForSpace(spaceId);
        }

        async function initializeSpaces(user) {
            unsubscribeSpaceMemberships?.();
            unsubscribeSpaceMemberships = null;
            currentSpaces = [];
            currentSpaceId = user.uid;
            initializedSpaceId = null;
            try {
                await ensurePersonalSpaceCallable();
                unsubscribeSpaceMemberships = onSnapshot(
                    collection(db, 'artifacts', appId, 'users', user.uid, 'memberships'),
                    snapshot => {
                        currentSpaces = snapshot.docs
                            .map(item => ({spaceId: item.id, ...item.data()}))
                            .sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1));
                        const savedSpaceId = localStorage.getItem(getSpaceStorageKey());
                        currentSpaceId = currentSpaces.some(space => space.spaceId === savedSpaceId)
                            ? savedSpaceId
                            : currentSpaces[0]?.spaceId || user.uid;
                        localStorage.setItem(getSpaceStorageKey(), currentSpaceId);
                        renderSpaceControls();
                        startSpaceDataListeners(currentSpaceId);
                    },
                    error => {
                        console.error('無法載入共同空間：', error);
                        document.getElementById('space-action-status').textContent = '共同空間載入失敗，暫時使用個人空間。';
                        startSpaceDataListeners(user.uid);
                    }
                );
            } catch (error) {
                console.error('共同空間初始化失敗：', error);
                currentSpaces = [{spaceId: user.uid, name: '我的空間', ownerUid: user.uid, role: 'owner'}];
                currentSpaceId = user.uid;
                renderSpaceControls();
                document.getElementById('space-action-status').textContent = '共同空間後端尚未部署，暫時使用原本的個人空間。';
                startSpaceDataListeners(user.uid);
            }
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                automaticResearchInboxLoaded = false;
                automaticResearchCategoriesLoaded = false;
                automaticResearchLoadedCollections.clear();
                loadResearchReviews();
                updateResearchLogCount();
                renderAutomaticResearchScheduleStatus();
                document.getElementById('auth-status').classList.replace('bg-amber-500', 'bg-emerald-500');
                document.getElementById('auth-text').innerText = user.displayName ? `嗨，${user.displayName}` : "已登入";
                document.getElementById('login-btn').classList.add('hidden'); document.getElementById('logout-btn').classList.remove('hidden');
                void initializeSpaces(user);
                clearInterval(automaticResearchPollTimer);
                automaticResearchPollTimer = setInterval(() => void checkAutomaticResearchSchedule(), 60_000);
                
                handleIncomingShare();
                processPendingShare();
            } else {
                cleanupCloudResearchListeners();
                clearTimeout(automaticResearchCheckTimer);
                clearInterval(automaticResearchPollTimer);
                automaticResearchCheckTimer = null;
                automaticResearchPollTimer = null;
                automaticResearchInboxLoaded = false;
                automaticResearchCategoriesLoaded = false;
                automaticResearchLoadedCollections.clear();
                currentUser = null;
                currentSpaceId = null;
                currentSpaces = [];
                currentSpaceMembers = [];
                initializedSpaceId = null;
                unsubscribeSpaceMemberships?.();
                unsubscribeSpaceMemberships = null;
                unsubscribeSpaceMembers?.();
                unsubscribeSpaceMembers = null;
                unsubscribeAnniversaries?.();
                unsubscribeAnniversaries = null;
                unsubscribeCalendarEvents?.();
                unsubscribeCalendarEvents = null;
                cleanupPlannerCategoryListeners();
                plannerTodoCollectionIds.clear();
                plannerTodoSyncStates.clear();
                plannerSyncState.anniversaries = 'syncing';
                plannerSyncState.calendarEvents = 'syncing';
                plannerSyncState.plans = 'syncing';
                plannerLastSyncedAt = null;
                currentAnniversaries = [];
                currentCalendarEvents = [];
                currentItemsByCollection.clear();
                renderCouplePlanner();
                renderSpaceControls();
                renderSpaceMembers();
                researchReviewItems = [];
                updateResearchLogCount();
                document.getElementById('auth-status').classList.replace('bg-emerald-500', 'bg-amber-500');
                document.getElementById('auth-text').innerText = "請先登入";
                document.getElementById('login-btn').classList.remove('hidden'); document.getElementById('logout-btn').classList.add('hidden');
                document.getElementById('main-grid-container').innerHTML = '';
                document.getElementById('inbox-list').innerHTML = `
                    <li class="bg-white/80 p-6 rounded-xl border border-indigo-100 text-slate-500 text-sm text-center ignore-drag backdrop-blur-sm">
                        <i class="fas fa-right-to-bracket text-indigo-300 text-xl mb-2"></i>
                        <div>請先登入才能查看你的收件匣</div>
                        <button id="inbox-login-prompt-btn" class="mt-3 text-indigo-600 font-semibold hover:underline">立即登入</button>
                    </li>`;
                document.getElementById('inbox-login-prompt-btn').addEventListener('click', () => document.getElementById('login-btn').click());
                handleIncomingShare();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') scheduleAutomaticResearchCheck(300);
        });
        window.addEventListener('focus', () => scheduleAutomaticResearchCheck(300));

        function checkAutoSortCondition() {
            if (isSorting || currentInboxItems.length === 0) return; 
            const apiKey = localStorage.getItem('geminiApiKey'); const autoSetting = localStorage.getItem('autoSortSetting') || 'off';
            if (!apiKey || autoSetting === 'off') return;
            const now = Date.now(); const lastSortTime = parseInt(localStorage.getItem('lastAutoSortTime') || '0', 10);
            if (autoSetting === 'always' || (autoSetting === 'daily' && now - lastSortTime > 86400000)) {
                runAiSort().then(success => {
                    if (success) localStorage.setItem('lastAutoSortTime', now.toString());
                });
            }
        }

        function setupRealtimeListeners(userId) {
            const getCol = (colName) => collection(db, 'artifacts', appId, 'users', userId, colName);
            const sortItems = (items) => items.sort((a, b) => getOrder(b) - getOrder(a));

            onSnapshot(doc(db, 'artifacts', appId, 'users', userId, 'settings', 'tags'), (snapshot) => {
                const tags = snapshot.exists() ? snapshot.data().items : [];
                currentTags = Array.isArray(tags)
                    ? tags.filter(tag => tag?.id && tag?.name).map(tag => ({ id: String(tag.id), name: String(tag.name) }))
                    : [];
                refreshOpenTagBrowser();
            });

            onSnapshot(getCol('inbox'), (snapshot) => {
                currentInboxItems = []; snapshot.forEach(doc => currentInboxItems.push({ id: doc.id, ...doc.data() }));
                automaticResearchInboxLoaded = true;
                sortItems(currentInboxItems); renderList(currentInboxItems, document.getElementById('inbox-list'), 'inbox');
                document.getElementById('inbox-count').innerText = currentInboxItems.length;
                document.getElementById('ai-sort-btn').disabled = currentInboxItems.length === 0;
                if (isInitialInboxLoad) { isInitialInboxLoad = false; setTimeout(checkAutoSortCondition, 800); }
                setTimeout(initSidebarObserver, 100);
                refreshOpenTagBrowser();
                renderAutomaticResearchScheduleStatus();
                if (isAutomaticResearchDataReady()) scheduleAutomaticResearchCheck();
            });

            onSnapshot(getCol('categories'), async (snapshot) => {
                automaticResearchCategoriesLoaded = true;
                currentCategories = [];
                snapshot.forEach(doc => currentCategories.push({ id: doc.id, ...doc.data() }));
                
                if (currentCategories.length === 0 && !localStorage.getItem('hasMigratedDefaultCategories')) {
                    localStorage.setItem('hasMigratedDefaultCategories', 'true');
                    const catCol = getCol('categories');
                    await setDoc(doc(catCol, 'todos'), { name: '待辦事項', icon: 'fas fa-check-square', type: 'todo', promptRule: '只要是需要執行、完成的任務、計畫、待辦事項就放這裡', order: 1000 });
                    await setDoc(doc(catCol, 'learning'), { name: '學習筆記', icon: 'fas fa-book', type: 'text', promptRule: '學習過程的筆記、知識點、重點整理', order: 2000 });
                    await setDoc(doc(catCol, 'ideas'), { name: '靈感與想法', icon: 'fas fa-lightbulb', type: 'text', promptRule: '突然想到的點子、創意、隨筆', order: 3000 });
                    await setDoc(doc(catCol, 'bookmarks'), { name: '稍後閱讀', icon: 'fas fa-bookmark', type: 'bookmark', promptRule: '只要是網址或想稍後看的文章就放這裡', order: 4000 });
                    return;
                }

                currentCategories.sort((a, b) => a.order - b.order);
                const categoryIds = new Set(currentCategories.map(category => category.id));
                cleanupPlannerCategoryListeners();
                plannerTodoCollectionIds.clear();
                currentCategories.filter(category => category.type === 'todo')
                    .forEach(category => plannerTodoCollectionIds.add(category.id));
                resetPlannerSyncState();
                [...currentItemsByCollection.keys()].forEach(id => {
                    if (!categoryIds.has(id)) currentItemsByCollection.delete(id);
                });
                [...automaticResearchLoadedCollections].forEach(id => {
                    if (!categoryIds.has(id)) automaticResearchLoadedCollections.delete(id);
                });
                
                renderCategoryManagerList(currentCategories);
                renderMainGrid(currentCategories);
                renderCouplePlanner();
                updateCategorySelectOptions(currentCategories);
                renderSidebar(currentCategories);
                setTimeout(initSidebarObserver, 100);
                refreshOpenTagBrowser();
                renderAutomaticResearchScheduleStatus();
                if (isAutomaticResearchDataReady()) scheduleAutomaticResearchCheck();
            });
        }

        function renderCollection(snapshot, containerEl, collectionName, iconClass) {
            const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            items.sort((a, b) => getOrder(b) - getOrder(a)); renderList(items, containerEl, collectionName, iconClass);
        }

        function getActionButtonsHTML() {
            return `
                <div class="flex items-center gap-0.5 shrink-0 z-10">
                    <button type="button" aria-label="複製卡片" class="copy-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="複製"><i class="fas fa-copy" aria-hidden="true"></i></button>
                    <button type="button" aria-label="編輯卡片" class="edit-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="編輯"><i class="fas fa-pen" aria-hidden="true"></i></button>
                    <button type="button" aria-label="移動卡片分類" class="move-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="移動分類"><i class="fas fa-folder-open" aria-hidden="true"></i></button>
                    <button type="button" aria-label="刪除卡片" class="delete-btn text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="刪除"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>
                </div>`;
        }

        function getWebResearchButtonHTML(item) {
            if (!canUseWebResearch(item?.text).ok) return '';
            const cloudEnabled = localStorage.getItem('cloudResearchEnabled') === 'on';
            const notebookLmSourceUrl = getNotebookLmSourceUrl(item?.text);
            return `
                <div class="flex flex-wrap justify-end gap-2 mt-1" data-card-interactive>
                    ${notebookLmSourceUrl ? `
                    <button type="button" class="notebooklm-research-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-300 text-xs font-bold transition-colors" title="複製影片網址並開啟 NotebookLM 手動研讀">
                        <i class="fas fa-book-open"></i>
                        <span>NotebookLM</span>
                    </button>` : ''}
                    <button type="button" class="web-research-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 text-xs font-bold transition-colors" title="${cloudEnabled ? '送入雲端背景研讀，完成後進入待審核' : 'AI 研讀這張卡片的網址'}">
                        <i class="fas ${cloudEnabled ? 'fa-cloud-arrow-up' : 'fa-wand-magic-sparkles'}"></i>
                        <span>${cloudEnabled ? '雲端研讀' : 'AI 研讀'}</span>
                    </button>
                </div>`;
        }

        function attachItemListeners(li, item, collectionName) {
            const copyBtn = li.querySelector('.copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    const textArea = document.createElement("textarea"); textArea.value = item.text;
                    document.body.appendChild(textArea); textArea.select();
                    try { document.execCommand('copy'); const icon = copyBtn.querySelector('i'); icon.className = 'fas fa-check text-emerald-500'; setTimeout(() => icon.className = 'fas fa-copy', 2000); } 
                    catch (err) {} document.body.removeChild(textArea);
                });
            }
            li.querySelector('.delete-btn')?.addEventListener('click', () => { 
                pendingDeleteTarget = { id: item.id, col: collectionName }; 
                confirmModal.classList.remove('hidden'); 
            });
            li.querySelector('.move-btn')?.addEventListener('click', () => {
                showMoveModal(item, collectionName);
            });
            li.querySelector('.edit-btn')?.addEventListener('click', () => {
                const isTodo = currentCategories.some(category => category.id === collectionName && category.type === 'todo');
                if (isTodo) {
                    openPlannerEntryModal(item, collectionName);
                    return;
                }
                pendingEditTarget = { id: item.id, col: collectionName }; editInput.value = item.text;
                document.getElementById('edit-plan-fields').classList.toggle('hidden', !isTodo);
                document.getElementById('edit-plan-fields').classList.toggle('grid', isTodo);
                document.getElementById('edit-plan-kind').value = getPlanKind(item);
                document.getElementById('edit-plan-date').value = parseDateKey(item.planDate) ? item.planDate : '';
                openEditCardModal();
            });
            li.querySelector('.web-research-btn')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (localStorage.getItem('cloudResearchEnabled') === 'on') {
                    enqueueCloudCardResearch(item, collectionName, event.currentTarget);
                } else {
                    runCardWebResearch(item, collectionName, event.currentTarget);
                }
            });
            li.querySelector('.notebooklm-research-btn')?.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const sourceUrl = getNotebookLmSourceUrl(item?.text);
                if (!sourceUrl) {
                    showToast('這張卡片沒有可交給 NotebookLM 的 YouTube 網址。', 'fas fa-triangle-exclamation');
                    return;
                }
                window.open('https://notebooklm.google.com/', '_blank', 'noopener,noreferrer');
                try {
                    await navigator.clipboard.writeText(sourceUrl);
                    showToast('已複製 YouTube 網址並開啟 NotebookLM，請貼到「新增來源」。', 'fas fa-copy');
                } catch {
                    const textArea = document.createElement('textarea');
                    textArea.value = sourceUrl;
                    textArea.setAttribute('readonly', '');
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    const copied = document.execCommand('copy');
                    textArea.remove();
                    showToast(
                        copied
                            ? '已複製 YouTube 網址並開啟 NotebookLM，請貼到「新增來源」。'
                            : 'NotebookLM 已開啟；請手動複製卡片中的 YouTube 網址。',
                        copied ? 'fas fa-copy' : 'fas fa-book-open'
                    );
                }
            });
        }

        function escapeHtml(unsafe) { 
            if (!unsafe) return '';
            return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); 
        }

        function getImageHTML(imageUrl) {
            const normalizedUrl = normalizeHttpUrl(imageUrl);
            if (!normalizedUrl) return '';
            const safeUrl = escapeHtml(normalizedUrl);
            return `<div class="mt-2 w-full"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="pointer-events-auto"><img src="${safeUrl}" class="w-full max-h-48 object-cover rounded-lg border border-slate-200 hover:opacity-90 transition-opacity pointer-events-auto"></a></div>`;
        }

        function buildUrlBoundaryRegex(flags = '') {
            // Stops a URL match at whitespace or CJK ideographs/kana/fullwidth punctuation,
            // since those glue directly onto URLs with no separating space in normal typing.
            return new RegExp('https?:\\/\\/[^\\s　-〿぀-ヿ㐀-鿿＀-￯]+', flags);
        }

        function insertNewlineAfterGluedUrls(text) {
            return text.replace(buildUrlBoundaryRegex('g'), (match, offset, fullString) => {
                const nextChar = fullString[offset + match.length];
                return (nextChar && !/\s/.test(nextChar)) ? match + '\n' : match;
            });
        }

        function getLinkPreviewData(text) {
            const safeText = text || '';
            const urlMatch = safeText.match(buildUrlBoundaryRegex());
            let previewHTML = '';
            let textWithoutUrl = safeText;

            if (urlMatch) {
                const url = normalizeHttpUrl(urlMatch[0]);
                if (!url) return { previewHTML, textWithoutUrl };
                const escapedUrl = escapeHtml(url);
                const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                if (ytMatch) {
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="block w-full mt-2 rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors relative group/preview pointer-events-auto"><img src="https://img.youtube.com/vi/${escapeHtml(ytMatch[1])}/mqdefault.jpg" class="w-full h-auto object-cover aspect-video"><div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-80 group-hover/preview:opacity-100 transition-opacity"><i class="fab fa-youtube text-red-500 text-5xl drop-shadow-md bg-white rounded-full"></i></div></a>`;
                } else if (url.includes('github.com')) {
                    const repoParts = new URL(url).pathname.replace(/^\//, '').split('/');
                    const repoPath = repoParts.slice(0, 2).join('/');
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors text-slate-700 pointer-events-auto"><i class="fab fa-github text-2xl shrink-0"></i><div class="flex flex-col overflow-hidden w-full"><span class="text-xs text-slate-400">GitHub Repository</span><span class="text-sm font-bold truncate">${escapeHtml(repoPath || 'GitHub Link')}</span></div></a>`;
                } else {
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-slate-700 pointer-events-auto"><div class="w-8 h-8 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center shrink-0"><i class="fas fa-link"></i></div><div class="flex flex-col overflow-hidden w-full"><span class="text-sm font-semibold truncate text-blue-600">${escapedUrl}</span><span class="text-xs text-slate-400 truncate">外部網站</span></div></a>`;
                }
                textWithoutUrl = safeText.replace(urlMatch[0], '').trim();
            }
            return { previewHTML, textWithoutUrl };
        }

        function renderList(items, containerEl, collectionName, iconClass = 'fas fa-circle text-[8px] text-indigo-400') {
            if (items.length === 0) {
                containerEl.innerHTML = collectionName === 'inbox' ? `<li class="bg-white/80 p-4 rounded-xl border border-indigo-100 text-slate-500 text-sm text-center ignore-drag">空空如也，丟點東西給我吧！</li>` : `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`;
                return;
            }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const li = document.createElement('li');
                li.className = 'bg-white p-3 rounded-xl border border-slate-100 text-slate-700 text-sm flex flex-col gap-2 relative shadow-sm group hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing w-full';
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                li.innerHTML = `
                    <div class="flex items-start justify-between w-full min-w-0">
                        <div class="flex items-start gap-2 flex-1 min-w-0 flex-col">
                            <div class="flex items-start gap-2 w-full mt-0.5">
                                <i class="${iconClass} shrink-0 mr-1 mt-1"></i>
                                <div class="leading-relaxed break-words break-all pr-2 line-clamp-3 text-left flex-1 whitespace-pre-wrap">${escapeHtml(textWithoutUrl || item.text || '')}</div>
                            </div>
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    ${getWebResearchButtonHTML(item)}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                attachItemListeners(li, item, collectionName);
                
                li.classList.add('cursor-pointer');
                li.addEventListener('click', (e) => {
                    if (justDropped) return; 
                    if (isInteractiveCardTarget(e.target)) return;
                    openEditor(item.id, item.text, collectionName);
                });
                
                containerEl.appendChild(li);
            });
        }

        function renderTodos(items, containerEl) {
            if (items.length === 0) { containerEl.innerHTML = `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`; return; }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const isCompleted = item.completed || false; const textClass = isCompleted ? 'todo-checked' : '';
                const li = document.createElement('li');
                li.className = `bg-white p-3 rounded-xl border border-slate-100 text-slate-700 text-sm flex flex-col gap-2 relative shadow-sm group hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing ${isCompleted ? 'todo-item-completed' : ''} w-full`;
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                
                li.innerHTML = `
                    <div class="flex items-start justify-between w-full min-w-0">
                        <div class="todo-content flex items-start gap-3 flex-1 min-w-0 cursor-pointer flex-col">
                            <div class="flex items-start gap-3 w-full mt-0.5">
                                <input type="checkbox" ${isCompleted ? 'checked' : ''} class="todo-checkbox w-4 h-4 text-emerald-500 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shrink-0 pointer-events-auto mt-[0.3rem]">
                                <div class="leading-relaxed break-words break-all pr-2 flex-1 transition-all line-clamp-3 whitespace-pre-wrap ${textClass}">${escapeHtml(textWithoutUrl || item.text || '')}</div>
                            </div>
                            ${(getPlanKind(item) !== 'task' || parseDateKey(item.planDate)) ? `<div class="ml-7 flex flex-wrap gap-1 text-[11px]"><span class="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">${PLAN_KINDS[getPlanKind(item)]}</span>${parseDateKey(item.planDate) ? `<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">${escapeHtml(item.planDate)}</span>` : ''}</div>` : ''}
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    ${getWebResearchButtonHTML(item)}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                
                const checkbox = li.querySelector('.todo-checkbox');
                
                li.addEventListener('click', async (e) => {
                    if (justDropped) return; 
                    if (e.target.tagName.toLowerCase() === 'img') return;
                    if (isInteractiveCardTarget(e.target)) return;
                    
                    openEditor(item.id, item.text, containerEl.getAttribute('data-col'));
                });
                
                checkbox.addEventListener('click', (e) => e.stopPropagation());
                checkbox.addEventListener('change', async (e) => {
                    if (!currentUser) {
                        e.target.checked = !e.target.checked;
                        showToast('請先登入，才能更新待辦狀態', 'fas fa-right-to-bracket');
                        return;
                    }
                    try {
                        await updateDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), containerEl.getAttribute('data-col'), item.id), { completed: e.target.checked });
                    } catch (error) {
                        e.target.checked = !e.target.checked;
                        console.error('更新待辦狀態失敗', error);
                        showToast('同步待辦狀態失敗，已復原勾選', 'fas fa-triangle-exclamation');
                    }
                });

                attachItemListeners(li, item, containerEl.getAttribute('data-col')); containerEl.appendChild(li);
            });
        }

        function renderBookmarks(items, containerEl, collectionName) {
            if (items.length === 0) { containerEl.innerHTML = `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`; return; }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const li = document.createElement('li');
                li.className = 'bg-white p-3 rounded-xl border border-slate-100 shadow-sm group hover:shadow-md transition-shadow flex flex-col gap-2 relative cursor-grab active:cursor-grabbing w-full';
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                
                let textHTML = textWithoutUrl ? `<div class="leading-relaxed break-words break-all text-slate-700 text-sm flex-1 line-clamp-3 pr-2 whitespace-pre-wrap">${escapeHtml(textWithoutUrl || '')}</div>` : '';

                li.innerHTML = `
                    <div class="flex items-start justify-between gap-2 w-full min-w-0 flex-col">
                        <div class="flex items-start gap-2 flex-1 w-full min-w-0">
                            <i class="fas fa-star text-rose-300 shrink-0 mt-1"></i>
                            ${textHTML}
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    ${getWebResearchButtonHTML(item)}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                attachItemListeners(li, item, collectionName); containerEl.appendChild(li);
            });
        }

        document.getElementById('cancel-delete-btn').addEventListener('click', () => { confirmModal.classList.add('hidden'); pendingDeleteTarget = null; });
        document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
            if (!currentUser) {
                showToast('請先登入，才能刪除卡片', 'fas fa-right-to-bracket');
                return;
            }
            if (pendingDeleteTarget) {
                const btn = document.getElementById('confirm-delete-btn'); const originalHTML = btn.innerHTML; btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>'; btn.disabled = true;
                try { 
                    const col = pendingDeleteTarget.col;
                    const id = pendingDeleteTarget.id;
                    const spaceId = getActiveSpaceId();
                    const docRef = doc(db, 'artifacts', appId, 'users', spaceId, col, id);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        const shortText = getShortText(data.text);
                        const colName = getCollectionName(col);
                        await deleteDoc(docRef);
                        historyManager.push({
                            undo: async () => {
                                await setDoc(doc(db, 'artifacts', appId, 'users', spaceId, col, id), data);
                                showToast(`已還原：將「${shortText}」放回 [${colName}]`, 'fas fa-undo');
                            },
                            redo: async () => {
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', spaceId, col, id));
                                showToast(`已重做：將「${shortText}」移至垃圾桶`, 'fas fa-redo');
                            }
                        });
                        showToast(`已將「${shortText}」移至垃圾桶`, 'fas fa-trash-alt', { label: '復原', onClick: () => historyManager.undo() });
                    }
                } catch(err) {
                    console.error('刪除卡片失敗', err);
                    showToast('刪除卡片失敗，請重試', 'fas fa-triangle-exclamation');
                } finally { btn.innerHTML = originalHTML; btn.disabled = false; confirmModal.classList.add('hidden'); pendingDeleteTarget = null; }
            }
        });

        function showMoveModal(item, currentCollection) {
            pendingMoveTarget = { id: item.id, col: currentCollection, data: item };
            
            const container = document.getElementById('move-options-container');
            container.innerHTML = '';
            
            const targets = [];
            if (currentCollection !== 'inbox') {
                targets.push({ id: 'inbox', name: '收件匣', icon: 'fas fa-inbox', colorClass: 'hover:border-indigo-500 hover:bg-indigo-50 text-indigo-500' });
            }
            
            currentCategories.forEach(cat => {
                if (cat.id !== currentCollection) {
                    let colorClass = 'hover:border-indigo-500 hover:bg-indigo-50 text-indigo-500';
                    if (cat.type === 'todo') colorClass = 'hover:border-emerald-500 hover:bg-emerald-50 text-emerald-500';
                    if (cat.type === 'bookmark') colorClass = 'hover:border-rose-500 hover:bg-rose-50 text-rose-500';
                    
                    targets.push({
                        id: cat.id,
                        name: cat.name,
                        icon: cat.icon || 'fas fa-folder',
                        colorClass: colorClass
                    });
                }
            });
            
            targets.forEach(target => {
                const btn = document.createElement('button');
                btn.className = `move-option-btn w-full p-3 text-left rounded-xl border border-slate-200 flex items-center gap-3 transition-colors ${target.colorClass}`;
                btn.setAttribute('data-target', target.id);
                btn.innerHTML = `<i class="${target.icon} w-6 text-center text-lg"></i><span class="font-semibold text-slate-700">${escapeHtml(target.name)}</span>`;
                
                btn.addEventListener('click', async (e) => {
                    const targetBtn = e.currentTarget; 
                    const targetCol = targetBtn.getAttribute('data-target');
                    if (currentUser && pendingMoveTarget) {
                        const originalHTML = targetBtn.innerHTML; 
                        targetBtn.innerHTML = '<div class="loader w-5 h-5 mx-auto border-t-slate-500"></div>';
                        try {
                            const { id, ...dataToMove } = pendingMoveTarget.data;
                            const oldCol = pendingMoveTarget.col;
                            const targetCat = currentCategories.find(c => c.id === targetCol);
                            const isTodoCol = targetCol === 'todos' || (targetCat && targetCat.type === 'todo');
                            if (!isTodoCol && dataToMove.completed !== undefined) delete dataToMove.completed;
                            const oldOrder = dataToMove.order || Date.now();
                            const newOrder = Date.now();
                            dataToMove.order = newOrder; 
                            
                            const shortText = getShortText(dataToMove.text);
                            const oldName = getCollectionName(oldCol);
                            const newName = getCollectionName(targetCol);
                            
                            historyManager.push({
                                undo: async () => {
                                    const oldData = { ...dataToMove, order: oldOrder };
                                    await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id), oldData);
                                    await copyCardDetails(targetCol, oldCol, id, id);
                                    await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCol, id));
                                    showToast(`已還原：將「${shortText}」放回 [${oldName}]`, 'fas fa-undo');
                                },
                                redo: async () => {
                                    await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCol, id), dataToMove);
                                    await copyCardDetails(oldCol, targetCol, id, id);
                                    await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id));
                                    showToast(`已重做：將「${shortText}」移至 [${newName}]`, 'fas fa-redo');
                                }
                            });

                            await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCol, id), dataToMove);
                            await copyCardDetails(oldCol, targetCol, id, id);
                            await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), oldCol, id));
                            showToast(`已將「${shortText}」移至 [${newName}]`, 'fas fa-exchange-alt');
                        } catch(err) { 
                            console.error(err); 
                        } finally { 
                            targetBtn.innerHTML = originalHTML; 
                            moveModal.classList.add('hidden'); 
                            pendingMoveTarget = null; 
                        }
                    }
                });
                
                container.appendChild(btn);
            });
            
            moveModal.classList.remove('hidden');
        }

        document.getElementById('cancel-move-btn').addEventListener('click', () => { 
            moveModal.classList.add('hidden'); 
            pendingMoveTarget = null; 
        });
        
        moveModal.addEventListener('click', (e) => {
            if (e.target === moveModal) {
                moveModal.classList.add('hidden');
                pendingMoveTarget = null;
            }
        });

        let activeAddCardColId = null;
        const addCardModal = document.getElementById('add-card-modal');
        const addCardInput = document.getElementById('add-card-input');
        let addCardPreviousFocus = null;

        window.openAddCardModal = function(colId, colName) {
            addCardPreviousFocus = document.activeElement;
            activeAddCardColId = colId;
            document.getElementById('add-card-modal-cat-name').textContent = colName;
            addCardInput.value = '';
            const isTodo = currentCategories.some(category => category.id === colId && category.type === 'todo');
            document.getElementById('add-plan-fields').classList.toggle('hidden', !isTodo);
            document.getElementById('add-plan-fields').classList.toggle('grid', isTodo);
            document.getElementById('add-plan-kind').value = 'task';
            document.getElementById('add-plan-date').value = '';
            addCardModal.classList.remove('hidden');
            keyLayers.push({ name: 'add-card', keys: modalKeys(window.closeAddCardModal) });
            addCardInput.focus();
        };

        window.closeAddCardModal = function() {
            addCardModal.classList.add('hidden');
            keyLayers.pop('add-card');
            activeAddCardColId = null;
            addCardInput.value = '';
            addCardPreviousFocus?.focus?.();
        };
        addCardModal.addEventListener('keydown', event => trapDialogTab(addCardModal, event));

        document.getElementById('cancel-add-card-btn').addEventListener('click', closeAddCardModal);
        
        addCardModal.addEventListener('click', (e) => {
            if (e.target === addCardModal) {
                closeAddCardModal();
            }
        });

        addCardInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                if (isTouchDevice) return; 
                e.preventDefault();
                document.getElementById('confirm-add-card-btn').click();
            }
        });

        document.getElementById('confirm-add-card-btn').addEventListener('click', async () => {
            if (!currentUser) {
                showToast('請先登入，才能新增卡片', 'fas fa-right-to-bracket');
                document.getElementById('login-btn')?.focus();
                return;
            }
            if (!activeAddCardColId) return;
            let text = addCardInput.value.trim();
            if (!text) return;

            const targetCollection = activeAddCardColId;
            const isTodo = currentCategories.some(category => category.id === targetCollection && category.type === 'todo');
            const planKind = document.getElementById('add-plan-kind').value;
            const planDate = document.getElementById('add-plan-date').value;
            if (isTodo && ((planDate && !parseDateKey(planDate)) || (planKind === 'date' && !planDate))) {
                showToast('約會需要有效日期', 'fas fa-calendar-days');
                return;
            }
            const btn = document.getElementById('confirm-add-card-btn');
            btn.disabled = true;
            btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>';

            try {
                const newDocData = { 
                    text: text, 
                    cardSearchText: text.toLocaleLowerCase('zh-Hant'),
                    createdAt: Date.now(),
                    createdByUid: currentUser.uid,
                    order: Date.now() 
                };
                if (isTodo) {
                    newDocData.planKind = Object.hasOwn(PLAN_KINDS, planKind) ? planKind : 'task';
                    if (planDate) newDocData.planDate = planDate;
                }

                const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection), newDocData);
                const newId = docRef.id;
                const shortText = getShortText(newDocData.text);
                const colName = getCollectionName(targetCollection);
                
                historyManager.push({
                    undo: async () => {
                        await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection, newId));
                        showToast(`已還原：移除新增的卡片「${shortText}」`, 'fas fa-undo');
                    },
                    redo: async () => {
                        await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection, newId), newDocData);
                        showToast(`已重做：將卡片「${shortText}」新增至 [${colName}]`, 'fas fa-redo');
                    }
                });
                
                showToast(`已新增卡片「${shortText}」至 [${colName}]`, 'fas fa-plus');
                closeAddCardModal();
            } catch (error) {
                console.error("新增卡片失敗", error);
                showToast(`新增卡片失敗：${error.message || '請稍後再試'}，表單仍保留`, 'fas fa-triangle-exclamation');
            } finally {
                btn.disabled = false;
                btn.innerText = '新增';
            }
        });

        document.getElementById('cancel-edit-btn').addEventListener('click', () => { closeEditCardModal(); });
        document.getElementById('confirm-edit-btn').addEventListener('click', async () => {
            if (!currentUser) {
                showToast('請先登入，才能編輯卡片', 'fas fa-right-to-bracket');
                document.getElementById('login-btn')?.focus();
                return;
            }
            if (pendingEditTarget) {
                const newText = document.getElementById('edit-input').value.trim(); if (!newText) return;
                const isTodo = currentCategories.some(category => category.id === pendingEditTarget.col && category.type === 'todo');
                const planKind = document.getElementById('edit-plan-kind').value;
                const planDate = document.getElementById('edit-plan-date').value;
                if (isTodo && ((planDate && !parseDateKey(planDate)) || (planKind === 'date' && !planDate))) {
                    showToast('約會需要有效日期', 'fas fa-calendar-days');
                    return;
                }
                const btn = document.getElementById('confirm-edit-btn'); const originalHTML = btn.innerHTML; btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>'; btn.disabled = true;
                try { 
                    const col = pendingEditTarget.col;
                    const id = pendingEditTarget.id;
                    const docRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), col, id);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const oldText = docSnap.data().text;
                        const oldData = docSnap.data();
                        const shortOldText = getShortText(oldText);
                        const shortNewText = getShortText(newText);
                        const newFields = {
                            text: newText,
                            cardSearchText: newText.toLocaleLowerCase('zh-Hant'),
                            ...(isTodo ? { planKind, planDate: planDate || deleteField() } : {})
                        };
                        const oldFields = {
                            text: oldText,
                            cardSearchText: oldText.toLocaleLowerCase('zh-Hant'),
                            ...(isTodo ? {
                                planKind: oldData.planKind === undefined ? deleteField() : oldData.planKind,
                                planDate: oldData.planDate === undefined ? deleteField() : oldData.planDate
                            } : {})
                        };
                        await updateDoc(docRef, newFields);
                        historyManager.push({
                            undo: async () => {
                                await updateDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), col, id), oldFields);
                                showToast(`已還原編輯：內容改回「${shortOldText}」`, 'fas fa-undo');
                            },
                            redo: async () => {
                                await updateDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), col, id), newFields);
                                showToast(`已重做編輯：內容改為「${shortNewText}」`, 'fas fa-redo');
                            }
                        });
                        showToast(`已將內容修改為「${shortNewText}」`, 'fas fa-edit');
                        closeEditCardModal();
                    }
                } catch(err) {
                    console.error('編輯卡片失敗', err);
                    showToast('編輯卡片失敗，請重試', 'fas fa-triangle-exclamation');
                } finally { btn.innerHTML = originalHTML; btn.disabled = false; }
            }
        });

        // ==========================================
        // ✨ ImgBB API 圖片上傳與表單提交流程
        // ==========================================
        const ideaInput = document.getElementById('idea-input');
        const imageUploadInput = document.getElementById('image-upload-input');
        const imagePreviewContainer = document.getElementById('image-preview-container');
        const imagePreviewImg = document.getElementById('image-preview-img');
        const removeImageBtn = document.getElementById('remove-image-btn');
        const aiWebStatusEl = document.getElementById('ai-web-status');
        const aiSortStatusEl = document.getElementById('ai-sort-status');
        const webResearchPreviewModal = document.getElementById('web-research-preview-modal');
        const webResearchPreviewContent = document.getElementById('web-research-preview-content');
        const webResearchPreviewSourceTitle = document.getElementById('web-research-preview-source-title');
        const webResearchPreviewSourceText = document.getElementById('web-research-preview-source-text');
        const webResearchPreviewSourceUrl = document.getElementById('web-research-preview-source-url');
        const webResearchPreviewMediaNotice = document.getElementById('web-research-preview-media-notice');
        const webResearchPreviewTagsContainer = document.getElementById('web-research-preview-tags-container');
        const webResearchPreviewTags = document.getElementById('web-research-preview-tags');
        const appendWebResearchBtn = document.getElementById('append-web-research-btn');
        const AI_SORT_COOLDOWN_MS = 5 * 60 * 1000;
        let pendingWebResearch = null;

        function formatCooldown(ms) {
            return `${Math.ceil(ms / 1000)} 秒`;
        }

        function formatStatusTime(timestamp) {
            if (!timestamp) return '尚無紀錄';
            try {
                return new Date(timestamp).toLocaleString('zh-TW', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (error) {
                return '尚無紀錄';
            }
        }

        function saveAiStatus(type, status, detail) {
            try {
                localStorage.setItem(`aiStatus:${type}`, JSON.stringify({
                    status,
                    detail,
                    timestamp: Date.now()
                }));
            } catch (error) {
                console.warn('無法儲存 AI 狀態：', error);
            }
        }

        function readAiStatus(type) {
            try {
                const raw = localStorage.getItem(`aiStatus:${type}`);
                if (!raw) return null;
                return JSON.parse(raw);
            } catch (error) {
                return null;
            }
        }

        function updateAiStatusPanel() {
            const webStatus = readAiStatus('web');
            const sortStatus = readAiStatus('sort');
            aiWebStatusEl.textContent = webStatus
                ? `網址研讀狀態：${webStatus.status}，${webStatus.detail}（${formatStatusTime(webStatus.timestamp)}）`
                : '網址研讀狀態：尚無紀錄';
            aiSortStatusEl.textContent = sortStatus
                ? `AI 整理狀態：${sortStatus.status}，${sortStatus.detail}（${formatStatusTime(sortStatus.timestamp)}）`
                : 'AI 整理狀態：尚無紀錄';
        }

        function setButtonLoading(button, loadingHTML, idleHTML) {
            if (!button) return () => {};
            const originalHTML = idleHTML || button.innerHTML;
            button.disabled = true;
            button.innerHTML = loadingHTML;
            return () => {
                button.disabled = false;
                button.innerHTML = originalHTML;
            };
        }

        function openWebResearchPreview(payload, { fromHistory = false } = {}) {
            pendingWebResearch = payload;
            const result = typeof payload.result === 'string'
                ? { note: payload.result, matchedTags: [], suggestedTags: [] }
                : payload.result;
            pendingWebResearch.result = result;
            const sourceUrl = normalizeHttpUrl(payload.sourceUrl || extractUrls(payload.sourceText)[0]);
            webResearchPreviewSourceTitle.textContent = payload.sourceTitle || '未取得網頁標題';
            webResearchPreviewSourceText.textContent = payload.sourceText || '未保留原始卡片內容';
            webResearchPreviewSourceUrl.textContent = sourceUrl || '原網址無法辨識';
            if (sourceUrl) webResearchPreviewSourceUrl.href = sourceUrl;
            else webResearchPreviewSourceUrl.removeAttribute('href');
            webResearchPreviewContent.textContent = result.note;
            const mediaNotice = result.mediaNotice || '';
            webResearchPreviewMediaNotice.textContent = mediaNotice;
            webResearchPreviewMediaNotice.classList.toggle('hidden', !mediaNotice);
            const suggestions = [...(result.matchedTags || []), ...(result.suggestedTags || [])];
            webResearchPreviewTags.replaceChildren();
            suggestions.forEach(tag => {
                const label = document.createElement('label');
                label.className = 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.value = tag.id;
                checkbox.className = 'h-4 w-4 accent-indigo-600';
                checkbox.setAttribute('data-web-research-tag', '');
                const text = document.createElement('span');
                text.textContent = tag.name;
                label.append(checkbox, text);
                if (tag.isNew) {
                    const badge = document.createElement('span');
                    badge.className = 'rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700';
                    badge.textContent = '新';
                    label.appendChild(badge);
                }
                webResearchPreviewTags.appendChild(label);
            });
            webResearchPreviewTagsContainer.classList.toggle('hidden', suggestions.length === 0);
            webResearchPreviewModal.classList.remove('hidden');
            keyLayers.push({
                name: 'web-research-preview',
                keys: modalKeys(closeWebResearchPreview)
            });
            if (!fromHistory) {
                history.pushState({ overlay: 'web-research-preview' }, '', window.location.href);
            }
        }

        function closeWebResearchPreview({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'web-research-preview') {
                history.back();
                return;
            }
            webResearchPreviewModal.classList.add('hidden');
            webResearchPreviewContent.textContent = '';
            webResearchPreviewSourceTitle.textContent = '';
            webResearchPreviewSourceText.textContent = '';
            webResearchPreviewSourceUrl.textContent = '';
            webResearchPreviewSourceUrl.removeAttribute('href');
            webResearchPreviewMediaNotice.textContent = '';
            webResearchPreviewMediaNotice.classList.add('hidden');
            webResearchPreviewTags.replaceChildren();
            webResearchPreviewTagsContainer.classList.add('hidden');
            pendingWebResearch = null;
            keyLayers.pop('web-research-preview');
        }

        async function runCardWebResearch(item, collectionName, button, {
            fromBackfill = false,
            deferPreview = false,
            attempt = 0
        } = {}) {
            const normalizedText = (item?.text || '').trim();
            const eligibility = canUseWebResearch(normalizedText);
            if (!eligibility.ok) {
                if (eligibility.reason === 'no_url') showToast('沒有偵測到網址，無法執行 AI 研讀。', 'fas fa-link');
                else if (eligibility.reason === 'multiple_urls') showToast('一次只支援研讀 1 個網址，請先精簡輸入。', 'fas fa-link');
                else if (eligibility.reason === 'too_long') showToast('這段內容太長，請先縮短後再執行 AI 研讀。', 'fas fa-align-left');
                return { status: 'ineligible' };
            }
            const sourceUrl = extractUrls(normalizedText)[0];
            const userNote = normalizedText.replace(sourceUrl, '').trim();
            const directVideoPage = isDirectVideoPageUrl(sourceUrl);
            const logContext = {
                cardTitle: getShortText(userNote || normalizedText, 160),
                sourceUrl,
                collectionName,
                itemId: item?.id || ''
            };

            let providerName = 'gemini';
            let apiKey = null;
            let targetModel = DEFAULT_WEB_RESEARCH_MODEL;
            let jinaApiKey = '';
            let systemPrompt = DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            try {
                const savedProvider = localStorage.getItem('webResearchProvider');
                const mistralApiKey = localStorage.getItem('mistralApiKey') || '';
                providerName = savedProvider === 'mistral' || savedProvider === 'gemini'
                    ? savedProvider
                    : mistralApiKey ? 'mistral' : 'gemini';
                apiKey = providerName === 'mistral'
                    ? mistralApiKey
                    : localStorage.getItem('geminiApiKey');
                targetModel = providerName === 'mistral'
                    ? localStorage.getItem('mistralWebResearchModel') || DEFAULT_MISTRAL_RESEARCH_MODEL
                    : localStorage.getItem('geminiWebResearchModel') || DEFAULT_WEB_RESEARCH_MODEL;
                jinaApiKey = localStorage.getItem('jinaApiKey') || '';
                systemPrompt = localStorage.getItem('webResearchSystemPrompt') || systemPrompt;
            } catch (error) {
                console.warn('無法讀取 AI 設定：', error);
            }
            if (!apiKey && !directVideoPage) {
                if (!fromBackfill) openSettingsModal();
                const providerLabel = providerName === 'mistral' ? 'Mistral' : 'Gemini';
                recordResearchLog({
                    ...logContext, level: 'error', stage: 'provider', provider: providerLabel,
                    model: targetModel, status: 'missing_api_key', action: 'stop',
                    title: `${providerLabel} API Key 尚未設定`,
                    detail: '整理服務沒有可用的 API Key。',
                    resolution: `在系統設定填入並儲存 ${providerLabel} API Key 後重新啟動。`
                });
                showToast(`請先設定 ${providerLabel} API Key，才能使用 AI 研讀。`, 'fas fa-key');
                return { status: 'blocked', reason: 'missing_api_key', provider: providerLabel, message: `缺少 ${providerLabel} API Key，佇列已停止。` };
            }

            const cacheContext = {
                provider: providerName,
                model: targetModel,
                prompt: systemPrompt,
                tags: currentTags.map(tag => `${tag.id}:${tag.name}`),
                pipeline: 'source-metadata-provider-json-v3'
            };
            const cached = readWebResearchCache(localStorage, normalizedText, Date.now(), cacheContext);
            if (cached) {
                saveAiStatus('web', '使用快取', '相同內容直接套用快取結果');
                updateAiStatusPanel();
                recordResearchLog({
                    ...logContext, level: 'success', stage: 'cache', provider: providerName,
                    model: targetModel, status: 'cached', action: 'cache', title: '已套用研讀快取',
                    detail: '相同網址、卡片內容、模型、Prompt 與 Tag 清單已有結果。',
                    resolution: '沒有呼叫 Jina 或模型 API，因此不消耗外部配額。'
                });
                const payload = {
                    itemId: item.id,
                    collectionName,
                    sourceText: normalizedText,
                    sourceTitle: cached.sourceTitle || userNote || new URL(sourceUrl).hostname,
                    sourceUrl,
                    cardTagIds: Array.isArray(item.tagIds) ? item.tagIds : [],
                    result: cached
                };
                if (deferPreview) return { status: 'ready', cached: true, payload };
                openWebResearchPreview(payload);
                showToast('已載入先前的 AI 研讀結果供預覽。', 'fas fa-clock-rotate-left');
                return { status: 'preview', cached: true, payload };
            }

            const cooldownRemaining = getWebResearchCooldownRemaining(localStorage);
            if (!directVideoPage && cooldownRemaining > 0) {
                saveAiStatus('web', '冷卻中', `剩餘 ${formatCooldown(cooldownRemaining)}`);
                updateAiStatusPanel();
                recordResearchLog({
                    ...logContext, level: 'warning', stage: 'cooldown', provider: providerName,
                    model: targetModel, status: 'cooldown', action: 'pause', title: '本機研讀冷卻中',
                    detail: `仍需等待 ${formatCooldown(cooldownRemaining)}。`,
                    resolution: '保留同一張卡，倒數結束後再送出。', retryAt: Date.now() + cooldownRemaining
                });
                showToast(`AI 研讀冷卻中，請 ${formatCooldown(cooldownRemaining)} 後再試。`, 'fas fa-hourglass-half');
                return { status: 'cooldown', remaining: cooldownRemaining };
            }

            const restoreButton = setButtonLoading(button, '<div class="loader w-4 h-4 border-2 border-t-transparent mx-auto"></div>');

            try {
                showToast(
                    directVideoPage
                        ? '正在辨識影片網址...'
                        : `正在用 Jina Reader 擷取原文，再交給 ${providerName === 'mistral' ? 'Mistral' : 'Gemini'} 整理...`,
                    'fas fa-robot'
                );
                const source = directVideoPage
                    ? { url: sourceUrl, title: '', description: '', content: '' }
                    : await readUrlWithJina(sourceUrl, jinaApiKey);
                const media = directVideoPage
                    ? { status: 'video_only', canSummarize: false, notice: '影片無法解析。' }
                    : classifyJinaResearchSource(source);
                const researchSource = {
                    ...source,
                    mediaStatus: media.status,
                    mediaNotice: media.notice
                };
                if (!directVideoPage && media.canSummarize) {
                    try {
                        localStorage.setItem('lastWebPolishTime', Date.now().toString());
                    } catch (storageError) {
                        console.warn('無法儲存 AI 研讀冷卻時間：', storageError);
                    }
                }
                const polished = directVideoPage
                    ? buildUnparsedVideoResearchResult(currentTags)
                    : media.canSummarize
                    ? await polishJinaContent({
                        provider: providerName,
                        source: researchSource,
                        userNote,
                        tags: currentTags,
                        apiKey,
                        model: targetModel,
                        systemPrompt
                    })
                    : { note: '頁面沒有可供解析的文字。', matchedTags: [], suggestedTags: [], mediaNotice: media.notice };
                polished.sourceTitle = await resolveResearchSourceTitle(sourceUrl, source, userNote);
                polished.sourceUrl = sourceUrl;
                polished.mediaNotice = media.notice;
                let cacheWritten = true;
                try {
                    writeWebResearchCache(localStorage, normalizedText, polished, Date.now(), cacheContext);
                } catch (storageError) {
                    cacheWritten = false;
                    console.warn('無法寫入 AI 研讀快取：', storageError);
                }
                saveAiStatus(
                    'web',
                    '成功',
                    cacheWritten ? '已完成網址研讀並寫入快取' : '已完成網址研讀（瀏覽器未允許寫入快取）'
                );
                updateAiStatusPanel();
                recordResearchLog({
                    ...logContext, level: 'success', stage: directVideoPage ? 'media' : 'complete',
                    provider: directVideoPage ? '本機判斷' : providerName, model: directVideoPage ? '' : targetModel,
                    status: directVideoPage ? 'video_only' : 'ready', action: 'complete',
                    title: directVideoPage ? '已辨識為尚未解析的影片' : 'AI 研讀完成',
                    detail: directVideoPage ? '影片內容未被猜測，僅建立「尚未解析的影片」結果。' : (cacheWritten ? '結果已完成並寫入快取。' : '結果已完成，但瀏覽器拒絕寫入快取。'),
                    resolution: deferPreview ? '依目前模式送往待審核或自動通過。' : '請在預覽確認後追加到詳細筆記。'
                });
                const payload = {
                    itemId: item.id,
                    collectionName,
                    sourceText: normalizedText,
                    sourceTitle: polished.sourceTitle,
                    sourceUrl,
                    cardTagIds: Array.isArray(item.tagIds) ? item.tagIds : [],
                    result: polished
                };
                if (deferPreview) return { status: 'ready', cached: false, payload };
                openWebResearchPreview(payload);
                showToast('AI 研讀完成，請預覽後確認追加。', 'fas fa-wand-magic-sparkles');
                return { status: 'preview', cached: false, payload };
            } catch (error) {
                const rawMessage = error?.message || '未知錯誤';
                const providerError = error?.providerInfo || error?.mistral || error?.gemini;
                const jinaError = error?.jina;
                console.error('AI 網頁研讀潤飾失敗', providerError ? {
                    provider: providerError.provider || providerName,
                    model: providerError.model,
                    status: providerError.status,
                    quotaId: providerError.quotaId,
                    retryDelay: providerError.retryDelay
                } : { stage: jinaError ? 'jina' : 'unknown', message: rawMessage });
                const stage = jinaError ? 'jina' : 'provider';
                const decision = classifyResearchFailure({
                    stage,
                    provider: providerName,
                    error,
                    hasJinaKey: Boolean(jinaApiKey),
                    attempt
                });
                const compactStatus = decision.category === 'provider_quota'
                    ? '配額不足'
                    : stage === 'jina'
                        ? '來源擷取失敗'
                        : '失敗';
                saveAiStatus('web', compactStatus, decision.detail);
                showToast(decision.userMessage, decision.action === 'stop' ? 'fas fa-circle-stop' : decision.action === 'skip' ? 'fas fa-forward' : 'fas fa-hourglass-half');
                recordResearchLog({
                    ...logContext,
                    level: decision.action === 'stop' || decision.action === 'skip' ? 'error' : 'warning',
                    stage,
                    provider: stage === 'jina' ? 'Jina Reader' : providerName,
                    model: stage === 'provider' ? targetModel : '',
                    status: decision.category,
                    action: decision.action,
                    title: decision.title,
                    detail: decision.detail,
                    resolution: decision.resolution,
                    retryAt: decision.retryAfterMs ? Date.now() + decision.retryAfterMs : 0
                });
                updateAiStatusPanel();
                if (decision.category === 'provider_quota') {
                    return {
                        status: 'quota',
                        provider: providerName === 'mistral' ? 'Mistral' : 'Gemini',
                        model: targetModel,
                        remaining: decision.retryAfterMs || 0,
                        error
                    };
                }
                if (decision.action === 'pause' || decision.action === 'retry') {
                    return {
                        status: decision.action,
                        remaining: decision.retryAfterMs,
                        provider: stage === 'jina' ? 'Jina Reader' : (providerName === 'mistral' ? 'Mistral' : 'Gemini'),
                        reason: decision.title,
                        error
                    };
                }
                if (decision.action === 'stop') {
                    return {
                        status: 'blocked',
                        reason: decision.category,
                        provider: stage === 'jina' ? 'Jina Reader' : (providerName === 'mistral' ? 'Mistral' : 'Gemini'),
                        message: decision.userMessage,
                        error
                    };
                }
                return { status: 'error', reason: decision.title, error };
            } finally {
                restoreButton();
            }
        }

        async function readUrlWithJina(sourceUrl, apiKey = '') {
            const request = buildJinaReaderRequest(sourceUrl, apiKey);
            let response;
            try {
                response = await fetch(request.url, request.options);
            } catch (cause) {
                const message = String(cause?.message || '網路連線失敗').slice(0, 300);
                const error = new Error(message);
                error.jina = { status: 0, message, detail: `Jina Reader｜網路或 CORS 失敗｜${message}` };
                throw error;
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = String(payload?.message || payload?.data?.message || `HTTP ${response.status}`).slice(0, 300);
                const error = new Error(message);
                error.jina = {
                    status: response.status,
                    message,
                    detail: `Jina Reader｜HTTP ${response.status}｜${message}`
                };
                throw error;
            }
            try {
                return parseJinaReaderResponse(payload, sourceUrl);
            } catch (cause) {
                const error = new Error(cause.message);
                error.jina = { status: response.status, message: cause.message, detail: `Jina Reader｜HTTP ${response.status}｜${cause.message}` };
                throw error;
            }
        }

        async function resolveResearchSourceTitle(sourceUrl, source, userNote = '') {
            if (isDirectVideoPageUrl(sourceUrl) && /(?:youtube\.com|youtu\.be)/i.test(sourceUrl)) {
                try {
                    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`);
                    if (response.ok) {
                        const metadata = await response.json();
                        if (String(metadata?.title || '').trim()) return String(metadata.title).trim();
                    }
                } catch (error) {
                    console.warn('無法取得 YouTube 影片標題：', error);
                }
            }
            const sourceTitle = String(source?.title || '').trim();
            if (sourceTitle) return sourceTitle;
            const noteTitle = String(userNote || '').trim();
            if (noteTitle) return noteTitle;
            try {
                return new URL(sourceUrl).hostname;
            } catch {
                return sourceUrl;
            }
        }

        async function persistWebResearchPayload(payload, selectedSuggestionIds) {
            if (!currentUser || !payload) throw new Error('沒有可儲存的研讀結果');
            const noteRef = doc(
                db,
                'artifacts',
                appId,
                'users',
                getActiveSpaceId(),
                payload.collectionName,
                payload.itemId,
                'details',
                'note'
            );
            const cardRef = doc(
                db,
                'artifacts',
                appId,
                'users',
                getActiveSpaceId(),
                payload.collectionName,
                payload.itemId
            );
            const tagsRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'settings', 'tags');
            const suggestions = [...(payload.result.matchedTags || []), ...(payload.result.suggestedTags || [])];
            await runTransaction(db, async transaction => {
                const [noteSnapshot, cardSnapshot, tagsSnapshot] = await Promise.all([
                    transaction.get(noteRef),
                    transaction.get(cardRef),
                    transaction.get(tagsRef)
                ]);
                const existingData = noteSnapshot.exists() ? noteSnapshot.data().data : null;
                if (!cardSnapshot.exists()) {
                    throw new Error('卡片已被刪除或移動，請重新研讀。');
                }
                const cardData = cardSnapshot.data();
                if (normalizeSourceText(cardData.text) !== normalizeSourceText(payload.sourceText)) {
                    throw new Error('卡片內容已在其他地方變更，請重新研讀。');
                }
                const serverTags = tagsSnapshot.exists() && Array.isArray(tagsSnapshot.data().items)
                    ? tagsSnapshot.data().items
                    : currentTags;
                const resolvedTags = resolveSelectedTags({
                    catalog: serverTags,
                    existingCardTagIds: Array.isArray(cardData.tagIds) ? cardData.tagIds : payload.cardTagIds,
                    suggestions,
                    selectedSuggestionIds
                });
                const now = Date.now();
                const searchFields = buildCardSearchFields({
                    cardText: cardData.text || payload.sourceText,
                    previousResearchText: cardData.researchSearchText,
                    newResearchText: payload.result.note
                });
                transaction.set(noteRef, {
                    data: buildWebResearchAppendData(existingData, payload.result.note, now),
                    updatedAt: now
                }, { merge: true });
                transaction.set(cardRef, {
                    tagIds: resolvedTags.cardTagIds,
                    ...searchFields,
                    updatedAt: now
                }, { merge: true });
                transaction.set(tagsRef, { items: resolvedTags.catalog, updatedAt: now }, { merge: true });
            });
        }

        async function appendPendingWebResearch() {
            if (!currentUser || !pendingWebResearch) return;
            const payload = pendingWebResearch;
            const restoreButton = setButtonLoading(
                appendWebResearchBtn,
                '<div class="loader w-4 h-4 border-2 border-t-transparent mx-auto"></div>',
                '追加到詳細筆記'
            );
            const selectedSuggestionIds = [...webResearchPreviewTags.querySelectorAll('input[data-web-research-tag]:checked')]
                .map(input => input.value);

            try {
                await persistWebResearchPayload(payload, selectedSuggestionIds);
                const completedReviewId = payload.reviewId;
                closeWebResearchPreview();
                const reviewRemoved = !completedReviewId || await deleteResearchReview(completedReviewId, 'succeeded');
                showToast(
                    reviewRemoved
                        ? 'AI 研讀結果與勾選的 tag 已儲存。'
                        : 'AI 研讀已儲存，但待審核清單清理失敗。',
                    reviewRemoved ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'
                );
            } catch (error) {
                console.error('追加 AI 研讀結果失敗：', error);
                showToast(`追加失敗：${error?.message || '未知錯誤'}`, 'fas fa-exclamation-triangle');
            } finally {
                restoreButton();
            }
        }

        document.getElementById('cancel-web-research-preview-btn').addEventListener('click', closeWebResearchPreview);
        document.getElementById('close-web-research-preview-btn').addEventListener('click', closeWebResearchPreview);
        appendWebResearchBtn.addEventListener('click', appendPendingWebResearch);
        webResearchPreviewModal.addEventListener('click', event => {
            if (event.target === webResearchPreviewModal) closeWebResearchPreview();
        });

        ideaInput.addEventListener('input', function() {
            this.style.height = '40px';
            this.style.height = (this.scrollHeight) + 'px';
        });
        function normalizeAutoNewlineTextarea(textareaEl) {
            if (localStorage.getItem('autoNewlineAfterUrl') === 'off') return false;
            const original = textareaEl.value;
            const processed = insertNewlineAfterGluedUrls(original);
            if (processed === original) return false;
            const start = textareaEl.selectionStart ?? original.length;
            const end = textareaEl.selectionEnd ?? start;
            const addedBeforeStart = insertNewlineAfterGluedUrls(original.slice(0, start)).length - start;
            const addedBeforeEnd = insertNewlineAfterGluedUrls(original.slice(0, end)).length - end;
            textareaEl.value = processed;
            textareaEl.selectionStart = start + addedBeforeStart;
            textareaEl.selectionEnd = end + addedBeforeEnd;
            textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        function attachAutoNewlinePaste(textareaEl) {
            textareaEl.addEventListener('paste', (e) => {
                if (localStorage.getItem('autoNewlineAfterUrl') === 'off') return;
                const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
                if (!clipboardText) {
                    // Some Android/iOS browsers do not expose clipboardData.
                    // Let the native paste finish, then normalize the resulting value.
                    setTimeout(() => normalizeAutoNewlineTextarea(textareaEl), 0);
                    return;
                }
                const processed = insertNewlineAfterGluedUrls(clipboardText);
                if (processed === clipboardText) return;
                e.preventDefault();
                const start = textareaEl.selectionStart;
                const end = textareaEl.selectionEnd;
                const original = textareaEl.value;
                textareaEl.value = original.slice(0, start) + processed + original.slice(end);
                const newCursor = start + processed.length;
                textareaEl.selectionStart = textareaEl.selectionEnd = newCursor;
                textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
            });
            textareaEl.addEventListener('input', (e) => {
                if (e.inputType === 'insertFromPaste') {
                    normalizeAutoNewlineTextarea(textareaEl);
                }
            });
        }
        attachAutoNewlinePaste(ideaInput);
        attachAutoNewlinePaste(addCardInput);
        ideaInput.addEventListener('keydown', function(e) { 
            if (e.key === 'Enter' && !e.shiftKey) { 
                // 改用觸控裝置偵測，避免電腦上的小視窗預覽時誤判為手機
                const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                if (isTouchDevice) return; // 觸控裝置 (手機/平板) 允許預設的換行行為
                
                e.preventDefault(); 
                document.getElementById('submit-btn').click(); // 模擬點擊送出按鈕
            } 
        });
        
        document.getElementById('paste-btn').addEventListener('click', async () => {
            try { const text = await navigator.clipboard.readText(); ideaInput.value += text; ideaInput.dispatchEvent(new Event('input')); ideaInput.focus(); } catch (err) { alert("無法自動讀取剪貼簿，請手動貼上。"); }
        });

        updateAiStatusPanel();

        ideaInput.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let index in items) {
                const item = items[index];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    e.preventDefault(); 
                    handleImageStaging(blob);
                    break;
                }
            }
        });

        document.getElementById('upload-image-btn').addEventListener('click', () => { imageUploadInput.click(); });
        imageUploadInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleImageStaging(e.target.files[0]);
        });

        function handleImageStaging(file) {
            const imgbbKey = localStorage.getItem('imgbbApiKey');
            if (!imgbbKey) {
                alert("請先點擊右上角「⚙️ 系統設定」，填寫免費的 ImgBB API Key 才能解鎖圖片上傳功能！");
                openSettingsModal();
                return;
            }
            
            if (file.size > 32 * 1024 * 1024) { alert("圖片太大了，ImgBB 限制最大 32MB！"); return; }
            
            stagedImageFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreviewImg.src = e.target.result;
                imagePreviewContainer.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }

        removeImageBtn.addEventListener('click', () => {
            stagedImageFile = null; imageUploadInput.value = '';
            imagePreviewContainer.classList.add('hidden'); imagePreviewImg.src = '';
        });

        async function polishJinaContent({ provider, ...options }) {
            return provider === 'mistral'
                ? polishJinaContentWithMistral(options)
                : polishJinaContentWithGemini(options);
        }

        async function polishJinaContentWithGemini({ source, userNote, tags, apiKey, model, systemPrompt }) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildGeminiResearchRequest({ source, userNote, tags, systemPrompt }))
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const info = describeGeminiApiError(errData, response.status, model);
                info.provider = 'gemini';
                const requestError = new Error(info.message);
                requestError.gemini = info;
                requestError.providerInfo = info;
                throw requestError;
            }
            
            const data = await response.json();
            if (data.error) {
                const info = describeGeminiApiError(data, data.error.code, model);
                info.provider = 'gemini';
                const requestError = new Error(info.message);
                requestError.gemini = info;
                requestError.providerInfo = info;
                throw requestError;
            }
            
            const candidate = data.candidates?.[0];
            if (!candidate) {
                const info = describeGeminiResponseIssue(data, model);
                info.provider = 'gemini';
                const responseError = new Error(info.message);
                responseError.gemini = info;
                responseError.providerInfo = info;
                throw responseError;
            }
            
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                const info = describeGeminiResponseIssue(data, model);
                info.provider = 'gemini';
                const responseError = new Error(`生成中斷，原因: ${candidate.finishReason}`);
                responseError.gemini = info;
                responseError.providerInfo = info;
                throw responseError;
            }
            
            const partText = extractGeminiResponseText(data);
            if (!partText) {
                const info = describeGeminiResponseIssue(data, model);
                info.provider = 'gemini';
                const responseError = new Error(info.message);
                responseError.gemini = info;
                responseError.providerInfo = info;
                throw responseError;
            }
            
            return parseGeminiResearchResult(partText, tags, source);
        }

        async function polishJinaContentWithMistral({ source, userNote, tags, apiKey, model, systemPrompt }) {
            const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(buildMistralResearchRequest({
                    source,
                    userNote,
                    tags,
                    model,
                    systemPrompt
                }))
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                const info = describeMistralApiError(
                    data,
                    response.status || data?.status,
                    model,
                    response.headers.get('retry-after')
                );
                const requestError = new Error(info.message);
                requestError.mistral = info;
                requestError.providerInfo = info;
                throw requestError;
            }
            const content = data?.choices?.[0]?.message?.content;
            const partText = typeof content === 'string'
                ? content.trim()
                : Array.isArray(content)
                    ? content.filter(part => part?.type === 'text' && part?.text).map(part => part.text).join('\n').trim()
                    : '';
            if (!partText) {
                const info = describeMistralApiError(
                    { message: '模型未回傳可顯示文字' },
                    200,
                    model
                );
                const responseError = new Error(info.message);
                responseError.mistral = info;
                responseError.providerInfo = info;
                throw responseError;
            }
            return parseGeminiResearchResult(partText, tags, source);
        }

        document.getElementById('add-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) {
                showToast('請先登入，才能新增共同內容', 'fas fa-right-to-bracket');
                document.getElementById('login-btn')?.focus();
                return;
            }
            let text = ideaInput.value.trim(); 
            
            if (!text && !stagedImageFile) return;

            const targetCollection = document.getElementById('category-select').value; 
            const btn = document.getElementById('submit-btn'); 
            btn.disabled = true; btn.innerHTML = '<div class="loader w-4 h-4 border-2"></div>';

            let uploadedImageUrl = null;

            try {
                if (stagedImageFile) {
                    const imgbbKey = localStorage.getItem('imgbbApiKey');
                    const formData = new FormData();
                    formData.append('image', stagedImageFile);

                    const res = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
                        method: 'POST', body: formData
                    });
                    
                    const data = await res.json();
                    if (data.success) {
                        uploadedImageUrl = data.data.url;
                    } else {
                        throw new Error(data.error?.message || "ImgBB 上傳失敗");
                    }
                }

                const newDocData = { 
                    text: text || "（附加圖片）", 
                    cardSearchText: (text || "（附加圖片）").toLocaleLowerCase('zh-Hant'),
                    createdAt: Date.now(), createdByUid: currentUser.uid, order: Date.now()
                };

                if (uploadedImageUrl) newDocData.imageUrl = uploadedImageUrl;

                const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection), newDocData);
                const newId = docRef.id;
                const shortText = getShortText(newDocData.text);
                const colName = getCollectionName(targetCollection);
                historyManager.push({
                    undo: async () => {
                        await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection, newId));
                        showToast(`已還原：移除新增的卡片「${shortText}」`, 'fas fa-undo');
                    },
                    redo: async () => {
                        await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCollection, newId), newDocData);
                        showToast(`已重做：將卡片「${shortText}」新增至 [${colName}]`, 'fas fa-redo');
                    }
                });
                showToast(`已新增卡片「${shortText}」至 [${colName}]`, 'fas fa-plus');
                
                ideaInput.value = ''; ideaInput.style.height = '40px';
                removeImageBtn.click(); 

            } catch (error) { 
                console.error("送出失敗", error);
                showToast(`送出失敗：${error.message || '請稍後再試'}，內容仍保留在輸入框`, 'fas fa-triangle-exclamation');
            } finally { 
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane text-xs"></i>'; ideaInput.focus();
            }
        });

        // ==========================================
        // ✨ 設定邏輯與 AI 分類
        // ==========================================
        let availableGeminiModels = [];
        let modelSettingsApiKey = '';
        let availableMistralModels = [];
        let mistralModelSettingsApiKey = '';

        function replaceSelectOptions(select, models, selectedValue, emptyLabel = '目前沒有可用模型') {
            select.innerHTML = '';
            if (!models.length) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = emptyLabel;
                select.appendChild(option);
                select.disabled = true;
                return;
            }
            select.disabled = false;
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.label;
                select.appendChild(option);
            });
            if (selectedValue && models.some(model => model.id === selectedValue)) {
                select.value = selectedValue;
            }
        }

        function populateGeminiModelSettings(models, apiKey, preferredWebModel = null) {
            availableGeminiModels = Array.isArray(models) ? models : [];
            modelSettingsApiKey = apiKey;
            const generalModels = availableGeminiModels
                .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
                .map(model => ({ id: model.name.replace(/^models\//, ''), label: model.displayName || model.name }));
            const verificationStatuses = Object.fromEntries(generalModels.map(model => [
                model.id,
                readWebResearchModelVerification(localStorage, apiKey, model.id)
            ]));
            const researchModels = getWebResearchModelOptions(availableGeminiModels, verificationStatuses);
            const currentGeneralModel = document.getElementById('model-select').value;
            const savedGeneralModel = currentGeneralModel
                || localStorage.getItem('geminiModel')
                || DEFAULT_WEB_RESEARCH_MODEL;
            const savedWebModel = preferredWebModel
                || document.getElementById('web-research-model-select').value
                || localStorage.getItem('geminiWebResearchModel')
                || DEFAULT_WEB_RESEARCH_MODEL;

            replaceSelectOptions(document.getElementById('model-select'), generalModels, savedGeneralModel);
            replaceSelectOptions(
                document.getElementById('web-research-model-select'),
                generalModels,
                savedWebModel,
                '目前沒有可用的生成模型'
            );
            replaceSelectOptions(
                document.getElementById('web-research-candidate-select'),
                researchModels.unknown,
                null,
                '沒有可測試的模型'
            );
            document.getElementById('verify-web-research-model-btn').disabled = researchModels.unknown.length === 0;
            document.getElementById('model-select-container').classList.remove('hidden');
            renderWebResearchProviderSettings();
            return researchModels;
        }

        async function loadGeminiModels(key) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const info = describeGeminiApiError(data, response.status, 'models.list');
                const error = new Error(info.message);
                error.gemini = info;
                throw error;
            }
            return Array.isArray(data.models) ? data.models : [];
        }

        async function loadMistralModels(key) {
            const response = await fetch('https://api.mistral.ai/v1/models', {
                headers: { Authorization: `Bearer ${key}` }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const info = describeMistralApiError(data, response.status, 'models.list', response.headers.get('retry-after'));
                const error = new Error(info.message);
                error.mistral = info;
                throw error;
            }
            return (Array.isArray(data.data) ? data.data : [])
                .filter(model => !model?.archived && model?.capabilities?.completion_chat !== false)
                .map(model => ({ id: String(model?.id || '').trim(), label: String(model?.id || '').trim() }))
                .filter(model => model.id);
        }

        function populateMistralModelSettings(models, apiKey) {
            availableMistralModels = Array.isArray(models) ? models : [];
            mistralModelSettingsApiKey = apiKey;
            const savedModel = document.getElementById('mistral-web-research-model-select').value
                || localStorage.getItem('mistralWebResearchModel')
                || DEFAULT_MISTRAL_RESEARCH_MODEL;
            replaceSelectOptions(
                document.getElementById('mistral-web-research-model-select'),
                availableMistralModels,
                savedModel,
                '這把 Key 目前沒有可用的對話模型'
            );
            document.getElementById('mistral-web-research-model-select-container').classList.remove('hidden');
        }

        function renderWebResearchProviderSettings() {
            const provider = document.getElementById('web-research-provider-select').value;
            const geminiReady = modelSettingsApiKey && availableGeminiModels.length > 0;
            document.getElementById('web-research-model-select-container').classList.toggle(
                'hidden',
                provider !== 'gemini' || !geminiReady
            );
            document.getElementById('mistral-settings-container').classList.remove('hidden');
        }

        async function probeWebResearchModel(apiKey, model) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: '請使用 Google Search 查詢今天是星期幾，只回覆「SEARCH_OK」。' }] }],
                    tools: [{ google_search: {} }],
                    generationConfig: { maxOutputTokens: 16, temperature: 0 }
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                const info = describeGeminiApiError(data, response.status, model);
                const error = new Error(info.message);
                error.gemini = info;
                throw error;
            }
            if (!data.candidates?.length) throw new Error('測試請求成功，但模型沒有回傳候選結果');
            return true;
        }

        function renderTagManager() {
            const container = document.getElementById('tag-manager-list');
            container.replaceChildren();
            const suspiciousTagIds = findSuspiciousTagIds(draftTags);
            const suspiciousWarning = document.getElementById('suspicious-tag-warning');
            suspiciousWarning.classList.toggle('hidden', suspiciousTagIds.length === 0);
            document.getElementById('suspicious-tag-count').textContent = String(suspiciousTagIds.length);
            if (!draftTags.length) {
                const empty = document.createElement('span');
                empty.className = 'text-xs text-slate-400';
                empty.textContent = '尚未建立 tag';
                container.appendChild(empty);
                return;
            }
            draftTags.forEach(tag => {
                const pill = document.createElement('span');
                pill.className = 'inline-flex min-h-10 max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white pl-3 pr-1 text-sm text-slate-700 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100';
                const name = document.createElement('input');
                name.type = 'text';
                name.maxLength = 40;
                name.value = tag.name;
                name.className = 'min-w-16 max-w-[min(20rem,calc(100vw-9rem))] bg-transparent outline-none';
                const resizeNameInput = () => {
                    const displayUnits = [...name.value].reduce(
                        (total, character) => total + (/[\u3000-\u9fff\uff01-\uff60]/u.test(character) ? 2 : 1),
                        0
                    );
                    name.style.width = `${Math.max(8, Math.min(40, displayUnits + 2))}ch`;
                };
                resizeNameInput();
                name.setAttribute('aria-label', `重新命名 tag ${tag.name}`);
                name.addEventListener('input', () => {
                    const nextName = name.value.replace(/\s+/g, ' ').slice(0, 40);
                    tag.name = nextName;
                    resizeNameInput();
                });
                name.addEventListener('blur', () => {
                    tag.name = tag.name.trim() || '未命名';
                    name.value = tag.name;
                    resizeNameInput();
                });
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-200';
                remove.setAttribute('aria-label', `刪除 tag ${tag.name}`);
                remove.innerHTML = '<i class="fas fa-times text-xs"></i>';
                remove.addEventListener('click', () => {
                    draftTags = draftTags.filter(item => item.id !== tag.id);
                    renderTagManager();
                });
                pill.append(name, remove);
                container.appendChild(pill);
            });
        }

        function addDraftTag() {
            const input = document.getElementById('new-tag-input');
            const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!name) return;
            const resolved = resolveSelectedTags({
                catalog: draftTags,
                suggestions: [{ id: `new:${name}`, name, isNew: true }],
                selectedSuggestionIds: [`new:${name}`]
            });
            if (resolved.catalog.length === draftTags.length) {
                showToast('這個 tag 已經存在。', 'fas fa-tag');
                return;
            }
            draftTags = resolved.catalog;
            input.value = '';
            renderTagManager();
        }

        function closeSettingsModal() {
            document.getElementById('settings-modal').classList.add('hidden');
            keyLayers.pop('settings');
        }

        function openSettingsModal() {
            document.getElementById('api-key-input').value = localStorage.getItem('geminiApiKey') || '';
            const mistralKey = localStorage.getItem('mistralApiKey') || '';
            document.getElementById('mistral-api-key-input').value = mistralKey;
            const savedProvider = localStorage.getItem('webResearchProvider');
            document.getElementById('web-research-provider-select').value = savedProvider === 'gemini' || savedProvider === 'mistral'
                ? savedProvider
                : mistralKey ? 'mistral' : 'gemini';
            const savedMistralModel = localStorage.getItem('mistralWebResearchModel') || DEFAULT_MISTRAL_RESEARCH_MODEL;
            replaceSelectOptions(
                document.getElementById('mistral-web-research-model-select'),
                [{ id: savedMistralModel, label: savedMistralModel }],
                savedMistralModel
            );
            document.getElementById('mistral-web-research-model-select-container').classList.toggle('hidden', !mistralKey);
            document.getElementById('jina-api-key-input').value = localStorage.getItem('jinaApiKey') || '';
            updateApiKeySaveStatuses();
            document.getElementById('imgbb-key-input').value = localStorage.getItem('imgbbApiKey') || '';
            document.getElementById('web-research-system-prompt').value = localStorage.getItem('webResearchSystemPrompt') || DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            document.getElementById('auto-sort-select').value = localStorage.getItem('autoSortSetting') || 'off';
            document.getElementById('auto-research-interval-select').value = localStorage.getItem('autoResearchInterval') || 'off';
            document.getElementById('cloud-research-enabled-toggle').checked = localStorage.getItem('cloudResearchEnabled') === 'on';
            const savedCloudApprovalMode = cloudAutomationSettings
                ? cloudAutomationSettings.approvalMode === 'auto' ? 'auto' : 'manual'
                : localStorage.getItem('cloudResearchApprovalMode') === 'auto' ? 'auto' : 'manual';
            const cloudApprovalInput = document.querySelector(
                `input[name="cloud-research-approval-mode"][value="${savedCloudApprovalMode}"]`
            );
            if (cloudApprovalInput) cloudApprovalInput.checked = true;
            document.getElementById('auto-newline-toggle').checked = localStorage.getItem('autoNewlineAfterUrl') !== 'off';
            draftTags = currentTags.map(tag => ({ ...tag }));
            renderTagManager();
            renderWebResearchProviderSettings();
            updateAiStatusPanel();
            renderAutomaticResearchScheduleStatus();
            document.getElementById('settings-modal').classList.remove('hidden');
            keyLayers.push({ name: 'settings', keys: modalKeys(closeSettingsModal) });
        }

        async function renameSpace() {
            const input = document.getElementById('space-rename-input');
            const button = document.getElementById('space-rename-btn');
            const status = document.getElementById('space-action-status');
            const name = input.value.trim();
            if (!name) {
                status.textContent = '請輸入空間名稱。';
                input.focus();
                return;
            }
            button.disabled = true;
            button.textContent = '儲存中…';
            try {
                await renameSpaceCallable({spaceId: getActiveSpaceId(), name});
                status.textContent = '空間名稱已更新。';
            } catch (error) {
                console.error('空間改名失敗：', error);
                status.textContent = error?.message || '空間改名失敗。';
            } finally {
                button.disabled = false;
                button.textContent = '改名';
            }
        }

        async function createSpaceInvite() {
            const emailInput = document.getElementById('space-invite-email');
            const button = document.getElementById('create-space-invite-btn');
            const result = document.getElementById('space-invite-result');
            const email = emailInput.value.trim();
            if (!email) {
                document.getElementById('space-action-status').textContent = '請先輸入伴侶登入時使用的 Google 帳號 email。';
                emailInput.focus();
                return;
            }
            button.disabled = true;
            button.textContent = '建立中…';
            try {
                const response = await createSpaceInviteCallable({spaceId: getActiveSpaceId(), email});
                const inviteCode = response.data?.inviteCode || '';
                result.replaceChildren();
                const message = document.createElement('span');
                message.textContent = `邀請碼（7 天有效）：${inviteCode}`;
                const copyButton = document.createElement('button');
                copyButton.type = 'button';
                copyButton.className = 'ml-2 rounded-md bg-white px-2 py-1 font-bold text-rose-700 hover:bg-rose-50';
                copyButton.textContent = '複製';
                copyButton.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(inviteCode);
                    copyButton.textContent = '已複製';
                });
                result.append(message, copyButton);
                result.classList.remove('hidden');
                emailInput.value = '';
                document.getElementById('space-action-status').textContent = '請用安全的私訊把邀請碼交給受邀帳號。';
            } catch (error) {
                console.error('建立共同空間邀請失敗：', error);
                document.getElementById('space-action-status').textContent = error?.message || '建立邀請失敗。';
            } finally {
                button.disabled = false;
                button.textContent = '建立邀請';
            }
        }

        async function removeSpaceMember(member) {
            const label = member.displayName || member.email || '這位成員';
            if (!window.confirm(`確定要將 ${label} 移出共同空間嗎？`)) return;
            try {
                await removeSpaceMemberCallable({
                    spaceId: getActiveSpaceId(),
                    memberUid: member.uid
                });
                document.getElementById('space-action-status').textContent = `${label} 已移出共同空間。`;
            } catch (error) {
                console.error('移除共同空間成員失敗：', error);
                document.getElementById('space-action-status').textContent = error?.message || '移除成員失敗。';
            }
        }

        async function acceptSpaceInvite() {
            const input = document.getElementById('space-invite-code');
            const button = document.getElementById('accept-space-invite-btn');
            const inviteCode = input.value.trim();
            if (!inviteCode) {
                document.getElementById('space-action-status').textContent = '請貼上邀請碼。';
                input.focus();
                return;
            }
            button.disabled = true;
            button.textContent = '加入中…';
            try {
                const response = await acceptSpaceInviteCallable({inviteCode});
                const spaceId = response.data?.spaceId;
                if (spaceId) localStorage.setItem(getSpaceStorageKey(), spaceId);
                document.getElementById('space-action-status').textContent = '加入成功，正在切換共同空間…';
                window.location.reload();
            } catch (error) {
                console.error('接受共同空間邀請失敗：', error);
                document.getElementById('space-action-status').textContent = error?.message || '加入失敗。';
                button.disabled = false;
                button.textContent = '加入空間';
            }
        }

        document.getElementById('settings-btn').addEventListener('click', () => {
            closeSidebar();
            openSettingsModal();
        });
        document.getElementById('space-status-btn').addEventListener('click', openSettingsModal);
        document.getElementById('space-select').addEventListener('change', event => {
            if (!currentUser || !currentSpaces.some(space => space.spaceId === event.target.value)) return;
            localStorage.setItem(getSpaceStorageKey(), event.target.value);
            window.location.reload();
        });
        document.getElementById('space-rename-btn').addEventListener('click', renameSpace);
        document.getElementById('create-space-invite-btn').addEventListener('click', createSpaceInvite);
        document.getElementById('accept-space-invite-btn').addEventListener('click', acceptSpaceInvite);
        document.getElementById('add-tag-btn').addEventListener('click', addDraftTag);
        document.getElementById('remove-suspicious-tags-btn').addEventListener('click', () => {
            const suspiciousTagIds = new Set(findSuspiciousTagIds(draftTags));
            if (suspiciousTagIds.size === 0) return;
            draftTags = draftTags.filter(tag => !suspiciousTagIds.has(tag.id));
            renderTagManager();
            showToast(`已從草稿移除 ${suspiciousTagIds.size} 個可疑 Tag；請按「儲存設定」套用。`, 'fas fa-broom');
        });
        document.getElementById('run-auto-research-now-btn').addEventListener('click', async () => {
            closeSettingsModal();
            await checkAutomaticResearchSchedule({ force: true });
        });
        document.getElementById('reset-auto-research-failures-btn').addEventListener('click', () => {
            const state = readCurrentAutomaticResearchState();
            state.failures = {};
            saveCurrentAutomaticResearchState(state);
            renderAutomaticResearchScheduleStatus();
            showToast('已清除自動排程失敗紀錄，隔離卡片可重新嘗試。', 'fas fa-rotate');
        });
        document.getElementById('auto-research-interval-select').addEventListener('change', renderAutomaticResearchScheduleStatus);
        document.getElementById('cloud-research-enabled-toggle').addEventListener('change', renderAutomaticResearchScheduleStatus);
        document.querySelectorAll('input[name="cloud-research-approval-mode"]').forEach(input => {
            input.addEventListener('change', renderAutomaticResearchScheduleStatus);
        });
        document.getElementById('new-tag-input').addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addDraftTag();
        });
        document.getElementById('reset-web-research-prompt-btn').addEventListener('click', () => {
            document.getElementById('web-research-system-prompt').value = DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
        });
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            const settingsModal = document.getElementById('settings-modal');
            if (e.target === settingsModal) {
                closeSettingsModal();
            }
        });
        document.getElementById('close-modal-btn').addEventListener('click', () => closeSettingsModal());

        const API_KEY_SETTINGS = {
            gemini: {
                inputId: 'api-key-input',
                storageKey: 'geminiApiKey',
                statusId: 'gemini-key-save-status',
                emptyMessage: '請先輸入 Gemini API Key。',
                savedMessage: 'Gemini Key 已儲存於此瀏覽器。'
            },
            mistral: {
                inputId: 'mistral-api-key-input',
                storageKey: 'mistralApiKey',
                statusId: 'mistral-key-save-status',
                emptyMessage: '請先輸入 Mistral API Key。',
                savedMessage: 'Mistral Key 已儲存於此瀏覽器。'
            },
            jina: {
                inputId: 'jina-api-key-input',
                storageKey: 'jinaApiKey',
                statusId: 'jina-key-save-status',
                emptyMessage: '請先輸入 Jina API Key；若要使用匿名額度，可保持空白。',
                savedMessage: 'Jina Key 已儲存於此瀏覽器。'
            }
        };

        function setApiKeySaveStatus(type, message, state = 'idle') {
            const status = document.getElementById(API_KEY_SETTINGS[type].statusId);
            status.textContent = message;
            status.classList.remove('text-slate-500', 'text-slate-600', 'text-emerald-700', 'text-amber-700', 'font-semibold');
            if (state === 'saved') status.classList.add('text-emerald-700', 'font-semibold');
            else if (state === 'dirty') status.classList.add('text-amber-700');
            else status.classList.add(type === 'mistral' ? 'text-slate-600' : 'text-slate-500');
        }

        function updateApiKeySaveStatuses() {
            Object.entries(API_KEY_SETTINGS).forEach(([type, config]) => {
                const hasSavedKey = Boolean(localStorage.getItem(config.storageKey));
                setApiKeySaveStatus(
                    type,
                    hasSavedKey ? `${config.savedMessage} 關閉設定後仍會保留。` : '尚未儲存 Key。',
                    hasSavedKey ? 'saved' : 'idle'
                );
            });
        }

        function saveApiKey(type) {
            const config = API_KEY_SETTINGS[type];
            const value = document.getElementById(config.inputId).value.trim();
            if (!value) {
                setApiKeySaveStatus(type, config.emptyMessage, 'dirty');
                showToast(config.emptyMessage, 'fas fa-key');
                return false;
            }
            try {
                localStorage.setItem(config.storageKey, value);
                setApiKeySaveStatus(type, config.savedMessage, 'saved');
                showToast(config.savedMessage, 'fas fa-check-circle');
                return true;
            } catch (error) {
                console.error(`儲存 ${type} API Key 失敗：`, error);
                setApiKeySaveStatus(type, '儲存失敗：瀏覽器可能禁止使用本機儲存空間。', 'dirty');
                showToast('Key 儲存失敗，請檢查瀏覽器儲存權限。', 'fas fa-exclamation-triangle');
                return false;
            }
        }

        document.getElementById('save-gemini-key-btn').addEventListener('click', () => saveApiKey('gemini'));
        document.getElementById('save-mistral-key-btn').addEventListener('click', () => saveApiKey('mistral'));
        document.getElementById('save-jina-key-btn').addEventListener('click', () => saveApiKey('jina'));

        document.getElementById('api-key-input').addEventListener('input', (event) => {
            const savedKey = localStorage.getItem('geminiApiKey') || '';
            const isSaved = Boolean(savedKey) && event.target.value.trim() === savedKey;
            setApiKeySaveStatus('gemini', isSaved
                ? API_KEY_SETTINGS.gemini.savedMessage
                : '尚未儲存目前輸入的 Gemini Key。', isSaved ? 'saved' : 'dirty');
            if (!modelSettingsApiKey || event.target.value.trim() === modelSettingsApiKey) return;
            modelSettingsApiKey = '';
            availableGeminiModels = [];
            document.getElementById('model-select-container').classList.add('hidden');
            document.getElementById('web-research-model-select-container').classList.add('hidden');
            document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，請重新查詢這把 Key 的可用模型。';
        });
        document.getElementById('web-research-provider-select').addEventListener('change', renderWebResearchProviderSettings);
        document.getElementById('mistral-api-key-input').addEventListener('input', (event) => {
            const savedKey = localStorage.getItem('mistralApiKey') || '';
            const isSaved = Boolean(savedKey) && event.target.value.trim() === savedKey;
            setApiKeySaveStatus('mistral', isSaved
                ? API_KEY_SETTINGS.mistral.savedMessage
                : '尚未儲存目前輸入的 Mistral Key。', isSaved ? 'saved' : 'dirty');
            if (!mistralModelSettingsApiKey || event.target.value.trim() === mistralModelSettingsApiKey) return;
            mistralModelSettingsApiKey = '';
            availableMistralModels = [];
            document.getElementById('mistral-web-research-model-select-container').classList.add('hidden');
            document.getElementById('mistral-model-status').textContent = 'API Key 已變更，請重新查詢這把 Key 的可用模型。';
        });
        document.getElementById('jina-api-key-input').addEventListener('input', (event) => {
            const savedKey = localStorage.getItem('jinaApiKey') || '';
            const isSaved = Boolean(savedKey) && event.target.value.trim() === savedKey;
            setApiKeySaveStatus('jina', isSaved
                ? API_KEY_SETTINGS.jina.savedMessage
                : '尚未儲存目前輸入的 Jina Key。', isSaved ? 'saved' : 'dirty');
        });
        
        document.getElementById('verify-key-btn').addEventListener('click', async () => {
            const key = document.getElementById('api-key-input').value.trim(); if(!key) return;
            const btn = document.getElementById('verify-key-btn'); btn.disabled = true; btn.innerHTML = '<div class="loader w-4 h-4 border-2 border-t-indigo-700 mx-auto"></div>';
            try {
                const models = await loadGeminiModels(key);
                if (document.getElementById('api-key-input').value.trim() !== key) {
                    document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢結果。';
                    return;
                }
                populateGeminiModelSettings(models, key);
                document.getElementById('web-research-model-verification-status').textContent = `已即時取得 ${models.length} 個 Gemini 模型。`;
            } catch(error) {
                if (document.getElementById('api-key-input').value.trim() !== key) {
                    document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢錯誤。';
                    return;
                }
                const detail = error?.gemini?.detail || error?.message || '無法取得模型清單';
                document.getElementById('web-research-model-verification-status').textContent = detail;
                showToast(`查詢模型失敗：${error?.gemini?.message || error?.message}`, 'fas fa-exclamation-triangle');
            } finally { btn.disabled = false; btn.innerText = '重新查詢可用模型'; }
        });

        document.getElementById('verify-mistral-key-btn').addEventListener('click', async () => {
            const key = document.getElementById('mistral-api-key-input').value.trim();
            if (!key) return;
            const button = document.getElementById('verify-mistral-key-btn');
            const status = document.getElementById('mistral-model-status');
            button.disabled = true;
            button.innerHTML = '<div class="loader w-4 h-4 border-2 border-t-orange-700 mx-auto"></div>';
            try {
                const models = await loadMistralModels(key);
                if (document.getElementById('mistral-api-key-input').value.trim() !== key) {
                    status.textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢結果。';
                    return;
                }
                populateMistralModelSettings(models, key);
                document.getElementById('web-research-provider-select').value = 'mistral';
                renderWebResearchProviderSettings();
                status.textContent = `已即時取得 ${models.length} 個 Mistral 對話模型。`;
            } catch (error) {
                if (document.getElementById('mistral-api-key-input').value.trim() !== key) {
                    status.textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢錯誤。';
                    return;
                }
                status.textContent = error?.mistral?.detail || error?.message || '無法取得模型清單';
                showToast(`查詢 Mistral 模型失敗：${error?.mistral?.message || error?.message}`, 'fas fa-exclamation-triangle');
            } finally {
                button.disabled = false;
                button.textContent = '重新查詢可用模型';
            }
        });

        document.getElementById('verify-web-research-model-btn').addEventListener('click', async () => {
            const apiKey = document.getElementById('api-key-input').value.trim();
            const model = document.getElementById('web-research-candidate-select').value;
            if (!apiKey || !model) return;
            const button = document.getElementById('verify-web-research-model-btn');
            const status = document.getElementById('web-research-model-verification-status');
            button.disabled = true;
            button.textContent = '測試中…';
            status.textContent = `正在用 ${model} 送出一次最小 Search 測試…`;
            try {
                await probeWebResearchModel(apiKey, model);
                if (document.getElementById('api-key-input').value.trim() !== apiKey
                    || document.getElementById('web-research-candidate-select').value !== model) {
                    status.textContent = 'API Key 或待測模型已變更，已丟棄這次測試結果。';
                    return;
                }
                writeWebResearchModelVerification(localStorage, apiKey, model, 'supported');
                populateGeminiModelSettings(availableGeminiModels, apiKey, model);
                status.textContent = `${model} 已確認支援 Search；結果會保留 7 天。`;
            } catch (error) {
                if (document.getElementById('api-key-input').value.trim() !== apiKey
                    || document.getElementById('web-research-candidate-select').value !== model) {
                    status.textContent = 'API Key 或待測模型已變更，已丟棄這次測試結果。';
                    return;
                }
                const info = error?.gemini;
                const unsupported = info?.status === 400
                    && /(?:google[_ ]search|google search).{0,120}(?:not supported|unsupported|not available|does not support|不支援)|(?:not supported|unsupported|not available|不支援).{0,120}(?:google[_ ]search|google search)/i.test(info.message);
                if (unsupported) {
                    writeWebResearchModelVerification(localStorage, apiKey, model, 'unsupported');
                    populateGeminiModelSettings(availableGeminiModels, apiKey);
                    status.textContent = `${model} 明確回覆不支援 Search。`;
                } else {
                    status.textContent = info?.isQuota
                        ? `${model} 暫時無法驗證：${info.detail}。這不代表模型不支援，可稍後重試。`
                        : `${model} 暫時無法驗證：${info?.detail || error.message}。`;
                }
            } finally {
                button.disabled = document.getElementById('web-research-candidate-select').disabled;
                button.textContent = '測試 Search';
            }
        });

        document.getElementById('save-settings-btn').addEventListener('click', async () => {
            const geminiKey = document.getElementById('api-key-input').value.trim();
            const mistralKey = document.getElementById('mistral-api-key-input').value.trim();
            const webResearchProvider = document.getElementById('web-research-provider-select').value;
            const jinaKey = document.getElementById('jina-api-key-input').value.trim();
            const imgbbKey = document.getElementById('imgbb-key-input').value.trim();
            const cloudResearchEnabled = document.getElementById('cloud-research-enabled-toggle').checked;
            const autoResearchInterval = document.getElementById('auto-research-interval-select').value;
            const cloudResearchApprovalMode = getCloudResearchApprovalMode();
            const wasCloudResearchEnabled = localStorage.getItem('cloudResearchEnabled') === 'on';
            const cleanedTags = draftTags
                .map(tag => ({ id: String(tag.id), name: String(tag.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) }))
                .filter(tag => tag.id && tag.name);
            const normalizedTagNames = cleanedTags.map(tag => tag.name.toLocaleLowerCase('zh-Hant'));
            const tagIds = cleanedTags.map(tag => tag.id);
            if (new Set(tagIds).size !== tagIds.length) {
                showToast('Tag 識別碼衝突，請刪除衝突項目後重新建立。', 'fas fa-tags');
                return;
            }
            if (new Set(normalizedTagNames).size !== normalizedTagNames.length) {
                showToast('Tag 名稱不可重複，請先調整後再儲存。', 'fas fa-tags');
                return;
            }
            draftTags = cleanedTags;
            if(geminiKey) {
                const storedGeminiKey = localStorage.getItem('geminiApiKey') || '';
                if (geminiKey !== storedGeminiKey && modelSettingsApiKey !== geminiKey) {
                    showToast('API Key 已變更，請先查詢這把 Key 的可用模型。', 'fas fa-key');
                    return;
                }
                localStorage.setItem('geminiApiKey', geminiKey);
                if (modelSettingsApiKey === geminiKey) {
                    if (document.getElementById('model-select').value) localStorage.setItem('geminiModel', document.getElementById('model-select').value);
                    if (document.getElementById('web-research-model-select').value) localStorage.setItem('geminiWebResearchModel', document.getElementById('web-research-model-select').value);
                }
            }
            if (webResearchProvider === 'mistral') {
                const storedMistralKey = localStorage.getItem('mistralApiKey') || '';
                if (!mistralKey) {
                    showToast('請先填入 Mistral API Key。', 'fas fa-key');
                    return;
                }
                if (mistralKey !== storedMistralKey && mistralModelSettingsApiKey !== mistralKey) {
                    showToast('Mistral API Key 已變更，請先查詢這把 Key 的可用模型。', 'fas fa-key');
                    return;
                }
            }
            if (mistralKey) {
                localStorage.setItem('mistralApiKey', mistralKey);
                const selectedMistralModel = document.getElementById('mistral-web-research-model-select').value;
                if (selectedMistralModel) localStorage.setItem('mistralWebResearchModel', selectedMistralModel);
            } else {
                localStorage.removeItem('mistralApiKey');
                localStorage.removeItem('mistralWebResearchModel');
            }
            localStorage.setItem('webResearchProvider', webResearchProvider);
            if (jinaKey) localStorage.setItem('jinaApiKey', jinaKey);
            else localStorage.removeItem('jinaApiKey');
            if(imgbbKey) { localStorage.setItem('imgbbApiKey', imgbbKey); }
            const systemPrompt = document.getElementById('web-research-system-prompt').value.trim() || DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            localStorage.setItem('webResearchSystemPrompt', systemPrompt);
            localStorage.setItem('autoSortSetting', document.getElementById('auto-sort-select').value);
            localStorage.setItem('autoResearchInterval', autoResearchInterval);
            localStorage.setItem('autoNewlineAfterUrl', document.getElementById('auto-newline-toggle').checked ? 'on' : 'off');
            try {
                if ((cloudResearchEnabled || wasCloudResearchEnabled) && !currentUser) {
                    throw new Error('請先登入，才能變更雲端研讀設定。');
                }
                if (cloudResearchEnabled || wasCloudResearchEnabled) {
                    await syncCloudAutomationSettings(
                        cloudResearchEnabled ? autoResearchInterval : 'off',
                        cloudResearchApprovalMode
                    );
                }
                localStorage.setItem('cloudResearchEnabled', cloudResearchEnabled ? 'on' : 'off');
                localStorage.setItem('cloudResearchApprovalMode', cloudResearchApprovalMode);
                if (currentUser) {
                    await setDoc(
                        doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'settings', 'tags'),
                        { items: draftTags, updatedAt: Date.now() },
                        { merge: true }
                    );
                }
                currentTags = draftTags.map(tag => ({ ...tag }));
                closeSettingsModal();
                renderAutomaticResearchScheduleStatus();
                scheduleAutomaticResearchCheck(300);
            } catch (error) {
                console.error('儲存系統設定失敗：', error);
                showToast(`設定儲存失敗：${error?.message || '請稍後重試。'}`, 'fas fa-exclamation-triangle');
            }
        });

        async function runAiSort() {
            if (isSorting || currentInboxItems.length === 0 || !currentUser) return false;
            const apiKey = localStorage.getItem('geminiApiKey'); const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
            if (!apiKey) { openSettingsModal(); return false; }
            const lastManualSortTime = parseInt(localStorage.getItem('lastManualSortTime') || '0', 10);
            const sortCooldownRemaining = Math.max(0, AI_SORT_COOLDOWN_MS - (Date.now() - lastManualSortTime));
            if (sortCooldownRemaining > 0) {
                saveAiStatus('sort', '冷卻中', `剩餘 ${formatCooldown(sortCooldownRemaining)}`);
                updateAiStatusPanel();
                showToast(`AI 整理冷卻中，請 ${formatCooldown(sortCooldownRemaining)} 後再試。`, 'fas fa-hourglass-half');
                return false;
            }

            isSorting = true; const btn = document.getElementById('ai-sort-btn'); btn.disabled = true; const originalHTML = btn.innerHTML; btn.innerHTML = `<div class="loader w-4 h-4 border-2 border-t-white"></div> <span id="ai-sort-text">AI 背景整理中...</span>`;
            localStorage.setItem('lastManualSortTime', Date.now().toString());
            try {
                const itemsToCategorize = [...currentInboxItems]; 
                
                const inboxData = itemsToCategorize.map(item => ({ id: item.id, content: item.text }));
                const categoryContext = currentCategories.map(c => `- ID: "${c.id}" (名稱: ${c.name}, 規則: ${c.promptRule || '無'})`).join('\n');
                const categoryIds = currentCategories.map(c => c.id);

                const promptText = `你是一個負責分類筆記的 AI。
請閱讀以下的 Inbox 項目，並根據現有的分類規則，決定每一個項目應該被放入哪一個分類。
絕對不能修改或分割原始項目的內容。你只需要返回每個項目的 itemId 和對應的 categoryId。

現有分類清單與規則：
${categoryContext}

Inbox 項目：
${JSON.stringify(inboxData, null, 2)}`;

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: { 
                            responseMimeType: "application/json", 
                            responseSchema: { 
                                type: "ARRAY", 
                                items: { 
                                    type: "OBJECT", 
                                    properties: { 
                                        itemId: { type: "STRING" }, 
                                        categoryId: { type: "STRING", enum: categoryIds } 
                                    },
                                    required: ["itemId", "categoryId"]
                                } 
                            } 
                        }
                    })
                });
                
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
                }

                const responseData = await response.json();
                if (responseData.error) throw new Error(responseData.error.message);

                const candidate = responseData.candidates?.[0];
                if (!candidate) throw new Error("模型未回傳結果");
                if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                    throw new Error(`生成中斷，原因: ${candidate.finishReason}`);
                }
                const partText = candidate.content?.parts?.[0]?.text;
                if (!partText) throw new Error("回傳結果無內容");

                const resultMap = JSON.parse(partText);
                const historyMappings = [];
                
                for (const mapping of resultMap) {
                    const item = itemsToCategorize.find(i => i.id === mapping.itemId);
                    if (!item) continue;
                    
                    let targetCol = mapping.categoryId;
                    if (!categoryIds.includes(targetCol)) targetCol = categoryIds[0] || 'inbox';
                    
                    const docData = buildCardMoveData(item);
                    
                    historyMappings.push({
                        itemId: item.id,
                        newCol: targetCol,
                        data: item
                    });
                    
                    await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), targetCol, item.id), docData);
                    await copyCardDetails('inbox', targetCol, item.id, item.id);
                    await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'inbox', item.id));
                }
                
                if (historyMappings.length > 0) {
                    historyManager.push({
                        undo: async () => {
                            for (const m of historyMappings) {
                                await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'inbox', m.itemId), m.data);
                                await copyCardDetails(m.newCol, 'inbox', m.itemId, m.itemId);
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), m.newCol, m.itemId));
                            }
                            showToast(`已還原 AI 整理，共 ${historyMappings.length} 個項目已放回 [收件匣]`, 'fas fa-undo');
                        },
                        redo: async () => {
                            for (const m of historyMappings) {
                                const docData = buildCardMoveData(m.data);
                                await setDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), m.newCol, m.itemId), docData);
                                await copyCardDetails('inbox', m.newCol, m.itemId, m.itemId);
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), 'inbox', m.itemId));
                            }
                            showToast(`已重做 AI 整理，共 ${historyMappings.length} 個項目已重新分類`, 'fas fa-redo');
                        }
                    });
                }
                saveAiStatus('sort', '成功', `已整理 ${resultMap.length} 個項目`);
                updateAiStatusPanel();
                showToast(`AI 整理完成，已分類 ${resultMap.length} 個項目`, 'fas fa-magic');
                return true;
            } catch (error) {
                console.error(error);
                const rawMessage = error?.message || '未知錯誤';
                const lowerMessage = rawMessage.toLowerCase();
                if (lowerMessage.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('too many requests')) {
                    saveAiStatus('sort', '配額不足', 'Gemini 回傳 429 / quota exceeded');
                    showToast('AI 整理遇到配額限制，請稍後再試。', 'fas fa-gauge-high');
                } else {
                    saveAiStatus('sort', '失敗', rawMessage);
                }
                updateAiStatusPanel();
                alert("AI 整理失敗：" + error.message);
                return false;
            } finally {
                isSorting = false; btn.disabled = false; btn.innerHTML = originalHTML;
            }
        }

        document.getElementById('ai-sort-btn').addEventListener('click', runAiSort);
        let activeEditorCardId = null;
        let activeEditorCollection = null;

        let currentEditorLoadId = 0;
        let editorInstance = null;
        let mdShortcutsCleanup = null;
        let pendingEditorTitle = null;

        async function openEditor(itemId, itemText, collectionName, { fromHistory = false } = {}) {
            const loadId = ++currentEditorLoadId;
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            const titleInput = document.getElementById('editor-title');
            
            // Force save if pending
            if (editorSaveTimeout) {
                await flushPendingEditorChanges();
            }
            
            if (editorInstance) {
                try {
                    editorInstance.destroy();
                } catch (e) {
                    console.log('Error destroying editor:', e);
                }
                editorInstance = null;
            }
            
            activeEditorCardId = itemId;
            activeEditorCollection = collectionName;
            
            // Set UI
            titleInput.innerText = itemText;
            modal.classList.remove('hidden');
            keyLayers.push({
                name: 'editor',
                keys: {
                    'Escape': (e) => {
                        if (document.querySelector('.ce-settings--opened, .ce-popover--opened, .ce-inline-toolbar--showed')) return;
                        e.preventDefault();
                        closeEditor();
                    }
                    // no 'mod+a' entry: passthrough -> EditorJS native two-stage select (spec §3)
                }
            });
            if (!fromHistory) {
                const editorUrl = `${window.location.pathname}?editor=${encodeURIComponent(itemId)}&col=${encodeURIComponent(collectionName)}`;
                history.pushState({ overlay: 'editor', itemId, collectionName }, '', editorUrl);
            }
            // Force reflow
            void modal.offsetWidth;
            document.body.classList.add('editor-open');
            backdrop.classList.add('opacity-100');
            container.classList.add('scale-100', 'opacity-100');

            document.getElementById('editorjs-container').innerHTML = '<div class="flex justify-center items-center h-full min-h-[50vh]"><div class="loader w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div></div>';

            // Fetch existing note from Firestore
            let noteData = null;
            try {
                // Ensure doc and getDoc are imported from firestore, they already should be in index.html
                const noteRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), collectionName, itemId, 'details', 'note');
                const noteSnap = await getDoc(noteRef);
                if (noteSnap.exists()) {
                    noteData = noteSnap.data().data;
                }
            } catch (err) {
                console.error("Failed to load note details:", err);
            }
            if (loadId !== currentEditorLoadId) return; // Abort if user clicked another card
            
            document.getElementById('editorjs-container').innerHTML = '';
            initEditor(noteData, handleEditorChange);
        }

        let editorSaveTimeout = null;
        
        function showSaveStatus(text, iconClass) {
            const status = document.getElementById('editor-save-status');
            status.innerHTML = `<i class="${iconClass} mr-1"></i>${text}`;
            status.classList.remove('opacity-0');
            setTimeout(() => status.classList.add('opacity-0'), 2000);
        }

        async function saveEditorContent() {
            if (!activeEditorCardId || !editorInstance) return;
            const cardId = activeEditorCardId;
            const collectionName = activeEditorCollection;
            const currentEditor = editorInstance;
            
            try {
                const outputData = await currentEditor.save();
                const noteRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), collectionName, cardId, 'details', 'note');
                
                // Use setDoc with merge:true in case details/note doesn't exist yet
                await setDoc(noteRef, { 
                    data: outputData,
                    updatedAt: Date.now()
                }, { merge: true });
                
                showSaveStatus('已儲存', 'fas fa-check-circle text-emerald-500');
            } catch (err) {
                console.error("Save failed:", err);
                showSaveStatus('儲存失敗', 'fas fa-exclamation-circle text-red-500');
            }
        }

        async function savePendingEditorTitle() {
            if (!activeEditorCardId || !activeEditorCollection || !pendingEditorTitle) return;
            const cardId = activeEditorCardId;
            const collectionName = activeEditorCollection;
            const title = pendingEditorTitle;
            pendingEditorTitle = null;

            try {
                const cardRef = doc(db, 'artifacts', appId, 'users', getActiveSpaceId(), collectionName, cardId);
                await updateDoc(cardRef, {
                    text: title,
                    cardSearchText: title.toLocaleLowerCase('zh-Hant')
                });
            } catch (error) {
                console.error('Failed to update title:', error);
                showSaveStatus('標題儲存失敗', 'fas fa-exclamation-circle text-red-500');
            }
        }

        async function flushPendingEditorChanges() {
            if (editorSaveTimeout) {
                clearTimeout(editorSaveTimeout);
                editorSaveTimeout = null;
            }
            await Promise.all([
                savePendingEditorTitle(),
                saveEditorContent()
            ]);
        }

        function handleEditorChange() {
            clearTimeout(editorSaveTimeout);
            editorSaveTimeout = setTimeout(flushPendingEditorChanges, 1000);
        }

        function initEditor(initialData = null, onChangeCallback = null) {
            if (mdShortcutsCleanup) { mdShortcutsCleanup(); mdShortcutsCleanup = null; }
            if (editorInstance) {
                try {
                    editorInstance.destroy();
                } catch (e) {
                    console.log('Error destroying editor:', e);
                }
                editorInstance = null;
            }

            const config = {
                holder: 'editorjs-container',
                placeholder: '在這裡開始輸入你的想法... (輸入 / 顯示選單)',
                onChange: () => {
                    if (onChangeCallback) onChangeCallback();
                },
                onReady: () => {
                    // debounceTimer 預設 200ms:每次觸發都會全文序列化以記錄復原點,打字時吃主執行緒。
                    // 拉長到 500ms 減少序列化頻率(復原顆粒度稍粗,換取打字順暢)。
                    new Undo({ editor: editorInstance, config: { debounceTimer: 500 } });
                },
                tools: {
                    header: { class: Header, inlineToolbar: true, config: { placeholder: '輸入標題', levels: [1, 2, 3], defaultLevel: 2 } },
                    list: { class: EditorjsList, inlineToolbar: true },
                    checklist: { class: Checklist, inlineToolbar: true },
                    quote: { class: Quote, inlineToolbar: true },
                    Marker: { class: Marker, inlineToolbar: true },
                    inlineCode: { class: InlineCode },
                    code: { class: CodeTool, config: { placeholder: '輸入程式碼' } },
                    delimiter: { class: Delimiter }
                },
                i18n: {
                    messages: {
                        ui: {
                            'blockTunes': { 'toggler': { 'Click to tune': '點擊調整', 'or drag to move': '或拖曳移動' } },
                            'inlineToolbar': { 'converter': { 'Convert to': '轉換為' } },
                            'toolbar': { 'toolbox': { 'Add': '新增區塊' } },
                            'popover': { 'Filter': '搜尋', 'Nothing found': '找不到項目', 'Convert to': '轉換為' }
                        },
                        toolNames: {
                            'Text': '文字', 'Heading': '標題', 'List': '清單',
                            'Unordered List': '項目清單', 'Ordered List': '數字清單',
                            'Checklist': '待辦清單', 'Quote': '引用', 'Code': '程式碼',
                            'Delimiter': '分隔線', 'Marker': '螢光筆', 'InlineCode': '行內程式碼',
                            'Bold': '粗體', 'Italic': '斜體', 'Link': '連結'
                        },
                        tools: {
                            'list': { 'Unordered': '項目符號', 'Ordered': '數字編號' },
                            'quote': { 'Enter a quote': '輸入引用內容', "Quote's author": '輸入來源' },
                            'header': { 'Heading 1': '標題 1', 'Heading 2': '標題 2', 'Heading 3': '標題 3' }
                        },
                        blockTunes: {
                            'delete': { 'Delete': '刪除', 'Click to delete': '點擊確認刪除' },
                            'moveUp': { 'Move up': '上移' },
                            'moveDown': { 'Move down': '下移' }
                        }
                    }
                }
            };
            
            if (initialData && initialData.blocks && initialData.blocks.length > 0) {
                config.data = initialData;
            }
            
            editorInstance = new EditorJS(config);
            mdShortcutsCleanup = attachMdShortcuts(() => editorInstance, document.getElementById('editorjs-container'));
        }

        function closeEditor({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'editor') {
                history.back();
                return;
            }
            currentEditorLoadId += 1;
            void flushPendingEditorChanges();
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            
            backdrop.classList.remove('opacity-100');
            container.classList.remove('scale-100', 'opacity-100');
            document.body.classList.remove('editor-open');
            keyLayers.pop('editor');
            setTimeout(() => modal.classList.add('hidden'), 300);
            activeEditorCardId = null;
            activeEditorCollection = null;
            
            if (mdShortcutsCleanup) { mdShortcutsCleanup(); mdShortcutsCleanup = null; }
            if (editorInstance) {
                editorInstance.destroy();
                editorInstance = null;
            }
        }

        document.getElementById('editor-close-btn').addEventListener('click', () => closeEditor());
        document.getElementById('editor-backdrop').addEventListener('click', () => closeEditor());

        let isSideLayout = localStorage.getItem('editorLayout') === 'side';
        function updateEditorLayout() {
            const modal = document.getElementById('editor-modal');
            const container = document.getElementById('editor-container');
            if (isSideLayout) {
                document.body.classList.add('side-layout-active');
                modal.classList.remove('justify-center', 'items-center');
                modal.classList.add('justify-end');
                container.classList.remove('max-w-4xl', 'md:rounded-2xl', 'md:h-[85vh]');
                container.classList.add('w-[50vw]', 'rounded-none', 'h-full');
            } else {
                document.body.classList.remove('side-layout-active');
                modal.classList.add('justify-center', 'items-center');
                modal.classList.remove('justify-end');
                container.classList.add('max-w-4xl', 'md:rounded-2xl', 'md:h-[85vh]');
                container.classList.remove('w-[50vw]', 'rounded-none', 'h-full');
            }
        }
        document.getElementById('editor-layout-btn').addEventListener('click', () => {
            isSideLayout = !isSideLayout;
            localStorage.setItem('editorLayout', isSideLayout ? 'side' : 'center');
            updateEditorLayout();
        });
        updateEditorLayout();

        window.addEventListener('popstate', async (event) => {
            const targetOverlay = event.state?.overlay || null;

            if (!webResearchPreviewModal.classList.contains('hidden') && targetOverlay !== 'web-research-preview') {
                closeWebResearchPreview({ fromHistory: true });
                return;
            }
            if (activeEditorCardId && targetOverlay !== 'editor') {
                closeEditor({ fromHistory: true });
                return;
            }
            const helpCenterModal = document.getElementById('help-center-modal');
            if (!helpCenterModal.classList.contains('hidden') && targetOverlay !== 'help-center') {
                closeHelpCenter({ fromHistory: true });
                return;
            }
            const globalSearchModal = document.getElementById('global-search-modal');
            if (!globalSearchModal.classList.contains('hidden') && targetOverlay !== 'global-search') {
                closeGlobalSearch({ fromHistory: true });
                return;
            }
            const tagBrowserModal = document.getElementById('tag-browser-modal');
            if (!tagBrowserModal.classList.contains('hidden') && targetOverlay !== 'tag-browser') {
                closeTagBrowser({ fromHistory: true });
                return;
            }
            const researchLogModal = document.getElementById('research-log-modal');
            if (!researchLogModal.classList.contains('hidden') && targetOverlay !== 'research-log') {
                closeResearchLog({ fromHistory: true });
                return;
            }

            if (targetOverlay === 'editor' && !activeEditorCardId && currentUser) {
                const itemId = event.state?.itemId;
                const collectionName = event.state?.collectionName;
                if (!itemId || !collectionName) {
                    history.replaceState({ overlay: null }, '', window.location.pathname);
                    return;
                }
                try {
                    const cardSnapshot = await getDoc(doc(
                        db,
                        'artifacts',
                        appId,
                        'users',
                        getActiveSpaceId(),
                        collectionName,
                        itemId
                    ));
                    if (history.state?.overlay !== 'editor') return;
                    if (cardSnapshot.exists()) {
                        openEditor(
                            itemId,
                            cardSnapshot.data().text || '無標題',
                            collectionName,
                            { fromHistory: true }
                        );
                    } else {
                        history.replaceState({ overlay: null }, '', window.location.pathname);
                    }
                } catch (error) {
                    console.error('無法從瀏覽紀錄重新開啟卡片：', error);
                    history.replaceState({ overlay: null }, '', window.location.pathname);
                }
                return;
            }

            if (targetOverlay === 'web-research-preview' && webResearchPreviewModal.classList.contains('hidden')) {
                // Preview content is intentionally ephemeral; discard unusable Forward state.
                history.replaceState({ overlay: null }, '', window.location.pathname);
                return;
            }
            if (targetOverlay === 'help-center' && helpCenterModal.classList.contains('hidden')) {
                openHelpCenter({ fromHistory: true });
                return;
            }
            if (targetOverlay === 'global-search' && globalSearchModal.classList.contains('hidden')) {
                openGlobalSearch({ fromHistory: true });
                return;
            }
            if (targetOverlay === 'tag-browser' && tagBrowserModal.classList.contains('hidden')) {
                openTagBrowser({ fromHistory: true });
                return;
            }
            if (targetOverlay === 'research-log' && researchLogModal.classList.contains('hidden')) {
                openResearchLog({ fromHistory: true });
            }
        });
        document.getElementById('editor-title').addEventListener('input', (e) => {
            clearTimeout(editorSaveTimeout);
            const newTitle = e.target.innerText.trim();
            pendingEditorTitle = newTitle || null;
            if (!newTitle) return; // Prevent empty title
            editorSaveTimeout = setTimeout(flushPendingEditorChanges, 1000);
        });
        window.addEventListener('beforeunload', (e) => {
            if (editorSaveTimeout || researchBackfillQueue.length > 0) {
                e.preventDefault();
                e.returnValue = ''; // Trigger browser warning
            }
        });

        // Toast System
        window.showToast = function(message, icon = 'fas fa-info-circle', action = null) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 transform transition-all duration-300 translate-y-full opacity-0 text-sm font-medium';
            const iconElement = document.createElement('i');
            iconElement.className = String(icon);
            const messageElement = document.createElement('span');
            messageElement.textContent = String(message);
            toast.append(iconElement, messageElement);
            let dismissTimer;
            if (action?.onClick) {
                const actionButton = document.createElement('button');
                actionButton.type = 'button';
                actionButton.className = 'shrink-0 rounded-md px-2 py-1 text-xs font-bold text-indigo-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300';
                actionButton.textContent = action.label || '復原';
                actionButton.setAttribute('aria-label', action.label || '復原');
                actionButton.addEventListener('click', async () => {
                    actionButton.disabled = true;
                    try { await action.onClick(); } finally {
                        clearTimeout(dismissTimer);
                        toast.remove();
                    }
                });
                toast.appendChild(actionButton);
            }
            container.appendChild(toast);
            
            requestAnimationFrame(() => {
                toast.classList.remove('translate-y-full', 'opacity-0');
            });
            
            dismissTimer = setTimeout(() => {
                toast.classList.add('translate-y-full', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, action?.onClick ? 6000 : 3000);
        };

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js')
                    .then(reg => console.log('Service Worker registered', reg))
                    .catch(err => console.log('Service Worker registration failed', err));
            });
        }
