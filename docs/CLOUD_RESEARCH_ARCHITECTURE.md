# Cloud Research Backend 架構

## 目標

將必須保持瀏覽器開啟的研讀佇列搬到受控後端，同時保留：

- GitHub Pages 前端。
- Firebase Authentication。
- 既有 Firestore 卡片資料。
- 手動審核／自動寫入選擇。
- Jina → OpenRouter 免費文字模型資料流。
- 失敗隔離與研讀紀錄。

## 第一階段元件

```text
GitHub Pages
  └─ Firebase Callable Functions
       ├─ updateResearchAutomation
       └─ enqueueCardResearch

Cloud Scheduler（每 10 分鐘）
  └─ discoverDueResearchJobs
       └─ Cloud Tasks
            └─ runResearchJob
                 ├─ Jina Reader
                 ├─ OpenRouter free text model fallback
                 ├─ YouTube → NotebookLM manual handoff
                 └─ Firestore pending result
```

## Firestore 路徑

```text
artifacts/{appId}/automationUsers/{uid}
artifacts/{appId}/users/{uid}/researchJobs/{jobId}
artifacts/{appId}/users/{uid}/researchUsage/{periodId}
```

`automationUsers/{uid}`：

- `enabled`
- `interval`
- `nextRunAt`
- `approvalMode`
- `maxJobsPerRun`
- `maxJobsPerDay`
- `monthlyBudgetCents`
- `maxVideoMinutesPerDay`

`researchJobs/{jobId}`：

- `status`
- `collectionName`
- `cardId`
- `sourceUrl`
- `sourceFingerprint`
- `sourceKind`
- `attempts`
- `result`
- `error`
- `createdAt`
- `updatedAt`

`researchUsage/{periodId}`：

- `jobs`
- `estimatedCostCents`
- `videoMinutes`
- `updatedAt`

## Job 狀態

```text
queued
  ↓
running
  ├─ pending_review
  ├─ auto_approving → succeeded
  ├─ succeeded
  ├─ retry_wait
  ├─ blocked_budget
  ├─ cancelled_stale
  └─ failed_terminal
```

工作建立時會保存當下的 `approvalMode`，避免排隊途中修改設定而改變既有工作的處理方式：

- `manual`：模型結果寫入 `pending_review`，由前端預覽後決定寫入或捨棄。
- `auto`：一般網址先進入 `auto_approving`，再以單一 Firestore transaction 驗證卡片 fingerprint、追加詳細筆記、更新搜尋索引與 Tag，最後標記 `succeeded`。
- YouTube 不套用自動寫入，仍進入 `pending_review` 並提供 NotebookLM 手動入口。

自動寫入的 transaction 同時包含卡片、詳細筆記、Tag 設定與 job 狀態，因此 Cloud Tasks 重送不會重複追加；若卡片已變更或刪除則標記 `cancelled_stale`。

## 冪等

Job ID 由以下資料建立：

```text
uid
collectionName
cardId
sourceFingerprint
promptVersion
```

相同卡片、相同來源內容、相同 prompt 版本只會得到同一個 job ID。Cloud Scheduler 至少一次傳送時，不會重複消耗模型或追加筆記。

## 成本控制

- Callable function 驗證 Firebase Auth。
- Schedule 只找 `enabled: true` 且 `nextRunAt <= now` 的使用者。
- 單次最多 20 張。
- 每日最多 50 張。
- 每月預估 AI 費用最多 500 cents。
- YouTube 不呼叫影片理解 API，因此不占用影片分鐘額度，也不產生模型費用。
- OpenRouter 只會從模型目錄選擇 prompt／completion 明確為 0 的模型。
- Tasks concurrency 為 1。
- Tasks dispatch rate 為 `0.016667/sec`，約每 60 秒最多開始一張；部署腳本會在
  Firebase 部署後重新套用，避免 queue 回到 500/sec 預設值。
- 相同工作成功或待審時直接返回。
- 卡片內容已改變則標記 `cancelled_stale`。
- 429／5xx 交由 Cloud Tasks 退避，不在 Function 內 sleep。
- 暫時性錯誤最多由 Cloud Tasks 嘗試 3 次；最後一次仍失敗會明確轉為
  `failed_terminal`，不會永久停在 `retry_wait`。
- 同一份卡片內容的 `failed_terminal` 工作可由使用者再按「雲端研讀」安全重試
  2 輪；不重複計入工作額度。`enqueue_failed` 可重新送入且不占手動重試次數。

## 尚未接上的部分

目前前端與雲端後端已正式串接，仍刻意保留以下限制：

- NotebookLM 沒有接自動回寫；YouTube 只提供複製網址並開啟 NotebookLM 的手動入口。

這些刻意分階段，避免一部署就開始批量產生費用。
