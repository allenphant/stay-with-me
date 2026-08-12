# 部署雲端研讀安全自動寫入，功能已上線（雙帳號實測延後）

> **更新時間**：2026-08-12 16:10
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

依使用者決定先跳過雙帳號真人驗收，補齊雲端研讀的手動審核／安全自動寫入流程，完成 commit、push、Functions 與 GitHub Pages 部署。

## 已完成任務

* **補齊雲端研讀審核模式**：設定頁加入「手動審核／自動寫入」，前端同步本機與伺服器設定，建立工作時快照 `approvalMode`；YouTube 維持 NotebookLM 人工流程。
  * `index.html`
  * `app.js`
* **完成安全自動寫入後端**：一般網址完成研讀後，以 Firestore transaction 驗證卡片版本並一次更新卡片、EditorJS 詳細筆記、搜尋索引、建議 Tag 與 job 狀態；支援重送冪等，卡片變更或刪除時標記 `cancelled_stale`。
  * `functions/src/index.js`
  * `functions/src/auto-approval.js`
* **補上自動寫入測試**：涵蓋純函式、前後端契約與瀏覽器整合；`npm test` 共 17 個測試檔全數通過，JS 語法、`git diff --check` 與瀏覽器 `pageErrors` 亦通過。
  * `functions/test/auto-approval.test.js`
  * `tests/cloud-auto-approval.test.mjs`
  * `tests/cloud-research.test.mjs`
  * `tests/card-web-research.browser.mjs`
* **更新操作與架構文件**：說明 `approvalMode`、transaction 邊界、YouTube 例外與部署安全設定。
  * `README.md`
  * `docs/CLOUD_RESEARCH_ARCHITECTURE.md`
  * `docs/CLOUD_SETUP_GUIDE.md`
* **提交並部署**：commit `3744235`（`Add safe cloud research auto-write`）已推送到功能分支與 `main`。Firebase 專案 `dating-with-viola` 的 10 個 Gen2 Functions 更新成功；`runResearchJob` 為 `ACTIVE`、Node.js 22。GitHub Pages 線上 `index.html`／`app.js` 與本機檔案 SHA-256 完全一致。
  * `functions/src/index.js`
  * `index.html`
  * `app.js`
* **核對部署安全設定**：既有 Cloud Tasks enqueuer、serviceAccountUser、Cloud Run invoker IAM 均正確；將 Firebase 部署重設的 Queue 速率恢復為同時 1 筆、約每分鐘 1 筆，回讀確認 Queue 為 `RUNNING`。
  * `scripts/deploy-functions.sh`

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：程式、測試、commit、push、Functions 與 GitHub Pages 部署皆已完成；尚未執行需要真人帳號／實際網址的端到端驗收。
* **下一步**：先用一張一般網址驗證 `manual → pending_review`，再切換 `auto` 驗證筆記、搜尋索引與 Tag 只寫入一次且 job 為 `succeeded`；雙帳號邀請與共同空間實測留到功能批次完成後。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **以 GitHub App 建立 PR**：功能分支推送成功後呼叫 GitHub connector 建立 draft PR。
  * **為什麼失敗**：GitHub API 回傳 `403 Resource not accessible by integration`，本機 `gh` 憑證也已失效。
  * **教訓**：恢復 GitHub App／`gh` 寫入權限前，無法走 PR 自動化；本次只有一筆已驗證 commit，因此以 fast-forward 推送 `main` 完成發布。
* **在受限環境使用 `npx firebase-tools`**：嘗試沿用部署腳本的 `npx`。
  * **為什麼失敗**：套件查詢遇到 `EAI_AGAIN`，但系統已安裝並登入全域 Firebase CLI 15.25.1。
  * **教訓**：此環境部署直接使用全域 `firebase`，仍須明確帶 `--only functions:research-backend --project dating-with-viola`。
* **假設 Firebase 部署會保留 Cloud Tasks 速率**：部署後只看 Functions 成功訊息。
  * **為什麼失敗**：部署把 `runResearchJob` 重設為每秒 500 筆，即使 `maxConcurrentDispatches` 仍為 1，也可能快速消耗外部 API 與成本。
  * **教訓**：每次 Functions 部署後都要執行／核對 `scripts/deploy-functions.sh` 的 Queue 限流步驟。
* **使用 `codebase-memory-mcp update -y` 更新索引**：把套件更新指令誤認為 repository reindex。
  * **為什麼失敗**：該指令需要互動式 TTY，並先移除本機索引快取。
  * **教訓**：程式碼知識圖譜應使用 MCP `index_repository`；本次已重新索引完成（663 nodes／1795 edges）。

## 關鍵決策 (Key Decisions)

* **[工作建立時快照 approvalMode]**：排隊中的工作不跟隨之後的設定變更。
  * **原因**：避免使用者送出時選手動審核，等待期間切成自動後，舊工作意外直接修改卡片。
  * **被否決的方案**：Worker 執行時才讀取最新全域設定。
* **[以 Firestore transaction 作自動寫入的冪等邊界]**：卡片、詳細筆記、Tag、搜尋索引與 job 狀態一起提交。
  * **原因**：Cloud Tasks 至少一次傳送與 commit acknowledgment 不確定時，不能留下半套資料或重複追加。
  * **被否決的方案**：依序寫入多個文件後再把 job 標為成功。
* **[自動重試沿用已保存模型結果]**：`auto_approving` 重試不再呼叫模型。
  * **原因**：降低外部 API 成本，並避免同一 job 因重送產生不同內容。
  * **被否決的方案**：每次 Task retry 都重新研讀與生成。
* **[YouTube 永遠保留人工審核]**：即使模式為 `auto`，YouTube 仍進入待審核／NotebookLM 流程。
  * **原因**：目前 Worker 沒有可靠的影片內容結果，不應把人工交接提示寫成正式研讀筆記。
  * **被否決的方案**：把所有來源一律自動寫入。

## 交接備忘錄 (Handover Context)

正式站是 `https://allenphant.github.io/stay-with-me/`；Firebase project ID 是 `dating-with-viola`，資料 namespace 是 `stay-with-me`，Functions 位於 `asia-east1`。目前 `main` 已包含 commit `3744235`，線上前端與本機完全一致，`runResearchJob` 更新時間為 `2026-08-12T08:05:57Z` 且狀態 `ACTIVE`。Queue `runResearchJob` 為 `RUNNING`，`maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`。

雙帳號邀請／共同空間實測依使用者決定延後。下一個 AI 接手後先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md`，第一件事是用一張一般網址分別驗證手動審核與自動寫入；確認 job 狀態、筆記、搜尋索引與 Tag 後，再繼續補下一個功能。若要恢復 PR 流程，先修復 GitHub App 或 `gh` 的寫入權限。
