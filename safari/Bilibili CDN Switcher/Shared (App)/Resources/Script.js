// ViewController.swift 載入完頁面後呼叫：
//   iOS：show('iphone') 或 show('ipad')
//   macOS：show('mac')，查到擴充開關狀態後再呼叫 show('mac', true/false)
// 第三個參數是 Xcode 範本留下的（macOS 13 以後叫「設定」不叫「偏好設定」），引導頁一律用最新系統的說法，不再使用
function show(platform, enabled) {
    document.body.classList.add(`platform-${platform}`);

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function post(action) {
    webkit.messageHandlers.controller.postMessage(action);
}

for (const button of document.querySelectorAll("button.open-preferences")) {
    button.addEventListener("click", () => post("open-preferences"));
}

for (const button of document.querySelectorAll("button.open-safari")) {
    button.addEventListener("click", () => post("open-safari"));
}
