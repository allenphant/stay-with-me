# 雲端研讀安全重試已完成 review 並部署上線

> **更新時間**：2026-08-13 08:44
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

review `agent/research-job-retry` 的安全重試功能；確認後合併、push、部署 Functions，並恢復 Queue 每分鐘約一筆的限流。依使用者先前決定，雙帳號真人實測暫緩。

## 已完成任務

* **完成一般網址的正式環境端到端驗證**：以 `https://example.com/` 和隔離 namespace `codex-e2e-cloud-research-20260812` 建立定向工作，不觸發會掃描所有啟用使用者的 production Scheduler。
  * 手動模式正確走到 `pending_review`，`attempts=1`，且不會在審核前修改既有筆記或 Tag。
  * 自動模式正確走到 `succeeded`／`auto_approved`，一次寫入卡片、EditorJS 筆記與 Tag；重送同一工作後 `attempts`、筆記區塊數及文件時間戳皆未改變，確認冪等。
  * 所有測試文件均已刪除並回讀確認：jobs 空白、card／note／automation 不存在、tags.items 空白，未碰觸使用者資料。
* **拒絕不完整的模型結果**：首次手動實測雖到達 `pending_review`，模型卻回傳空的結果欄位；現在 OpenRouter 使用嚴格 JSON schema、別名／wrapper 正規化及完整性驗證，只選擇宣告支援 structured outputs 的免費模型。
  * `functions/src/providers.js`
  * `functions/test/providers.test.js`
  * 已提交、推送及部署：`b8cdb65 Require structured research results`
* **阻擋混雜文字並統一台灣繁體中文**：嚴格 schema 後仍實測到韓文／天城文／泰盧固文混入，後續又出現簡體中文；現在會拒絕敘述欄位的異常文字，並以 `opencc-js@1.4.1` 的 `cn → twp` 正規化敘述與 Tag 後再驗證、寫入。
  * `functions/src/providers.js`
  * `functions/test/providers.test.js`
  * `functions/package.json`
  * `functions/package-lock.json`
  * 已提交、推送及部署：`b441fd7 Reject mixed-script research results`、`dc901ea Normalize research output to Taiwan Chinese`
* **完成安全且有上限的研讀重試功能並發布**：`agent/research-job-retry` 已通過 review，以 fast-forward 合併到 `main`、推送並部署；功能 commit 為 `2f10681 Add bounded cloud research retries`，review 修正為 `232fef1 Harden bounded cloud research retries`。
  * Worker 最多自動嘗試 3 次；第三次可重試錯誤會成為 `failed_terminal`，不再永久停在 `retry_wait`。
  * 同一內容最多允許 2 次人工重試；重用既有 job、清除舊結果與錯誤、重新排隊，且不重複計算用量。單純 `enqueue_failed` 的重新排隊不消耗人工重試次數。
  * Review 發現模型成功後的自動核准 transaction 仍可能在 Cloud Tasks 耗盡重送後停在 `auto_approving`；現在同樣套用 3 次上限，並只在 job 仍為 `auto_approving` 時以 transaction 改成 `failed_terminal`，避免成功回應遺失時把 `succeeded` 倒退。
  * Queue 的 `maxAttempts` 與程式判斷共用 `MAX_TASK_ATTEMPTS`，避免部署設定和狀態機分歧。
  * `PROMPT_VERSION` 已升為 `cloud-research-v3-structured-results`，避免舊版確定性空結果 job 阻擋新版有效工作。
  * 前端已補齊人工重試、排隊重試、重試上限與重新排隊中的訊息；架構和設定文件同步更新。
  * `functions/src/job-policy.js`
  * `functions/src/index.js`
  * `functions/test/job-policy.test.js`
  * `app.js`
  * `tests/cloud-research.test.mjs`
  * `docs/CLOUD_RESEARCH_ARCHITECTURE.md`
  * `docs/CLOUD_SETUP_GUIDE.md`
* **完成驗證與部署核對**：JS 語法檢查、`npm test` 的 17 個測試檔、完整 Puppeteer 瀏覽器回歸與 `git diff --check` 全數通過；瀏覽器 `pageErrors` 為空。程式碼知識圖譜已依最終程式重建（681 nodes／1835 edges）。
  * 本次部署的程式 commit：`232fef1071ddfbf92522d2dbd8db0c83caf6e62c`
  * 10 個 Gen2 Functions 均已成功更新；`runResearchJob` 為 `ACTIVE`、Node.js 22、`maxInstanceCount=1`，更新時間 `2026-08-13T00:43:42.470544060Z`。
  * Queue 已恢復並回讀為 `RUNNING`、`maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`、`maxAttempts=3`。

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：研讀結果完整性、文字品質、台灣繁體正規化及有上限的自動／人工重試都已在 `main` 上線；正式環境的手動／自動／冪等流程先前已通過，部署與 Queue 限流也已回讀確認。
* **下一步**：若要再驗證本次重試功能，可用隔離 namespace 建立一個定向 `failed_terminal` job，確認人工重送不增加 usage、最多兩輪；不可啟動 production Scheduler。否則可直接開始下一個尚未補齊的產品功能。
* **卡點 (Blocker)**：無。GitHub App／本機 `gh` 仍沒有可用寫入權限，但直接 `git push` 可用，不阻擋既定發布方式。
* **安全性備註**：`npm audit --omit=dev` 為 9 個 moderate、0 high／critical，皆來自既有 Firebase 依賴鏈，不是新增的 `opencc-js`。未執行會造成 Firebase 套件降版／大版本變動的自動修復。

## 避坑指南 (Failed Approaches)

* **直接執行 production Scheduler 做隔離實測**：此動作可能掃描並替所有已啟用使用者排入工作。
  * **為什麼不採用**：超出單一測試 namespace 的安全邊界，可能動到真實資料與外部 API 用量。
  * **教訓**：正式環境 E2E 應只建立隔離 job，並建立指向該 job 的定向 Cloud Task。
* **用 shell 未正確保留 Cloud Task JSON 引號**：第一次 `--body-content={...}` 送出的 body 變成無效 JSON，Worker 回傳 HTTP 400。
  * **為什麼失敗**：shell 展開吃掉 JSON 欄位引號。
  * **教訓**：`--body-content` 使用單引號包住完整靜態 JSON；錯誤 task 要立即刪除。
* **以本機 ADC 使用 Firebase Admin SDK 操作隔離資料**：Firestore 回傳 `PERMISSION_DENIED`。
  * **為什麼失敗**：本機 Application Default Credentials 沒有對應資料權限。
  * **教訓**：沿用既有 `gcloud auth print-access-token`，只在程序記憶體中透過 Firestore REST 操作，不能輸出或保存 token。
* **交易後立刻做跨文件平行快照**：曾短暫看到 note／tags 為 null，但直接讀取精確 REST 路徑皆為 200。
  * **為什麼失敗**：過早的平行快照不適合作為跨文件最終一致性的唯一證據。
  * **教訓**：交易完成後應對每個精確文件路徑再次回讀，並比較筆記數量與時間戳。
* **只依賴 strict JSON schema 保證內容品質**：schema 能保證欄位形狀，不能保證語言與字體品質。
  * **為什麼失敗**：實測結果混入多種非預期文字，之後也出現簡體中文。
  * **教訓**：結構驗證、文字腳本防線與 OpenCC 台灣繁體正規化三者都需要。
* **在受限網路執行 `npm audit`**：第一次遇到 `EAI_AGAIN`。
  * **為什麼失敗**：sandbox 無法連線套件 registry。
  * **教訓**：只讀 audit 可在核准網路後重跑；不要直接套用會破壞 Firebase 版本的 `audit fix`。
* **假設 Firebase 部署會保留 Cloud Tasks 速率**：Functions 部署會把 Queue dispatch rate 重設為每秒 500 筆。
  * **為什麼失敗**：Firebase deploy 會覆寫 queue 設定。
  * **教訓**：每次部署後都要恢復並回讀 `maxConcurrentDispatches=1` 與 `maxDispatchesPerSecond=0.016667`。
* **直接執行完整部署腳本**：`scripts/deploy-functions.sh` 除了部署和 Queue 更新，也會重複寫入 project-level IAM。
  * **為什麼不採用**：安全審核不允許在只有部署授權時一併做廣泛且持久的 IAM mutation；而既有 IAM 已在前次部署驗證完成。
  * **教訓**：既有專案的普通程式更新應只執行 Firebase Functions deploy，再單獨更新／回讀指定 Queue；只有 IAM 確實缺失且獲明確授權時才補 IAM。

## 關鍵決策 (Key Decisions)

* **[正式 E2E 使用隔離 namespace 與定向 Task]**：不執行會掃描所有使用者的 production Scheduler。
  * **原因**：只驗證本次建立的 job，可完整測試線上 Worker 且不碰真實資料。
  * **被否決的方案**：直接手動觸發 production Scheduler。
* **[模型輸出採三層防線]**：先由 JSON schema 固定結構，再檢查必填內容與文字腳本，最後以 OpenCC 正規化為台灣繁體。
  * **原因**：線上實測證明單靠 prompt 或 schema 都不足以保證可寫入的內容品質。
  * **被否決的方案**：空欄位、混雜文字或簡體內容仍視為研讀成功。
* **[以 Firestore transaction 作自動寫入的冪等邊界]**：卡片、EditorJS 筆記、Tag、搜尋索引與 job 狀態一起提交。
  * **原因**：Cloud Tasks 至少一次傳送時，不能留下半套資料或重複追加。
  * **被否決的方案**：依序寫多個文件，再把 job 標為成功。
* **[自動與人工重試都設定明確上限]**：Worker 最多 3 次，使用者對同一內容最多人工重試 2 次，enqueue 失敗不計入人工次數。
  * **原因**：避免永久卡在 `retry_wait`、無限消耗外部 API，同時保留短暫錯誤的恢復能力。
  * **被否決的方案**：無限重試，或每次按下研讀都建立新 job 並重複計算用量。
* **[Review 後以 fast-forward 發布安全重試]**：先補齊自動核准 transaction 的終止狀態，再將兩筆功能 commit 原樣 fast-forward 到 `main`。
  * **原因**：保留清楚歷史，同時確保所有失敗路徑都有明確上限，部署設定與程式常數一致。
  * **被否決的方案**：忽略 `auto_approving` 卡死風險，直接部署原功能分支。

## 交接備忘錄 (Handover Context)

正式站是 `https://allenphant.github.io/stay-with-me/`；Firebase project ID 是 `dating-with-viola`，資料 namespace 是 `stay-with-me`，Functions 位於 `asia-east1`。Functions 正式環境目前部署自 `main` commit `232fef1`；研讀品質修正、一般網址的手動／自動／冪等 E2E，以及有上限的自動／人工重試都已完成並部署。10 個 Functions 更新成功，Queue 已恢復為每分鐘約一筆。測試資料先前已完整清除。

下一個 AI 接手後先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md`。若要做正式環境重試 E2E，必須沿用隔離 namespace 加定向 Cloud Task，驗證 `failed_terminal → manual_retry`、usage 不增加與兩輪上限，不可啟動 production Scheduler；否則直接盤點並補下一個產品功能。雙帳號邀請／共同空間真人實測繼續延後。
