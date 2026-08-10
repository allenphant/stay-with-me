# CLAUDE.md

## 溝通

* 一律使用繁體中文回覆。

## 工具授權

* 可以直接執行 `gh` 指令（建立 PR、合併 PR 等），不需每次徵詢。
* 需要時可自行安裝 CLI 工具（例如 `firebase-tools`）。
* 破壞性的雲端資源刪除（例如 `gcloud functions delete`）仍須先說明影響並取得同意，執行前要先驗證沒有其他服務相依。

## 部署流程

* **前端**：commit → 開 PR → squash 合併進 `main` → GitHub Pages 自動建置。
* **後端 Functions**：`firebase deploy --only functions:research-backend --project dating-with-viola`
  * 一定要帶 `--only functions:research-backend` 這個 codebase filter；泛用的 `--only functions` 曾只部署到單一 function。

## 收尾

* 每次結束前更新 `CURRENT_STATE.md`，保持單一份最新狀態快照。
