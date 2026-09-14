# 共同計畫首頁主軸已發布，等待正式站驗收（已完成／待驗收）

> **更新時間**：2026-09-14 16:13
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

* 完成 `wrap-up` 第一階段：保存本次交接快照、更新專案偏好、整理目前狀態，並列出待使用者核准的整併項目。
* 延續本次產品工作：將共同計畫放在首頁主軸，維持 `TODO.md` 作為產品待辦文件；使用者希望改動完成測試後直接發布到正式站驗收，不以本機瀏覽器驗收作為前提。

## 已完成任務

### 共同計畫首頁主軸

* 共同計畫現在位於頁面標題後的第一個核心區塊，收件匣與快速新增輸入框保留在後方；側欄第一項加入「共同計畫」，並讓 IntersectionObserver 在滾動時正確高亮 Planner。
* 新增 `TODO.md` 作為產品待辦的主要維護文件，分開目前處理、產品功能、品質可及性與已完成項目；`CURRENT_STATE.md` 只記錄交接快照。
* 功能已由 [PR #9](https://github.com/allenphant/stay-with-me/pull/9) squash 合併到 `main`，commit `2047fa0cd904ae3659b976cbcb3e2e291ea2f69f`；文件發布紀錄在 [PR #10](https://github.com/allenphant/stay-with-me/pull/10)，目前 `main`／`origin/main` 為 `623e1ad`。
* 本次前端／文件已通過 `npm test`（20 個測試檔全過）、`node --check app.js`、`git diff --check`；impeccable layout detector 在 parser 降級模式下回報 0 個 layout finding。GitHub Pages build 已顯示 `built`，正式站 `index.html`、`app.js` 雜湊與合併版本相同；真人驗收仍待確認首頁順序、側欄跳轉與行程新增。

### 日曆與單純排行程

* 日曆日期格的空白處可開啟預填該日期的新增行程；日期數字仍是可鍵盤操作的按鈕，既有行程／待辦卡片仍先開啟自己的編輯器。
* 中央年月改成按鈕，開啟原生年月選擇器快速跳轉，並支援取消、Escape 與點擊外部關閉。
* 單日行程支援新增／編輯／刪除，欄位為標題、日期、可選開始／結束時間、地點、備註；不建立待辦卡片、不需完成勾選。既有行程和紀念日仍可同時顯示。
* 行程存於目前空間 `artifacts/{appId}/users/{spaceId}/calendarEvents/{id}`，沿用既有空間成員 Firestore rules；本次未更動 rules 或 Functions。無重複行程、跨日行程、關閉 App 後提醒或外部行事曆同步，留待後續需求確認。
* 相關檔案：`app.js`、`index.html`、`couple-planner.mjs`、`tests/couple-planner.test.mjs`、`tests/couple-planner-dom.test.mjs`。日曆互動版本由 [PR #7](https://github.com/allenphant/stay-with-me/pull/7) squash 合併，commit `336033fe0e7a5edaa72a3b69bc1d5ef126a7d060`；單純行程版本由 [PR #5](https://github.com/allenphant/stay-with-me/pull/5) 合併，發布 commit `9b4946a25007e676677924b5e49d9afa587ba6ee`。

### 共同計畫第一階段與紀念日

* 已加入待辦類型（待辦／願望／約會）、可選日期、共享月曆、未排期願望入口，以及每年重複的紀念日與 App 內未來 30 天提示。舊待辦未新增欄位時仍視為一般待辦；願望改成約會只更新原卡片，不複製資料。
* 紀念日存在目前空間的 `anniversaries` collection；待辦仍沿用各 todo 類型分類的原 collection。
* 已使用窄螢幕日曆橫向捲動、表單標籤、對話框語意與焦點移動等 UI 可及性原則。
* 使用者已在正式站驗收紀念日成功；雙帳號邀請／共同空間真人驗證依使用者決定延後。

### 每日小日記構想

* 已記入後續產品規劃，尚未建立日記資料或代幣扣款：每天可寫一則日記，另一人使用代幣解鎖，價格與日記字數成正比。
* 實作前仍須決定字數計價公式（最低價／上限、編輯後價格是否變動）及代幣為個人錢包或共享錢包。鎖定內容必須由 Firestore rules 與可信任的後端扣款／解鎖流程保護，不能沿用目前成員可讀全部空間子集合的規則再只用 UI 隱藏。

### 雲端研讀安全重試（歷史已完成，保留交接脈絡）

* 已以 `https://example.com/` 和隔離 namespace `codex-e2e-cloud-research-20260812` 完成一般網址的正式環境端到端驗證，不觸發會掃描所有啟用使用者的 production Scheduler：手動模式到達 `pending_review`、`attempts=1`，自動模式到達 `succeeded`／`auto_approved`；重送同一工作後 attempts、筆記區塊數及文件時間戳皆未改變，確認冪等。測試資料已刪除並回讀確認，未碰觸使用者資料。
* 模型輸出已採嚴格 JSON schema、別名／wrapper 正規化及完整性驗證，只選擇宣告支援 structured outputs 的免費模型；另以 `opencc-js@1.4.1` 的 `cn → twp` 正規化敘述與 Tag 後再驗證，拒絕異常文字與簡體／混雜文字。相關 commit：`b8cdb65`、`b441fd7`、`dc901ea`。
* `agent/research-job-retry` 已 review、fast-forward 合併、推送並部署；功能 commit `2f10681`，review 修正後為 `232fef1`。Worker 最多自動嘗試 3 次；同一內容最多 2 次人工重試；`enqueue_failed` 重新排隊不消耗人工重試次數；`auto_approving` 也有 3 次上限，且只在仍為該狀態時轉為 `failed_terminal`。
* `PROMPT_VERSION` 為 `cloud-research-v3-structured-results`；Queue 的 `maxAttempts` 與程式共用 `MAX_TASK_ATTEMPTS`；前端已補齊人工重試、排隊重試、重試上限與重新排隊中的訊息；架構與設定文件同步更新。
* 部署核對已完成：當時 JS 語法檢查、`npm test` 17 個測試檔、完整 Puppeteer 瀏覽器回歸與 `git diff --check` 全數通過，瀏覽器 `pageErrors` 為空；10 個 Gen2 Functions 更新成功，`runResearchJob` 為 `ACTIVE`、Node.js 22、`maxInstanceCount=1`；Queue 已恢復為 `RUNNING`、`maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`、`maxAttempts=3`。

## 進行中與卡點 (In Progress & Blockers)

* 目前無程式碼 blocker。待在正式站驗收首頁共同計畫順序、側欄跳轉、點擊空白日期格新增行程，以及中央年月快速跳轉。
* 雙帳號邀請／共同空間真人驗證仍依使用者決定延後；這不阻擋單帳號 UI 與日曆功能驗收。
* 尚未實作的產品功能包括每日共同問答、代幣與天竺鼠、AI 每週回顧，以及每日小日記；產品優先順序以 `TODO.md` 為準。
* 日記功能卡在安全規格決策：計價公式、最低／最高代幣、編輯後價格、錢包歸屬、解鎖紀錄與退款／重複解鎖行為尚未定案。
* 若要再驗證雲端研讀重試，必須用隔離 namespace 加定向 Cloud Task，驗證 `failed_terminal → manual_retry`、usage 不增加與兩輪上限，不可啟動 production Scheduler。
* GitHub App／本機 `gh` 曾沒有可用寫入權限，但直接 `git push` 可用，不阻擋既定發布方式；`npm audit --omit=dev` 當時為 9 個 moderate、0 high／critical，皆來自既有 Firebase 依賴鏈，未執行可能造成 Firebase 套件變動的自動修復。

## 避坑指南 (Failed Approaches)

* 不要直接執行 production Scheduler 做隔離實測；它可能掃描並替所有已啟用使用者排入工作。正式環境 E2E 應只建立隔離 job，並建立指向該 job 的定向 Cloud Task。
* Cloud Task 的 `--body-content` 要以單引號包住完整靜態 JSON；shell 展開曾吃掉欄位引號並造成 HTTP 400，錯誤 task 要立即刪除。
* 本機 ADC 曾無法以 Firebase Admin SDK 操作隔離資料並回傳 `PERMISSION_DENIED`；應沿用既有 `gcloud auth print-access-token`，只在程序記憶體中透過 Firestore REST 操作，不能輸出或保存 token。
* 交易後立刻做跨文件平行快照曾短暫看到 note／tags 為 null；跨文件最終一致性不可只靠過早快照，應對每個精確 REST 路徑再次回讀，並比較筆記數量與時間戳。
* strict JSON schema 只能固定欄位形狀，不能單獨保證語言與字體品質；需要結構驗證、文字腳本防線與 OpenCC 台灣繁體正規化三層防線。
* 受限網路執行 `npm audit` 曾遇到 `EAI_AGAIN`；只讀 audit 可在核准網路後重跑，不要直接套用可能破壞 Firebase 版本的 `audit fix`。
* Firebase Functions 部署會把 Cloud Tasks 速率重設為每秒 500 筆；每次部署後都要恢復並回讀 `maxConcurrentDispatches=1` 與 `maxDispatchesPerSecond=0.016667`。
* `scripts/deploy-functions.sh` 除了部署和 Queue 更新，也會重複寫入 project-level IAM；普通程式更新應只執行 Functions deploy，再單獨更新／回讀指定 Queue，只有 IAM 確實缺失且獲明確授權時才補 IAM。
* UI critique 的 layout detector 在缺少完整 parser 時會降級；本次已記錄為 0 findings，但不把降級模式等同真人視覺驗收。瀏覽器若受本機 socket／Chromium sandbox 限制，改到正式站由使用者驗收。
* 本次 `tests/project-backlog.test.mjs` 曾因待辦文件標題已更新而使用過時斷言失敗；修正測試契約後才重新執行完整測試，不為了通過而改動無關程式。

## 關鍵決策 (Key Decisions)

* **[首頁以共同計畫為第一主軸]**：頁面標題後先呈現共同計畫，收件匣與快速新增後置；側欄與滾動高亮同步反映此資訊架構。原因是共同計畫是目前產品最能代表「一起生活」的核心入口。
* **[待辦文件與交接快照分離]**：產品待辦集中放在 `TODO.md`，`CURRENT_STATE.md` 只維護最新交接脈絡，完成項目仍留在待辦文件的已完成區，避免兩份清單互相漂移。
* **[前端發布採 commit → PR → squash → GitHub Pages]**：改動完成測試後直接推送並在正式站驗收；真人驗收延後不等於阻擋發布。
* **[正式 E2E 使用隔離 namespace 與定向 Task]**：不執行會掃描所有使用者的 production Scheduler，避免動到真實資料與外部 API 用量。
* **[模型輸出採三層防線]**：先由 JSON schema 固定結構，再檢查必填內容與文字腳本，最後以 OpenCC 正規化為台灣繁體；空欄位、混雜文字或簡體內容不視為研讀成功。
* **[以 Firestore transaction 作自動寫入的冪等邊界]**：卡片、EditorJS 筆記、Tag、搜尋索引與 job 狀態一起提交，避免 Cloud Tasks 至少一次傳送留下半套資料或重複追加。
* **[自動與人工重試都設定明確上限]**：Worker 最多 3 次，使用者對同一內容最多人工重試 2 次，enqueue 失敗不計入人工次數；不採用無限重試或每次建立新 job 的方案。
* **[日記先完成安全規格再開發]**：日記解鎖不能只靠 UI 隱藏；需先定義錢包、計價與解鎖交易，再由 Firestore rules 和可信任後端落實。

## 交接備忘錄 (Handover Context)

正式站是 `https://allenphant.github.io/stay-with-me/`；Firebase project ID 是 `dating-with-viola`，資料 namespace 是 `stay-with-me`，Functions 位於 `asia-east1`。前端最新 `main`／`origin/main` 為 `623e1ad`，共同計畫首頁主軸發布在 `2047fa0`；Functions 正式環境目前部署自 `main` commit `232fef1`。研讀品質修正、一般網址的手動／自動／冪等 E2E，以及有上限的自動／人工重試都已完成並部署；測試資料先前已完整清除。

下一個 AI 接手後先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md` 與 `TODO.md`，再依使用者指定優先順序工作。若要做正式環境重試 E2E，必須沿用隔離 namespace 加定向 Cloud Task；若要做前端改動，完成測試後直接走既定 PR／squash／Pages 流程並提供正式站驗收位置。雙帳號邀請／共同空間真人實測繼續延後。

本次 `wrap-up` 已將舊快照保留於 `docs/wrap-up/states/2026-09-14-1552.md`；使用者已核准 A-1，`AGENTS.md` 標題已修正為 `# AGENTS.md`。A-2 的 `gh` 授權偏好保留不變，實際需要 `gh` 且認證過期時再請使用者重新登入。
