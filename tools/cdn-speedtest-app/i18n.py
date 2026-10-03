# GUI 多語系字串：zh-TW / zh-CN / en / ja / ko。隱私聲明固定英文（PRIVACY_EN）。
LANGS = [("zh-TW", "繁體中文"), ("zh-CN", "简体中文"), ("en", "English"), ("ja", "日本語"), ("ko", "한국어")]

EXT_NAME = "Overseas Video Speedup for bilibili"
# 擴充在各語言商店上的名稱（src/_locales 的 extName）；擴充沒有的語言用英文
EXT_NAMES = {"zh-TW": "海外影片加速 for bilibili", "zh-CN": "海外视频加速 for bilibili"}


def ext_name(lang):
    return EXT_NAMES.get(lang, EXT_NAME)


PRIVACY_EN = """Privacy Notice — Bilibili CDN Speed Test

This tool is made by the developer of the browser extension "{ext}". It measures how fast Bilibili's video CDN servers are from your network, so the extension can recommend better servers for users in your country.

WHAT IS COLLECTED (only if you click "Send" at the end)
• Your public IP address, and the country, city and ISP/network name derived from it (via ipinfo.io).
• Network type: wired / Wi-Fi / possibly mobile, plus Wi-Fi standard, signal strength and link rate. Your Wi-Fi name (SSID) is NOT collected.
• General internet speed (download, upload, latency) measured against Cloudflare.
• Speed test results for Bilibili CDN servers (speed, response time, errors), the test videos used, and DNS resolver information.
• App version, the language you chose, and the time of the test.
• Your email address — only if you choose to join the prize draw.

USAGE LOG (sent automatically once you agree to this notice, even if you don't click "Send")
• When you continue past this page (noting whether it's the first time on this computer), and when you start a test, finish a test, send the report, or add nodes to the extension's custom node list.
• Each entry contains only: the event type, your country (derived from your IP), the time, the app version and language, a random ID generated for this computer (not linked to your identity), and your email address only if you entered it for the prize draw.

WHAT IS NOT COLLECTED
• Your Bilibili account or password. If you log in with the QR code, the login session stays in this computer's memory only, is used solely to request HD video streams for the test, and is discarded when the app closes. Nothing about your account is sent.
• Your files, browsing history, or any other personal data.

HOW IT IS USED
• Test results are used only to develop and improve the extension (choosing and ranking CDN servers per country). After sending, the 10 recommended servers are added to the extension's custom node list in your browser (on this computer only).
• The usage log is used only to count how many people use the app and where, so the developer can improve it.
• Your email (if provided) is used only to send you a confirmation and, after the results are verified, the gift card. It is never used for marketing and never shared.
• Data is sent to the developer's Google account (Google Apps Script, Gmail, Google Drive / Sheets). It is not sold or shared with third parties.

SERVICES THIS APP CONTACTS DURING THE TEST
Bilibili, ipinfo.io, ip-api.com and proxycheck.io (VPN check), Cloudflare (speed.cloudflare.com) or Linode speed-test servers, Google Public DNS (dns.google), and Google Apps Script (usage log, invite code check, and the report when you click "Send").

You can stop the test at any time; no test results are sent unless you click "Send". After a successful upload, the local copy of the results is deleted when you close the app. To have your data deleted, contact the developer via the extension's support page:
{support}

Extension: {ext_url}
"""

S = {
    "title": {"zh-TW": "Bilibili CDN 測速", "zh-CN": "Bilibili CDN 测速", "en": "Bilibili CDN Speed Test",
              "ja": "Bilibili CDN 速度テスト", "ko": "Bilibili CDN 속도 테스트"},
    "language": {"zh-TW": "語言", "zh-CN": "语言", "en": "Language", "ja": "言語", "ko": "언어"},
    "privacy": {"zh-TW": "隱私聲明", "zh-CN": "隐私声明", "en": "Privacy notice",
                "ja": "プライバシーに関する通知", "ko": "개인정보 처리 안내"},
    "agree": {"zh-TW": "我已閱讀並同意隱私聲明", "zh-CN": "我已阅读并同意隐私声明", "en": "I have read and agree to the privacy notice",
              "ja": "プライバシーに関する通知を読み、同意します", "ko": "개인정보 처리 안내를 읽었으며 이에 동의합니다"},
    "ext_link": {"zh-TW": "擴充功能【{name}】線上應用程式商店", "zh-CN": "扩展程序【{name}】应用商店",
                 "en": "Extension [{name}] on the web stores", "ja": "拡張機能【{name}】ウェブストア",
                 "ko": "확장 프로그램 【{name}】 웹 스토어"},
    "test_mode": {"zh-TW": "開發者測試模式（不實際測速，只跑 5 秒假進度）", "zh-CN": "开发者测试模式（不实际测速，只跑 5 秒假进度）",
                  "en": "Developer test mode (no real test, 5-second fake progress)",
                  "ja": "開発者テストモード（実測せず、5 秒の疑似進行のみ）",
                  "ko": "개발자 테스트 모드 (실제 측정 없음, 5초 가짜 진행)"},
    "next": {"zh-TW": "下一步", "zh-CN": "下一步", "en": "Next", "ja": "次へ", "ko": "다음"},
    "back": {"zh-TW": "上一步", "zh-CN": "上一步", "en": "Back", "ja": "戻る", "ko": "이전"},
    "close": {"zh-TW": "關閉", "zh-CN": "关闭", "en": "Close", "ja": "閉じる", "ko": "닫기"},
    "test_banner": {"zh-TW": "【測試模式】", "zh-CN": "【测试模式】", "en": "[TEST MODE]", "ja": "【テストモード】",
                    "ko": "[테스트 모드]"},

    # 第 2 頁：測速目的（純測速／抽獎＋必中獎邀請碼）
    "purpose_title": {"zh-TW": "你為了什麼目的測速？", "zh-CN": "你为了什么目的测速？", "en": "Why are you running this test?",
                      "ja": "テストの目的を選んでください", "ko": "테스트 목적을 선택해 주세요"},
    "opt_free_desc": {
        "zh-TW": "測完發送後，最快的 10 個節點會自動加入擴充的「自訂節點列表」。網路檢查只做參考，不限網速，也不限 VPN。",
        "zh-CN": "测完发送后，最快的 10 个节点会自动加入扩展的「自定义节点列表」。网络检查只做参考，不限网速，也不限 VPN。",
        "en": "After you send the results, the 10 fastest servers are added to the extension's \"Custom node list\". The network check is for reference only — no minimum speed, and VPNs are allowed.",
        "ja": "結果を送信すると、最も速い 10 個のサーバーが拡張機能の「カスタムノードリスト」に追加されます。ネットワークチェックは参考のみで、速度や VPN の制限はありません。",
        "ko": "결과를 보내면 가장 빠른 서버 10개가 확장 프로그램의 \"사용자 지정 노드 목록\"에 추가됩니다. 네트워크 확인은 참고용이며 속도·VPN 제한이 없습니다."},
    "gift_body": {
        "zh-TW": "為了感謝你協助測試，留下 email 就能參加抽獎，獎品是價值 {gift} 的禮物卡。有「必中獎邀請碼」的話，確認測試結果後一定會收到。",
        "zh-CN": "为了感谢你协助测试，留下 email 就能参加抽奖，奖品是价值 {gift} 的礼品卡。有「必中奖邀请码」的话，确认测试结果后一定会收到。",
        "en": "As thanks for running this test, leave your email to enter a prize draw for a {gift} gift card. With a guaranteed-prize invite code, you'll definitely get one once your results are verified.",
        "ja": "ご協力のお礼として、メールアドレスを登録すると {gift} 相当のギフトカードの抽選に参加できます。「当選確定招待コード」をお持ちの方は、結果の確認後に必ずお受け取りいただけます。",
        "ko": "협조에 대한 감사의 표시로, 이메일을 남기시면 {gift} 상당의 기프트 카드 추첨에 참여할 수 있습니다. \"당첨 확정 초대 코드\"가 있으면 결과 확인 후 반드시 받으실 수 있습니다."},
    "gift_body_generic": {
        "zh-TW": "為了感謝你協助測試，留下 email 就能參加禮物卡抽獎（品牌與金額之後以 email 通知）。有「必中獎邀請碼」的話，確認測試結果後一定會收到。",
        "zh-CN": "为了感谢你协助测试，留下 email 就能参加礼品卡抽奖（品牌与金额之后以 email 通知）。有「必中奖邀请码」的话，确认测试结果后一定会收到。",
        "en": "As thanks for running this test, leave your email to enter a gift card prize draw (brand and amount confirmed by email). With a guaranteed-prize invite code, you'll definitely get one once your results are verified.",
        "ja": "ご協力のお礼として、メールアドレスを登録するとギフトカードの抽選に参加できます（ブランドと金額は後ほどメールでお知らせします）。「当選確定招待コード」をお持ちの方は、結果の確認後に必ずお受け取りいただけます。",
        "ko": "협조에 대한 감사의 표시로, 이메일을 남기시면 기프트 카드 추첨에 참여할 수 있습니다(브랜드와 금액은 추후 이메일로 안내). \"당첨 확정 초대 코드\"가 있으면 결과 확인 후 반드시 받으실 수 있습니다."},
    "gift_detecting": {"zh-TW": "正在偵測你所在的國家…", "zh-CN": "正在检测你所在的国家…", "en": "Detecting your country…",
                       "ja": "国を検出しています…", "ko": "국가를 확인하는 중…"},
    "email": {"zh-TW": "Email", "zh-CN": "Email", "en": "Email", "ja": "メールアドレス", "ko": "이메일"},
    "opt_free": {"zh-TW": "單純測試／建立擴充「自訂節點列表」", "zh-CN": "单纯测试／创建扩展「自定义节点列表」",
                 "en": "Just test / build the extension's \"Custom node list\"",
                 "ja": "テストのみ／拡張機能の「カスタムノードリスト」を作成",
                 "ko": "테스트만 / 확장 프로그램의 \"사용자 지정 노드 목록\" 만들기"},
    "opt_lottery": {"zh-TW": "參加抽獎", "zh-CN": "参加抽奖", "en": "Join the prize draw", "ja": "抽選に参加する",
                    "ko": "추첨에 참여"},
    "invite": {"zh-TW": "必中獎邀請碼（選填）", "zh-CN": "必中奖邀请码（选填）", "en": "Guaranteed-prize invite code (optional)",
               "ja": "当選確定招待コード（任意）", "ko": "당첨 확정 초대 코드 (선택)"},
    "invite_verify": {"zh-TW": "驗證", "zh-CN": "验证", "en": "Verify", "ja": "確認", "ko": "확인"},
    "invite_checking": {"zh-TW": "驗證中…", "zh-CN": "验证中…", "en": "Verifying…", "ja": "確認中…", "ko": "확인 중…"},
    "invite_ok": {"zh-TW": "✓  邀請碼驗證成功！確認測試結果後，你一定會收到禮物卡。",
                  "zh-CN": "✓  邀请码验证成功！确认测试结果后，你一定会收到礼品卡。",
                  "en": "✓  Invite code verified! You'll receive a gift card once your results are verified.",
                  "ja": "✓  招待コードを確認しました！テスト結果の確認後、必ずギフトカードをお送りします。",
                  "ko": "✓  초대 코드가 확인되었습니다! 결과 확인 후 반드시 기프트 카드를 보내 드립니다."},
    "invite_bad": {"zh-TW": "邀請碼與 email 對不上，或已經失效。你仍然可以繼續，會以一般抽獎參加。",
                   "zh-CN": "邀请码与 email 对不上，或已经失效。你仍然可以继续，会以普通抽奖参加。",
                   "en": "This invite code doesn't match the email, or is no longer valid. You can still continue — you'll join the regular draw.",
                   "ja": "招待コードがメールアドレスと一致しないか、すでに無効になっています。このまま続行すると通常の抽選に参加します。",
                   "ko": "초대 코드가 이메일과 일치하지 않거나 이미 만료되었습니다. 계속 진행하면 일반 추첨으로 참여합니다."},
    "invite_err": {"zh-TW": "目前無法驗證邀請碼（{err}）。你仍然可以繼續，會以一般抽獎參加。",
                   "zh-CN": "目前无法验证邀请码（{err}）。你仍然可以继续，会以普通抽奖参加。",
                   "en": "The invite code couldn't be verified right now ({err}). You can still continue — you'll join the regular draw.",
                   "ja": "現在、招待コードを確認できません（{err}）。このまま続行すると通常の抽選に参加します。",
                   "ko": "지금은 초대 코드를 확인할 수 없습니다 ({err}). 계속 진행하면 일반 추첨으로 참여합니다."},
    "invite_need_email": {"zh-TW": "請先填寫有效的 email，再驗證邀請碼。", "zh-CN": "请先填写有效的 email，再验证邀请码。",
                          "en": "Please enter a valid email first, then verify the code.",
                          "ja": "先に有効なメールアドレスを入力してから、コードを確認してください。",
                          "ko": "먼저 올바른 이메일을 입력한 후 코드를 확인해 주세요."},
    "email_invalid": {"zh-TW": "請輸入有效的 email。", "zh-CN": "请输入有效的 email。", "en": "Please enter a valid email.",
                      "ja": "有効なメールアドレスを入力してください。", "ko": "올바른 이메일을 입력해 주세요."},
    "join_lottery": {"zh-TW": "參加抽獎", "zh-CN": "参加抽奖", "en": "prize draw", "ja": "抽選に参加", "ko": "추첨 참여"},
    "join_invite": {"zh-TW": "必中獎邀請碼 ✓", "zh-CN": "必中奖邀请码 ✓", "en": "guaranteed-prize code ✓",
                    "ja": "当選確定コード ✓", "ko": "당첨 확정 코드 ✓"},

    # 第 3 頁：QR 登入
    "login_title": {"zh-TW": "用 Bilibili App 掃描登入", "zh-CN": "用 Bilibili App 扫码登录", "en": "Log in with the Bilibili app",
                    "ja": "Bilibili アプリでスキャンしてログイン", "ko": "Bilibili 앱으로 스캔하여 로그인"},
    "login_desc": {"zh-TW": "測速需要以 1080P 以上畫質進行，必須登入。登入資訊只留在這台電腦的記憶體，不會傳送。",
                   "zh-CN": "测速需要以 1080P 以上画质进行，必须登录。登录信息只保留在这台电脑的内存中，不会发送。",
                   "en": "The test runs at 1080P or higher, so logging in is required. Your login stays in this computer's memory and is never sent.",
                   "ja": "テストは 1080P 以上の画質で行うため、ログインが必要です。ログイン情報はこの PC のメモリ内にのみ保持され、送信されません。",
                   "ko": "테스트는 1080P 이상 화질로 진행되므로 로그인이 필요합니다. 로그인 정보는 이 컴퓨터의 메모리에만 있으며 전송되지 않습니다."},
    "qr_generating": {"zh-TW": "產生 QR code 中…", "zh-CN": "生成二维码中…", "en": "Generating QR code…",
                      "ja": "QR コードを生成中…", "ko": "QR 코드 생성 중…"},
    "qr_waiting": {"zh-TW": "等待掃描…", "zh-CN": "等待扫码…", "en": "Waiting for scan…", "ja": "スキャン待ち…",
                   "ko": "스캔 대기 중…"},
    "qr_scanned": {"zh-TW": "已掃描，請在手機上確認", "zh-CN": "已扫码，请在手机上确认", "en": "Scanned — please confirm on your phone",
                   "ja": "スキャンしました。スマートフォンで確認してください", "ko": "스캔됨 — 휴대폰에서 확인해 주세요"},
    "qr_expired": {"zh-TW": "QR code 已過期，重新產生…", "zh-CN": "二维码已过期，重新生成…", "en": "QR code expired, regenerating…",
                   "ja": "QR コードの期限切れ。再生成中…", "ko": "QR 코드가 만료되어 다시 생성 중…"},
    "qr_neterr": {"zh-TW": "連線失敗，5 秒後重試", "zh-CN": "连接失败，5 秒后重试", "en": "Network error, retrying in 5 s",
                  "ja": "接続エラー。5 秒後に再試行します", "ko": "연결 오류, 5초 후 재시도"},

    # 第 4 頁：測速
    "test_title": {"zh-TW": "測速中，請保持連線、不要開 VPN", "zh-CN": "测速中，请保持联网、不要开 VPN",
                   "en": "Testing — stay online, VPN off", "ja": "テスト中 — 接続を維持し、VPN はオフに",
                   "ko": "테스트 중 — 연결을 유지하고 VPN은 끄세요"},
    "test_desc": {"zh-TW": "預計約需 {min} 分鐘，期間請盡量不要看影片或下載，也不要關閉視窗。",
                  "zh-CN": "预计约需 {min} 分钟，期间请尽量不要看视频或下载，也不要关闭窗口。",
                  "en": "Expected to take about {min} minutes. Please avoid streaming or downloading, and keep this window open.",
                  "ja": "約 {min} 分かかる見込みです。その間は動画視聴やダウンロードを控え、ウィンドウを閉じないでください。",
                  "ko": "약 {min}분 걸릴 예정입니다. 그동안 동영상 시청이나 다운로드를 삼가고 창을 닫지 마세요."},
    "detected": {"zh-TW": "偵測到：", "zh-CN": "检测到：", "en": "Detected: ", "ja": "検出：", "ko": "감지됨: "},
    "dns_sys": {"zh-TW": "系統 DNS", "zh-CN": "系统 DNS", "en": "System DNS", "ja": "システム DNS", "ko": "시스템 DNS"},
    "dns_doh": {"zh-TW": "Google DoH", "zh-CN": "Google DoH", "en": "Google DoH", "ja": "Google DoH", "ko": "Google DoH"},
    "elapsed": {"zh-TW": "已經過", "zh-CN": "已用时", "en": "Elapsed", "ja": "経過", "ko": "경과"},
    "remaining": {"zh-TW": "預估剩餘 ≈ {m} 分鐘", "zh-CN": "预计剩余 ≈ {m} 分钟", "en": "≈ {m} min remaining",
                  "ja": "残り約 {m} 分", "ko": "약 {m}분 남음"},
    "stop_close": {"zh-TW": "停止並關閉", "zh-CN": "停止并关闭", "en": "Stop & close", "ja": "停止して閉じる", "ko": "중지하고 닫기"},
    "stop_q_title": {"zh-TW": "停止測速", "zh-CN": "停止测速", "en": "Stop test", "ja": "テストを停止", "ko": "테스트 중지"},
    "stop_q": {"zh-TW": "確定要停止測速並關閉嗎？目前的結果不會發送。", "zh-CN": "确定要停止测速并关闭吗？当前结果不会发送。",
               "en": "Stop the test and close? Nothing will be sent.", "ja": "テストを停止して閉じますか？結果は送信されません。",
               "ko": "테스트를 중지하고 닫을까요? 결과는 전송되지 않습니다."},
    "st_detect": {"zh-TW": "偵測網路環境", "zh-CN": "检测网络环境", "en": "Detecting network", "ja": "ネットワークを検出",
                  "ko": "네트워크 확인"},
    "st_env": {"zh-TW": "量測網路與總頻寬", "zh-CN": "测量网络与总带宽", "en": "Measuring bandwidth", "ja": "回線速度を測定",
               "ko": "대역폭 측정"},
    "st_pool": {"zh-TW": "收集測試影片", "zh-CN": "收集测试视频", "en": "Collecting test videos", "ja": "テスト動画を収集",
                "ko": "테스트 영상 수집"},
    "st_pick": {"zh-TW": "挑選影片", "zh-CN": "挑选视频", "en": "Picking videos", "ja": "動画を選択", "ko": "영상 선택"},
    "st_ceiling": {"zh-TW": "量測頻寬上限", "zh-CN": "测量带宽上限", "en": "Measuring capacity", "ja": "最大帯域を測定",
                   "ko": "최대 대역폭 측정"},
    "st_stage1": {"zh-TW": "快篩所有節點", "zh-CN": "快速筛选所有节点", "en": "Screening all servers", "ja": "全サーバーを予備測定",
                  "ko": "전체 서버 1차 측정"},
    "st_stage2": {"zh-TW": "細測候選節點", "zh-CN": "精测候选节点", "en": "Testing candidate servers", "ja": "候補サーバーを詳細測定",
                  "ko": "후보 서버 정밀 측정"},
    "st_report": {"zh-TW": "產生報告", "zh-CN": "生成报告", "en": "Writing report", "ja": "レポート作成", "ko": "보고서 작성"},
    "failed": {"zh-TW": "測速失敗", "zh-CN": "测速失败", "en": "Test failed", "ja": "テストに失敗しました", "ko": "테스트 실패"},

    # 第 5 頁：確認發送
    "done_title": {"zh-TW": "測速完成", "zh-CN": "测速完成", "en": "Test complete", "ja": "テスト完了", "ko": "테스트 완료"},
    "f_country": {"zh-TW": "國家", "zh-CN": "国家", "en": "Country", "ja": "国", "ko": "국가"},
    "f_isp": {"zh-TW": "ISP", "zh-CN": "ISP", "en": "ISP", "ja": "ISP", "ko": "ISP"},
    "f_ip": {"zh-TW": "IP", "zh-CN": "IP", "en": "IP", "ja": "IP", "ko": "IP"},
    "f_network": {"zh-TW": "網路類型", "zh-CN": "网络类型", "en": "Network", "ja": "ネットワーク", "ko": "네트워크"},
    "f_bw": {"zh-TW": "總頻寬", "zh-CN": "总带宽", "en": "Bandwidth", "ja": "回線速度", "ko": "대역폭"},
    "f_login": {"zh-TW": "已登入", "zh-CN": "已登录", "en": "Logged in", "ja": "ログイン", "ko": "로그인"},
    "f_email": {"zh-TW": "Email", "zh-CN": "Email", "en": "Email", "ja": "メール", "ko": "이메일"},
    "f_default": {"zh-TW": "建議預設節點", "zh-CN": "建议默认节点", "en": "Recommended default server",
                  "ja": "推奨デフォルトサーバー", "ko": "권장 기본 서버"},
    "f_rec": {"zh-TW": "建議節點（會加入擴充的「自訂節點列表」）", "zh-CN": "建议节点（会加入扩展的「自定义节点列表」）",
              "en": "Recommended servers (added to the extension's \"Custom node list\")",
              "ja": "推奨サーバー（拡張機能の「カスタムノードリスト」に追加されます）",
              "ko": "권장 서버 (확장 프로그램의 \"사용자 지정 노드 목록\"에 추가됨)"},
    "yes": {"zh-TW": "是", "zh-CN": "是", "en": "yes", "ja": "はい", "ko": "예"},
    "no480": {"zh-TW": "否（≤480P）", "zh-CN": "否（≤480P）", "en": "no (≤480P)", "ja": "いいえ（480P 以下）",
              "ko": "아니요 (480P 이하)"},
    "none": {"zh-TW": "（未提供）", "zh-CN": "（未提供）", "en": "(not provided)", "ja": "（未入力）", "ko": "(미제공)"},
    "send_q": {"zh-TW": "要把報告傳給作者嗎？將傳送上方資訊與完整測速結果（REPORT.md、summary.json），不含 B 站帳號資訊。",
               "zh-CN": "要把报告发给作者吗？将发送上方信息与完整测速结果（REPORT.md、summary.json），不含 B 站账号信息。",
               "en": "Send the report to the author? It includes the information above and the full results (REPORT.md, summary.json) — no Bilibili account info.",
               "ja": "レポートを作者に送信しますか？上記の情報と全結果（REPORT.md、summary.json）が含まれます。Bilibili アカウント情報は含まれません。",
               "ko": "보고서를 작성자에게 보낼까요? 위 정보와 전체 결과(REPORT.md, summary.json)가 포함되며 Bilibili 계정 정보는 포함되지 않습니다."},
    "send": {"zh-TW": "發送並建立自訂列表", "zh-CN": "发送并创建自定义列表", "en": "Send & build custom list",
             "ja": "送信してカスタムリストを作成", "ko": "보내고 사용자 지정 목록 만들기"},
    "dont_send": {"zh-TW": "不發送", "zh-CN": "不发送", "en": "Don't send", "ja": "送信しない", "ko": "보내지 않기"},
    "open_folder": {"zh-TW": "開啟報告資料夾", "zh-CN": "打开报告文件夹", "en": "Open report folder", "ja": "レポートのフォルダを開く",
                    "ko": "보고서 폴더 열기"},
    "sending": {"zh-TW": "傳送中…", "zh-CN": "发送中…", "en": "Sending…", "ja": "送信中…", "ko": "보내는 중…"},
    "send_failed": {"zh-TW": "傳送失敗：{err}\n可用「開啟報告資料夾」手動把報告傳給作者。",
                    "zh-CN": "发送失败：{err}\n可用「打开报告文件夹」手动把报告发给作者。",
                    "en": "Sending failed: {err}\nYou can open the report folder and send it to the author manually.",
                    "ja": "送信に失敗しました：{err}\nレポートのフォルダを開き、手動で作者に送ってください。",
                    "ko": "전송 실패: {err}\n보고서 폴더를 열어 작성자에게 직접 보내 주세요."},
    "no_upload": {"zh-TW": "此版本未設定接收網址，請手動把報告資料夾傳給作者。", "zh-CN": "此版本未设置接收地址，请手动把报告文件夹发给作者。",
                  "en": "No upload address is set in this build; please send the report folder to the author manually.",
                  "ja": "この版には送信先が設定されていません。レポートのフォルダを手動で作者に送ってください。",
                  "ko": "이 버전에는 전송 주소가 없습니다. 보고서 폴더를 작성자에게 직접 보내 주세요."},

    # 第 6 頁：感謝
    "thanks_title": {"zh-TW": "謝謝你的協助！", "zh-CN": "谢谢你的协助！", "en": "Thank you!", "ja": "ご協力ありがとうございました！",
                     "ko": "도와주셔서 감사합니다!"},
    "thanks_sent_email": {
        "zh-TW": "報告已送出。確認信已寄到 {email}，作者確認測試結果無誤後，會把禮物卡寄到這個信箱。",
        "zh-CN": "报告已发送。确认信已发到 {email}，作者确认测试结果无误后，会把礼品卡发到这个邮箱。",
        "en": "Your report has been sent. A confirmation email has been sent to {email}. After the author verifies your results, the gift card will be sent to this address.",
        "ja": "レポートを送信しました。確認メールを {email} に送りました。作者が結果を確認した後、このアドレスにギフトカードをお送りします。",
        "ko": "보고서를 보냈습니다. 확인 메일을 {email}(으)로 보냈습니다. 작성자가 결과를 확인한 후 이 주소로 기프트 카드를 보내 드립니다."},
    "thanks_sent": {"zh-TW": "報告已送出，你的測試會幫助改善擴充功能的節點推薦。",
                    "zh-CN": "报告已发送，你的测试会帮助改善扩展程序的节点推荐。",
                    "en": "Your report has been sent. It will help improve the extension's server recommendations.",
                    "ja": "レポートを送信しました。拡張機能のサーバー推奨の改善に役立てます。",
                    "ko": "보고서를 보냈습니다. 확장 프로그램의 서버 추천 개선에 사용됩니다."},
    "thanks_not_sent": {"zh-TW": "報告沒有傳送，結果保留在你的電腦：\n{path}",
                        "zh-CN": "报告没有发送，结果保留在你的电脑：\n{path}",
                        "en": "The report was not sent. The results are kept on your computer:\n{path}",
                        "ja": "レポートは送信されていません。結果はこの PC に保存されています：\n{path}",
                        "ko": "보고서를 보내지 않았습니다. 결과는 이 컴퓨터에 저장되어 있습니다:\n{path}"},
    "thanks_cleaned": {"zh-TW": "報告已上傳，關閉視窗後本機的測速檔案會自動刪除。",
                       "zh-CN": "报告已上传，关闭窗口后本机的测速文件会自动删除。",
                       "en": "The report has been uploaded. The local test files will be deleted when you close this window.",
                       "ja": "レポートをアップロードしました。ウィンドウを閉じると PC 上のテストファイルは自動で削除されます。",
                       "ko": "보고서를 업로드했습니다. 창을 닫으면 이 컴퓨터의 테스트 파일이 자동으로 삭제됩니다."},
    # 感謝頁：建立擴充的「自訂節點列表」
    "add_to_ext": {"zh-TW": "將建議節點加入擴充的「自訂節點列表」", "zh-CN": "将建议节点加入扩展的「自定义节点列表」",
                   "en": "Add the recommended servers to the extension's \"Custom node list\"",
                   "ja": "推奨サーバーを拡張機能の「カスタムノードリスト」に追加する",
                   "ko": "권장 서버를 확장 프로그램의 \"사용자 지정 노드 목록\"에 추가"},
    "send_only": {"zh-TW": "發送", "zh-CN": "发送", "en": "Send", "ja": "送信", "ko": "보내기"},
    "no_browser_title": {"zh-TW": "沒有選擇瀏覽器", "zh-CN": "没有选择浏览器", "en": "No browser selected",
                         "ja": "ブラウザが選ばれていません", "ko": "브라우저를 선택하지 않음"},
    "no_browser_q": {"zh-TW": "你沒有選擇瀏覽器，此次結果不會更新自訂列表。確定發送嗎？",
                     "zh-CN": "你没有选择浏览器，此次结果不会更新自定义列表。确定发送吗？",
                     "en": "You didn't select a browser, so this result won't update your custom list. Send anyway?",
                     "ja": "ブラウザが選ばれていないため、今回の結果でカスタムリストは更新されません。送信しますか？",
                     "ko": "브라우저를 선택하지 않아 이번 결과로 사용자 지정 목록이 업데이트되지 않습니다. 그래도 보낼까요?"},
    "ext_missing_list": {
        "zh-TW": "以下瀏覽器還不能建立「自訂節點列表」。請不要關閉此視窗，安裝或更新擴充後，再按「建立自訂列表」。",
        "zh-CN": "以下浏览器还不能创建「自定义节点列表」。请不要关闭此窗口，安装或更新扩展后，再点「创建自定义列表」。",
        "en": "The \"Custom node list\" couldn't be built in these browsers yet. Keep this window open, install or update the extension, then click \"Build custom list\".",
        "ja": "次のブラウザではまだ「カスタムノードリスト」を作成できません。このウィンドウを閉じずに、拡張機能をインストールまたは更新してから「カスタムリストを作成」を押してください。",
        "ko": "다음 브라우저에서는 아직 \"사용자 지정 노드 목록\"을 만들 수 없습니다. 이 창을 닫지 말고 확장 프로그램을 설치하거나 업데이트한 뒤 \"사용자 지정 목록 만들기\"를 눌러 주세요."},
    "ext_st_missing": {"zh-TW": "尚未安裝擴充", "zh-CN": "尚未安装扩展", "en": "extension not installed",
                       "ja": "拡張機能が未インストール", "ko": "확장 프로그램 미설치"},
    "ext_st_outdated": {"zh-TW": "擴充版本太舊（{ver}）", "zh-CN": "扩展版本太旧（{ver}）", "en": "extension too old ({ver})",
                        "ja": "拡張機能のバージョンが古い（{ver}）", "ko": "확장 프로그램 버전이 오래됨 ({ver})"},
    "install": {"zh-TW": "安裝", "zh-CN": "安装", "en": "Install", "ja": "インストール", "ko": "설치"},
    "update": {"zh-TW": "更新", "zh-CN": "更新", "en": "Update", "ja": "更新", "ko": "업데이트"},
    "manual_add": {"zh-TW": "或是手動把以下節點加入擴充的「自訂節點列表」：",
                   "zh-CN": "或是手动把以下节点加入扩展的「自定义节点列表」：",
                   "en": "Or add these servers to the extension's \"Custom node list\" yourself:",
                   "ja": "または、次のサーバーを拡張機能の「カスタムノードリスト」に手動で追加してください：",
                   "ko": "또는 다음 서버를 확장 프로그램의 \"사용자 지정 노드 목록\"에 직접 추가하세요:"},
    "copy_all": {"zh-TW": "全部複製", "zh-CN": "全部复制", "en": "Copy all", "ja": "すべてコピー", "ko": "모두 복사"},
    "copied": {"zh-TW": "已複製", "zh-CN": "已复制", "en": "Copied", "ja": "コピーしました", "ko": "복사됨"},
    "build_list": {"zh-TW": "建立自訂列表", "zh-CN": "创建自定义列表", "en": "Build custom list",
                   "ja": "カスタムリストを作成", "ko": "사용자 지정 목록 만들기"},
    "ext_built": {"zh-TW": "已在瀏覽器開啟 B 站，節點已加入「自訂節點列表」。",
                  "zh-CN": "已在浏览器打开 B 站，节点已加入「自定义节点列表」。",
                  "en": "Bilibili was opened in your browser and the servers were added to the \"Custom node list\".",
                  "ja": "ブラウザで Bilibili を開き、サーバーを「カスタムノードリスト」に追加しました。",
                  "ko": "브라우저에서 Bilibili를 열고 서버를 \"사용자 지정 노드 목록\"에 추가했습니다."},
}


S.update({
    # 第 2 頁：網路檢查
    "check_title": {"zh-TW": "網路檢查", "zh-CN": "网络检查", "en": "Network check", "ja": "ネットワークチェック",
                    "ko": "네트워크 확인"},
    "check_desc": {
        "zh-TW": "開始前先確認你的網路適合測速：下載速度至少 {min} Mbps，且沒有使用 VPN 或代理。約需 40 秒。",
        "zh-CN": "开始前先确认你的网络适合测速：下载速度至少 {min} Mbps，且没有使用 VPN 或代理。约需 40 秒。",
        "en": "First, let's make sure your connection is suitable: at least {min} Mbps download, and no VPN or proxy. Takes about 40 seconds.",
        "ja": "開始前に回線を確認します：ダウンロード {min} Mbps 以上で、VPN やプロキシを使っていないこと。約 40 秒かかります。",
        "ko": "시작 전에 네트워크를 확인합니다: 다운로드 {min} Mbps 이상, VPN·프록시 미사용. 약 40초 걸립니다."},
    "check_running": {"zh-TW": "檢查中…", "zh-CN": "检查中…", "en": "Checking…", "ja": "確認中…", "ko": "확인 중…"},
    "m_down": {"zh-TW": "下載", "zh-CN": "下载", "en": "Download", "ja": "ダウンロード", "ko": "다운로드"},
    "m_up": {"zh-TW": "上傳", "zh-CN": "上传", "en": "Upload", "ja": "アップロード", "ko": "업로드"},
    "m_lat": {"zh-TW": "延遲", "zh-CN": "延迟", "en": "Latency", "ja": "遅延", "ko": "지연"},
    "m_vpn": {"zh-TW": "VPN／代理", "zh-CN": "VPN／代理", "en": "VPN / proxy", "ja": "VPN／プロキシ", "ko": "VPN/프록시"},
    "vpn_none": {"zh-TW": "未偵測到", "zh-CN": "未检测到", "en": "Not detected", "ja": "検出なし", "ko": "감지 안 됨"},
    "vpn_found": {"zh-TW": "偵測到", "zh-CN": "检测到", "en": "Detected", "ja": "検出", "ko": "감지됨"},
    "check_pass": {"zh-TW": "網路符合條件，可以開始測速！", "zh-CN": "网络符合条件，可以开始测速！",
                   "en": "Your connection looks good — ready to test!", "ja": "回線は条件を満たしています。テストを始められます！",
                   "ko": "네트워크가 조건을 충족합니다. 테스트를 시작할 수 있습니다!"},
    "fail_slow": {
        "zh-TW": "不好意思，你的網速太慢（下載 {down} Mbps，需要至少 {min} Mbps），無法進行有效測速。",
        "zh-CN": "不好意思，你的网速太慢（下载 {down} Mbps，需要至少 {min} Mbps），无法进行有效测速。",
        "en": "Sorry, your connection is too slow for a meaningful test ({down} Mbps download; at least {min} Mbps is required).",
        "ja": "申し訳ありません。回線速度が遅すぎるため、有効なテストができません（ダウンロード {down} Mbps、{min} Mbps 以上が必要です）。",
        "ko": "죄송합니다. 네트워크 속도가 너무 느려 유효한 테스트를 할 수 없습니다 (다운로드 {down} Mbps, 최소 {min} Mbps 필요)."},
    "fail_vpn": {
        "zh-TW": "偵測到你正在使用 VPN 或代理。VPN 會讓結果無法代表你所在國家的網路，請關閉後按「重新檢查」。",
        "zh-CN": "检测到你正在使用 VPN 或代理。VPN 会让结果无法代表你所在国家的网络，请关闭后按「重新检查」。",
        "en": "A VPN or proxy was detected. Results through a VPN don't represent your country's network — please turn it off and click \"Check again\".",
        "ja": "VPN またはプロキシの使用を検出しました。VPN 経由の結果はお住まいの国の回線を反映しません。オフにしてから「再チェック」を押してください。",
        "ko": "VPN 또는 프록시 사용이 감지되었습니다. VPN을 통한 결과는 거주 국가의 네트워크를 대표하지 못합니다. 끈 후 \"다시 확인\"을 눌러 주세요."},
    "check_err": {"zh-TW": "無法完成網路檢查（{err}），請確認網路連線後重試。", "zh-CN": "无法完成网络检查（{err}），请确认网络连接后重试。",
                  "en": "The network check failed ({err}). Please check your connection and try again.",
                  "ja": "ネットワークチェックに失敗しました（{err}）。接続を確認して再試行してください。",
                  "ko": "네트워크 확인에 실패했습니다 ({err}). 연결을 확인한 후 다시 시도해 주세요."},
    "check_eta": {"zh-TW": "預計本次測試約需 {min} 分鐘，結束之前請不要關閉視窗。",
                  "zh-CN": "预计本次测试约需 {min} 分钟，结束之前请不要关闭窗口。",
                  "en": "This test should take about {min} minutes. Please keep this window open until it finishes.",
                  "ja": "今回のテストは約 {min} 分かかる見込みです。終わるまでウィンドウを閉じないでください。",
                  "ko": "이번 테스트는 약 {min}분 걸릴 예정입니다. 끝날 때까지 창을 닫지 마세요."},
    "check_desc_free": {
        "zh-TW": "先檢查你的網路狀況。你選的是單純測試，結果只做參考，不影響能否繼續。約需 40 秒。",
        "zh-CN": "先检查你的网络状况。你选的是单纯测试，结果只做参考，不影响能否继续。约需 40 秒。",
        "en": "First, let's check your connection. Since you chose to just test, the result is for reference only and won't stop you from continuing. Takes about 40 seconds.",
        "ja": "まず回線を確認します。「テストのみ」を選んだため、結果は参考のみで、続行には影響しません。約 40 秒かかります。",
        "ko": "먼저 네트워크를 확인합니다. \"테스트만\"을 선택하셨으므로 결과는 참고용이며 계속 진행에 영향을 주지 않습니다. 약 40초 걸립니다."},
    "warn_slow": {"zh-TW": "你的網速偏慢（下載 {down} Mbps；參加抽獎需要至少 {min} Mbps）。",
                  "zh-CN": "你的网速偏慢（下载 {down} Mbps；参加抽奖需要至少 {min} Mbps）。",
                  "en": "Your connection is on the slow side ({down} Mbps download; the prize draw requires at least {min} Mbps).",
                  "ja": "回線速度がやや遅めです（ダウンロード {down} Mbps。抽選への参加には {min} Mbps 以上が必要です）。",
                  "ko": "네트워크 속도가 다소 느립니다 (다운로드 {down} Mbps, 추첨 참여에는 최소 {min} Mbps 필요)."},
    "warn_vpn": {"zh-TW": "偵測到你正在使用 VPN 或代理，測出來的會是經過 VPN 的速度。",
                 "zh-CN": "检测到你正在使用 VPN 或代理，测出来的会是经过 VPN 的速度。",
                 "en": "A VPN or proxy was detected, so the results will reflect speeds through the VPN.",
                 "ja": "VPN またはプロキシの使用を検出しました。結果は VPN 経由の速度になります。",
                 "ko": "VPN 또는 프록시 사용이 감지되었습니다. 결과는 VPN을 거친 속도가 됩니다."},
    "check_free_warn": {
        "zh-TW": "你選的是單純測試，仍然可以繼續，結果會反映你目前的網路狀況。",
        "zh-CN": "你选的是单纯测试，仍然可以继续，结果会反映你当前的网络状况。",
        "en": "Since you chose to just test, you can still continue — the results will reflect your current connection.",
        "ja": "「テストのみ」を選んだため、このまま続行できます。結果は現在の回線状況を反映します。",
        "ko": "\"테스트만\"을 선택하셨으므로 계속할 수 있으며, 결과는 현재 네트워크 상황을 반영합니다."},
    "check_back_free": {
        "zh-TW": "只是想建立自己的「自訂節點列表」的話，可以按「上一步」改選「單純測試」，就不受網速與 VPN 限制。",
        "zh-CN": "只是想创建自己的「自定义节点列表」的话，可以点「上一步」改选「单纯测试」，就不受网速与 VPN 限制。",
        "en": "If you just want to build your own \"Custom node list\", click \"Back\" and choose \"Just test\" — there's no speed or VPN requirement.",
        "ja": "自分の「カスタムノードリスト」を作りたいだけなら、「戻る」で「テストのみ」を選べば速度や VPN の制限はありません。",
        "ko": "내 \"사용자 지정 노드 목록\"만 만들려면 \"이전\"을 눌러 \"테스트만\"을 선택하세요. 속도·VPN 제한이 없습니다."},
    "check_retry": {"zh-TW": "重新檢查", "zh-CN": "重新检查", "en": "Check again", "ja": "再チェック", "ko": "다시 확인"},
    "check_testmode": {"zh-TW": "（測試模式：忽略檢查結果，仍可繼續）", "zh-CN": "（测试模式：忽略检查结果，仍可继续）",
                       "en": "(Test mode: result ignored, you can continue)", "ja": "（テストモード：結果を無視して続行できます）",
                       "ko": "(테스트 모드: 결과를 무시하고 계속할 수 있음)"},
    "step": {"zh-TW": "步驟 {i} / {n}", "zh-CN": "步骤 {i} / {n}", "en": "Step {i} of {n}", "ja": "ステップ {i} / {n}",
             "ko": "{i} / {n} 단계"},
    "subtitle": {"zh-TW": "幫助改善 B 站海外播放速度", "zh-CN": "帮助改善 B 站海外播放速度",
                 "en": "Help make Bilibili faster outside China", "ja": "海外での Bilibili 再生を速くするために",
                 "ko": "해외 Bilibili 재생 속도 개선에 도움을 주세요"},
    "thanks_hero": {"zh-TW": "謝謝你！", "zh-CN": "谢谢你！", "en": "Thank you!", "ja": "ありがとうございます！",
                    "ko": "감사합니다!"},
    "thanks_lead": {
        "zh-TW": "你剛剛測了 {n} 個 B 站節點。這份結果會用來幫 {country} 的使用者找到更快、更穩的播放節點。",
        "zh-CN": "你刚刚测了 {n} 个 B 站节点。这份结果会用来帮 {country} 的用户找到更快、更稳的播放节点。",
        "en": "You just tested {n} Bilibili servers. Your results will help viewers in {country} get faster, smoother playback.",
        "ja": "{n} 台の Bilibili サーバーを測定していただきました。この結果は {country} のユーザーがより速く安定して再生できるサーバーを選ぶために使われます。",
        "ko": "방금 {n}개의 Bilibili 서버를 측정해 주셨습니다. 이 결과는 {country} 사용자들이 더 빠르고 안정적으로 재생할 수 있도록 하는 데 사용됩니다."},
    "thanks_next": {"zh-TW": "接下來", "zh-CN": "接下来", "en": "What happens next", "ja": "このあとの流れ", "ko": "다음 단계"},
    "thanks_step_mail": {"zh-TW": "確認信已寄到 {email}（沒看到的話請檢查垃圾郵件匣）",
                         "zh-CN": "确认信已发到 {email}（没看到的话请检查垃圾邮件箱）",
                         "en": "A confirmation email has been sent to {email} (check your spam folder if you don't see it)",
                         "ja": "確認メールを {email} に送信しました（届かない場合は迷惑メールフォルダをご確認ください）",
                         "ko": "확인 메일을 {email}(으)로 보냈습니다 (보이지 않으면 스팸함을 확인해 주세요)"},
    "thanks_step_verify": {"zh-TW": "作者會在幾天內確認你的測試結果", "zh-CN": "作者会在几天内确认你的测试结果",
                           "en": "The author will verify your results within a few days",
                           "ja": "作者が数日以内にテスト結果を確認します", "ko": "작성자가 며칠 내로 결과를 확인합니다"},
    "thanks_step_lottery": {"zh-TW": "確認無誤後，你會參加{gift}抽獎，中獎的話會以 email 通知",
                            "zh-CN": "确认无误后，你会参加{gift}抽奖，中奖的话会以 email 通知",
                            "en": "Once verified, you'll be entered in the draw for {gift}; winners are notified by email",
                            "ja": "確認後、{gift}の抽選に参加となります。当選者にはメールでお知らせします",
                            "ko": "확인 후 {gift} 추첨에 참여하게 되며, 당첨 시 이메일로 안내해 드립니다"},
    "thanks_step_gift": {"zh-TW": "確認無誤後，{gift}會寄到你的信箱", "zh-CN": "确认无误后，{gift}会发到你的邮箱",
                         "en": "Once verified, {gift} will be sent to your inbox",
                         "ja": "確認後、{gift}をメールでお送りします", "ko": "확인 후 {gift}을(를) 이메일로 보내 드립니다"},
    "gift_word": {"zh-TW": "禮物卡", "zh-CN": "礼品卡", "en": "your gift card", "ja": "ギフトカード", "ko": "기프트 카드"},
    "gift_word_v": {"zh-TW": "價值 {gift} 的禮物卡", "zh-CN": "价值 {gift} 的礼品卡", "en": "a {gift} gift card",
                    "ja": "{gift} 相当のギフトカード", "ko": "{gift} 상당의 기프트 카드"},
    "thanks_unsent_title": {"zh-TW": "已完成測試", "zh-CN": "已完成测试", "en": "Test finished", "ja": "テスト完了",
                            "ko": "테스트 완료"},
})


def t(key, lang, **kw):
    d = S.get(key, {})
    s = d.get(lang) or d.get("en") or key
    return s.format(**kw) if kw else s


def default_lang():
    """依 Windows 介面語言預選；其他系統看 locale"""
    try:
        import ctypes
        lid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        return {1028: "zh-TW", 3076: "zh-TW", 5124: "zh-TW", 2052: "zh-CN", 4100: "zh-CN", 1041: "ja",
                1042: "ko"}.get(lid, "en")
    except Exception:
        import locale
        loc = (locale.getlocale()[0] or "").lower()
        if loc.startswith("zh") and ("tw" in loc or "hk" in loc or "hant" in loc): return "zh-TW"
        if loc.startswith("zh"): return "zh-CN"
        if loc.startswith("ja"): return "ja"
        if loc.startswith("ko"): return "ko"
        return "en"
