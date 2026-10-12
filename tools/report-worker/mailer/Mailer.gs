/**
 * 擴充內建回報頁（report.html → Cloudflare Worker bcs-report）的確認信。
 * 這是 Apps Script 專案「bilibili-cdn-switcher 回報表單同步 issue」裡 Mailer.gs 的版本控管副本（與 scripts/feedback-form/Code.gs 同一個專案，
 * 共用已授權的 MailApp）。Worker 在 issue 建好後 POST JSON 到這個 Web app（/exec），由專案擁有者的 Gmail 寄確認信給填了 email 的使用者；
 * 使用者直接回信就進擁有者的收件匣。
 * 部署：Web app、執行身分 = 我、存取 = 任何人。Worker 端 secrets：MAIL_URL（/exec 網址）、MAIL_SECRET（= MAIL_SECRET 常數）。
 * MAIL_SECRET 的實際值只放在 Apps Script 專案與 Worker secret，不要寫進這個檔。
 */
var MAIL_SECRET = "<放在 Apps Script 專案裡，與 Worker 的 MAIL_SECRET 相同>";
var MAIL_SENDER_NAME = "Bilibili CDN Switcher";

var MAIL_T = {
  zh_TW: {
    subject: "[海外影片加速 for bilibili] 已收到你的回報 #{n}",
    body: "你好，\n\n已收到你的回報，謝謝！處理進度可以在這裡追蹤：\n{url}\n\n如果想補充更多資訊（例如截圖、發生的時間、其他影片），直接回覆這封信即可，會送到開發者的信箱。\n\n回報編號：{id}\n\n— 海外影片加速 for bilibili"
  },
  zh_CN: {
    subject: "[海外视频加速 for bilibili] 已收到你的反馈 #{n}",
    body: "你好，\n\n已收到你的反馈，谢谢！处理进度可以在这里跟踪：\n{url}\n\n如果想补充更多信息（例如截图、发生的时间、其他视频），直接回复这封邮件即可，会送到开发者的邮箱。\n\n反馈编号：{id}\n\n— 海外视频加速 for bilibili"
  },
  en: {
    subject: "[Bilibili CDN Switcher] We received your report #{n}",
    body: "Hi,\n\nThanks, your report has been received. You can track progress here:\n{url}\n\nIf you'd like to add more details (screenshots, when it happened, other videos), simply reply to this email; it goes straight to the developer.\n\nReport ID: {id}\n\n— Bilibili CDN Switcher"
  },
  ja: {
    subject: "[Bilibili CDN Switcher] ご報告を受け付けました #{n}",
    body: "こんにちは。\n\nご報告ありがとうございます。対応状況はこちらで確認できます：\n{url}\n\n補足情報（スクリーンショット、発生時刻、他の動画など）があれば、このメールにそのまま返信してください。開発者に届きます。\n\n報告 ID：{id}\n\n— Bilibili CDN Switcher"
  },
  ko: {
    subject: "[Bilibili CDN Switcher] 신고가 접수되었습니다 #{n}",
    body: "안녕하세요.\n\n신고해 주셔서 감사합니다. 처리 상황은 여기에서 확인할 수 있습니다:\n{url}\n\n추가 정보(스크린샷, 발생 시각, 다른 영상 등)가 있으면 이 메일에 바로 답장해 주세요. 개발자에게 전달됩니다.\n\n신고 ID: {id}\n\n— Bilibili CDN Switcher"
  }
};

function mailLang_(lang) {
  lang = String(lang || "").replace("-", "_");
  if (/^zh_(TW|HK|MO|Hant)/i.test(lang)) return "zh_TW";
  if (/^zh/i.test(lang)) return "zh_CN";
  if (/^ja/i.test(lang)) return "ja";
  if (/^ko/i.test(lang)) return "ko";
  return "en";
}
function mailFill_(s, v) { return s.replace(/\{(\w+)\}/g, function (_, k) { return v[k] == null ? "" : String(v[k]); }); }

function mailOut_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Web app 入口：Worker POST { secret, to, lang, id, issueUrl, issueNumber } */
function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return mailOut_({ ok: false, error: "bad_json" }); }
  if (!p || p.secret !== MAIL_SECRET) return mailOut_({ ok: false, error: "bad_secret" });
  var to = String(p.to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return mailOut_({ ok: false, error: "bad_to" });
  var t = MAIL_T[mailLang_(p.lang)];
  var v = { n: p.issueNumber, url: p.issueUrl, id: p.id };
  try {
    MailApp.sendEmail({ to: to, name: MAIL_SENDER_NAME, subject: mailFill_(t.subject, v), body: mailFill_(t.body, v) });
    return mailOut_({ ok: true });
  } catch (err) {
    return mailOut_({ ok: false, error: String(err && err.message || err) });
  }
}
