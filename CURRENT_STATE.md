# 修正 Stay With Me Firebase 登入 referrer 限制（後端與資料隔離已完成，登入卡住）

> **更新時間**：2026-08-03 17:26
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

將 `my-ai-brain` 模板延伸為獨立的情侶共編空間，加入成員與邀請機制、隔離兩個產品的 Firebase 資料，完成新專案後端部署，並排除正式網站的登入問題。

## 已完成任務

* **建立獨立 Firebase 環境**
  * 沿用既有 project ID `dating-with-viola`，將顯示名稱改為 `Stay With Me`。
  * project number 為 `1060778384338`，Firestore 位於 `asia-east1`。
  * Firebase Web App ID 為 `1:1060778384338:web:a89a535bbaadb12b5cc60b`。
  * 前端資料命名空間已由 `my-personal-ai-brain` 改為 `stay-with-me`，不再讀取 My AI Brain 的字卡。
* **完成安全規則與雙人成員機制**
  * 已部署版本化的 `firestore.rules`，採 membership 授權與其他路徑預設拒絕。
  * 已加入個人空間、指定 email 的七日邀請碼、接受邀請、切換空間、列出成員與 owner 移除成員。
  * 邀請資料不允許客戶端直接讀寫；成員異動由 Callable Functions 驗證 Auth、email 與 membership。
* **完成新專案後端部署**
  * 九個 Gen 2 Functions 均已部署至 `asia-east1`：`ensurePersonalSpace`、`createSpaceInvite`、`acceptSpaceInvite`、`removeSpaceMember`、`updateResearchAutomation`、`enqueueCardResearch`、`resolveResearchReview`、`discoverDueResearchJobs`、`runResearchJob`。
  * Cloud Tasks queue `asia-east1/runResearchJob` 為 `RUNNING`，並已設定低吞吐、有限重試及所需 IAM。
  * Secret Manager 已建立 `GEMINI_API_KEY`、`JINA_API_KEY`、`OPENROUTER_API_KEY`；值未寫入 repository。
  * Artifact Registry image cleanup 設為保留 7 天。
* **完成前端遷移與發布**
  * GitHub Pages 已發布於 `https://allenphant.github.io/stay-with-me/`。
  * 線上 `app.js` 已確認使用 `projectId: "dating-with-viola"` 與 `appId` namespace `stay-with-me`。
  * PR [#2](https://github.com/allenphant/stay-with-me/pull/2) 已合併至 `main`，合併 commit 為 `a4798fd`。
* **完成驗證**
  * Firestore Rules 已成功編譯並發布。
  * 完整測試曾達 98 tests 全數通過，並通過 JavaScript／shell 語法檢查與 `git diff --check`。

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：登入問題已解決，驗收清單前半段完成。剩下建卡持久化與雙帳號流程兩項人工測試。
* **已完成｜Browser key referrer 修正（2026-08-04 01:02 UTC）**：key `9306a3ce-9b06-47e8-8371-6a12cb6a73ac` 的 `allowedReferrers` 由 `https://allenphant.github.io/stay-with-me/*` 改為 `https://allenphant.github.io/*`，另外兩筆 `firebaseapp.com`／`web.app` 維持不變。
  * 已用 `describe --format=json` 逐字元驗證三筆值皆無隱藏 newline／空白污染。
  * 已確認 `apiTargets` 仍為原本 9 個 service，未被 update 清空。
* **已完成｜線上登入**：使用者於 2026-08-04 回報 Google 登入成功，`auth/requests-from-referer-...-are-blocked` 消失。
* **已完成｜資料隔離驗證（CLI 客觀證據）**：以 Firestore REST `showMissing=true` 列出兩專案的 namespace，各自只有一個且互不重疊。
  * `dating-with-viola` → 僅 `artifacts/stay-with-me`
  * `my-ai-brain-6867e` → 僅 `artifacts/my-personal-ai-brain`
  * 註：`artifacts/{appId}` 是無欄位的隱含父文件，一般 list 會回空值，**必須加 `showMissing=true`** 才看得到。
* **已完成｜membership 機制實地生效**：`ensurePersonalSpace` 於 01:04:19Z 自動建立 `spaces/sk3Hgr0kLETBA8oMSwkxITWlwrp1`（`ownerUid` 同 uid、`memberCount: 1`、子集合 `memberships`）。
* **已完成｜測試套件**：`npm test` 98 tests 全數通過，與既有基準一致。
* **待辦｜人工測試 A**：在新站建立 `獨立資料庫測試` 卡片 → 重新整理確認仍在。（目前該 space 尚無任何卡片子集合，是乾淨基準）
* **待辦｜人工測試 B**：雙帳號邀請／加入／共同編輯／移除成員。
* **已完成｜人工測試 A（建卡持久化）**：卡片落於 `artifacts/stay-with-me/users/sk3Hgr.../inbox/T7WR2nAYvARMEupfAZ9y`（`text: "測試"`，01:13:31Z），舊專案無此資料。
* **已完成｜品牌字樣清洗（改為 Stay With Me）**：`index.html` 標題／H1／Guide 標籤／頁尾標語、`manifest.json` name 與 short_name、`sw.js` CACHE_NAME（`ai-brain-v11` → `stay-with-me-v12`，順帶強制清舊快取）、`package.json`、`functions/package.json`、`functions/src/providers.js` 的 OpenRouter APP_URL／APP_NAME。
  * 一併修正說明頁兩個**指向舊站與舊 repo 的錯誤連結**（原本連到 `my-ai-brain`），現指向 `stay-with-me`。
  * 同步更新 `tests/help-center.test.mjs` 與 `tests/card-web-research.browser.mjs` 的對應斷言。
  * **刻意保留**：`tests/shared-space.test.mjs:44,58` 的 `my-ai-brain-6867e` 字樣是隔離守門斷言（`assert.doesNotMatch`），改掉會讓防護失效；`README.md:7` 的 My Personal AI Brain 是專案沿革陳述，非品牌殘留。
  * 驗證：`npm test` 98/98 通過、JSON／JS 語法檢查通過、`git diff --check` 乾淨。
* **待辦｜人工測試 B**：雙帳號邀請／加入／共同編輯／移除成員。UI 入口在**設定 Modal** 的「共同空間」區塊，開啟方式為頁首粉紅愛心鈕（登入後才顯示）或側邊欄齒輪。
  * **2026-08-04 發現：邀請流程尚未真正跑過。** Viola 只是登入，`ensurePersonalSpace` 便自動建了她**自己的**個人空間（`n2yU5QGHrgehMR0oCYXb3d0hyWL2`，`memberCount: 1`），兩人各自獨立。**登入 ≠ 加入**，必須另外走邀請碼流程。
* **已完成｜雙人綁定的 UI 修正**：後端本來就有雙人上限（`functions/src/index.js` 的 `createSpaceInvite` 與 `acceptSpaceInvite` 皆檢查 `memberCount >= 2`），但前端不反映狀態，導致「看起來還能邀請第三人」。
  * 新增 `space-pair-status`：未綁定時提示要建立／貼上邀請碼，已綁定時顯示「已與 X 綁定，這個空間已滿（上限兩人）」。
  * `memberCount >= 2` 時隱藏邀請表單。
  * 成員 listener 原本只呼叫 `renderSpaceMembers()`，改為 `renderSpaceControls()`，否則綁定狀態與邀請表單不會隨成員載入更新。
* **已完成｜空間改名功能**：`spaces` 文件在 `firestore.rules` 是 `allow write: if false`，客戶端不能直寫，因此新增 Callable **`renameSpace`**（owner-only）。
  * 空間名稱有**反正規化**：同時存在 `spaces/{id}.name` 與每位成員的 `users/{uid}/memberships/{spaceId}.name`，改名需以 batch 一起更新，否則另一方看到舊名稱。
  * 前端新增 `space-rename-row`（僅 owner 可見）；輸入框在使用者正在編輯時不會被 re-render 覆蓋。
* **已完成｜清理舊專案**：已從 `my-ai-brain-6867e`（`asia-east1`）刪除誤部署的 `ensurePersonalSpace`、`createSpaceInvite`、`acceptSpaceInvite`、`removeSpaceMember`。刪除前已驗證舊站線上 `app.js` 對這 4 個的引用次數為 0。刪除後該專案剩下正好 5 個 research Functions，`dating-with-viola` 未受影響。
* **已完成｜前端部署**：PR [#3](https://github.com/allenphant/stay-with-me/pull/3) 已 squash 合併至 `main`（`493e898`）。
  * **踩雷紀錄**：PR #2 是 squash 合併，`main` 上的 `a4798fd` 已含分支前三個 commit 的內容，直接合併 PR #3 會衝突（`the merge commit cannot be cleanly created`）。解法是從 `origin/main` 開新分支 cherry-pick 新 commit、驗證 `git diff` 與原 commit 為空後 force-with-lease 更新 PR 分支。
* **已完成｜後端部署**：`renameSpace` 建立成功，其餘 9 個更新成功，`dating-with-viola` 現有 10 個 Functions 全為 `ACTIVE`。
  * firebase-tools 15.25.1 已安裝於本機。**Firebase CLI 有獨立登入，不吃 gcloud 憑證**，需先 `firebase login`。
  * **踩雷紀錄**：`--non-interactive` 部署會因 `GEMINI_RESEARCH_MODEL`／`OPENROUTER_RESEARCH_MODEL` 中斷，即使兩者在 `index.js` 已有 `default`。**export 環境變數無效，CLI 只認 dotenv 檔**，必須建立 `functions/.env`（已被 `.gitignore` 第 7 行排除）。目前值與線上原值相同，部署未改變行為。
* **已完成｜線上驗證**：`https://allenphant.github.io/stay-with-me/` 的 `<title>` 已是 `Stay With Me`，`space-rename-btn`／`space-pair-status` 已存在，`app.js` 含 `renameSpaceCallable`。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **沿用模板 Firebase config**：clone 後曾連到 `my-ai-brain-6867e`，因此新網站看見舊字卡。
  * **教訓**：不同產品必須使用獨立 Firebase project 與獨立資料 namespace；本次已改為 `dating-with-viola`／`stay-with-me`。
* **刪除舊 project 再建立同名 project**：建立新 project 時遇到 project quota，且刪除後 ID 通常不適合立刻重用。
  * **教訓**：保留不可變的 `dating-with-viola` project ID，只修改顯示名稱為 `Stay With Me`。
* **在 Cloud Shell 貼上過長的 referrer 指令**：終端自動換行曾把隱藏 newline 寫進 `http://localhost/*`。
  * **教訓**：本次先用短指令只設定三個正式網域，更新後一定以 `describe --format='yaml(...)'` 檢查實際值。
* **只允許 GitHub Pages repository path**：設定 `https://allenphant.github.io/stay-with-me/*` 後，Firebase Auth 仍以 origin `https://allenphant.github.io` 檢查 API key，造成目前登入錯誤。
  * **教訓**：Browser key 的 GitHub Pages referrer 應允許 `https://allenphant.github.io/*`；Firebase Authorized Domains 仍維持 `allenphant.github.io`。
* **使用錯誤的 Functions deploy filter**：`functions:ensurePersonalSpace` 找不到 codebase，泛用 `--only functions` 首次又只部署 task function。
  * **教訓**：此 repository 的 codebase 是 `research-backend`，部署使用 `--only functions:research-backend`。

## 關鍵決策 (Key Decisions)

* **[獨立專案]**：Stay With Me 使用 `dating-with-viola`，My AI Brain 保留 `my-ai-brain-6867e`；兩者不得再共用資料庫。
* **[不可變 ID 與顯示名稱分離]**：project ID、Firebase auth domain 與 storage bucket 仍保留 `dating-with-viola`，產品顯示名稱使用 `Stay With Me`。
* **[安全資料邊界]**：Firestore 以 space membership 控制讀寫、server-only invite 與 default deny 取代「任何登入者皆可讀寫」。
* **[雙人上限]**：每個共享空間最多兩名成員，邀請綁定 email 並設七天期限。
* **[成本護欄]**：Blaze 已啟用並設 US$5 預算通知；Functions、Tasks 與 image cleanup 採低成本設定。
* **[API key 定位]**：Firebase Web API key 可出現在客戶端，但必須靠 API allowlist、HTTP referrer、Auth、Firestore Rules 與 App Check 分層保護；Gemini/Jina/OpenRouter secrets 僅存 Secret Manager。

## 交接備忘錄 (Handover Context)

下一輪先在 Cloud Shell 執行以下短指令，修正 Browser key 的正式站 referrer；這個動作只改應用程式限制，不應移除既有 API targets，但仍需用第二條指令確認兩者都存在：

```bash
BROWSER_KEY_ID="9306a3ce-9b06-47e8-8371-6a12cb6a73ac"

gcloud services api-keys update "$BROWSER_KEY_ID" \
  --project=dating-with-viola \
  --location=global \
  --allowed-referrers='https://allenphant.github.io/*,https://dating-with-viola.firebaseapp.com/*,https://dating-with-viola.web.app/*'

gcloud services api-keys describe "$BROWSER_KEY_ID" \
  --project=dating-with-viola \
  --location=global \
  --format='yaml(displayName,restrictions)'
```

確認 `allowedReferrers` 沒有隱藏換行、`apiTargets` 仍包含 Firebase／Firestore／Identity Toolkit／Secure Token 等既有 allowlist。等待設定傳播後，在 `https://allenphant.github.io/stay-with-me/` 按 `Ctrl+Shift+R` 強制重新整理並重新登入。

登入成功後依序驗證：新站沒有 My AI Brain 舊字卡、建立 `獨立資料庫測試` 卡片後重新整理仍存在、舊 My AI Brain 網站看不到該卡，再進行雙帳號邀請／加入／共同編輯／移除成員測試。全部通過後，才從舊專案 `my-ai-brain-6867e` 移除先前誤部署的四個共享 Functions：`ensurePersonalSpace`、`createSpaceInvite`、`acceptSpaceInvite`、`removeSpaceMember`；不要刪除既有五個 research Functions。

接手後第一步請先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md`。
