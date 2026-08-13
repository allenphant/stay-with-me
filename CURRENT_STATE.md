# 一般網址雲端研讀已完成線上驗證，安全重試功能待部署

> **更新時間**：2026-08-12 17:17
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

先用一張一般網址完整驗證雲端研讀的手動審核與自動寫入，再繼續補下一個功能；依使用者先前決定，雙帳號真人實測暫緩。

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
* **完成安全且有上限的研讀重試功能**：功能目前只在本機分支 `agent/research-job-retry`，commit `2f10681 Add bounded cloud research retries`，尚未推送、合併或部署。
  * Worker 最多自動嘗試 3 次；第三次可重試錯誤會成為 `failed_terminal`，不再永久停在 `retry_wait`。
  * 同一內容最多允許 2 次人工重試；重用既有 job、清除舊結果與錯誤、重新排隊，且不重複計算用量。單純 `enqueue_failed` 的重新排隊不消耗人工重試次數。
  * `PROMPT_VERSION` 已升為 `cloud-research-v3-structured-results`，避免舊版確定性空結果 job 阻擋新版有效工作。
  * 前端已補齊人工重試、排隊重試、重試上限與重新排隊中的訊息；架構和設定文件同步更新。
  * `functions/src/job-policy.js`
  * `functions/src/index.js`
  * `functions/test/job-policy.test.js`
  * `app.js`
  * `tests/cloud-research.test.mjs`
  * `docs/CLOUD_RESEARCH_ARCHITECTURE.md`
  * `docs/CLOUD_SETUP_GUIDE.md`
* **完成驗證與部署核對**：重試分支已 rebase 到最新 `main`；JS 語法檢查、`npm test` 的 17 個測試檔與 `git diff --check` 全數通過。程式碼知識圖譜也已重建（679 nodes／1826 edges）。
  * 線上 `main`：`dc901eae3e56a31e7ef136f1b728b1b545ff71e6`
  * 本機重試分支：`2f106812f65b1daf41dec2b220e98bb7586da00a`
  * 10 個 Gen2 Functions 均已更新；`runResearchJob` 為 `ACTIVE`、Node.js 22，更新時間 `2026-08-12T08:59:33.388613211Z`。
  * Queue 已恢復並回讀為 `RUNNING`、`maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`、`maxAttempts=3`。

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：研讀結果完整性、文字品質與台灣繁體正規化已在 `main` 上線，正式環境的手動／自動／冪等流程均已通過。安全重試功能已完成並驗證，但只存在於本機 `agent/research-job-retry`。
* **下一步**：review `git diff main...agent/research-job-retry`；確認後合併到 `main`、push、部署 Functions，最後再次把 Cloud Tasks Queue 恢復為同時 1 筆、約每分鐘 1 筆並回讀驗證。可再用隔離 job 定向驗證一次終止失敗或人工重試流程。
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
* **[安全重試暫留功能分支]**：先完成、測試並 rebase，但沒有在未獲明確發布指令時推送或部署。
  * **原因**：下一個功能的發布範圍應由使用者確認，不能和已核准的研讀品質修正混在一起。
  * **被否決的方案**：完成後自動發布至正式環境。

## 交接備忘錄 (Handover Context)

正式站是 `https://allenphant.github.io/stay-with-me/`；Firebase project ID 是 `dating-with-viola`，資料 namespace 是 `stay-with-me`，Functions 位於 `asia-east1`。正式環境目前跑的是 `main` commit `dc901ea`；研讀品質修正與一般網址的手動／自動／冪等 E2E 都已完成，測試資料也已清除。安全重試功能位於本機 `agent/research-job-retry` commit `2f10681`，工作樹在寫入本狀態檔前為乾淨，尚未推送、合併或部署。

下一個 AI 接手後先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md`，接著 review `git diff main...agent/research-job-retry`；若內容符合預期，就合併、push、部署 Functions，並在部署後立刻恢復與核對 Queue 每分鐘約一筆的限流。若要做正式環境重試 E2E，必須沿用隔離 namespace 加定向 Cloud Task，不可啟動 production Scheduler。雙帳號邀請／共同空間真人實測繼續延後。
