// 一般公告的 HTML（後台寫、從伺服器下載）不能直接塞 innerHTML：先用 DOMParser 解析成惰性文件（不跑 script、不載圖片），
// 再依白名單重建成 DOM——只留排版標籤，https 連結交給 openLink 開新分頁，其他屬性（style、on*…）全部丟掉，顏色交給頁面的主題。
// 擴充的公告視窗（announcement.js）用；本機後台的預覽也載入這一份（admin/app/ext/[file]/route.js），兩邊顯示一致。
(function () {
  "use strict";
  // 白名單標籤（照原樣重建，不帶屬性）；DROP 的整個連內容丟掉；其他標籤拆掉外殼、保留裡面的文字
  var KEEP_TAGS = ["H1", "H2", "H3", "H4", "P", "B", "STRONG", "I", "EM", "U", "S", "SMALL", "SUB", "SUP", "BR", "HR",
    "UL", "OL", "LI", "A", "SPAN", "DIV", "CODE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"];
  // 圖片也丟掉：載入外部圖片會把使用者的 IP 送給圖片網站
  var DROP_TAGS = ["SCRIPT", "STYLE", "IFRAME", "FRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA",
    "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS", "LINK", "META", "BASE", "TITLE", "HEAD"];

  function rebuild(src, dst, openLink) {
    Array.prototype.forEach.call(src.childNodes, function (node) {
      if (node.nodeType === Node.TEXT_NODE) { dst.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return; // 註解等
      var tag = node.tagName.toUpperCase();
      if (DROP_TAGS.indexOf(tag) !== -1) return;
      var href = tag === "A" ? node.getAttribute("href") || "" : "";
      // 不在白名單、或不是 https 的連結：拆掉外殼只留文字
      if (KEEP_TAGS.indexOf(tag) === -1 || (tag === "A" && !/^https:\/\//i.test(href))) { rebuild(node, dst, openLink); return; }
      var el = document.createElement(tag.toLowerCase());
      if (tag === "A") {
        el.href = href;
        el.addEventListener("click", function (ev) { ev.preventDefault(); openLink(href); });
      }
      rebuild(node, el, openLink);
      dst.appendChild(el);
    });
  }

  window.HtmlSanitize = {
    // 把 html 依白名單重建進 container（container 原本的內容會清掉）
    render: function (html, container, openLink) {
      container.textContent = "";
      var doc = new DOMParser().parseFromString(String(html || ""), "text/html");
      rebuild(doc.body, container, openLink || function (url) { window.open(url, "_blank", "noopener"); });
    },
  };
})();
