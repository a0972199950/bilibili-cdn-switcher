// 擴充的 src/lottery-text.js 是瀏覽器腳本，載入時把結果寫進 window.LotteryText：先給它一個 window（index.js 取完幣別表就刪掉）
globalThis.window ??= {};
