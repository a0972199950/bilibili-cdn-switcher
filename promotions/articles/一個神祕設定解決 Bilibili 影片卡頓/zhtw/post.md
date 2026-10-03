# 一個神祕設定解決 Bilibili 影片卡頓

![](背景模糊圖加上文字.png)

![](第一步點擊安裝.png)

![](第二步測速.png)

![](最後一步收尾.png)

你各位B站看影片也卡成狗嗎?

懶得看原理，省流: 瀏覽器裝這個 (如果有竄改猴/游猴的同功能腳本記得先移除)
【Chrome】[TW/SG 影片加速 for bilibili (非官方)](https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch)
【Firefox】[TW/SG 影片加速 for bilibili (非官方)](https://addons.mozilla.org/addon/bilibili-cdn-switcher)
【Edge】[TW/SG 影片加速 for bilibili (非官方)](https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp)

Before

After

==== 如果你還想繼續看 ====

台灣看 bilibili 影片卡頓，搜尋網路常出現 VPN 啦，改 DNS 8.8.8.8 之類的，這些都不一定管用
因為真正的原因是B站給你分配了「慢速的 CDN 節點」。上面這些方法本質都是「提高拿到好節點的機率」，不能根治。所以跟哈密瓜一樣，有些人有用有些人沒用

真要徹底解決，你必須知道所在地區最好的節點，然後固定它

為此我做了這個插件，如果巴友一般用電腦瀏覽器看，裝上面的擴充，強制影片走最快的節點

如果用Android看，不要用官方 APP，改用PiliNara這個三方 apk (好用很多沒廣告)
https://github.com/Starfallan/PiliNara/releases

如果用機上盒或智能電視，別用那什麼雲xx小電視(真的拉完了)，用 blbl APP
https://github.com/roge4444/blblRogerMod/releases

原理都是一樣的，這些 APP 內建測速並固定 CDN 的功能

========

以上是我採雷三年多來的真心分享，非葉配
瀏覽器擴充是我自己做來給自己用的，永久免費。希望幫到有需求的人，有想要的功能或 bug 回報也可以留言或私訊

如果你裝上後覺得不錯，不妨順手留個五星鼓勵。或者到以下 Github 專案點個星星
https://github.com/a0972199950/bilibili-cdn-switcher
