//
//  ViewController.swift
//  Shared (App)
//
//  Created by ByteDance on 2026/9/25.
//

import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.johnh.bilibili-cdn-switcher.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        // 引導頁依裝置顯示 iPhone／iPad 各自的步驟
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        webView.evaluateJavaScript("show('\(device)')")
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), false)")
                }
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let action = message.body as? String else {
            return
        }

#if os(iOS)
        if action != "open-safari" {
            return
        }

        // 用 Safari 打開 B 站，讓使用者在網址列的延伸功能選單裡直接開啟擴充。
        // x-safari-https 會指定用 Safari 開（預設瀏覽器不是 Safari 也一樣）；系統不支援就退回一般網址
        let fallback = URL(string: "https://www.bilibili.com/")!
        UIApplication.shared.open(URL(string: "x-safari-https://www.bilibili.com/")!) { opened in
            if !opened {
                UIApplication.shared.open(fallback)
            }
        }
#elseif os(macOS)
        if action != "open-preferences" {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                NSApp.terminate(self)
            }
        }
#endif
    }

}
