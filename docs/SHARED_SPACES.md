# 共同空間與 Firestore Rules 部署指南

## 資料模型

既有資料不搬移。個人空間 ID 就是原本使用者的 Firebase Auth UID，因此舊卡片仍位於：

```text
artifacts/{appId}/users/{spaceId}/...
```

共同空間使用下列授權資料：

```text
artifacts/{appId}/spaces/{spaceId}
artifacts/{appId}/spaces/{spaceId}/members/{uid}
artifacts/{appId}/users/{uid}/memberships/{spaceId}
artifacts/{appId}/spaceInvites/{inviteCode}
```

`spaceInvites` 不允許前端直接讀寫。建立邀請、接受邀請與移除成員都由驗證 Firebase Auth 的 Callable Functions 執行。

## 在 Firebase Console 確認目前規則

1. 打開 Firebase Console，選擇顯示名稱為 `Stay With Me`、project ID 為 `dating-with-viola` 的專案。
2. 進入 **Build → Firestore Database → Rules**。
3. 查看上方目前發布中的規則，不要只看 Rules playground。
4. 如果看到涵蓋所有文件的 `allow read, write: if request.auth != null`，代表任何登入此 Firebase project 的人都可能通過規則，應換成 repository 的 `firestore.rules`。
5. 可在 Rules playground 分別測試：未登入、本人 UID、非成員 UID、共同空間成員 UID。

## 安全部署順序

先在測試帳號與可回復的維護時段操作：

1. 部署 Functions：`npm run deploy:functions`
2. 部署包含共同空間 UI 的靜態前端。
3. 以原資料擁有者登入一次；`ensurePersonalSpace` 會建立 owner membership。
4. 部署規則：`npm run deploy:rules`
5. 重新整理並確認原本卡片仍可讀寫。
6. owner 在設定頁輸入伴侶的 Google 帳號 email，建立七日邀請碼。
7. 伴侶以該帳號登入、輸入邀請碼，加入後確認雙方能即時看見同一張測試卡片。

`firestore.rules` 另外保留「尚未建立 space 文件時，UID 本人仍可存取原資料」的 bootstrap 條件，降低部署過程鎖住既有資料的風險。

## 回復方式

Firebase Console 的 Rules 頁可查看先前規則版本。若部署後發生非預期的 permission denied，先回復上一版規則，再檢查 owner membership 是否已建立；不要改回允許所有登入者讀寫的規則作為長期方案。
