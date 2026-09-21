# 共同計畫首頁主軸與共同生活功能已通過正式站驗收

> **更新時間**：2026-09-21
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 2026-09-21 部署後維運收尾完成

* 使用者完成 `gcloud` 重新登入後，已成功更新並回讀 `runResearchJob` Cloud Tasks queue。
* Queue 狀態為 `RUNNING`；`maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`（約每分鐘一筆）、`maxAttempts=3`，符合既有安全限速契約。
* 天竺鼠正式站驗收與本次 Functions 部署後的維運工作均已完成，目前沒有未解決 blocker。

## 2026-09-21 天竺鼠正式站驗收通過

* 使用者已在正式站確認小糰子可完成初始化，先前永久停在「等待共同小夥伴資料…」的問題已解除。
* 天竺鼠圖片、初始狀態、代幣購買、共享庫存與餵食流程的本輪驗收已結束；產品待辦改列完成。
* 部署後的 `runResearchJob` Cloud Tasks 安全限速已恢復並回讀完成。

## 2026-09-21 天竺鼠永久等待根因修正

* 正式 `ensureGuineaPig` logs 沒有任何 authenticated request，確認問題發生在前端呼叫 Function 之前。根因是 `attachSpace` 先建立代幣 listener，而舊路徑 `artifacts/{appId}/users/{spaceId}/tokens/wallets/{uid}` 有奇數段，只能代表 collection，不能作為 Firestore document；`doc()` 同步拋錯後中止了整個共同生活初始化。
* 錢包與 ledger 已改成合法文件路徑 `tokenWallets/{uid}`、`tokenLedger/{ledgerId}`；Functions、前端 listener 與 Firestore rules 已一起更新。舊路徑不可能成功寫入文件，因此不需要資料搬移。
* 天竺鼠 listener 與 `ensureGuineaPig` 現在排在其他共同生活 listener 之前，避免無關 listener 的同步錯誤再次阻斷小糰子初始化。
* 新增 `functions/src/couple-feature-paths.js` 與回歸測試，會驗證 token path 的 segment 數為偶數且可指向 Firestore document；完整測試 23／23、JS syntax check 與 `git diff --check` 通過。
* 修正已推送至 commit `802f43e`；Firestore rules 與 Functions 部署成功，GitHub Pages run `35550537338` 已成功，正式站回讀到 `pets/guineaPig → ensureGuineaPig → tokenWallets` 的順序且舊 `tokens/wallets` 路徑已消失。
* Functions 部署後需恢復 `runResearchJob` Cloud Tasks 限速；本機 `gcloud` reauthentication 已過期，執行 update 時未修改 queue。待使用者重新執行 `gcloud auth login` 後，恢復並回讀 `maxConcurrentDispatches=1`、`maxDispatchesPerSecond=0.016667`。

## 2026-09-18 天竺鼠 loading 修正與小糰子正式站素材

* 已確認「正在準備你們的共同小夥伴…」不是預期的完成狀態：正常初始化資料應顯示飽足度 72、心情 68；截圖中的 0／100 代表 Callable 或 Firestore listener 尚未把寵物資料送回前端。
* 前端現在對 `ensureGuineaPig` 加上 12 秒逾時、錯誤狀態與「重新載入」按鈕；Callable 成功回傳的完整寵物資料也會直接更新畫面，不再只等待 Firestore listener。
* `ensureGuineaPig`、購買飼料與餵食 Callable 都回傳正規化的小糰子資料；保留 0 值狀態，不會因為 falsy 判斷被重設成初始值。
* 新增由 imagegen 產生的透明背景素材 `assets/guinea-pig-xiaotuanzi.png`，已接入共同小夥伴卡片；正式站已回讀圖片、重試按鈕與 12 秒逾時邏輯。
* 程式碼與素材已推送至 commit `21a7c10`；Firebase Functions 更新成功，GitHub Pages run `35298512665` 已以 `success` 完成；未登入 smoke check 仍正確回覆 `UNAUTHENTICATED`。
* 尚待使用者在正式站登入後確認實際初始化、購買與餵食；本環境沒有使用者登入 session，未代替使用者宣稱 authenticated UI 驗收完成。

## 2026-09-17 Planner 同步卡住修正

* 已修正共同計畫同步狀態的兩個問題：Firestore 本機快取沒有伺服器回覆時不再永久顯示「同步中…」；分類快照也不會再把已完成的紀念日／行程同步狀態重設回 `syncing`。
* 連續 12 秒只收到本機快取時，Planner 會顯示「離線快取」並提供「重新連線」；真正收到伺服器快照才會顯示「已同步」。狀態提示會保留可及性的錯誤說明。
* 已補回歸斷言，`node --check app.js`、`npm test`（22／22）與 `git diff --check` 通過；修正已推送至 commit `77c657d`，正式站已回讀到逾時與「離線快取」文案。

## 2026-09-17 天竺鼠功能已部署

* 一起生活新增「共同小夥伴」區塊：共同空間有一隻小糰子，兩個人可以查看飽足度、心情與共享飼料庫存。
* 飼料商店提供高級牧草（3 枚）、小蔬菜盤（5 枚）與磨牙小點心（8 枚）；購買會扣除目前登入者的代幣，餵食會消耗共享庫存並提升小糰子狀態。
* 新增 `ensureGuineaPig`、`buyGuineaPigFeed`、`feedGuineaPig` 三個 Callable Functions；Firestore rules 允許成員讀取寵物狀態，但禁止客戶端直接寫入 `pets`。
* 前端與測試已提交至 commit `f4b66fa`；Firebase rules 與 Functions 已成功部署，未登入 smoke check 正確回覆 `UNAUTHENTICATED`。正式站真人驗收待使用者確認商店購買與餵食流程。

## 2026-09-17 共同生活功能批次

本批已完成除「天竺鼠／飼料商店」以外的產品待辦，程式碼、回歸測試、正式 Firebase 部署與正式站真人驗收均已完成。

* 新增 `couple-features.mjs` 與首頁「一起生活」區塊：每日共同問答、每日小日記、AI 每週回顧、共享白板與個人代幣餘額。
* 代幣只由 Callable Functions 交易：首次使用 20 枚、每日回答 +5、每日寫日記 +3；錢包與 ledger 禁止客戶端寫入。
* 日記以每人／每日一篇保存；每 20 字 1 枚，最低 3、最高 30；第一次解鎖後永久可讀且不可再編輯。私人內容 rules 只允許作者或已有 unlock 文件的成員讀取。
* 共享白板使用 `whiteboardBlocks` 結構化資料，支援 note／todo、即時更新與刪除；本輪不與 Planner 待辦同步。
* `settings-modal` 已拆成「共同空間／AI 與研讀」兩個 tab；AI 缺 Key 時會直接開在 AI 分頁。
* 新增 `functions/src/couple-feature-policy.js`、Callable Functions 與 Firestore rules；本機 `npm test` 目前 22/22 通過，JS syntax check 與 `git diff --check` 通過。

### 本批部署狀態

* Firestore rules 已成功編譯並發布；`research-backend` Functions 已成功部署，新增 `ensureTokenWallet`、`submitDailyAnswer`、`saveDailyDiary`、`unlockDailyDiary`、`saveWeeklyReview` 五個 Callable Functions。未帶認證的 endpoint smoke check 正確回覆 `UNAUTHENTICATED`。
* GitHub Pages run `35195406770` 已以 commit `90f5b66` 完成；正式站已回讀 `couple-life-hub`／「共同生活」標記：`https://allenphant.github.io/stay-with-me/`。
* Functions 部署後嘗試恢復既有 `runResearchJob` Cloud Tasks 限速時，`oasis@cdc.gov.tw` 缺少 `cloudtasks.queues.update/get` 權限；沒有修改 IAM，queue 限速狀態仍待具權限帳號回讀確認。
* 共同生活原有功能的正式站驗收已通過；天竺鼠新增流程尚待使用者在正式站驗收。目前 CUA 沒有可用瀏覽器或 App surface，沒有代替使用者宣稱 UI 驗收完成。

## 本次對話目標

* 依 `TODO.md` 從共同計畫主軸繼續完成不需要產品決策的技術待辦。
* 使用者希望改動完成測試後直接推送到正式站驗收，不以本機瀏覽器驗收作為前提；本批正式站真人驗收已完成。

## 已完成任務

### 共同計畫首頁主軸

* 共同計畫現在位於頁面標題後的第一個核心區塊，收件匣與快速新增輸入框保留在後方；側欄第一項加入「共同計畫」，並讓 IntersectionObserver 在滾動時正確高亮 Planner。
* 新增 `TODO.md` 作為產品待辦的主要維護文件，分開目前處理、產品功能、品質可及性與已完成項目；`CURRENT_STATE.md` 只記錄交接快照。
* 功能已由 [PR #9](https://github.com/allenphant/stay-with-me/pull/9) squash 合併到 `main`，commit `2047fa0cd904ae3659b976cbcb3e2e291ea2f69f`；文件發布紀錄在 [PR #10](https://github.com/allenphant/stay-with-me/pull/10)，該階段 `main`／`origin/main` 為 `623e1ad`。
* 前一批前端／文件已通過 `npm test`（20 個測試檔全過）、`node --check app.js`、`git diff --check`；impeccable layout detector 在 parser 降級模式下回報 0 個 layout finding。GitHub Pages run #22 已 `success`；本批更新後的正式站驗收狀態見下方交接備忘錄。

### 統一新增與編輯入口

* 本次完成 Planner 的統一入口：首頁「新增計畫」、月曆空白日期、月曆既有項目、待辦分類右上角新增，以及待辦／願望／約會卡片的編輯，皆進入同一份表單。
* 表單可切換「行程／待辦／願望／約會」；行程仍寫入 `calendarEvents`，其餘仍寫入選定的 `type: todo` 分類，保留既有資料模型與 Firestore rules。待辦／願望可不填日期，約會與行程需要日期。
* 共同計畫編輯可切換待辦分類與計畫類型；另提供「編輯完整內容」回到既有 EditorJS 編輯器，不把摘要欄位與完整筆記混在一起。
* `couple-planner.mjs` 新增 `normalizePlannerCard`，並補上有效類型、分類、日期與約會必填日期的測試；DOM 測試覆蓋單一表單與四種入口。該批已推送至 `main` commit `20a8d86`，Pages run #22 成功。
* 程式碼知識圖譜已依本次版本重建為 769 nodes／2441 edges；`docs`、`scripts` 與測試依既有規則排除，沒有 parse partial 或 skipped 檔案。

### 日曆與單純排行程

* 日曆日期格的空白處可開啟預填該日期的新增行程；日期數字仍是可鍵盤操作的按鈕，既有行程／待辦卡片仍先開啟自己的編輯器。
* 中央年月改成按鈕，開啟原生年月選擇器快速跳轉，並支援取消、Escape 與點擊外部關閉。
* 單日行程支援新增／編輯／刪除，欄位為標題、日期、可選開始／結束時間、地點、備註；不建立待辦卡片、不需完成勾選。既有行程和紀念日仍可同時顯示。
* 行程存於目前空間 `artifacts/{appId}/users/{spaceId}/calendarEvents/{id}`，沿用既有空間成員 Firestore rules；本次未更動 rules 或 Functions。無重複行程、跨日行程、關閉 App 後提醒或外部行事曆同步，留待後續需求確認。
* 相關檔案：`app.js`、`index.html`、`couple-planner.mjs`、`tests/couple-planner.test.mjs`、`tests/couple-planner-dom.test.mjs`。日曆互動版本由 [PR #7](https://github.com/allenphant/stay-with-me/pull/7) squash 合併，commit `336033fe0e7a5edaa72a3b69bc1d5ef126a7d060`；單純行程版本由 [PR #5](https://github.com/allenphant/stay-with-me/pull/5) 合併，發布 commit `9b4946a25007e676677924b5e49d9afa587ba6ee`。

### 本批共同計畫技術補強

* Planner 在手機版改成選定日期的 agenda：可用日期欄位、前後一天、空白日期新增；桌面保留月曆格，且點擊空白日期格仍可排行程。
* Planner 顯示共編者、最近同步時間與同步狀態；Firestore snapshot 支援同步中／已同步／同步失敗，失敗時可按重試並重新建立 listener。
* 行程與紀念日都有建立者資訊；行程刪除與紀念日刪除提供短暫 undo，紀念日可在原表單直接編輯。
* 未登入新增／編輯、背景同步失敗與待辦勾選失敗都有明確提示及可復原行為；新增紀錄寫入 `createdByUid` 供 Planner 顯示建立者。
* 補齊主要 textarea、API key、contenteditable、icon-only 控制與圖片預覽的可及性標籤；加入全域 keyboard `focus-visible` 樣式、`prefers-reduced-motion` 與窄版／200% zoom 下的 agenda 佈局。
* 固定版本 CDN 套件已補 SRI、`crossorigin` 與 `defer`；Tailwind Play CDN 為 runtime-generated，DragDropTouch 仍是上游未固定版本，兩者都在 `index.html` 留有明確例外說明。
* `npm test` 目前 20／20 通過，另通過 `node --check app.js`、`node --check couple-planner.mjs` 與 `git diff --check`；DOM 測試已把 CDN SRI、agenda、同步狀態與可及性契約納入回歸。

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

* 目前無程式碼 blocker；首頁共同計畫順序、側欄跳轉、行程新增與同步狀態修正已由使用者在正式站驗收通過。
* 雙帳號邀請／共同空間真人驗證仍依使用者決定延後；這不阻擋單帳號 UI 與日曆功能驗收。
* 每日共同問答、代幣、AI 每週回顧、每日小日記、共享白板與天竺鼠功能均已實作；目前產品上暫停的只有天竺鼠後續擴充內容，產品優先順序以 `TODO.md` 為準。
* 日記功能卡在安全規格決策：計價公式、最低／最高代幣、編輯後價格、錢包歸屬、解鎖紀錄與退款／重複解鎖行為尚未定案。
* 共享白板第一版已採單一結構化區塊白板，支援自由文字與 Todo；即時同步採最後寫入者優先，Todo 暫不同步至 Planner。
* 設定 modal 已拆分為共同空間與 AI／研讀兩個分頁。
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

正式站是 `https://allenphant.github.io/stay-with-me/`；Firebase project ID 是 `dating-with-viola`，資料 namespace 是 `stay-with-me`，Functions 位於 `asia-east1`。前端目前 `main`／`origin/main` 為 `ca1f7d5`，共同計畫首頁主軸發布在 `2047fa0`，統一入口發布在 `20a8d86`；本批 GitHub Pages run #25 已成功，並已從正式站回讀 agenda、同步狀態、SRI、同步重試與建立者欄位。Functions 正式環境目前部署自 `main` commit `232fef1`。研讀品質修正、一般網址的手動／自動／冪等 E2E，以及有上限的自動／人工重試都已完成並部署；測試資料先前已完整清除。

下一個 AI 接手後先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md` 與 `TODO.md`，再依使用者指定優先順序工作。若要做正式環境重試 E2E，必須沿用隔離 namespace 加定向 Cloud Task；若要做前端改動，完成測試後直接走既定 PR／squash／Pages 流程並提供正式站驗收位置。雙帳號邀請／共同空間真人實測繼續延後。

本次 `wrap-up` 已將舊快照保留於 `docs/wrap-up/states/2026-09-14-1552.md`；使用者已核准 A-1，`AGENTS.md` 標題已修正為 `# AGENTS.md`。A-2 的 `gh` 授權偏好保留不變，實際需要 `gh` 且認證過期時再請使用者重新登入。
