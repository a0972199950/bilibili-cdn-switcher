/**
 * Google 表單「意見回饋與 Bug 回報」→ 自動在 GitHub 開 issue，並寄確認信給有填 Email 的使用者。
 *
 * 這份檔案是 Apps Script 編輯器裡程式碼的版本控管副本；
 * 改了這裡要記得同步貼回編輯器。部署步驟見同目錄 README.md。
 *
 * 需要的 Script Property：GITHUB_TOKEN（fine-grained PAT，只開本 repo 的 Issues: Read and write）
 */

var REPO = "a0972199950/bilibili-cdn-switcher";
var FORM_ID = "1np8rQTIf5yUdd7d9F0snraUnMLP1lpCa0QUKXRvealI"; // 表單編輯網址 /forms/d/<這段>/edit
var EXTRA_LABELS = ["from-form"];

// 確認信從腳本擁有者的 Gmail 寄出，顯示名稱用這個
var SENDER_NAME = "海外影片加速 for bilibili";

// 表單三語共用，文字一律「繁中 | 簡中 | English」；由 localizeForm 套用到表單上
var SEP = " | ";
var FORM_TEXT = {
  title: ["海外影片加速 for bilibili 意見回饋", "海外视频加速 for bilibili 意见反馈", "Overseas Video Speedup for bilibili Feedback"],
  description: ["請分享你的想法或回報問題，協助我們改進。", "请分享你的想法或反馈问题，帮助我们改进。", "Share your ideas or report a problem to help us improve."],
  type: { title: ["請求類型", "请求类型", "Type of Request"] },
  title_: {
    title: ["標題", "标题", "Title"],
    help: ["一句話描述問題或想要的功能", "一句话描述问题或想要的功能", "Describe the problem or idea in one line"]
  },
  body: {
    title: ["建議內容", "建议内容", "Details"],
    help: ["Bug 請盡量寫出：在哪個頁面、做了什麼、看到什麼結果", "Bug 请尽量写出：在哪个页面、做了什么、看到什么结果", "For bugs, please include: which page, what you did, and what happened"]
  },
  email: {
    title: ["Email（選填）", "Email（选填）", "Email (optional)"],
    help: [
      "填寫的話會寄確認信給你，修復／功能上線時也會通知你。注意：Email 會公開顯示在 GitHub 的追蹤頁面上。",
      "填写的话会寄确认信给你，修复／功能上线时也会通知你。注意：Email 会公开显示在 GitHub 的追踪页面上。",
      "If provided, we'll send you a confirmation and let you know when it's fixed or shipped. Note: your email will be shown publicly on the GitHub tracking page."
    ]
  },
  env: {
    title: ["環境資訊（由擴充自動帶入）", "环境信息（由扩展自动带入）", "Environment info (auto-filled by the extension)"],
    help: [
      "從擴充的「問題回報」按鈕開啟時，會自動帶入版本、瀏覽器、目前設定與 debug 資訊，方便排查問題；不想提供可以刪掉。",
      "从扩展的「问题反馈」按钮打开时，会自动带入版本、浏览器、当前设置与 debug 信息，方便排查问题；不想提供可以删掉。",
      "When opened from the extension's \"Report a bug\" button, this is pre-filled with the version, browser, current settings and debug info to help troubleshoot. Feel free to delete it."
    ]
  }
};

// 表單「類型」選項 → issue 的 label 與標題前綴（選項文字比對開頭，舊的單語選項也認得）
var TYPES = [
  { choice: ["Bug 回報", "Bug 报告", "Bug report"], label: "bug", prefix: "[Bug]" },
  { choice: ["功能許願", "功能许愿", "Feature request"], label: "enhancement", prefix: "[許願]" }
];

// 用「題目標題含有這段字」找欄位：表單改成三語前後都認得
var FIELDS = {
  type: "Type of Request",
  title: "標題",
  body: "建議內容",
  email: "Email",
  env: "環境資訊"
};

var MAX_TITLE = 200;     // GitHub 上限 256，留點空間給前綴
var MAX_BODY = 50000;    // GitHub 上限 65536，留空間給環境資訊
var MAX_ENV = 8000;

/** 表單送出觸發器（由 installTrigger 建立）。 */
function createIssueFromResponse(e) {
  var data = readResponse_(e.response);
  var issue = null;
  try {
    issue = postIssue_(buildIssue_(data));
    console.log("已建立 issue：" + issue.html_url);
  } catch (err) {
    notifyFailure_(data, err);
    throw err;
  } finally {
    sendReceipt_(data, issue);
  }
}

/** 只需執行一次：建立「表單送出」觸發器（重複執行會先清掉舊的）。 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "createIssueFromResponse") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("createIssueFromResponse")
    .forForm(FORM_ID)
    .onFormSubmit()
    .create();
  console.log("觸發器已建立");
}

/** 在表單最後新增「環境資訊」題（已存在就略過）。 */
function addEnvField() {
  var form = FormApp.openById(FORM_ID);
  if (findItem_(form, "env")) { console.log("環境資訊題已存在"); return; }
  form.addParagraphTextItem().setTitle(FORM_TEXT.env.title.join(SEP)).setHelpText(lines_(FORM_TEXT.env.help)).setRequired(false);
  console.log("已新增環境資訊題");
}

/** 把表單標題、說明、題目、選項套用成三語版本（可重複執行；題目 ID 不變，預填連結不受影響）。 */
function localizeForm() {
  var form = FormApp.openById(FORM_ID);
  form.setTitle(FORM_TEXT.title.join(SEP)).setDescription(lines_(FORM_TEXT.description));
  var type = findItem_(form, "type");
  type.setTitle(FORM_TEXT.type.title.join(SEP));
  type.asMultipleChoiceItem().setChoiceValues(TYPES.map(function (t) { return t.choice.join(SEP); }));
  [["title", FORM_TEXT.title_], ["body", FORM_TEXT.body], ["email", FORM_TEXT.email], ["env", FORM_TEXT.env]].forEach(function (pair) {
    var item = findItem_(form, pair[0]);
    if (!item) { console.warn("找不到題目：" + pair[0]); return; }
    item.setTitle(pair[1].title.join(SEP)).setHelpText(lines_(pair[1].help));
  });
  console.log("表單已套用三語文字");
}

/** 檢查 token 能不能用（不會建立 issue）。 */
function checkSetup() {
  var res = github_("get", "/repos/" + REPO, null);
  console.log("Token 可用，repo：" + res.full_name);
}

function findItem_(form, key) {
  var items = form.getItems();
  for (var i = 0; i < items.length; i++) if (items[i].getTitle().indexOf(FIELDS[key]) !== -1) return items[i];
  return null;
}

// 說明文字較長，三語分行比用 | 串成一行好讀
function lines_(arr) { return arr.join("\n"); }

function readResponse_(response) {
  var data = { type: "", title: "", body: "", email: "", env: "", time: response.getTimestamp() };
  response.getItemResponses().forEach(function (ir) {
    var question = ir.getItem().getTitle();
    Object.keys(FIELDS).forEach(function (key) {
      if (question.indexOf(FIELDS[key]) !== -1) data[key] = String(ir.getResponse() || "").trim();
    });
  });
  return data;
}

function typeOf_(value) {
  for (var i = 0; i < TYPES.length; i++) if (value.indexOf(TYPES[i].choice[0]) === 0) return TYPES[i];
  return null;
}

function buildIssue_(data) {
  var type = typeOf_(data.type);
  var title = ((type ? type.prefix + " " : "") + neutralize_(data.title || "(未填標題)")).slice(0, MAX_TITLE);
  var body = [
    "### 類型",
    data.type || "_未填_",
    "",
    "### 內容",
    neutralize_(data.body || "_未填_").slice(0, MAX_BODY),
    "",
    "### 聯絡 Email",
    data.email || "_未提供_",
    "",
    data.env ? "### 環境資訊\n````text\n" + data.env.replace(/`{4,}/g, "```").slice(0, MAX_ENV) + "\n````\n" : "",
    "---",
    "<sub>由 Google 表單自動建立 · 送出時間 " +
      Utilities.formatDate(data.time, "Asia/Taipei", "yyyy-MM-dd HH:mm") + "（台北時間）</sub>"
  ].join("\n");
  var labels = EXTRA_LABELS.concat(type ? [type.label] : []);
  return { title: title, body: body, labels: labels };
}

// 使用者內容裡的 @someone 會真的 tag 到人，插入零寬空白讓它失效
function neutralize_(text) {
  return text.replace(/@(?=[A-Za-z0-9])/g, "@​");
}

function postIssue_(issue) {
  return github_("post", "/repos/" + REPO + "/issues", issue);
}

function github_(method, path, payload) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("尚未設定 Script Property：GITHUB_TOKEN");
  var options = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch("https://api.github.com" + path, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("GitHub API " + code + "：" + res.getContentText());
  return JSON.parse(res.getContentText());
}

// 開 issue 失敗時把整筆回覆寄給自己，避免回報默默消失（原始回覆也仍留在表單裡）
function notifyFailure_(data, err) {
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    "[表單→Issue 失敗] " + (data.title || "(未填標題)"),
    "錯誤：" + err + "\n\n類型：" + data.type + "\n標題：" + data.title +
      "\nEmail：" + data.email + "\n\n" + data.body
  );
}

// 確認信文案；語言依環境資訊裡擴充帶入的 lang=，沒有就用繁中
var RECEIPT = {
  zh_TW: {
    subject: "已收到你的回報：",
    hello: "你好，",
    thanks: "感謝你填寫「海外影片加速 for bilibili」的意見回饋，我們已經收到了！",
    type: "類型：", title: "標題：", body: "內容：",
    tracking: "這筆回報已建立成公開的追蹤項目，之後的處理進度都會更新在這裡：",
    publicNote: "（追蹤頁面是公開的，會顯示你填寫的內容與 Email）",
    closing: "修復或功能上線時，我們會再寄信通知你。如果有想補充的資訊（例如截圖），直接回覆這封信就可以。",
    sign: "海外影片加速 for bilibili"
  },
  zh_CN: {
    subject: "已收到你的反馈：",
    hello: "你好，",
    thanks: "感谢你填写「海外视频加速 for bilibili」的意见反馈，我们已经收到了！",
    type: "类型：", title: "标题：", body: "内容：",
    tracking: "这条反馈已建立为公开的追踪项目，之后的处理进度都会更新在这里：",
    publicNote: "（追踪页面是公开的，会显示你填写的内容与 Email）",
    closing: "修复或功能上线时，我们会再寄信通知你。如果有想补充的信息（例如截图），直接回复这封信就可以。",
    sign: "海外视频加速 for bilibili"
  },
  en: {
    subject: "We received your feedback: ",
    hello: "Hi,",
    thanks: "Thanks for your feedback on \"Overseas Video Speedup for bilibili\" — we've received it!",
    type: "Type: ", title: "Title: ", body: "Details:",
    tracking: "Your report is now a public tracking item; progress updates will be posted here:",
    publicNote: "(The tracking page is public and shows what you submitted, including your email.)",
    closing: "We'll email you again when it's fixed or shipped. If you have more to add (e.g. screenshots), just reply to this email.",
    sign: "Overseas Video Speedup for bilibili"
  }
};

function receiptLang_(env) {
  var m = /lang=([\w-]+)/.exec(env || "");
  var lang = m ? m[1].toLowerCase() : "zh-tw";
  if (lang.indexOf("zh") !== 0) return "en";
  return /cn|hans|sg/.test(lang) ? "zh_CN" : "zh_TW";
}

// 有填 Email 才寄確認信；開 issue 失敗時照寄，只是不附連結。寄信失敗不影響 issue，記錄就好
function sendReceipt_(data, issue) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return;
  var lang = receiptLang_(data.env);
  var r = RECEIPT[lang];
  var type = typeOf_(data.type);
  var typeText = type ? type.choice[{ zh_TW: 0, zh_CN: 1, en: 2 }[lang]] : data.type;
  var lines = [
    r.hello,
    "",
    r.thanks,
    "",
    r.type + (typeText || "-"),
    r.title + (data.title || "-"),
    r.body,
    data.body || "-",
    ""
  ];
  if (issue) lines.push(r.tracking, issue.html_url, r.publicNote, "");
  lines.push(r.closing, "", r.sign);
  try {
    MailApp.sendEmail({
      to: data.email,
      name: SENDER_NAME,
      subject: r.subject + (data.title || "-"),
      body: lines.join("\n")
    });
  } catch (err) {
    console.error("確認信寄送失敗：" + err);
  }
}
