這個功能主要要做三件事

1. 建立版本更新紀錄
2. 建立 chrome, firefox, edge 自動化上架流程


- 專案需維護一個 `尚未上架的新功能清單`，與`已上架，某個版本相較於上一個版本的追加功能清單`。這可以在同一個 json 中維護。這個功能敘述同樣支持多語言

- 設定一個 pre-push hook，會檢查上述清單。如果該次 push 對應的最新 commit 和 分支出來的原始 commit diff 中，上述功能清單沒有變動，則彈一個交互提示 "No new features/bugs found. Please check if any changes need to record. Ignore and push: No/Yes" 的彈窗。選 No那就不能 push，必須要把新功能更新到 `尚未上架的新功能清單` 中才可以 push

- agent.md 增加對這個 pre-push 卡點的理解，並按照情況選擇是否要追加功能清單

- 新增一個 `/release` skill。這個 skill 會
  - 詢問要升級 major, minor 還是 patch
  - 建立一個 release branch `release/xx.xx.x`
  - 將待上架的功能列表移到確定的新版本號功能列表下
  - 個瀏覽器的擴充介紹，根據新功能調整敘述(只需要納入主要功能，bug修復，或是對用戶無用的功能不需納入。舉例，我如果做了一個 donate 功能，並放了一個排行榜，這是對用戶來說無用的功能，不需要再擴充介紹裡講)
  - 使用金鑰自動完成 chrome, firefox, edge 的上架。自動編譯並上傳新的壓縮包，填入各語言圖片與介紹。但發布按鈕交由我人工按
  - push 該 branch
  - master merge 該 branch

- 用戶 storage 裡面要存他當前用哪個版本。每次打開設定選單，就嘗試更新那個版本。
  - 如果在更新時有一個先前版本，代表他是老用戶。此時設定選單需要跳出一個一次性，可關閉的 popup，內容提示他最新版本號與新增的功能。當用戶關閉該 popup 後，才正式將新版本號更新到 storage
  - 如果在更新時沒有先前版本，代表他是新用戶。此時直接更新版本號 storage，不跳 popup


完成後自動用 chrome 測試 popup 是否生效。