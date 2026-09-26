# TW/SG Video Speedup for bilibili (Unofficial) — App Store (Safari extension) listing copy

## Short description

Helps Taiwan/Singapore users watch bilibili's web player more smoothly at 4K and other high-quality resolutions, with less buffering and stuttering. Unofficial third-party extension, not affiliated with bilibili.

## Detailed description
(If you have a Tampermonkey/Greasemonkey script with the same functionality installed, please remove it first to avoid conflicts.)

Did you pay for a bilibili Premium membership, only to spend the whole time staring at a buffering wheel — money straight down the drain?

This bugged me for a long time, until I finally found something that actually works

So I decided to turn it into a Safari extension. There must be plenty of people with the same problem — I hope it helps you too!

🆓 This extension is completely FREE, and guaranteed to stay "FREE FOREVER"!
⚡ Nothing to configure, just install it and it works!

Open any bilibili video after installing and it switches you to the fastest route for Taiwan/Singapore behind the scenes. Faster loading, less buffering, and even 4K plays straight through.

■ Key features
・Works out of the box — a TW/SG-optimized route is applied by default, no setup needed
・Multiple CDN routes — choose among Alibaba Cloud, Tencent Cloud, Huawei Cloud, Akamai, and more; useful for other regions too if you pick the node closest to you
・Custom route — enter your own CDN host manually
・Automatic failover — detects failed requests or stalled playback and silently switches to bilibili's own backup node first; only asks you if the backup also fails
・Per-node speed test — a dedicated page that measures each route's download speed for the current video and quality, so you can compare for yourself
・Live status display — shows the CDN route actually in use in the top-left corner of the player, handy for comparing results
・Multi-language UI — automatically switches between Traditional Chinese / Simplified Chinese / English based on your system language
・One-click disable — turns off completely, restoring Safari's original behavior

■ How to use
After downloading the app, open it once, then go to Safari → Settings → Extensions, enable "Bilibili CDN Switcher", and allow it to access bilibili.com. From then on it activates automatically on any bilibili video page; click the extension icon next to the address bar to change the route or turn the feature off.

■ Privacy
This extension does not collect or transmit any user data, makes no outbound network connections, and contains no remote code. All settings are stored locally on your own device. The source code is fully open — feel free to review it.
https://github.com/a0972199950/bilibili-cdn-switcher

■ Requirements
macOS 14 Sonoma or later with Safari 17 or later; iPhone/iPad requires iOS/iPadOS 17 or later.
(This extension injects a content script in world: MAIN, which requires Safari 17 or later.)

[This is an independently developed, third-party extension. It is not affiliated with, authorized by, or endorsed by bilibili in any way.]
