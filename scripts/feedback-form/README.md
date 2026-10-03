# 回饋表單 → GitHub Issue

擴充裡「🐛 問題回報／功能許願」按鈕開啟的 Google 表單，送出後由 Apps Script 自動在本 repo 開 issue：

- 類型「Bug 回報」→ label `bug`、標題前綴 `[Bug]`；「功能許願」→ `enhancement`、`[許願]`
- 一律加上 `from-form` label
- 使用者有填 Email 就寫進 issue（issue 是公開的），並寄確認信（附 issue 連結）給對方：從腳本擁有者的 Gmail 寄出、顯示名稱為 `SENDER_NAME`，一天上限 100 封。表單本身的「收集電子郵件地址」要設為「不收集」，Email 才會是選填
- 「環境資訊」題由擴充 popup 預填（`src/popup.js` 的 `FEEDBACK_ENV_ENTRY`，目前是 `entry.603662239`），以程式碼區塊寫進 issue。題目由 `addEnvField` 建立；若刪掉重建，entry ID 會變，要同步改 popup.js
- 開 issue 失敗會寄信給腳本擁有者，原始回覆也仍保留在表單裡

Apps Script 是**獨立專案**（不是綁在表單上），用 `Code.gs` 裡的 `FORM_ID` 掛表單送出觸發器：
<https://script.google.com/home/projects/16uu3gbOV_EXQS_1_3nP_zCL9wawRCK8p29Q2Yo_oGX_peCMTHEwzNsER/edit>

`Code.gs` 是編輯器內程式碼的版本控管副本，改了要同步貼回去。

## 部署（只需做一次）

1. **GitHub token**：到 <https://github.com/settings/personal-access-tokens/new> 建立 fine-grained token
   - Repository access：Only select repositories → `bilibili-cdn-switcher`
   - Permissions → Repository permissions → **Issues: Read and write**（其他都不用開）
2. **貼程式碼**：<https://script.new> 建立專案 → 把 `Code.gs` 整份貼進去取代預設內容並儲存（換表單的話改 `FORM_ID`）
3. **存 token**：Apps Script 左側 ⚙「專案設定」→ 最下方「指令碼屬性」→ 新增 `GITHUB_TOKEN` = 第 1 步的 token
4. **建立觸發器**：回到編輯器，上方函式選單選 `installTrigger` → 執行 → 依提示授權
5. **驗證**：執行 `checkSetup`，執行記錄出現「Token 可用」即完成
6. **表單文字**（改了 `FORM_TEXT` / `TYPES` 才需要）：執行 `localizeForm`，把表單標題、題目、說明、選項套成「繁中 | 簡中 | English」三語版本。題目 ID 不變，擴充的預填連結不受影響。Google 表單的輸入框 placeholder 無法自訂，提示都放在題目說明裡

Token 過期後重做第 1、3 步即可；失敗通知信會提示 `GitHub API 401`。
