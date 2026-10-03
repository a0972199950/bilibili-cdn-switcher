/**
 * 背景腳本：
 *  1) 更新時補記「從哪個版本升上來」
 *  2) 收下測速工具（CDNSpeedTest.exe）推薦的節點，接到「自訂節點列表」後面（見 bridge.js 的匯入網址）
 *
 * 1) 1.5.x 以前不會記錄 installedVersion，popup 沒辦法分辨「舊使用者剛更新」與「全新安裝」。
 * 瀏覽器在更新時會把 previousVersion 帶進 onInstalled，不用舊版配合，這裡把它補寫成 installedVersion，
 * popup 的 checkVersionUpdate() 就會把 (previousVersion, 目前版本] 之間的更新內容彈出來。
 * 全新安裝（reason = install）不處理，維持「新使用者不彈」。
 */
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason !== "update" || !details.previousVersion) return;
  chrome.storage.local.get("installedVersion", function (items) {
    // 已經有紀錄（1.6.0 起 popup 自己會寫）就不蓋掉；沒有才補上
    if (items && items.installedVersion) return;
    chrome.storage.local.set({ installedVersion: details.previousVersion });
  });
});

// 2) 匯入網址任何網站都能做出來，所以只收 cdn-list.json 裡有的節點（測速工具測的也就是這份），
//    別人沒辦法藉此把影片導到自己的網域。已經在列表裡的不重複加，新的依序接在後面
function importCustomHosts(hosts) {
  return fetch(chrome.runtime.getURL("cdn-list.json"))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var known = {};
      (data.options || []).forEach(function (o) { if (o.value !== "backup") known[o.value] = true; });
      return new Promise(function (resolve) {
        chrome.storage.local.get({ customHosts: [], cdnMode: null, cdnHost: null }, function (items) {
          var list = Array.isArray(items.customHosts) ? items.customHosts.slice() : [];
          var added = 0;
          (Array.isArray(hosts) ? hosts : []).forEach(function (h) {
            if (typeof h !== "string" || !known[h] || list.indexOf(h) >= 0) return;
            list.push(h);
            added++;
          });
          var patch = { customHosts: list };
          // 已經選了自訂節點列表、但列表原本是空的（還在用原本的節點）→ 直接改用列表第一個
          if (items.cdnMode === "custom" && list.length && list.indexOf(items.cdnHost) < 0) patch.cdnHost = list[0];
          chrome.storage.local.set(patch, function () {
            resolve({ ok: true, added: added, total: list.length });
          });
        });
      });
    })
    .catch(function (e) { return { ok: false, err: String(e) }; });
}
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== "CDN_SWITCHER_IMPORT_CUSTOM") return;
  importCustomHosts(msg.hosts).then(sendResponse);
  return true;
});
