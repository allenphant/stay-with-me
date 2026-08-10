# 完成 Stay With Me 品牌清洗、雙人綁定 UI 與空間改名功能，前後端均已上線（待雙帳號實測）

> **更新時間**：2026-08-04 09:52
> **專案核心**：以 Vanilla JS、Firebase Authentication／Firestore／Functions 與 GitHub Pages 打造的雙人共編生活空間。

## 本次對話目標

修正 Firebase Browser key 的 allowed referrer 以解除 GitHub Pages 登入失敗，跑完資料隔離驗收清單，清理舊專案誤部署的 Functions，將殘留的 My AI Brain 品牌字樣改為 Stay With Me，並補上雙人綁定的 UI 與空間改名功能。

## 已完成任務

* **修正 Browser key referrer（登入 blocker 解除）**：key `9306a3ce-9b06-47e8-8371-6a12cb6a73ac` 的 `allowedReferrers` 由 `https://allenphant.github.io/stay-with-me/*` 改為 `https://allenphant.github.io/*`。已逐字元驗證無隱藏 newline，且 `apiTargets` 仍為原本 9 個 service 未被清空。使用者已確認登入成功。
* **完成資料隔離驗收**：以 Firestore REST 確認兩專案 namespace 互不重疊，`dating-with-viola` 僅有 `artifacts/stay-with-me`、`my-ai-brain-6867e` 僅有 `artifacts/my-personal-ai-brain`。測試卡片落於 `artifacts/stay-with-me/users/sk3Hgr.../inbox/T7WR2nAYvARMEupfAZ9y`。
* **清理舊專案誤部署 Functions**：從 `my-ai-brain-6867e`（`asia-east1`）刪除 `ensurePersonalSpace`、`createSpaceInvite`、`acceptSpaceInvite`、`removeSpaceMember`。刪除前已驗證舊站線上 `app.js` 對這 4 個的引用次數為 0。刪除後該專案剩正好 5 個 research Functions。
* **品牌字樣清洗為 Stay With Me**
  * `index.html`：`<title>`、H1、Guide 標籤、頁尾標語；並修正兩個原本指向舊站與舊 repo 的**錯誤連結**
  * `manifest.json`：`name` 與 `short_name`
  * `sw.js`：`CACHE_NAME` 由 `ai-brain-v11` → `stay-with-me-v12`（強制舊快取失效，否則改名不會生效）
  * `package.json`、`functions/package.json`、`functions/src/providers.js`（OpenRouter APP_URL／APP_NAME）
  * `tests/help-center.test.mjs`、`tests/card-web-research.browser.mjs`（同步斷言）
* **雙人綁定 UI**：後端本就有雙人上限，但前端不反映，導致滿員仍可按邀請。
  * `index.html`：新增 `space-pair-status`
  * `app.js`：`renderSpacePairStatus()`；`memberCount >= 2` 時隱藏邀請表單；成員 listener 改呼叫 `renderSpaceControls()`
* **空間改名功能**
  * `functions/src/index.js`：新增 owner-only Callable `renameSpace`
  * `index.html`：新增 `space-rename-row`
  * `app.js`：`renameSpaceCallable`、`renameSpace()` 與按鈕綁定
* **部署**：PR [#3](https://github.com/allenphant/stay-with-me/pull/3) 已 squash 合併至 `main`；後端 10 個 Functions 全數 `ACTIVE`（`renameSpace` 為新建）。線上已驗證 `<title>` 為 `Stay With Me`、`app.js` 含 `renameSpaceCallable`。
* **驗證**：`npm test` 98/98、`functions` 21/21、JSON／JS 語法檢查、`git diff --check` 全通過。

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：所有程式改動與部署都已完成並上線。
* **下一步**：唯一剩下的驗收項目是**雙帳號實測** —— 建立邀請碼 → Viola 貼上加入 → 共同編輯 → 移除成員；順便驗證新的改名功能與綁定狀態顯示。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **只允許 GitHub Pages repository path**：設定 `https://allenphant.github.io/stay-with-me/*`。
  * **為什麼失敗**：Firebase Auth 是以 origin `https://allenphant.github.io` 檢查 API key，不含 path。
  * **教訓**：Browser key 的 GitHub Pages referrer 必須是 `https://allenphant.github.io/*`。
* **用 Firestore REST 列出 `artifacts` 下的 namespace 得到空結果**，誤判資料庫是空的。
  * **為什麼失敗**：`artifacts/{appId}` 是沒有欄位的隱含父文件（implicit parent），一般 list 不會回傳。
  * **教訓**：查這類路徑一定要加 `showMissing=true`。
* **把「對方登入成功」當成「已加入空間」**。
  * **為什麼失敗**：任何帳號登入時 `ensurePersonalSpace` 都會自動建立**自己的**個人空間，與邀請流程無關。
  * **教訓**：登入 ≠ 加入，必須另外走建立邀請碼／貼上加入兩步。
* **直接合併 PR #3 到 `main`**，出現 `the merge commit cannot be cleanly created`。
  * **為什麼失敗**：PR #2 是 squash 合併，`main` 上的 `a4798fd` 已包含分支前三個 commit 的內容，造成重複衝突。
  * **教訓**：此 repo 一律 squash 合併，後續分支要從 `origin/main` 開新分支 cherry-pick，驗證 `git diff` 與原 commit 為空後再 force-with-lease 更新 PR 分支。
* **以 `export` 環境變數餵給 `firebase deploy --non-interactive`**。
  * **為什麼失敗**：CLI 只讀 dotenv 檔，環境變數無效；且即使 `index.js` 的 `defineString` 已有 `default`，非互動模式仍會索取 `GEMINI_RESEARCH_MODEL`／`OPENROUTER_RESEARCH_MODEL`。
  * **教訓**：需建立 `functions/.env`（已被 `.gitignore` 第 7 行排除）。目前值與線上原值相同，部署未改變行為。
* **以為 Firebase CLI 能沿用 gcloud 憑證**。
  * **為什麼失敗**：`firebase projects:list` 直接報錯，Firebase CLI 有完全獨立的登入。
  * **教訓**：本機部署前需另外執行一次 `firebase login`。

## 關鍵決策 (Key Decisions)

* **[共用其中一人的空間，不合併資料]**：`acceptSpaceInvite` 是把受邀者加入**擁有者既有的空間**，不會建立第三個空間，也不搬移任何卡片。
  * **原因**：space ID 同時就是資料根目錄 ID（個人空間 ID = 擁有者 uid），沿用可做到 no-copy migration。
  * **被否決的方案**：建立獨立共同空間並合併雙方資料（需搬移資料、成本與風險都高）。
  * **副作用**：受邀者原本空間的卡片不會帶過來，仍只有本人看得到，可用「目前使用」下拉切換。
* **[空間名稱反正規化]**：名稱同時存在 `spaces/{id}.name` 與每位成員的 `users/{uid}/memberships/{spaceId}.name`。
  * **原因**：讓客戶端列出可用空間時不必逐一讀取 space 文件。
  * **代價**：`renameSpace` 必須以 batch 同時更新空間文件與所有成員的 membership，否則另一方看到舊名稱。
* **[改名走 Callable 而非客戶端直寫]**：`firestore.rules` 對 `spaces` 是 `allow write: if false`。
  * **原因**：維持 server-only 的成員與空間中繼資料邊界。
* **[保留隔離守門測試的舊專案字樣]**：`tests/shared-space.test.mjs:44,58` 仍提及 `my-ai-brain-6867e`。
  * **原因**：那是 `assert.doesNotMatch` 斷言，確保正式設定不會再連回舊專案；改掉等於拆掉防護。
* **[雙人上限維持在後端]**：UI 只做狀態呈現，實際限制仍由 `createSpaceInvite`／`acceptSpaceInvite` 檢查 `memberCount >= 2`。

## 交接備忘錄 (Handover Context)

專案已全面上線且無卡點。正式站 `https://allenphant.github.io/stay-with-me/`，Firebase project ID 為 `dating-with-viola`（顯示名稱 Stay With Me），資料 namespace `stay-with-me`，Functions 位於 `asia-east1`。

目前 Firestore 有兩個各自獨立的個人空間（`sk3Hgr...` 王睿君、`n2yU5Q...` Viola Weng，`memberCount` 皆為 1），**尚未綁定**。

接手後第一步請先閱讀 `/home/cdc/CCdevelopment/stay-with-me/source/CURRENT_STATE.md`，接著協助使用者完成唯一剩下的驗收：雙帳號邀請流程。UI 入口在**設定 Modal** 的「共同空間」區塊，開啟方式為頁首粉紅愛心鈕（登入後才顯示）或側邊欄齒輪。

**提醒使用者一個取捨**：加入 = 受邀者進入擁有者的空間，受邀者自己空間的卡片不會跟過來。趁雙方資料都還少，先決定哪一個當共同空間。

測試若出錯，可用下列指令查 log 與資料狀態：

```bash
gcloud functions logs read acceptSpaceInvite --project=dating-with-viola --region=asia-east1 --limit=30

TOKEN=$(gcloud auth print-access-token)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/dating-with-viola/databases/(default)/documents/artifacts/stay-with-me/spaces?pageSize=20"
```

本機環境：gcloud 已登入 `allenphant11@gmail.com`，firebase-tools 15.25.1 已安裝並登入，`gh` 可用。
