/**
 * Bilibili CDN 測速報告接收端（Google Apps Script 網頁應用程式）。
 * 測速 app 測完後 POST JSON 到本網址，本腳本會：
 *   1. 把 REPORT.md / summary.json 當附件寄給「部署者自己」（主旨含報告編號 #xxxxxxxx，方便搜尋）
 *   2. 另存一份到 Google 雲端硬碟資料夾「CDN SpeedTest Reports」
 *   3. 在試算表「CDN SpeedTest Log」新增一列（email、國家、ISP、頻寬、Gmail 連結、報告檔連結…）
 *   4. 若測試者留了 email，用部署者的 Gmail 寄一封確認信給測試者（依 app 語言；每日上限 DAILY_CONFIRM_LIMIT）
 *   5. 若帶了「必中獎邀請碼」：到 Neon 再驗證一次（未被作廢即有效），正式報告會累計使用次數
 * 另外提供 action=verify_invite：app 在「參加方式」頁即時驗證邀請碼與 email 是否相符（不需要自架伺服器）。
 *          action=log：app 的使用紀錄（安裝、執行、測速完成、發送…），寫進 Neon 的 app_events（npm run events:show 查看）。
 *          action=lotteries：進行中的抽獎（Neon 的 lotteries，npm run lottery:add 新增），app 在「測速目的」頁用 HTML 顯示。
 *
 * 設定：專案設定 → 指令碼屬性 → TOKEN（與 app 的 config.json 的 token 相同）。
 *       NEON_URL：Neon 的 Postgres 連線字串（postgresql://…），邀請碼功能用；設好後在編輯器執行 testNeon 確認連線。
 *       邀請碼的新增／作廢在本機：npm run invite:create / invite:delete / invite:show。
 *       SHEET_ID 會在第一次收到報告（或執行 testSend）時自動建立並寫入。
 * 部署：部署 → 新增部署作業 → 網頁應用程式；執行身分「我」、存取權「所有人」。
 *       修改後：管理部署作業 → 編輯 → 版本「新版本」→ 部署（網址不變）。
 */
const FOLDER_NAME = 'CDN SpeedTest Reports';
const SHEET_NAME = 'CDN SpeedTest Log';
const MAX_BYTES = 3 * 1024 * 1024;
const DAILY_CONFIRM_LIMIT = 30;  // 每日最多寄幾封確認信（防止 token 外流後被拿來亂寄信）
const SENDER_NAME = 'Overseas Video Speedup for bilibili';

const HEADER = ['收到時間', '報告編號', '測試模式', 'Email', '無償', '國家', '城市', 'ISP', 'IP', '網路類型',
                '下載 Mbps', '上傳 Mbps', '延遲 ms', 'B站頻寬上限 Mbps', '建議預設節點', '已登入', '語言', 'App 版本',
                '禮物卡', '確認信', 'Gmail 連結', '報告檔', '禮物卡已寄', '備註', '參加方式', '邀請碼'];

const EXT_URL_DEFAULT = 'https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch' +
  '?utm_source=cdn_speedtest_mail&utm_medium=email&utm_campaign=speedtest';

// 確認信文字（{gift}、{country}、{n}、{ext} 會被替換）
const CONFIRM = {
  'zh-TW': {
    subject: '🎉 謝謝你協助 Bilibili CDN 測速！',
    hello: '你好！', title: '謝謝你的協助！',
    intro: '你的 Bilibili CDN 測速報告已經收到了。你剛剛測了 {n} 個 B 站節點，這份結果會用來幫 {country} 的使用者找到更快、更穩的播放節點。',
    next: '接下來', s1: '作者會在幾天內確認你的測試結果', s2: '確認無誤後，{gift}會寄到這個信箱',
    gift_v: '價值 <b>{gift}</b> 的禮物卡', gift: '禮物卡',
    s2_lottery: '確認無誤後，你會參加{gift}抽獎，中獎的話會寄到這個信箱',
    badge: '🎫 你使用了必中獎邀請碼，確認後一定會收到禮物卡。',
    rid: '報告編號', cta: '在 Chrome 安裝擴充',
    ext: '這次測速是為了改善 Chrome 擴充「{ext}」，讓海外使用者看 B 站更順。',
    foot: '這封信由測速程式自動寄出。有任何問題，直接回覆這封信就可以了。',
  },
  'zh-CN': {
    subject: '🎉 谢谢你协助 Bilibili CDN 测速！',
    hello: '你好！', title: '谢谢你的协助！',
    intro: '你的 Bilibili CDN 测速报告已经收到了。你刚刚测了 {n} 个 B 站节点，这份结果会用来帮 {country} 的用户找到更快、更稳的播放节点。',
    next: '接下来', s1: '作者会在几天内确认你的测试结果', s2: '确认无误后，{gift}会发到这个邮箱',
    gift_v: '价值 <b>{gift}</b> 的礼品卡', gift: '礼品卡',
    s2_lottery: '确认无误后，你会参加{gift}抽奖，中奖的话会发到这个邮箱',
    badge: '🎫 你使用了必中奖邀请码，确认后一定会收到礼品卡。',
    rid: '报告编号', cta: '在 Chrome 安装扩展',
    ext: '这次测速是为了改善 Chrome 扩展「{ext}」，让海外用户看 B 站更顺畅。',
    foot: '这封邮件由测速程序自动发送。有任何问题，直接回复这封邮件就可以了。',
  },
  'en': {
    subject: '🎉 Thank you for running the Bilibili CDN speed test!',
    hello: 'Hi there,', title: 'Thank you so much!',
    intro: 'We have received your Bilibili CDN speed test report. You just tested {n} Bilibili servers — your results will help viewers in {country} get faster, smoother playback.',
    next: 'What happens next', s1: 'The author will verify your results within a few days',
    s2: 'Once verified, {gift} will be sent to this email address',
    gift_v: 'a <b>{gift}</b> gift card', gift: 'your gift card',
    s2_lottery: 'Once verified, you will be entered in the draw for {gift}; winners are notified at this address',
    badge: '🎫 You used a guaranteed-prize invite code — you will receive a gift card once your results are verified.',
    rid: 'Report ID', cta: 'Get the extension for Chrome',
    ext: 'This test helps improve the Chrome extension "{ext}", which makes Bilibili faster for viewers outside China.',
    foot: 'This email was sent automatically by the speed test app. Just reply if you have any questions.',
  },
  'ja': {
    subject: '🎉 Bilibili CDN 速度テストへのご協力ありがとうございました！',
    hello: 'こんにちは。', title: 'ご協力ありがとうございました！',
    intro: 'Bilibili CDN 速度テストのレポートを受け取りました。{n} 台の Bilibili サーバーを測定していただいた結果は、{country} のユーザーがより速く安定して再生できるサーバーを選ぶために使われます。',
    next: 'このあとの流れ', s1: '作者が数日以内にテスト結果を確認します', s2: '確認後、{gift}をこのメールアドレスにお送りします',
    gift_v: '<b>{gift}</b> 相当のギフトカード', gift: 'ギフトカード',
    s2_lottery: '確認後、{gift}の抽選に参加となります。当選された方にはこのアドレスにお知らせします',
    badge: '🎫 当選確定招待コードをご利用いただきました。結果の確認後、必ずギフトカードをお送りします。',
    rid: 'レポート ID', cta: 'Chrome 拡張機能を入手',
    ext: 'このテストは Chrome 拡張機能「{ext}」の改善に使われ、海外での Bilibili 視聴をより快適にします。',
    foot: 'このメールは速度テストアプリから自動送信されています。ご不明な点はこのメールに返信してください。',
  },
  'ko': {
    subject: '🎉 Bilibili CDN 속도 테스트에 협조해 주셔서 감사합니다!',
    hello: '안녕하세요.', title: '도와주셔서 정말 감사합니다!',
    intro: 'Bilibili CDN 속도 테스트 보고서를 받았습니다. 방금 {n}개의 Bilibili 서버를 측정해 주셨고, 이 결과는 {country} 사용자들이 더 빠르고 안정적으로 재생할 수 있도록 하는 데 사용됩니다.',
    next: '다음 단계', s1: '작성자가 며칠 내로 테스트 결과를 확인합니다', s2: '확인 후 {gift}을(를) 이 이메일 주소로 보내 드립니다',
    gift_v: '<b>{gift}</b> 상당의 기프트 카드', gift: '기프트 카드',
    s2_lottery: '확인 후 {gift} 추첨에 참여하게 되며, 당첨 시 이 주소로 안내해 드립니다',
    badge: '🎫 당첨 확정 초대 코드를 사용하셨습니다. 결과 확인 후 반드시 기프트 카드를 보내 드립니다.',
    rid: '보고서 ID', cta: 'Chrome 확장 프로그램 받기',
    ext: '이번 테스트는 Chrome 확장 프로그램 "{ext}"을(를) 개선하여 해외 사용자의 Bilibili 시청을 더 원활하게 하는 데 쓰입니다.',
    foot: '이 메일은 속도 테스트 앱에서 자동으로 발송되었습니다. 문의 사항은 이 메일에 회신해 주세요.',
  },
};

/** 國家代碼 → 當地語言的國名（JP → 日本 / Japan / 일본）；不支援時回傳原代碼 */
function regionName(code, lang) {
  try { return new Intl.DisplayNames([lang || 'en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
}

function fill(s, v) { return s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

/** 確認信（HTML + 純文字）。樣式全部 inline，Gmail / Outlook / 手機都能正常顯示 */
function confirmMail(lang, g, rid, country, n, extUrl, guaranteed) {
  const c = CONFIRM[lang] || CONFIRM['en'];
  const colon = /^(zh|ja)/.test(lang || '') ? '：' : ': ';
  country = regionName(country, lang);
  const giftHtml = g ? fill(c.gift_v, { gift: esc(g) }) : c.gift;
  const v = { n: n || '', country: esc(country || ''), ext: esc(SENDER_NAME), gift: giftHtml };
  const url = extUrl || EXT_URL_DEFAULT;
  const pink = '#FB7299';
  const s2 = guaranteed ? c.s2 : c.s2_lottery;
  const step = (i, s) => `
      <tr><td style="padding:6px 0;vertical-align:top;width:34px">
        <div style="width:26px;height:26px;border-radius:13px;background:${pink};color:#fff;font-weight:bold;
                    font-size:14px;line-height:26px;text-align:center">${i}</div></td>
      <td style="padding:8px 0 6px 8px;font-size:15px;color:#18191C;line-height:1.5">${s}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#F4F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;
       border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',
       'Hiragino Sans','Malgun Gothic',sans-serif">
  <tr><td style="background-color:${pink};background:linear-gradient(135deg,#FB7299,#FF9DB8);padding:36px 32px;
                 text-align:center;color:#fff">
    <div style="font-size:44px;line-height:1">🎉</div>
    <div style="font-size:24px;font-weight:bold;margin-top:12px">${c.title}</div>
  </td></tr>
  <tr><td style="padding:28px 32px 8px">
    <p style="margin:0 0 12px;font-size:15px;color:#18191C">${c.hello}</p>
    <p style="margin:0;font-size:15px;color:#18191C;line-height:1.7">${fill(c.intro, v)}</p>
  </td></tr>
  <tr><td style="padding:16px 32px 8px">
    <div style="background:#FFF1F5;border-radius:12px;padding:16px 20px">
      <div style="font-size:15px;font-weight:bold;color:${pink};margin-bottom:4px">${c.next}</div>
      <table role="presentation" cellpadding="0" cellspacing="0">${step(1, c.s1)}${step(2, fill(s2, v))}</table>
    </div>${guaranteed ? `
    <div style="margin-top:12px;background:#E7F6EE;border:1px solid #2BA471;border-radius:12px;padding:12px 16px;
                font-size:14px;color:#1E7A50;line-height:1.6">${c.badge}</div>` : ''}
  </td></tr>
  <tr><td style="padding:20px 32px 4px;text-align:center">
    <a href="${esc(url)}" style="display:inline-block;background:${pink};color:#fff;text-decoration:none;
       font-size:15px;font-weight:bold;padding:12px 28px;border-radius:24px">🧩 ${c.cta}</a>
    <p style="margin:14px 0 0;font-size:13px;color:#61666D;line-height:1.6">${fill(c.ext, v)}</p>
  </td></tr>
  <tr><td style="padding:22px 32px 28px;border-top:1px solid #F1F2F3">
    <p style="margin:0;font-size:12px;color:#9499A0;line-height:1.6">${c.foot}<br>${c.rid}${colon}#${esc(rid)}</p>
    <p style="margin:10px 0 0;font-size:12px;color:#9499A0">— ${esc(SENDER_NAME)}</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const giftPlain = g ? fill(c.gift_v, { gift: g }).replace(/<\/?b>/g, '') : c.gift;
  const plain = [c.hello, '', c.title, '', fill(c.intro, { n: n || '', country: country || '', ext: SENDER_NAME }), '',
                 c.next + colon, '1. ' + c.s1, '2. ' + fill(s2, { gift: giftPlain }),
                 guaranteed ? c.badge : '', '',
                 c.cta + colon + url, '', c.foot, c.rid + colon + '#' + rid, '', '— ' + SENDER_NAME].join('\n');
  return { subject: c.subject, html, plain };
}

/** 在編輯器執行：把各語言確認信寄給自己預覽（不寫試算表、不計入每日上限） */
function previewConfirm() {
  const me = Session.getEffectiveUser().getEmail();
  Object.keys(CONFIRM).forEach(lang => {
    [false, true].forEach(guaranteed => {
      const mail = confirmMail(lang, 'Amazon USD 10', 'preview1', 'JP', 299, null, guaranteed);
      MailApp.sendEmail({ to: me, subject: `[預覽${guaranteed ? '・必中' : '・抽獎'}] ` + mail.subject, body: mail.plain,
                          htmlBody: mail.html, name: SENDER_NAME });
    });
  });
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BYTES) return out({ ok: false, err: 'too large' });
    const body = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TOKEN');
    if (!token || body.token !== token) return out({ ok: false, err: 'bad token' });
    if (body.action === 'verify_invite') return out(verifyInvite(body.email, body.code));
    if (body.action === 'log') return out(logEvent(body));
    if (body.action === 'lotteries') return out(activeLotteries(body.lang));
    // 只有測速報告才寄信、寫試算表；認不得的 action 一律拒絕，不要當成報告（舊版 app 送報告時沒帶 action）
    if (body.action && body.action !== 'report') return out({ ok: false, err: 'unknown action' });
    return out(handleReport(body));
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function handleReport(body) {
  const m = body.meta || {};
  const test = !!body.test_mode;
  const rid = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmm');
  const base = `${test ? 'TEST-' : ''}${m.country || 'XX'}-${stamp}-${rid}`;
  const email = isEmail(body.email) ? String(body.email).trim() : '';
  const g = body.gift ? `${body.gift.vendor || ''} ${body.gift.amount || ''}`.trim() : '';

  // 5) 必中獎邀請碼：以伺服器端驗證為準（app 只會送出已驗證成功的碼）；正式報告會累計使用次數
  const code = email ? normCode(body.invite_code) : '';
  let guaranteed = false, inviteNote = '';
  if (code) {
    try {
      guaranteed = test ? checkInvite(email, code) : recordInviteReport(email, code, rid);
      inviteNote = guaranteed ? code : `${code}（驗證失敗）`;
    } catch (err) {
      inviteNote = `${code}（無法驗證：${String(err).slice(0, 80)}）`;
    }
  }
  const join = !email ? '純測速' : (guaranteed ? '必中獎' : '抽獎');

  // 1) 寄給自己（附件）
  const report = Utilities.newBlob(String(body.report || ''), 'text/markdown', `${base}-REPORT.md`);
  const summary = Utilities.newBlob(JSON.stringify(body.summary || {}, null, 1), 'application/json',
                                    `${base}-summary.json`);
  const subject = `[CDN 測速]${test ? '[TEST]' : ''}${guaranteed ? '[必中]' : ''} ${m.country || '?'} ${m.city || ''} ｜ ${m.isp || ''} ｜ ` +
                  `${m.network || ''} ｜ ${email || '無 email'} #${rid}`;
  const text = [
    String(body.text || ''),
    '',
    `Email：${email || (body.no_compensation ? '（純測速，不參加抽獎）' : '（未提供）')}`,
    `參加方式：${join}${inviteNote ? `（邀請碼 ${inviteNote}）` : ''}`,
    `禮物卡：${g || '（未設定）'}`,
    `IP：${m.ip || '-'}`,
    `測試時間：${m.time || '-'}`,
    `語言：${body.lang || '-'}　App 版本：${body.app_version || '-'}`,
    `報告編號：#${rid}`,
  ].join('\n');
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject, body: text, name: 'CDN SpeedTest',
                      attachments: [report, summary] });

  // 2) 雲端硬碟
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  const rf = folder.createFile(report);
  folder.createFile(summary);

  // 4) 確認信給測試者
  let confirm = '';
  if (email) confirm = sendConfirm(email, body.lang, g, rid, m.country, m.n_nodes, body.extension_url, guaranteed);

  // 3) 試算表
  const gmail = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('subject:' + rid)}`;
  sheet().appendRow([new Date(), rid, test ? 'TEST' : '', email, body.no_compensation ? '是' : '',
                     m.country || '', m.city || '', m.isp || '', m.ip || '', m.network || '',
                     num(m.down_mbps), num(m.up_mbps), num(m.latency_ms), num(m.ceiling), m.default || '',
                     m.login ? '是' : '否', body.lang || '', body.app_version || '', g, confirm, gmail, rf.getUrl(),
                     '', '', join, inviteNote]);
  return { ok: true, rid, confirm, guaranteed };
}

function sendConfirm(email, lang, g, rid, country, nNodes, extUrl, guaranteed) {
  const props = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  const key = 'CONFIRM_' + day;
  const sent = Number(props.getProperty(key) || 0);
  if (sent >= DAILY_CONFIRM_LIMIT) return '超過每日上限，未寄';
  const mail = confirmMail(lang, g, rid, country, nNodes, extUrl, guaranteed);
  MailApp.sendEmail({ to: email, subject: mail.subject, body: mail.plain, htmlBody: mail.html, name: SENDER_NAME });
  props.setProperty(key, String(sent + 1));
  return '已寄';
}

function sheet() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty('SHEET_ID', ss.getId());
  }
  const sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  } else if (sh.getLastColumn() < HEADER.length) {  // 舊版表頭：補上後來新增的欄位
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  }
  return sh;
}

// ── 必中獎邀請碼（Neon Postgres，經由 Neon 的 HTTP SQL 端點，不需要自架伺服器） ─────────
const INVITE_RATE = 10;  // 同一個 email 每 10 分鐘最多驗證幾次
const INVITE_RATE_ALL = 60;  // 全部合計每 10 分鐘最多幾次（防止暴力猜碼）

/** 執行一句 SQL（$1、$2… 參數化），回傳 rows（物件陣列） */
function neonQuery(sql, params) {
  const url = PropertiesService.getScriptProperties().getProperty('NEON_URL');
  if (!url) throw new Error('NEON_URL not set');
  const host = (url.match(/@([^/:?]+)/) || [])[1];
  if (!host) throw new Error('bad NEON_URL');
  const res = UrlFetchApp.fetch('https://' + host.replace(/^[^.]+\./, 'api.') + '/sql', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'Neon-Connection-String': url },
    payload: JSON.stringify({ query: sql, params: params || [] }),
  });
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) throw new Error('neon ' + res.getResponseCode() + ': ' + body.slice(0, 200));
  return JSON.parse(body).rows || [];
}

function normCode(c) { return String(c || '').replace(/[\s-]/g, '').toUpperCase(); }

/** email + 邀請碼相符且尚未被作廢（npm run invite:delete）就有效；有效期間可無限次使用。順便記錄最後驗證時間 */
function checkInvite(email, code) {
  const rows = neonQuery('update invite_codes set last_verified_at = now() where code = $1 and lower(email) = $2 ' +
                         'and revoked_at is null returning code', [normCode(code), String(email).trim().toLowerCase()]);
  return rows.length > 0;
}

/** 正式報告送出時：仍有效就累計報告次數、記下最後一份報告編號（不會讓邀請碼失效） */
function recordInviteReport(email, code, rid) {
  const rows = neonQuery('update invite_codes set report_count = report_count + 1, last_report_id = $3, ' +
                         'last_report_at = now(), last_verified_at = now() where code = $1 and lower(email) = $2 ' +
                         'and revoked_at is null returning code',
                         [normCode(code), String(email).trim().toLowerCase(), rid]);
  return rows.length > 0;
}

/** app 的「參加方式」頁呼叫：{ ok, valid } */
function verifyInvite(email, code) {
  if (!isEmail(email) || !normCode(code)) return { ok: true, valid: false };
  const cache = CacheService.getScriptCache();
  const hit = k => { const n = Number(cache.get(k) || 0) + 1; cache.put(k, String(n), 600); return n; };
  if (hit('inv:' + String(email).trim().toLowerCase()) > INVITE_RATE || hit('inv:*') > INVITE_RATE_ALL) {
    return { ok: false, err: 'too many attempts' };
  }
  try {
    return { ok: true, valid: checkInvite(email, code) };
  } catch (err) {
    return { ok: false, err: 'db' };
  }
}

// ── 使用紀錄（Neon 的 app_events，資料表由本機 npm run events:show 建立） ─────────
// install 安裝（這台電腦第一次執行）、run 執行、free 純測速、lottery 抽獎、guaranteed 必中抽獎、
// test_done 測速完成、send 發送、custom_list 更新自訂節點列表
const EVENT_TYPES = ['install', 'run', 'free', 'lottery', 'guaranteed', 'test_done', 'send', 'custom_list'];
const EVENT_RATE = 30;     // 同一台電腦（install_id）每 10 分鐘最多幾筆
const EVENT_RATE_ALL = 1000;  // 全部合計每 10 分鐘最多幾筆

function logEvent(b) {
  const type = String(b.type || '');
  if (EVENT_TYPES.indexOf(type) < 0) return { ok: false, err: 'bad type' };
  const iid = String(b.install_id || '').replace(/[^0-9a-f-]/gi, '').slice(0, 40);
  const cache = CacheService.getScriptCache();
  const hit = k => { const n = Number(cache.get(k) || 0) + 1; cache.put(k, String(n), 600); return n; };
  if (hit('ev:' + iid) > EVENT_RATE || hit('ev:*') > EVENT_RATE_ALL) return { ok: false, err: 'too many events' };
  const country = String(b.country || '').toUpperCase();
  try {
    neonQuery('insert into app_events (type, country, email, install_id, app_version, lang, test) ' +
              'values ($1, $2, $3, $4, $5, $6, $7)',
              [type, /^[A-Z]{2}$/.test(country) ? country : null,
               isEmail(b.email) ? String(b.email).trim().toLowerCase() : null, iid || null,
               String(b.app_version || '').slice(0, 20) || null, String(b.lang || '').slice(0, 10) || null,
               !!b.test_mode]);
    return { ok: true };
  } catch (err) {
    return { ok: false, err: 'db' };
  }
}

// ── 進行中的抽獎（Neon 的 lotteries，資料表由本機 npm run lottery:add 建立） ─────────
const LOTTERY_LANG_FALLBACK = ['en', 'zh-TW'];

/** 現在介於 starts_at 與 ends_at、且沒有提前結束的抽獎中，最新開始的那一個（期間重疊時只顯示它；開始時間相同取後新增的），
 *  取 app 語言的 HTML（缺的話依序退回 en、zh-TW）。快取 5 分鐘 */
function activeLotteries(lang) {
  lang = String(lang || 'en').slice(0, 10);
  const cache = CacheService.getScriptCache();
  const key = 'lot:' + lang;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  let res;
  try {
    const rows = neonQuery('select id, title, html from lotteries where ended_at is null and now() >= starts_at ' +
                           'and now() < ends_at order by starts_at desc, id desc limit 1');
    const items = rows.map(r => {
      const h = r.html || {};
      const l = [lang].concat(LOTTERY_LANG_FALLBACK).find(k => h[k]) || Object.keys(h)[0];
      return { id: r.id, title: r.title, html: h[l] || '' };
    }).filter(x => x.html);
    res = { ok: true, items };
  } catch (err) {
    return { ok: false, err: 'db' };
  }
  cache.put(key, JSON.stringify(res), 300);
  return res;
}

/** 在編輯器執行：確認 NEON_URL 連得上，並印出邀請碼數量（資料表由本機 npm run invite:create 建立） */
function testNeon() {
  const r = neonQuery('select count(*)::int as n, count(*) filter (where revoked_at is null)::int as valid ' +
                      'from invite_codes')[0];
  Logger.log(`Neon 連線正常：邀請碼 ${r.n} 組（有效 ${r.valid}）`);
}

function isEmail(s) { return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim()); }
function num(x) { return (x === null || x === undefined || x === '') ? '' : Number(x); }

function doGet() {
  return out({ ok: true, service: 'cdn-speedtest-receiver' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 在編輯器手動執行一次：完成 Gmail / 雲端硬碟 / 試算表授權，寄測試信給自己、寫一列 TEST 到試算表，
 * 並把確認信寄給自己（模擬測試者留了 email）。執行紀錄會印出試算表網址。
 */
function testSend() {
  const me = Session.getEffectiveUser().getEmail();
  const res = handleReport({
    test_mode: true, app_version: 'test', lang: 'zh-TW', text: '這是 testSend 測試信',
    email: me, no_compensation: false, gift: { vendor: 'Test Card', amount: 'USD 0' },
    meta: { country: 'TEST', city: '', isp: 'test isp', ip: '0.0.0.0', network: 'Wi-Fi',
            time: new Date().toISOString(), down_mbps: 1, up_mbps: 1, latency_ms: 1, ceiling: 1,
            default: 'upos-sz-mirror08ct.bilivideo.com', login: true },
    report: '# test report', summary: { test: true },
  });
  Logger.log(JSON.stringify(res));
  Logger.log('試算表：' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl());
}
