"use client";

/* =======================================================================
 * 线下场合（1.7.5 建，1.7.7 改成气泡体）。
 *
 * 从聊天页加号面板的「去见他」进来。线上是隔着手机的微信体（短、碎、不写动作神态心理），
 * 这一页是**见了面**：**顶栏与输入栏整副照抄线上聊天页**（同一层薄纱、同一颗白胶囊大气泡、
 * 同样的 34 圆钮与 36 圆钮、同样那颗会跳的粉心），壁纸也是线上那张、气泡也是左白右粉、
 * 头像也是 38——恩熙 1.7.8 定的口径：**看着就是同一个聊天页，只有内容区的排版不同**。
 * 内容区多一层**动作描述**（照参考图定下的两处「位置」）：
 *   ① 动作／神情／体态／旁白——**不成气泡**，灰斜体，底下铺一层半透明白
 *      （1.7.13 加的底：换了壁纸之后灰字压照片上认不出来）；
 *   ② 他说的话——气泡，顶上压一枚小名牌（隔着旁白，不标认不出是谁在说）。
 *      引号只在**切的时候**当凭据（靠它认出哪截是话），**不跟着进气泡**（1.7.17 恩熙定的：
 *      气泡就该像平常发出去那样，直接是文字内容）。
 * 两者按他写的顺序来回交替。
 * **旁白通栏、气泡让头像**（1.7.15）：旁白没有头像，就从屏幕最左铺到最右；
 * 气泡那一行才让出头像那 38px，且**每一只气泡都带一枚头像**。
 * ⇒ 两条不再必然同宽，「谁在说」看头像与名牌、「是动作还是话」看长相，一眼分得开。
 * **我们自己的样式**（1.7.16，恩熙定的三条）：
 *   ① 旁白左缘压一截细竖线（像引用条）——通栏一条长句有个「起手处」；
 *   ② **气泡跟随文字**（短句缩成一小团、长句铺开），**旁白不跟**（旁白仍通栏）；
 *   ③ **她的旁白换成粉调**（底淡粉、字深粉、竖线粉），跟 TA 那侧的灰**一色之差**分得开谁在动。
 * 气泡皮这一轮仍是 1.7.15 那身中性灰（她只说了宽度，没说颜色）。
 * **1.7.17（恩熙又三笔）**：
 *   ① 她那一侧的旁白**右对齐**（她的话在右，竖线一并挪到右缘，跟 TA 那侧左右相对）；
 *   ② 台词气泡**不再带引号**（`splitLine` 照旧靠引号切，只是拼进气泡时不包）；
 *   ③ 输入框那句提示改成「写下你此刻**对他**说的话」（TA 是他，不是她）。
 * **1.7.18（细节四笔，恩熙说「按你的想法改」）**：
 *   ① 气泡**靠头像那一角收一截**（TA 侧左上／她侧右上，18 → 6）——气泡像是从这枚头像里长出来的；
 *   ② 旁白里**括号括着的小动作／心声降一级**（小半号、淡一档、正体）——一眼分得清「旁白」与
 *      「旁白里的小动作」（纯显示层，切法与提示词一个字没动）；
 *   ③ 消息区**上沿渐隐**（18px mask）——往顶栏底下滚时不再一刀切断，底下透出来的是壁纸本身；
 *   ④ 他正写着时末尾跟一枚**会闪的细竖线**（打字光标）——不再是整块文字凭空长出来。
 * **1.7.19（恩熙问「气泡能不能沿用线上的气泡呢？」）**：气泡皮**换回线上那一套**
 *   （TA 侧＝半透白渐变＋粉边＋白文字影＋两层粉影，她侧＝半透粉＋白字＋内高光，
 *   取值与线上 `ChatWindow` 里那两只一字不差）——1.7.15 照参考图换的那身中性灰**撤了**。
 *   她那一侧从此**不再是同一块灰**（这就是 1.7.16 起一直挂着的那处「要不要分色」，沿用线上即分）。
 *   线下只留三处自己的口径：**跟随文字**（`maxWidth:"100%"`，1.7.16）／`boxSizing` 自己补／
 *   字号行距仍用 14.5／1.6（线上 13／1.55；这一页旁白是 13.5，气泡再小就跟旁白一样大了）。
 *   圆角也照线上（TA 切左下角、她侧切右下角）⇒ 1.7.18 那枚「切靠头像那一角」一并撤了。
 * **1.7.20（恩熙说「线上线下字体能不能都改一下，更高级一点的」）**：聊天的**正文与气泡**
 *   换**宋体**（`SERIF`＝站内自托管的思源宋，零新增加载）——线上消息气泡与线下这一页的气泡
 *   同一天换、口径一致（见各气泡样式里的注；线上字号默认 13→13.5、行距 1.55→1.65，
 *   线下这页字号本就是 14.5、行距 1.6→1.7）。**其余 UI 一律仍走苹方（SANS）**：
 *   按钮、列表、设置、顶栏、输入框都不动——只把「说出口的话」这一层换成宋体，
 *   界面仍旧干净，两层正好拉开。**旁白不进这一笔**：线下旁白一直是霞鹜文楷（KAI）斜体，
 *   与气泡的宋体正好两层（文楷＝叙述的口气、宋体＝说出口的话），别混成一样。
 * **1.7.21（恩熙说「线下这个字体的大小再小一点，太大了」）**：这一页的文字**整层收小半号**——
 *   气泡 14.5→13.5、旁白 13.5→13、旁白里那截小动作 12.5→12。**三档一起降、相对层级一点不动**
 *   （气泡仍比旁白大半号）：只缩气泡那一档的话它会跟旁白撞成一样大，那正是 1.7.19 那处口径要避的。
 *   纯字号一处，字体（宋体／文楷）、行距（气泡 1.7、旁白 1.9）、配色、切法、提示词**都没动**。
 * **1.7.22（恩熙说「我喜欢它现在的输出方式，但现在这个样式会感觉这是一个分段，
 *   我希望用样式去让它变成这是一段的感觉」）**：**内容、切法、提示词一个字没动**——
 *   她喜欢这个输出方式，只嫌读起来是「一条一条」。于是收在 `Turn` 里两处：
 *   ① 头像与名牌**整回合只出一枚**（原先一只气泡配一枚，她那一轮的十三条里挂了六枚，
 *      一眼看上去就是六条消息）；其余台词行补一枚 38px 占位，好让气泡仍对齐在同一列
 *      ——**这一半在 1.7.24 半途收回**（她说着还是每只气泡要配一枚，见下）；
 *   ② 接缝不再均等（原先块块 gap 5）：台词与紧跟它的那句旁白、以及以「，」收尾的引导句
 *      与它的下一句台词，本来就是**同一句话的两半**，贴死 0；其余才留 6px 的呼吸
 *      ——**这一半在 1.7.25 也收回**（她嫌气泡贴旁白的卡片太紧，见下）。
 *   提示词第 2 条那版「一段一拍」的草稿**就此搁下**（她说这个写法她要）。
 * **1.7.23（恩熙说「它分不清哪些是它说出来的话：我听到你那句『我好想你啊』，心里颤动了一下
 *   ——这句『我好想你啊』怎么变成气泡了，它不是他说的」）**：切法补一条**转述**的例外。
 *   原先只要在引号里就算台词（1.7.13），可模型会拿引号去**引述她的原话**
 *   （「我听到你那句『…』」），被引的那几个字就误成了气泡。现在：引号**紧前头**
 *   那一小截里带着「听到／听见／那句／说的／想起」这类凭据时，这句引号**连引号一起
 *   留在旁白里**、不切气泡（见 splitLine 的 ECHO_RE）。**只动切法一层**：提示词、
 *   字体、字号、行距、配色、1.7.22 那两处样式，一律没动。
 * **1.7.24（恩熙说「首先我觉得单个气泡还是要有一个头像」）**：1.7.22 那半**半途收回**——
 *   头像与名牌**回到「一只气泡配一枚」**（1.7.22 是整回合只出一枚）。只回退这一半：
 *   1.7.22 的另一半（接缝咬合 `seamOf`）留着没动；占位用的 `AvatarSpacer` 随之删掉
 *   （每条都真出头像，不再需要空撑）。**内容、切法、提示词、字体字号行距配色一律没动。**
 * **1.7.25（恩熙说「然后现在 气泡紧贴着旁白的卡片，有点不太好」）**：1.7.22 的**另一半也收回**
 *   ——接缝不再分「贴死／留 6」，**块与块之间一律都是 6px**（`seamOf` 与那两个 `marginTop`
 *   删掉，回到 `Turn` 容器上一枚 `gap`；`Act` 为此加的那个 `style` prop 也一并删）。
 *   1.7.22 至此**两半都收回**，这一页只余 1.7.24 的「一只气泡配一枚头像」＋ 1.7.23 的转述例外。
 *   **内容、切法、提示词、字体字号行距配色一律没动。**
 * **1.7.26（恩熙说「是不是得改一下这个样式」→ 定了 A＋B）**：这一页**头一次主动动长相**。
 *   A **旁白不再是「卡片」**：1.7.13 铺的那层半透明白底、1.7.16 压的那条左缘细竖线、
 *   圆角与内距全撤，只留一行灰斜体字（`mineActStyle` 那侧的粉底同理撤掉，只余粉字与右对齐）；
 *   可读性改由**贴身白晕**（`textShadow`）兜——浅壁纸上把字衬出来、深壁纸上等于一圈浅光。
 *   她／TA 两侧同一副骨架，只是「一灰一粉、一左一右」照旧。
 *   B **名牌整枚撤掉**（`NameChip`／`nameChipStyle`／`NAME_CHIP_OFFSET`／`AvatarSlot` 的
 *   `offset` 全删）：一只气泡配一枚头像已经说明是谁，一轮里重复五六条深色实心名牌比正文还重。
 *   **内容、切法、提示词一律没动**；字体（气泡宋体／旁白文楷）与字号行距**也没动**
 *   （D「旁白改宋体」没选）。
 *   紧接着她说「可能也要改改文风跟它输出的方式、提示词这些」——那一块**没动**，
 *   提示词正文依法（祖训 524）要她点头，拟另拟一版给她过目。
 * **1.7.27（恩熙说「不行，现在这个样子非常的不行，看起来很糊」）**：1.7.26 兜可读性用的是
 *   `0 0 6px` 的**大半径白晕**，13px 的小字外头糊一圈 6px 的白，字整个发虚。改成**贴身 1px
 *   硬边**（四向各描一圈、不散光）。**只改这一处 `textShadow`**，其余一律没动（卡片仍是撤的、
 *   名牌仍是撤的、字体字号行距配色仍是原样、提示词仍一字未动）。
 * **1.7.28（恩熙发来参考图：「我大概希望的感觉是这样的」，并要求「改整体的样式」）**：
 *   这一页**换了骨架**——从「气泡体」改成**剧本体**（照那张参考图，同 App 类产品的排法）。
 *   ① **一轮只亮一次身份**：起手一截 `TurnHead`＝方头像（圆角方 34）＋ 名字 ＋ **一条虚线拉到右边**；
 *      底下整段不再逐条挂头像、不再有气泡（1.7.15 起的「旁白通栏、气泡让头像」整副撤掉）。
 *   ② **台词不再是气泡**：它就是正文里**带引号的一段**（`Line`），与旁白同一副字、同一个左边界；
 *      「说的」与「看的」只靠引号分。**切法一个字没动**（`splitLine` 照旧靠引号认台词，只是拼回
 *      正文时把引号也带上）。`Bubble`／`charBubbleStyle`／`mineBubbleStyle`／`AvatarSlot` 全删。
 *   ③ **两边同排**：她那一侧也照样起「头像＋名字＋虚线」的头、**两边都左对齐**（1.7.16 起
 *      「她侧粉调＋右对齐」那一套撤掉）；粉只留给她名字与头像。`mineActStyle`／`mineActAsideStyle` 删。
 *   ④ **通篇一副字**：宋体（`SERIF`）**正体、不斜**——旁白从此不是文楷斜体了（1.7.20 那条口径
 *      在这一页**收掉**）；字号 13／台词 13.5、行距 1.95、字距 .03em、近墨色。
 *   ⑤ **底下铺一张「纸」**：消息区一层半透白（alpha .90→.87）＋ `backdrop-filter: blur(14px)`，
 *      壁纸在底下**若隐若现**；字有纸可依，1.7.26／1.7.27 那两版「白晕／硬边」**都撤了**
 *      （字上做文章这条路恩熙连否两次，这一版改从底下铺）。
 *   **内容、切法、提示词一律没动**；提示词那一块（她说「也改改文风跟输出方式」）仍按祖训 524 挂着。
 * **1.7.29（恩熙说「没有办法透出壁纸，不是很透；用户的地方也应该右对齐、从右边长出来的感觉；
 *   旁白跟正文要有更明显的区分，颜色或字号都行」）**：1.7.28 那副骨架**不动**，只调四笔：
 *   ① **纸调透**：alpha `.90／.87 → .62／.56`、模糊 `14px → 6px`，壁纸真透上来；
 *   ② **她那一侧整条镜像到右边**（1.7.28 定的「两边都左对齐」在这一版收回）：起手那截
 *      `TurnHead` 变成「虚线 → 名字 → 头像」，正文那一列内距镜像（右 59 ／ 左 16）、字右对齐；
 *      「从右边长出来」。粉仍只在她名字与头像上。
 *   ③ **旁白与台词拉开**（靠字号＋明暗，**不换字体**——她说「不是字体，字体大小」）：
 *      旁白 13→**12.5**、色 `#6B6269 → #8B828A`（更淡）；台词 13.5→**14**、色 `#3A3439 → #28232A`
 *      （更深）；旁白里那截小动作 12→11.5、色 `#8C838B → #A79EA5`。
 *   **内容、切法、提示词一律没动**（提示词那一块仍按祖训 524 挂着）。
 * **1.7.30（恩熙说「现在透了可以了，但它跟上面（顶栏那截）有点衔接不上；能不能做得稍微再
 *   精细一些、多一点细节」）**：骨架与透度都**不动**，只把上沿的接缝与两处小细节收拾一遍。
 *   ① **接缝**：纸的顶端色由暖白 `255,253,251` **换成顶栏那层纱的粉白 `255,247,249`**
 *      （两截白不是同一种白，才是那条「台阶」的正主）；上沿 mask 由 alpha `0` 起改为
 *      **`.34` 起、24px 内补满**——紧贴顶栏那一条不再是「没有纸」，纸与底下那层 `blur(6px)`
 *      一起缓入，不再凭空冒出来。
 *   ② **顶栏底沿那段「化开」的纱**由 22px 拉到 **34px**、浓度由 `.45／.30／.12` 调匀成
 *      `.40／.26／.09`，让粉色薄纱往纸里多融一截。
 *   ③ **两处小细节**：名字那条虚线**靠名字那头实、往外那头渐隐**（随镜像翻方向）；
 *      头像外圈加一枚**极细白描边**（`0 0 0 1px rgba(255,255,255,.85)`），在纸上「坐得住」。
 *   **内容、切法、提示词一律没动**（提示词那一块仍按祖训 524 挂着）。
 * **1.7.31（恩熙看过 1.7.30 说「现在上面感觉还是有一个过渡衔接的样子」）**：1.7.30 那笔
 *   **方向不对**——它把纸的顶端调浓（`.60`）又把 mask 缓入拉到 24px，等于在交界处
 *   **自己造了一条 24px 的渐变带**，她看到的就是这条带子。这一版按平它：
 *   ① 纸的顶端浓度由 `.60` 收到 **`.45`**，与顶栏那层纱（`rgba(255,247,249,.45)`）
 *      **同色同浓度**——两截并成一整块，交界处没有浓淡差就没有带；
 *   ② 上沿 mask 由 `.34 起／24px` 改成 **`.92 起／10px`**，从「缓入一段」改成「只柔化
 *      最上面那行字」；
 *   ③ 顶栏底沿那截「化开的纱」（22px／1.7.30 的 34px）**整段撤掉**——它就叠在纸上，
 *      本身就是一条「由浓渐淡」的带子；
 *   ④ 顶栏补上底下纸那层 **`blur(6px)`**（原来只有纸上有模糊，交界处「一条糊一条不糊」）。
 *   **内容、切法、提示词一律没动**（提示词那一块仍按祖训 524 挂着）。
 * **1.7.32（恩熙在「线下场景签」这版里定的入口与形态）**：线下多一样**场景签**——她自己手标地点，
 *   他跟着换景往下写。① **入口**在她定的位置：**输入框上方一条淡功能条**，只挂「场景签」，
 *   右边一行小字报「此刻在 ××」（或「还没标地点」）；**输入栏那一行一个字没动**
 *   （左边那颗斜体钮要快、常用，她明确说了不要去动加号／这一行）。② **只写地点、不写时间**：
 *   线下是实时的，不必替它对表。③ **形态**：点「换到这儿」压一条 `role:"system"` 的**场景签**
 *   （`scene` 字段）在记录里——与「这一场到此」那条分界线**同一路，只给屏幕看**：不进记忆、
 *   不喂模型（`offlineAsMessages` 滤掉的就是 system）；长相刻意不同（分界线是灰实线、收场；
 *   场景签是粉虚线夹地名、换景）。④ **喂料另走一路**：ChatWindow 从记录里**倒着取最后一条
 *   场景签**（先撞上分界线就归零，新一场要重新标），拼一行「【场景】××」挂在她这一轮的话后面
 *   ——见 `currentSceneOf`。⑤ **提示词同版三处**（第 3 条＝以对话动作为主、神态心理比喻占比小；
 *   第 5 条＝自然往下推进、但上一轮写过的动作神态心境不再写、也不预告；第 9 条后加「【场景】」那句）。
 * **1.7.33（恩熙定的：线下锁死连发）**：这一页锁死成「连发」那一档——小飞机只管把话记下、
 *   **不请他**（无论他是不是正在写）；攒够了几句按**爱心**他才一次回完。爱心不再看设置里
 *   那颗开关（线下那颗已拿掉），只要她**有话没回**就亮。他一次回的是**好几只气泡**
 *   （台词一只、旁白一只，切法照旧，提示词一个字没动）。
 * **1.7.35（恩熙定的：他主动换景）**：他说得差不多了、或自己提议去别处，可以**自己换地方**，
 *   不必等她手动标。① **口令**`【换到：地点】`——**单独一行**、只写地点（提示词第 10 条，
 *   见 chatApi 的 buildOfflineStylePrompt）。② **切法**：他这一段的正文按换景行切开，
 *   切出几段就落几条——**段与段之间压一条场景签**（与她自己标的那条同形），地名就此换过去；
 *   底下那条「此刻在 ××」与下一轮喂料的「【场景】××」都跟着变（`moveSplit`／`entriesOfReply`）。
 *   ③ **换景不是收场**：不压「这一场到此」那条分界线，这一场接着往下走——**收场只能她自己点「结束」**。
 *   ④ 与此刻**同名＝没换**，不重复压签。
 * **1.7.41（恩熙：他那侧旁白里引用她的话不该变成台词块）**：模型写「他……她说／「保护」／
 *   的时候语气很自然」这种**把引用嵌在句子里**的旁白时，中间那截被引的**她的话**会被单拎成
 *   台词块，一句旁白还被断成两截。**只动切法一层，提示词一个字没动**：① `MENTION_AFTER_RE`
 *   ——引号**后头**紧跟着「的／的时候／那两个字」这类**名词化**的词时，整对引号连字留在旁白里
 *   （判据放在**开引号**处先往后看一眼配对闭引号，别放闭引号那刻，见 splitLine）；②
 *   `isContinuation` ＋ `parseScene` 的 `while` 缝句——一句话被硬拆成几行时先并回一句再切。
 *   凭据都很窄：上一行话说了（有句末标点）就一定不缝，正常一句一行一个字不动；真在他嘴里的
 *   台词照旧是台词块。切法本身仍是「只把引号里的当台词」，没换路子。
 * **1.7.42（恩熙：旁白末尾多出一个逗号／断在奇怪的位置）**：「他的声音更低了，“我不在乎。”」
 *   这句切在引号前头、旁白单拎成一行时，尾巴那个逗号本是连着后头台词的，单拎出来就成了断在
 *   半句上的多余标点。新增 `DANGLING_COMMA_RE` ＋ `dropDanglingComma`：**旁白块紧挨着一块台词**
 *   且旁白末尾是逗号／顿号／分号时，把这个尾巴摘掉；`parseScene` 末尾只对 `narrate=true` 那侧
 *   过一遍，她那侧自己打的一个字不动。旁白接旁白、旁白收尾（模型自己断的行）都不碰。
 * **1.7.43（恩熙：有些断句也有问题）**：模型偶尔写在**句子中间换行**，把紧跟的逗号甩到
 *   下一行行首（「他听见那句“我是喜欢你的」／「，脚步顿住。」），渲染出来那个逗号孤零零挂在
 *   段首、上一句也被切成两段。这个逗号是切在**引号前头**（1.7.42 管不到），也不属于
 *   1.7.41 那两种续行凭据。新增 `LEAD_PUNCT_RE` ＋ `isContinuation` 头一条判据：**下一行一上来
 *   就是标点**（逗号／顿号／分号／冒号／问叹／闭引号／右括号——标点绝不可能起头）时，
 *   无条件并回上一行末尾。仍是切法一层、提示词一个字没动；她那侧自己打的一个字不动。
 * **1.7.44（恩熙：还有本应该是气泡的文字没显现出来）**：模型写「他说，声音淡，但**每个字**都很
 *   清晰，"会控制不住地想知道你在和谁在一起……」——这句前半是他的旁白、后半在引号里的是他的
 *   台词，本该切成「旁白 ＋ 气泡」两块，实际整段都留在灰色旁白里。根因是**转述凭据收得太宽**
 *   （1.7.23 的 `ECHO_RE` 里挂着一个**裸的「个字」**）：引号紧前头那 8 个字（`ECHO_WINDOW`）里
 *   一出现「每个字」就被当成「他在转述别人的话」⇒ 引号里的台词连引号一起留在旁白、不成气泡。
 *   改法：`ECHO_RE` 里那条裸的 `个字` 换成**带数词**的写法（`[两三一四五]个字`，如「那两个字」
 *   「三个字」照旧命中），「每个字」「一个字」这种不再误伤；`几个字`／`这几个字`／`那几个字`
 *   原样保留。仍是切法一层、提示词一个字没动；她那侧自己打的一个字不动。
 * **1.7.45（恩熙：他老绕着第一轮我说的话打转，连台词都原句搬回来——「不要怕改的地方多，
 *   我要确保我的东西不会重复」）**：病根不在切法，在**喂料**——每轮把前文整段原文原样回喂，
 *   模型看得见「演过什么」，却看不见「演到哪了」⇒ 每轮都在答她第一轮抛的那句、同一态度换着
 *   法儿再表一遍、说过的台词一字不差又写一遍。照参考项目那套「每轮自报一条事件小结」的做法
 *   治（见提示词第 12 条）：TA 每轮结尾**另起一行**写「【本轮】××」（一句话说清这一轮刚发生
 *   的那一件事，例：【本轮】他问她到底想不想跟他走），这行由这里摘出来、不上屏、不算他戏里
 *   的话，只挂在**这一轮最后一条** `assistant` 记录上当进度单（`OfflineEntry.beat`）；下一轮
 *   由 `ChatWindow` 把前面各轮的 beat 按顺序拼成「【已经演过的】」摆在他眼前。摘法与「【换到：
 *   地点】」同一套容错（行首装饰符、方括号半／全角、冒号可省、行尾多带标点），**独占一行才
 *   认**——写歪了认不出来＝当普通正文，与从前一模一样。流式预览里换景口令与进度行一并挡住，
 *   不让她看见半行「【本轮」。仍是切法一层＋喂料一层，提示词正文改动已过恩熙点头（祖训 524）。
 * 顶栏那两颗钮的**活**换了（皮没换）：左边＝**返回**（只是回线上看记录，这一场没结束——
 * 1.7.39 起这一趟线上仍旧锁着，想说话得点线上那条「回到这一场」），
 * 右边＝线下设置（字数要求／结束这一场／重开一场）。「结束」在设置弹层里，点它才算收场。
 *
 * 一轮正文怎么切（1.7.13）：`*…*` 包住的当动作描述；TA 那侧另外**只把引号里的当台词**，
 * 引号外头的一律落成动作描述（她那张图里「视野突然被…堵死」那种整段旁白就是这么剥出来的），
 * 顺带把半角引号／逗号问号收拾成全角。切法见 parseScene——她那侧自己手打的话走同一套，
 * 但没标 `act` 就整条当台词。切不开的行一律当台词，宁可多一只气泡、不可丢字。
 *
 * 输入栏（1.7.11）也是线上那一行的骨架：左边一颗斜体钮（**动作／心声模式**，开着时她写下来的
 * 整条都是旁白、不走右粉气泡）、中间书写框、右边爱心（催他回）＋小飞机（写下去／停下）。
 * **1.7.33 起线下锁死连发**：小飞机只管把话记下、**不请他**（无论他是不是正在写）；
 * 攒够了几句按爱心他才一次回完；爱心不再看那颗开关，只要她**有话没回**就亮。
 *
 * 写法提示词单独一份（chatApi 的 buildOfflineStylePrompt），线上那套格式规矩一条不套进来；
 * 生成由 ChatWindow 代劳（档案／世界书／记忆与 API 都在那边，见 OfflineGenerate），
 * 这一页只管记录、排版与设置。
 *
 * 记录单开一份存档（`chat-offline-scenes`，见 settings/chat.ts），**不塞进 messages**——
 * 那边绑着未读数、列表预览、媒体占位一大片假设。但**线上线下记忆是通的**（1.7.7）：
 * 这一场的经过由 ChatWindow 并回线上——① 拼成一条「经过」挂在线上请求的上下文最前
 * （见 offlineAsMessages / offlineTranscript），② 收场时留一句「你们刚见过」的短说明，
 * 线上下一轮带上（用掉即清）。
 * **1.7.46 起归总不再并进线上那一趟**：见面自有一条记忆线，由 ChatWindow 按「几轮」
 * 自己归总（见 memory.ts 的 maybeRunOfflineCondense）——两边各数各的账，
 * 同一段见面不会被归总两遍。
 * **1.7.47（恩熙：场景签「也是不会自动推进」）**：1.7.35／1.7.40 两版都没治好——病根是他那行
 * 口令**带了个判断题**（「挪了地方才写、没挪就别写」），他判断不出来就干脆不写。改法＝把这行
 * 换成**每轮无条件都写**的「【此地】地点」（提示词第 11 条，改动已过恩熙点头）：① `SITE_RE`
 * 认这一行，末段这条报的是**这一轮结束时**在哪儿，跟当前签一比、不一样就自动换签（跟 `MOVE_RE`
 * 同走 `moveSplit`，老写法「【换到：地点】」照旧认，兼容旧会话）；② **认景兜底**——他这一轮
 * 一字没交代时，`guessSpot` 从他自己的话里认最后那处落脚点（走进／来到／进了／抵达／拐进／
 * 踏进／回到／推开…的门），替他挪签；认不出、跟此刻同名、或认出来的不像地名，都什么也不动
 * （宁可不动，也不乱标；标歪了她点「场景签」照样能改）。
 *
 * 收场要点**「结束」**——这是这一场唯一的出口：没点之前一直在线下，不会自己跳回线上。
 * 收场时在记录尾巴上压一条**分界线**（1.7.9）：记录**不删**，只是从此处起算新的一场，
 * 下次进来一眼看得出从哪儿起是新的一段（分界线只给屏幕看，不进记忆、不喂模型）。
 * ======================================================================= */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronUp, Flag, Heart, Italic, MapPin, MoreHorizontal, PenLine, RotateCcw, Send, SquareStop, Trash2 } from "lucide-react";
import type { ChatMessage, OfflineEntry } from "@/types/chat";
import {
  OFFLINE_ROUNDS_CEIL,
  OFFLINE_ROUNDS_FLOOR,
  OFFLINE_WORDS_CEIL,
  OFFLINE_WORDS_FLOOR,
  clearOfflineScene,
  getOfflineScene,
  saveOfflineScene,
} from "@/lib/settings/chat";
import { uuid } from "@/lib/uuid";
import { AVATAR_GRADIENT, CHAT_BG_DEFAULT, CHAT_PAGE_SIZE, KAI, SANS, SERIF, T } from "./shared";

/** 生成一段线下正文。由 ChatWindow 提供：那边才拿得到档案／世界书／记忆与生效中的 API。 */
export type OfflineGenerate = (args: {
  /** 这一段之前的所有记录（含她刚写的那条）。 */
  history: OfflineEntry[];
  /** 她这一轮写的话／动作。 */
  input: string;
  /** 流式：每来一截就回吐全文（页面拿它做打字机预览）。 */
  onDelta: (full: string) => void;
  signal: AbortSignal;
  /** 这一轮**真发出去的原样**、以及连发合并的记账（1.7.51／1.8.4）：
   *  ChatWindow 把她这条话连同【场景】／【进度】那句／易变尾巴拼成那一整份回吐出来，
   *  页面记在她这条记录上（见 OfflineEntry.apiText），下一轮回喂逐字送回。
   *  `carryId`＝承接合并的那一条（也是记 apiText 的那条）；`foldedIds`＝并进它的前几条
   *  （落 `foldedInto`，回喂时不再单独出现）；`merged`＝合并后的光原文（落 `mergedText`，
   *  给记忆归总与回线上那份「经过」——它们走非回喂那一路，不读带尾巴的 apiText）。
   *  她只发了一条时 `foldedIds` 为空、`merged` 就等于那一句。 */
  onSent?: (patch: {
    carryId: string;
    foldedIds: string[];
    text: string;
    merged: string;
  }) => void;
}) => Promise<string>;

/* ---------- 线下记录并回线上（1.7.7） ---------- */

/** 线下记录里能回喂的那些（滤掉给屏幕看的失败提示），转成消息形状。
 *  记忆浓缩与线下自己那一趟请求都用它——别在别处再抄一遍这个映射。
 *
 *  她标了 `act` 的那些（1.7.11）：包上 `*…*` 再喂——页面里 TA 的旁白就是这个写法，
 *  不标一下，模型看见「恩熙：我推开门」分不出是动作还是台词，下一段就会跟着写错。
 *  换行压成空格：星号只包得住一行（`parseScene` 也是按行认的），包不进去反而更乱。 */
export function offlineAsMessages(entries: OfflineEntry[], verbatim = false): ChatMessage[] {
  return entries
    .filter((e) => e.role !== "system" && !e.foldedInto)
    .map((e) => {
      /* 连发并过来的那几条（1.8.4）：内容由承接那条的 `mergedText` 一次给出——
         并进去的那几条这一路不再单独出现（屏幕上照旧一格一句话，见 OfflineEntry.foldedInto）。 */
      const bare = e.mergedText
        ? e.mergedText
        : e.act
          ? `*${e.content.replace(/\s*\n\s*/g, " ").trim()}*`
          : e.content;
      /* verbatim（1.7.51）：喂料那一趟要的是**上一轮真发出去的原样**——她那句话后头挂着
         【场景】／【进度】那句／此刻那一串，回喂时若只剩光原话，站子逐字比对到这条就断，
         其后整段每轮作废重写（线上早有这一格，见 ChatMessage.apiText）。
         记忆浓缩照旧走光原文（默认 false）：尾巴是给模型看的现场，不该并进记忆，
         回线上那份「经过」（offlineTranscript）也一样。 */
      /* 进度行随段落走（1.7.60，恩熙 2026-09-28 点头「跟线上一样」）：
         原先进度单是**攒成一份、塞在她这一轮的话里**——那句话每轮全新，于是整份进度
         每轮重掏一次钱，场子越久越厚（实测「输入」一路涨到 1.4 万，线上只有几百）。
         改成缀在**各段自己身上**：喂料那一趟把这条段落自己那句【本轮】接回末尾，
         进度就跟着「被缓存盖住的历史」走，每轮只多出新增那一条的增量。
         TA 照样看得见演到哪了——一条不少，只是散在各段尾，且离它所属的那段更近。
         只认 verbatim（喂料那一趟）：记忆浓缩与回线上那份「经过」照旧要光原文。 */
      const withBeat =
        verbatim && e.role === "assistant" && e.beat ? `${bare}\n【本轮】${e.beat}` : bare;
      return {
        id: e.id,
        role: e.role,
        content:
          verbatim && e.role === "user" && e.apiText ? e.apiText : withBeat,
        createdAt: e.createdAt,
        isRead: true,
      };
    });
}

/** 此刻在哪儿（1.7.32）：记录里**最后一条场景签**的地点。
 *  倒着扫，先撞上「这一场到此」那条分界线就归零——新的一场要重新标地点，
 *  与喂料那一路（ChatWindow 的 generateOfflineReply）同一个口径。没有＝还没标过。
 *
 *  两处共用：① 线下页那条淡功能条上显示「此刻在 ××」；② 喂模型时拼「【场景】××」。 */
export function currentSceneOf(entries: OfflineEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.divider) return "";
    if (e.scene) return e.scene;
  }
  return "";
}

/** 这一场的记录（1.7.46）：**最后一条分界线之后**的那些。
 *  归总按「这一场」算账——上一场已经收场、归总过了，不再卷进来重算一遍。
 *  没划过线＝整份记录。喂料那一路（ChatWindow 的 generateOfflineReply）同一条口径。 */
export function sceneEntriesOf(entries: OfflineEntry[]): OfflineEntry[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].divider) return entries.slice(i + 1);
  }
  return entries;
}

/** 拼回线上时最多带最近这么多条——她说的「上下文 50 条」；整场太长就只留近段。 */
const OFFLINE_TAKE = 50;

/**
 * 把这一场拼成**一条**「经过」消息，挂在线上请求的上下文最前（1.7.7）。
 *
 * 为什么拼成一条、不按条塞进历史：线上那套【消息格式】是微信体（短、碎、不写动作），
 * 线下正文是小说体（旁白＋台词）。一条条混进历史，等于每轮都在给他示范错误的格式。
 * 包成一条带抬头、写明「这是见面、不在手机上」的记录，他读得懂那是**见过面**，
 * 又不会把旁白学进下一句回复里。
 *
 * 为什么挂最前、不贴在本轮前面：挂最前，前缀在这一整段区间里恒定（只往尾巴上加新消息），
 * 站的自动前缀缓存才连读；贴到本轮前面就成了「每轮往后挪一格」，整段缓存轮轮作废。
 * 条数上限就是她说的 50 条，再老的由记忆的裁剪口径（contextLimit）接手兜着。
 */
export function offlineTranscript(
  entries: OfflineEntry[],
  charName: string,
  myName: string,
): ChatMessage | null {
  const lines = offlineAsMessages(entries).slice(-OFFLINE_TAKE);
  if (lines.length === 0) return null;
  const body = lines
    .map((m) => `${m.role === "user" ? myName : charName}：${m.content.trim()}`)
    .join("\n");
  return {
    id: "offline-transcript",
    role: "user",
    content:
      "【你们线下见过面 · 最近一次（在一处，没隔着手机）】\n" +
      "以下是那次见面的经过，当作你亲历过的；现在你们回到手机上说话。\n\n" +
      body,
    createdAt: lines[lines.length - 1].createdAt,
    isRead: true,
  };
}

/** 进线下时最多带最近这么多条线上消息（1.8.4）。 */
const ONLINE_TAKE = 30;

/**
 * 把**线上刚才那一段**拼成一条挂在见面请求的上下文最前（1.8.4）。
 *
 * 为什么要有它：`offlineTranscript` 管的是反方向（见过面回到手机，让他记得见过），
 * 这一条管进线下那一头——此前进线下只带线下记录本身与记忆，线上聊的内容一个字没带，
 * 于是他不知道她为什么突然来见面，张口就是「你怎么来了」。
 *
 * 与 `offlineTranscript` 同一条做法：拼成**一条**、挂最前（不贴在本轮前面）——
 * 见面期间线上是冻着的，这一条逐字不变，站子的前缀缓存能一路连读；按条混进历史
 * 反而会把微信体的短句一盏一盏喂成见面小说的写法（格式串味）。
 *
 * 只给他读：不落库、不上屏、不进记忆（`offlineAsMessages` 那一路与此无涉）。 */
export function onlineTranscript(
  messages: ChatMessage[],
  charName: string,
  myName: string,
): ChatMessage | null {
  const lines = messages
    .filter((m) => m.role !== "system" && m.content.trim() !== "")
    .slice(-ONLINE_TAKE);
  if (lines.length === 0) return null;
  const body = lines
    .map((m) => `${m.role === "user" ? myName : charName}：${m.content.trim()}`)
    .join("\n");
  return {
    id: "online-transcript",
    role: "user",
    content:
      "【你们刚在手机上聊过 · 最近一段（隔着手机）】\n" +
      "以下是刚才手机上说过的话，当作你亲历过的；现在她来见你了，你们就在一处、没隔着手机。\n\n" +
      body,
    createdAt: lines[lines.length - 1].createdAt,
    isRead: true,
  };
}

export default function OfflineScenePage({
  charName,
  charAvatar,
  charSignature,
  myName,
  myAvatar,
  mySignature,
  bg,
  characterId,
  maskId,
  words,
  onWordsChange,
  rounds,
  onRoundsChange,
  onGenerate,
  onRoundEnd,
  onEnd,
}: {
  charName: string;
  charAvatar?: string;
  /** TA 的名字底下那行签名——线上顶栏就挂着它，线下照抄。 */
  charSignature?: string;
  /** 她自己的名字与头像——右侧气泡要用，跟线上同一套。 */
  myName: string;
  myAvatar?: string;
  /** 她那行签名（「我」页面那句真签名）；线上顶栏也是它。 */
  mySignature?: string;
  /** 聊天壁纸（线上那张，她自定义过就跟着走）。 */
  bg?: string;
  characterId: string;
  maskId: string;
  /** 字数要求（已过 offlineWordsOf 的夹取）。 */
  words: { min: number; max: number };
  onWordsChange: (next: { min: number; max: number }) => void;
  /** 记忆「带最近几轮」（1.7.46，已过 offlineMemoryRoundsOf 的夹取）：一个数管两件事——
   *  每次只把最近这么多轮的原文摆给他；每攒够这么多轮就把这段归总进记忆。 */
  rounds: number;
  onRoundsChange: (n: number) => void;
  onGenerate: OfflineGenerate;
  /** 每演完一轮（她写一句、TA 回一段）叫一声（1.7.46）：ChatWindow 拿它看这一场攒够轮数没有，
   *  攒够就把这段归总进记忆。参数＝此刻的全部记录（已归总过的由水位线自己滤掉）。 */
  onRoundEnd?: (entries: OfflineEntry[]) => void;
  /** 离开线下、回到线上（「返回」与「结束」都走这里，1.7.10）。
   *  第一个参数＝这一场有没有真写过（有 TA 写下的段）——ChatWindow 拿它决定要不要
   *  给线上一句「你们刚见过」，并把这一场并进记忆。
   *  第二个参数＝**这一趟算不算收场**（1.7.39，恩熙定的）：`false`＝「返回」，
   *  只是把这一页收起来（回线上看记录），这一场还开着——总闸不落，线上发不了消息，
   *  「回到这一场」随时回来接着写；`true`＝「结束这一场」，才放平总闸、线上解锁。 */
  onEnd: (wrote: boolean, ended: boolean) => void;
}) {
  /** null＝还在读档（免得空场先闪一下）。 */
  const [entries, setEntries] = useState<OfflineEntry[] | null>(null);
  const [input, setInput] = useState("");
  /** 正在写的那一段（流式全文；空＝没在写）。 */
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSet, setShowSet] = useState(false);
  /** 这一条是**动作／神情／心里那句**，不是台词（1.7.11）：输入栏左边那颗斜体钮开着时是真的。
   *  开启状态只活在这一次「去见他」里，不落库——下次进来仍是「说话」那一档。 */
  const [actMode, setActMode] = useState(false);
  /** 场景签（1.7.32）：输入框上方那条淡功能条点开的小弹层，与里头待确认的地点。 */
  const [showScene, setShowScene] = useState(false);
  const [sceneDraft, setSceneDraft] = useState("");
  /** 正在改的那一条（1.7.50，null＝没在改）＋ 输入框里那份草稿。
   *  线上是长按气泡弹菜单，线下这一页是一条一条的剧本，长按整条弹这张底单（见 Turn）。 */
  const [editEntry, setEditEntry] = useState<OfflineEntry | null>(null);
  const [editDraft, setEditDraft] = useState("");
  /** 长按那一条要先问「改字还是重写」（1.7.62，恩熙 2026-09-28 定的）。
   *  原先是长按直接进编辑器——他写崩了一轮（被模型挡下、或者整段不对味）时，
   *  她要的是**把这一轮重写掉**，而这一页当时没有那条路（线上长按气泡弹的是菜单）。
   *  现在长按弹这张小菜单：改字（进下面那张底单）／重新生成（把这一轮他写的抹掉重跑）。 */
  const [menuEntry, setMenuEntry] = useState<OfflineEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 输入框（1.7.40）：发出去以后要把它的高度收回来（见 send）。
   *  受控输入框只 setInput("") 不会让 height 复位，之前打完两行发出去框就停在两行。 */
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 滚动容器（1.7.36）：加载更早的记录时要靠它把视口钉住（见 loadMore）。 */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 历史分页（1.7.36）：记录**默认只上屏最近 CHAT_PAGE_SIZE 条**，再往前的要她点
      顶上那颗「加载更早的」才一次推上来——线上消息流同一枚数、同一套做法（见 ChatWindow）。
      **只切屏幕这一路**：喂模型的 history 一直是这一场的全量 entries（见 ChatWindow 那段），
      所以翻页不动上下文、不动记忆。换角色／面具即归零。 */
  const [visibleCount, setVisibleCount] = useState(CHAT_PAGE_SIZE);
  /** 记录的最新一份（真值，不是 render 里那份快照）。TA 正写着的时候她照样能发，
   *  他写完那一段要接在**最新**的尾巴上——拿发起时那份快照往回盖，会把她后加的抹掉（见 run）。 */
  const entriesRef = useRef<OfflineEntry[] | null>(null);

  /** 此刻在哪儿（1.7.32）：给功能条上那行小字用。喂模型那一份由 ChatWindow 自己算
   *  （同一个 currentSceneOf，同一条口径）。 */
  const currentScene = useMemo(() => currentSceneOf(entries ?? []), [entries]);

  useEffect(() => {
    let alive = true;
    void getOfflineScene(characterId, maskId).then((scene) => {
      if (alive) {
        entriesRef.current = scene.entries;
        setEntries(scene.entries);
        /* 换角色／面具＝从头来过：分页翻回最近那一页，不记上次翻到哪儿（与线上同口径）。 */
        setVisibleCount(CHAT_PAGE_SIZE);
      }
    });
    return () => {
      alive = false;
    };
  }, [characterId, maskId]);

  /* 离开这一页（换角色／面具、或返回）时把还在写的那一段掐掉：
     不然流完还要往一份已经换掉的记录里写。 */
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /* 新内容进来就沉到底：这一页是往下读的，别让新写的一段藏在屏幕外。 */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries, draft]);

  const persist = useCallback(
    (next: OfflineEntry[]) => {
      /* 真值与 state 一起更新：落库、渲染、以及「接在哪儿」都以它为凭（见 entriesRef）。 */
      entriesRef.current = next;
      setEntries(next);
      void saveOfflineScene(characterId, maskId, next);
    },
    [characterId, maskId],
  );

  /** 场景签（1.7.32）：把地点压成一条 `system` 记录——与分界线同理，**只给屏幕看**
   *  （不进记忆、不喂模型）；喂料走「【场景】××」那一行（见 currentSceneOf）。
   *  从这一条起他写下去的都发生在这儿。与当前地点同名就什么也不落（切回旧地点照旧落）。 */
  const setScene = useCallback(() => {
    const name = sceneDraft.trim();
    setShowScene(false);
    if (!name || name === currentScene) return;
    persist([
      ...(entriesRef.current ?? entries ?? []),
      { id: uuid(), role: "system", content: "", createdAt: new Date().toISOString(), scene: name },
    ]);
  }, [sceneDraft, currentScene, entries, persist]);

  /** 打开编辑器（1.7.50）：把这一条的原文摆进底单。1.7.62 起由长按菜单的「改字」进来
   *  （长按本身先弹菜单，见 openMenu）。
   *  只给**话**开（`Turn` 里只对 user／assistant 挂长按）：分界线、场景签、失败提示这些
   *  是屏幕自己的记号，改它们没有意义。 */
  const openEdit = useCallback((entry: OfflineEntry) => {
    setEditEntry(entry);
    setEditDraft(entry.content);
  }, []);

  /** 长按那一条 → 弹菜单（1.7.62）：先问「改字还是重写」。
   *  从前长按是**直接**进编辑器，于是「他这一轮被挡下了／写歪了，想让他重写」根本没有入口。 */
  const openMenu = useCallback((entry: OfflineEntry) => setMenuEntry(entry), []);

  /** 存下改后的这一条。线下这一页的记录**就是**这一场的存档（`persist` 落
   *  `chat-offline-scenes`），改完下一次发送／点爱心时 `run` 从 `entriesRef` 现取，
   *  喂给他的历史里就已经是改后的话。
   *  改过的这条要**连同「上一轮真发出去的原样」一起抹掉**（1.7.51）：那份里记的是改前的
   *  字，留着回喂就对不上屏幕上的话（线上同一格，见 ChatMessage.apiText）。 */
  const saveEdit = useCallback(() => {
    if (!editEntry) return;
    const text = editDraft.trim();
    if (!text) return;
    const base = entriesRef.current ?? entries ?? [];
    persist(
      base.map((e) => {
        if (e.id !== editEntry.id) return e;
        const next: OfflineEntry = { ...e, content: text };
        delete next.apiText;
        return next;
      }),
    );
    setEditEntry(null);
  }, [editEntry, editDraft, entries, persist]);

  /** 跑一段：history 里已含她这一轮那条，回来接 TA 一段（失败落一条可重来的提示）。
   *  落在哪儿见 weave——他这一段要接在**他当时看到的那条**后面，不是记录的尾巴上。 */
  const run = useCallback(
    async (history: OfflineEntry[], said: string) => {
      setBusy(true);
      setDraft("");
      const controller = new AbortController();
      abortRef.current = controller;
      const stamp = () => new Date().toISOString();
      /* 他这一段插在哪儿（1.7.11）：接在**他当时看到的那条**（history 的尾巴）后面。
         她趁他写着的时候又发的那几条（连续发送）原样留在后头——这样记录的顺序才是真的，
         她再按爱心（见 pending）也就有得催；若一律接在记录的尾巴上，她后加的那几条
         会被记成「他已经回过了」，既没人回、爱心也不亮。 */
      const weave = (tails: OfflineEntry[]): OfflineEntry[] => {
        const base = entriesRef.current ?? history;
        const anchor = history[history.length - 1]?.id;
        const at = anchor ? base.findIndex((e) => e.id === anchor) : -1;
        if (at < 0) return [...base, ...tails];
        return [...base.slice(0, at + 1), ...tails, ...base.slice(at + 1)];
      };
      /* 他这一段（1.7.35）：按换景行切开落。切出几段就落几条——**段与段之间压一条场景签**
         （与她自己标的那条同形，见 setScene），地点就此换过去，底下那条「此刻在 ××」
         与下一轮喂料的「【场景】××」都跟着变。换地方**不是收场**（不压分界线），
         这一场接着往下走。没有换景行时就一条，与从前一模一样。
         起点取**他当时看到的**那个地点（history，而非 entriesRef）——她趁他写着的时候
         自己改了场景签，不该把他也算成「换景」。与此刻同名＝没换，不重复压签（见 setScene）。
         1.7.47 两处：① 末段那条「【此地】地点」也当换景行（`SITE_RE`）——报的是这一轮结束时
         在哪儿，不一样就换签；② 他这一轮**一字没交代**时，由 `guessSpot` 从他自己的话里认
         最后那处落脚点兜底（宁可不动，也不乱标）。 */
      const entriesOfReply = (text: string): OfflineEntry[] => {
        const out: OfflineEntry[] = [];
        let now = currentSceneOf(history);
        /* 进度行（1.7.45）：先从正文里摘出来——它不上屏、不算他戏里的话，只留作下一轮的进度单。 */
        const { text: body, beats } = takeBeats(text);
        const { parts, declared } = moveSplit(body);
        for (const { scene, content } of parts) {
          if (scene && scene !== now) {
            out.push({ id: uuid(), role: "system", content: "", createdAt: stamp(), scene });
            now = scene;
          }
          if (content) out.push({ id: uuid(), role: "assistant", content, createdAt: stamp() });
        }
        /* 认景兜底（1.7.47）：他这轮自己没交代在哪儿，就从他的话里认最后那个落脚点，
           压在整轮下头——底下那条「此刻在 ××」跟着挪。跟此刻同名就不动。 */
        if (!declared) {
          const spot = guessSpot(body);
          if (spot && spot !== now) {
            out.push({ id: uuid(), role: "system", content: "", createdAt: stamp(), scene: spot });
          }
        }
        /* 一个字都没写出来（或整段只剩换景行）：仍照老规矩兜一条省略号，别当成没回过。 */
        if (out.length === 0) {
          out.push({ id: uuid(), role: "assistant", content: "……", createdAt: stamp() });
        }
        /* 进度行挂在**最后一条他写的记录**上（1.7.45）：他这一轮可能自己切了好几段，
           进度行说的是**整轮**发生过什么，跟着末段走。 */
        if (beats.length > 0) {
          for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].role === "assistant") {
              out[i].beat = beats.join("；");
              break;
            }
          }
        }
        return out;
      };
      try {
        const full = await onGenerate({
          history,
          input: said,
          /* 打字机预览（1.7.45）：换景口令与「【本轮】××」进度行都不该在预览里露面，
             这里先把这类整行挡住（正式落盘由 moveSplit／takeBeats 摘掉）。 */
          onDelta: (chunk) => setDraft(stripMarkLines(chunk)),
          signal: controller.signal,
          /* 发出去＝存下来＝回喂（1.7.51）：把这一轮真发出去的那一整份记在她这条话上，
             下一轮回喂原样送回，站子的前缀缓存才不会从这条起作废（线上早有这一格）。
             连发攒下的那几条（1.8.4）：只有**承接**那条记正文，前几条落 `foldedInto`
             ——回喂时不单独出现，可屏幕上照旧一格一句，不并、不删。 */
          onSent: ({ carryId, foldedIds, text, merged }) => {
            const base = entriesRef.current ?? history;
            persist(
              base.map((e) => {
                if (e.id === carryId) {
                  return foldedIds.length > 0
                    ? { ...e, apiText: text, mergedText: merged }
                    : { ...e, apiText: text };
                }
                if (foldedIds.includes(e.id)) return { ...e, foldedInto: carryId };
                return e;
              }),
            );
          },
        });
        const next = weave(entriesOfReply(full.trim()));
        persist(next);
        /* 一轮演完了（她写一句、TA 回一段）：叫一声 ChatWindow——那边看这一场攒够
           「带最近 __ 轮」那么多轮没有，攒够就把这段归总进记忆（1.7.46）。
           失败那一趟不叫（只落了一条提示，不算一轮）。 */
        onRoundEnd?.(next);
      } catch (err) {
        /* 掐断不算错：留一条可重来的提示，她点「重新写」就接着走。 */
        const stopped = controller.signal.aborted;
        const msg = stopped
          ? "你叫停了这一场。"
          : err instanceof Error && err.message
            ? err.message
            : "这一场没能写下去，稍后再试。";
        persist(
          weave([
            { id: uuid(), role: "system", content: msg, createdAt: stamp(), retryable: true },
          ]),
        );
      } finally {
        setBusy(false);
        setDraft("");
        abortRef.current = null;
      }
    },
    [onGenerate, persist, onRoundEnd],
  );

  const send = useCallback(() => {
    const said = input.trim();
    if (!said || entries === null) return;
    const mine: OfflineEntry = {
      id: uuid(),
      role: "user",
      content: said,
      createdAt: new Date().toISOString(),
      /* 开着那颗斜体钮写下来的，整条都是旁白（见 actMode）。 */
      ...(actMode ? { act: true } : {}),
    };
    const next = [...(entriesRef.current ?? entries), mine];
    persist(next);
    setInput("");
    /* 高度收回来（1.7.40）：清空文字不会动 height，不收回的话打完两行出去的框就停在两行。 */
    const el = inputRef.current;
    if (el) el.style.height = "auto";
    /* 线下锁死连发（1.7.33）：小飞机只管把话记下、**不请他**——无论他是不是正在写。
       攒着的那几句由爱心一次交给他（见 forceReply）。 */
  }, [actMode, entries, input, persist]);

  /** 重来某一轮：那条失败提示去掉，拿它前面她说的话重跑（不用重新打字）。
   *  先把记录退回到那一步再跑——run 落库以最新记录为准（见 entriesRef），
   *  不退回去的话，被重写的那半截（连同那条失败提示）会原样留着。 */
  const retry = useCallback(
    (failId: string) => {
      const list = entries ?? [];
      if (busy) return;
      const idx = list.findIndex((e) => e.id === failId);
      if (idx < 0) return;
      let u = idx - 1;
      while (u >= 0 && list[u].role !== "user") u--;
      if (u < 0) return;
      const trimmed = list.slice(0, u + 1);
      persist(trimmed);
      /* 她那句要是**连发合并**的承接条（1.8.4）：重跑时交给请求的是合并原文，
         不是光最后那一句——并进去的几句已经从回喂历史里摘掉了，只带最后一句就等于丢话。 */
      void run(trimmed, list[u].mergedText ?? list[u].content);
    },
    [busy, entries, persist, run],
  );

  /** 重新生成某一轮（1.7.62，恩熙 2026-09-28 点头）：把**他这一轮写的**从记录里抹掉，
   *  拿她刚才那句话重跑一遍——被抹掉的那些不会留在记录里，也不会进下一轮喂给他的历史
   *  （喂料走 entriesRef，见 run 的 weave）。
   *
   *  与「重新写」（retry）的分工：retry 治的是**没成**那一趟（失败提示还挂在记录上，
   *  要连提示一起切掉）；这里治的是**已经落下来的正文**——模型没报错、却回了一段
   *  拒绝的话，或者整段写歪了，他要重写的就是这一段。
   *
   *  切法：从这条往前走一条**她说的话**（u），往后走到**下一条她说的话之前**（end）——
   *  中间整段（他这一轮切的几段、夹着的场景签）都算这一轮，一并换掉。
   *  她趁他写着又连发的那几句留在 end 之后，**不删**（他重写的那段由 weave 插回原位）。
   *  history 只递到她那句话为止：那几句还没轮到他看见。 */
  const regenerate = useCallback(
    (entryId: string) => {
      if (busy) return;
      const base = entriesRef.current ?? entries ?? [];
      const idx = base.findIndex((e) => e.id === entryId);
      if (idx < 0) return;
      let u = idx - 1;
      while (u >= 0 && base[u].role !== "user") u--;
      if (u < 0) return;
      let end = u + 1;
      while (end < base.length && base[end].role !== "user") end++;
      const hist = base.slice(0, u + 1);
      persist([...hist, ...base.slice(end)]);
      /* 同 retry（1.8.4）：承接条给的是**合并原文**，别只递最后一句。 */
      void run(hist, base[u].mergedText ?? base[u].content);
    },
    [busy, entries, persist, run],
  );

  /* ---------- 待回复队列：末尾连着的一串她的话（连发攒下的） ---------- */
  const pending = useMemo(() => {
    const list = entries ?? [];
    let i = list.length - 1;
    while (i >= 0 && list[i].role === "user") i--;
    return list.slice(i + 1);
  }, [entries]);
  /* 可以让他回：攒着没回的话 ＋ 他不在写。线下锁死连发（1.7.33），不再看设置里那颗开关
     ——**有话没回就亮**（恩熙定的：爱心只把「有话」这一种）。 */
  const canForceReply = pending.length > 0 && !busy;

  /** 爱心＝让他把攒下的几句一次回完（线上同一颗、同一个活）。 */
  const forceReply = useCallback(() => {
    if (!canForceReply) return;
    const last = pending[pending.length - 1];
    /* 承接条有合并原文就给合并原文（1.8.4）：只递最后一句会把并进去的几句丢掉。 */
    void run(entriesRef.current ?? [], last.mergedText ?? last.content);
  }, [canForceReply, pending, run]);

  /** 「返回」＝只是把这一页收起来，回线上看记录，**这一场没结束**（1.7.10 恩熙定的，
   *  1.7.39 把「没结束」这层意思落到实处）：下次点「去见他」、或点线上那条
   *  「回到这一场」，接着往下写，所以**不划线**——线只在「结束」时压（见 endScene）。
   *  1.7.39 起这一趟**不再并进记忆、也不给线上留「你们刚见过」**：那一场还开着，
   *  记录随时还会往下长，中途并一次是白并；等真「结束」了再一起算（见 ChatWindow 的 onEnd）。 */
  const leaveScene = useCallback(() => {
    abortRef.current?.abort();
    onEnd((entries ?? []).some((e) => e.role === "assistant"), false);
  }, [entries, onEnd]);

  /** 「结束」＝这一场收场（他说要回去了）：先掐掉还在写的那一段，再跳回线上。
   *  入口在**设置弹层**里（1.7.10 从左上角挪过去的——那里改成了「返回」）。
   *  1.7.39 起这一颗还管着线上那扇门：ChatWindow 收到 `ended === true` 才把
   *  「这一场开着」的总闸放平，线上才又能打字。
   *
   *  收场时在记录尾巴上压一条**分界线**（1.7.9，恩熙定的）——**不删记录**：
   *  这一场到此为止，下次进来写的就是新的一场，一眼看得出从哪儿起是新的一段。
   *  这条线也是「从 0 起算」的记号：ChatWindow 的 generateOfflineReply 喂料时
   *  只取**最后一条分界线之后**的（旧场靠记忆接续，不再整段重放）。
   *  空场（她点开又原样退出、TA 一个字没写）不划线，免得多出一条无意义的线。 */
  const endScene = useCallback(() => {
    abortRef.current?.abort();
    const list = entries ?? [];
    const wrote = list.some((e) => e.role === "assistant");
    if (wrote) {
      persist([
        ...list,
        {
          id: uuid(),
          role: "system",
          content: "",
          createdAt: new Date().toISOString(),
          divider: true,
        },
      ]);
    }
    onEnd(wrote, true);
  }, [entries, onEnd, persist]);

  const stepW = (which: "min" | "max", d: number) => {
    const clamp = (v: number) =>
      Math.min(OFFLINE_WORDS_CEIL, Math.max(OFFLINE_WORDS_FLOOR, Math.round(v)));
    const next = { ...words };
    if (which === "min") {
      next.min = clamp(words.min + d);
      /* 顶过上限就把上限让上去：两个数是一段区间，不该出现「下限高于上限」。 */
      if (next.min > next.max) next.max = next.min;
    } else {
      next.max = clamp(words.max + d);
      if (next.max < next.min) next.min = next.max;
    }
    onWordsChange(next);
  };

  /** 「记忆 · 带最近几轮」那颗步进（1.7.46）：±1，夹在 2–30（与 offlineMemoryRoundsOf 同一把夹子）。 */
  const stepRounds = (d: number) =>
    onRoundsChange(
      Math.min(OFFLINE_ROUNDS_CEIL, Math.max(OFFLINE_ROUNDS_FLOOR, rounds + d)),
    );

  /** 书写框自己长高（线上同款）：到 106 就打住，再多就在框里滚。
   *  **高度得先扣掉上下的内边距**：这个框没有 `box-sizing: border-box`，
   *  `style.height` 指「文字区」高度，而 `scrollHeight` 把 padding 也算进去了；
   *  不扣的话，一行字（24＋12＝36）会被当成文字区高度，框实际撑到 36＋12＝48px
   *  ——每打一个字框就凭空高出一截（恩熙说的「一输入就变成两行」）。
   *  `offsetHeight - clientHeight` 就是上下 padding（这里 border 为 0），不写死数值。 */
  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const t = e.target;
    t.style.height = "auto";
    const pad = t.offsetHeight - t.clientHeight;
    t.style.height = `${Math.min(t.scrollHeight - pad, 106)}px`;
  };

  const list = entries ?? [];

  /* 分页切片（1.7.36）：只把最近 visibleCount 条摆上屏，再往前的还没上来——
     顶上那颗「加载更早的」露不露、露几条，都由这两个数说了算。 */
  const shown = list.length > visibleCount ? list.slice(-visibleCount) : list;
  const olderCount = list.length - visibleCount;

  /* 加载更早的记录（1.7.36）：只把**上屏条数**往上推一格，记录本身一条都没动。
     推完要把视口钉住：新增的那些全在上头，不钉的话内容整体下坠，她正看着的那行会跑掉。
     做法＝记下推之前的 scrollHeight／scrollTop，推完（useLayoutEffect，还在上屏之前）
     把多出来的那段高度补回 scrollTop，屏幕上那行字一动不动。 */
  const loadMoreRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const loadMore = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      loadMoreRestoreRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    setVisibleCount((c) => Math.min(c + CHAT_PAGE_SIZE, list.length));
  }, [list.length]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const restore = loadMoreRestoreRef.current;
    if (!el || !restore) return;
    loadMoreRestoreRef.current = null;
    el.scrollTop = restore.scrollTop + (el.scrollHeight - restore.scrollHeight);
  }, [visibleCount]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        /* 92：压住聊天窗口里那几层（消息流 20／输入栏 30／弹层 55～75／聊天设置 90）。 */
        zIndex: 92,
        display: "flex",
        flexDirection: "column",
        /* 壁纸跟线上同一张（她自定义过也照搬）。**1.9.91 换新脸**：撤掉顶上那层暖粉径向——
           线上就是纯壁纸，这一页也跟着干净，不再自己压一层雾。 */
        background: bg || CHAT_BG_DEFAULT,
        fontFamily: SANS,
        color: T.ink,
        overflow: "hidden",
      }}
    >
      <style>{`
        .of-soft { transition: transform .16s ease, opacity .16s ease; }
        .of-soft:active { transform: scale(.93); opacity: .7; }
        .of-in { animation: ofIn .32s ease both; }
        @keyframes ofIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        /* 长按改话（1.7.50）：一整条剧本不让浏览器自己挑字，长按就只走我们这张底单
           （线上 .chat-body 那套的同一份，见 ChatWindow）。 */
        .of-turn { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
        /* 顶栏正中那颗小粉心会轻轻跳一下——**线上同一套**（见 ChatWindow）。
           线下这一页是见了面，但顶栏这颗心是聊天页的记号，照抄才像同一页。
           ⚠️ 同样别写 infinite（1.9.7）：无限动画会让合成器永远醒着、每 16ms 硬出一帧，
           手机的烫就是这么来的。只跳三下（约 5.7s）就歇，与线上保持一致。 */
        @keyframes heartBeat { 0%,100% { transform: scale(1); } 45% { transform: scale(1.14); } }
        .chat-heart { animation: heartBeat 1.9s ease-in-out 3; }
        /* 打字光标（1.7.18）：他正写着的时候，末尾跟一枚会闪的细竖线——
           1.7.18 以前是整块文字直接长出来，看不出「正在写」。颜色跟所在那块字走（currentColor）。 */
        .of-caret {
          display: inline-block; width: 2px; height: 1em; margin-left: 2px;
          vertical-align: -0.12em; border-radius: 1px; background: currentColor;
          opacity: .5; animation: ofCaret 1.05s linear infinite;
        }
        @keyframes ofCaret { 0%, 49% { opacity: .5; } 50%, 100% { opacity: 0; } }
        /* 书写框占位字：淡纸白（1.9.91 跟线上同款，见 ChatWindow）。 */
        .chat-input::placeholder { color: rgba(255,253,248,.42); }
        @media (prefers-reduced-motion: reduce) {
          .of-soft { transition: none; }
          .of-in { animation: none; }
          .chat-heart { animation: none; }
          .of-caret { animation: none; }
        }
      `}</style>

      {/* 顶栏（**1.9.91 换新脸**）：**整副照抄线上聊天页**（见 ChatWindow 那头 header）——
          墨底 `T.ink` 一整条、纸白的字与钮，中间两排：
            第一排：左「返回」、右「线下设置」，两颗都是**无边框透明的纸白图标**；
            第二排：他名（右对齐）＋ 44 见方、3px 描边、硬错影的两枚头像 ＋ 我名（左对齐）。
          名字用衬线大字 26／700 ＋ `2px 2px 0` 粉错影；底下签名纸白 `.55`。
          **撤掉旧的白胶囊与正中那颗会跳的粉心**——线上顶栏已经没有粉心了，线下跟着撤，
          两头才真的是一张脸。
          两颗钮的**活**不变：
            · 左边＝**返回**（1.7.10）：只是回线上看记录，**这一场没结束**，点「去见他」或线上那条
              「回到这一场」接着往下写（1.7.39：这一趟线上仍旧锁着，发不了消息）；
            · 右边＝线下设置（字数要求／连续发送／结束这一场／重开一场），图标仍是那三颗点。 */}
      <header
        style={{
          position: "relative",
          flex: "none",
          zIndex: 20,
          background: T.ink,
          padding:
            "calc(var(--safe-area-top, 0px) + max(var(--sim-status-h, 0px) - 10px, 6px)) 14px 12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 26,
          }}
        >
          <button
            type="button"
            onClick={leaveScene}
            aria-label="返回（这一场没结束，随时回来接着写）"
            className="of-soft"
            style={{ ...headerBtnStyle, width: "auto", height: "auto", color: "#FFFDF8", padding: 0 }}
          >
            <ChevronLeft size={27} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setShowSet(true)}
            aria-label="线下设置"
            className="of-soft"
            style={{ ...headerBtnStyle, width: "auto", height: "auto", color: "#FFFDF8", padding: 0 }}
          >
            <MoreHorizontal size={26} strokeWidth={2.6} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
          <div style={{ flex: 1, minWidth: 0, textAlign: "right", paddingRight: 13 }}>
            <span style={headerNameStyle}>{charName}</span>
            <HeaderSign text={charSignature} />
          </div>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6 }}>
            <HeaderAvatar avatar={charAvatar} fallbackChar={charName.charAt(0)} />
            <HeaderAvatar avatar={myAvatar} fallbackChar={myName.charAt(0)} variant="me" />
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left", paddingLeft: 13 }}>
            <span style={headerNameStyle}>{myName}</span>
            <HeaderSign text={mySignature} />
          </div>
        </div>
      </header>

      {/* 消息区（1.7.18 加上沿渐隐）：往上滚到顶栏底下时不再一刀切断——
          用一层 18px 的 mask 把最上面那截淡掉。mask 是「透出去」而不是盖一层色，
          所以底下透出来的就是壁纸本身，跟顶栏底下那段 22px 的纱接得上。
          **底下铺一张「纸」**（1.7.28）：恩熙拿参考图定的整体口径是**剧本纸**——
          消息不再直接挂在壁纸上，而是落在一层半透明的纸上，壁纸在底下**若隐若现**；
          字有了纸可依，才不必再往字上糊底、描边（见文件头 1.7.28）。
          **1.7.29 调透**：恩熙说「没有办法透出壁纸，不是很透」——alpha 由 .90／.87 降到
          .62／.56、模糊由 14px 收到 6px，让壁纸的轮廓与颜色真透上来（纸还在，只是变薄了）。
          **1.7.31 把这条接缝按平**：恩熙看过 1.7.30 说「上面感觉还是有一个过渡衔接的样子」——
          还是能看出一条「渐变带」。这一版把三处对齐：① 纸的顶端浓度由 `.60` 收到 **`.45`**，
          与顶栏那层纱**同色同浓度**，两截变成一整块；② 上沿 mask 由 `.34 起／24px` 改成
          **`.92 起／10px`**——原来那 24px 的缓入自己就是一条看得见的过渡带，现在只留 10px
          用来柔化滚上去的那行字，几乎不动纸的浓度；③ 顶栏自己也补上底下纸那层
          `blur(6px)`（原来只有纸上有模糊，交界处「一条糊一条不糊」也是缝的来路）。
          同时把顶栏底沿那截「化开的纱」**整段撤掉**（见 header 那段注释）——它叠在纸上
          就是那条带子。 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 0 20px",
          background:
            "linear-gradient(180deg, rgba(255,247,249,.45) 0%, rgba(255,250,247,.56) 100%)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,.92) 0, #000 10px)",
          maskImage: "linear-gradient(180deg, rgba(0,0,0,.92) 0, #000 10px)",
        }}
      >
        {entries === null ? null : list.length === 0 && !draft ? (
          <div
            style={{
              margin: "26px 18px 0",
              padding: "34px 20px",
              textAlign: "center",
              borderRadius: 20,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(255,255,255,.9)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 19, letterSpacing: ".06em" }}>还没见着面</div>
            <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.9, color: T.ink3 }}>
              在下面写下你此刻在做什么、说什么；
              <br />
              接下来的由他来接。
            </div>
          </div>
        ) : (
          <>
            {/* 历史分页（1.7.36）：上头还有没上屏的，就在记录最前面摆一颗「加载更早的」。
                报的是**这一场一共多少条**（不是这一页多少条）——她要知道的是总量；
                点一下再推一页上来，视口由上面那个 loadMoreRestoreRef 钉住、不动。 */}
            {olderCount > 0 ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 2px" }}>
                <button
                  type="button"
                  onClick={loadMore}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 14px", borderRadius: 999,
                    border: "1px solid rgba(232,106,155,.22)",
                    background: "rgba(255,255,255,.86)",
                    color: T.ink2, fontSize: 11.5, letterSpacing: ".06em", cursor: "pointer",
                  }}
                >
                  <ChevronUp size={13} strokeWidth={2} />
                  加载更早的 {Math.min(CHAT_PAGE_SIZE, olderCount)} 条 · 共 {list.length} 条
                </button>
              </div>
            ) : null}
            {shown.map((e, i) => (
              <Turn
                key={e.id}
                entry={e}
                charName={charName}
                charAvatar={charAvatar}
                myName={myName}
                myAvatar={myAvatar}
                first={i === 0 || shown[i - 1].role !== e.role}
                onRetry={retry}
                onLongPress={openMenu}
              />
            ))}
            {/* 正在写的那一段：跟 TA 已写好的同一副骨架，边写边长。
                草稿里星号常常只写了一半——parseScene 认「行首是星号」也是动作，
                免得先冒一只气泡再突然变灰。 */}
            {draft ? (
              <Turn
                entry={{ id: "draft", role: "assistant", content: draft, createdAt: "" }}
                charName={charName}
                charAvatar={charAvatar}
                myName={myName}
                myAvatar={myAvatar}
                first={list.length === 0 || list[list.length - 1].role !== "assistant"}
                onRetry={retry}
                typing
              />
            ) : busy ? (
              <div
                style={{
                  /* 跟新骨架的正文同一条左边界（1.7.28：头像 34 ＋ 缝 9 ＋ 16 ＝ 59）。 */
                  padding: "3.5px 16px 3.5px 59px",
                  fontSize: 11.5,
                  color: T.ink3,
                  letterSpacing: ".08em",
                }}
              >
                他正在写…
              </div>
            ) : null}
          </>
        )}

        <div ref={bottomRef} style={{ height: 8 }} />
      </div>

      {/* 底部输入区：**照抄线上聊天页**（见 ChatWindow 那条输入区）——
          一根实底白横杆压住壁纸、上沿一根发丝，里头一颗圆角 20 的白胶囊，
          一行四样：斜体钮（动作／心声）／书写框／爱心（催他回）／写下去（或停下）。
          皮全是线上那副：左边那颗白圆钮照 ＋ 那颗做，右边两颗实心粉圆照爱心与小飞机做。
          线上的 ＋ 面板没搬——里头是「发自拍／去见他」这些**隔着手机**的事，这一页已经见了面；
          那个位置改给了这颗斜体钮（1.7.11）：她要一条**动作／神情／心里那句**。
          爱心只要她**有话没回**就亮（见 canForceReply）——线下锁死连发（1.7.33），不看开关。 */}
      <div
        style={{
          position: "relative",
          flex: "none",
          /* **1.9.91 换新脸**：底部这一条改成实底**墨色**，跟顶栏一头一尾、中间留浅
             （与线上聊天页同款，见 ChatWindow 那头输入条）。原来压住照片的白横杆与顶上
             那根发丝线一并撤掉——墨底是实心的，压在上头的控件才立得住。 */
          background: T.ink,
          zIndex: 30,
          paddingBottom: "calc(var(--safe-area-bottom, 0px) + 6px)",
        }}
      >
        {/* 场景签入口（1.7.32）：输入框上方这条淡功能条，点「场景签」标个地点。
            只写地名、不写时间——线下是实时的，他跟着这个地点往下写。
            刻意不碰下面那行输入栏：斜体钮要快、常用，恩熙说了不要动它。 */}
        <div style={sceneBarStyle}>
          <button
            type="button"
            onClick={() => {
              setSceneDraft(currentScene);
              setShowScene(true);
            }}
            className="of-soft"
            style={sceneBtnStyle}
          >
            <MapPin size={12} strokeWidth={2} />
            场景签
          </button>
          <span style={sceneNowStyle}>
            {currentScene ? `此刻在 ${currentScene}` : "还没标地点"}
          </span>
        </div>
        <div style={{ padding: "10px 14px 4px" }}>
          <div style={inputBarStyle}>
            {/* 斜体钮（1.7.11）：开着的时候，她写下来的整条都当**动作／神情／心里那句**，
                渲染成浅灰斜体旁白，不走右边那只粉气泡。1.9.91 换新脸：底色改成墨底方钮
                （3px 硬错影，跟线上那颗「＋」一张脸），开着整颗换粉渐层。 */}
            <button
              type="button"
              onClick={() => setActMode((v) => !v)}
              aria-label="动作／心声：开着时写下的整条都当旁白"
              aria-pressed={actMode}
              className="of-soft"
              style={{
                ...inputSideBtnStyle,
                background: actMode
                  ? "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)"
                  : "#0F0D13",
                color: "#FFFDF8",
                boxShadow: actMode
                  ? "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)"
                  : "0 3px 0 rgba(255,253,248,.30)",
              }}
            >
              <Italic size={19} strokeWidth={2} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow(e);
              }}
              onKeyDown={(e) => {
                /* 回车写下去、Shift＋回车换行（跟线上同一套）；中文选字时的回车不算。 */
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                actMode ? "写你的动作、神情或心里那句…" : "写下你此刻对他说的话"
              }
              rows={1}
              className="chat-input"
              style={inputTextStyle}
            />
            {/* 爱心（1.7.11）：催他把攒着的话一次回完——皮与线上那颗一模一样。
                点得动时实心粉底白心；平时整颗淡下去待命，不碍眼、也不抢小飞机的戏。
                什么时候亮见 canForceReply：他正写着的时候她连着发的那些就攒在这儿。 */}
            <button
              type="button"
              onClick={forceReply}
              disabled={!canForceReply}
              aria-label="催他回（把攒着的话一次交给他）"
              className="of-soft"
              style={{
                ...inputRoundBtnStyle,
                opacity: canForceReply ? 1 : 0.35,
                cursor: canForceReply ? "pointer" : "default",
              }}
            >
              <Heart size={18} strokeWidth={1.8} fill="currentColor" />
            </button>
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="停下"
                className="of-soft"
                style={inputRoundBtnStyle}
              >
                <SquareStop size={20} strokeWidth={1.6} />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={input.trim() === ""}
                aria-label="写下去"
                className="of-soft"
                style={{
                  ...inputRoundBtnStyle,
                  opacity: input.trim() === "" ? 0.35 : 1,
                  cursor: input.trim() === "" ? "default" : "pointer",
                }}
              >
                <Send size={19} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 场景签（1.7.32）：标个地点、换到这儿。写个地名就行，不用写时间——
          线下是实时的，他往下写的都发生在这儿。压一条粉虚线的场景签在记录里，
          只给屏幕看；喂模型走「【场景】××」那一行（见 currentSceneOf）。 */}
      {showScene ? (
        <div
          onClick={() => setShowScene(false)}
          style={{
            position: "absolute",
            inset: 0,
            /* 45：要压住设置弹层（40）与输入栏（30），免得点不着。 */
            zIndex: 45,
            background: "rgba(20,19,24,.28)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#FFFFFF",
              borderRadius: "22px 22px 0 0",
              padding: `18px 18px calc(var(--safe-area-bottom, 0px) + 18px)`,
              boxShadow: "0 -12px 30px -14px rgba(20,19,24,.25)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 16, letterSpacing: ".06em" }}>此刻在哪儿</div>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              写个地点就行，不用写时间——从这一条起，他写下去的都发生在这儿。
            </div>
            <input
              autoFocus
              value={sceneDraft}
              onChange={(e) => setSceneDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  setScene();
                }
              }}
              placeholder="比如：街角那家奶茶店"
              className="chat-input"
              style={{
                marginTop: 14,
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 14,
                border: `1px solid ${T.line}`,
                background: "#FFFFFF",
                fontFamily: SANS,
                fontSize: 14,
                color: T.ink,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={setScene}
              disabled={sceneDraft.trim() === ""}
              className="of-soft"
              style={{
                marginTop: 10,
                width: "100%",
                height: 44,
                borderRadius: 14,
                border: "none",
                background: T.pink,
                color: "#FFFFFF",
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: ".04em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: sceneDraft.trim() === "" ? "default" : "pointer",
                opacity: sceneDraft.trim() === "" ? 0.4 : 1,
                boxShadow: "0 3px 10px rgba(232,106,155,.30)",
              }}
            >
              <MapPin size={14} strokeWidth={2.2} />
              换到这儿
            </button>
          </div>
        </div>
      ) : null}

      {/* 长按那一条的小菜单（1.7.62，恩熙 2026-09-28 定的）：改字，还是让他重写这一轮。
          从前长按是**直接**进下面那张底单，于是「他这一轮被挡下了／整段写歪了、想让他重来」
          根本没有入口——线上长按气泡弹的就是菜单，这一页补上同一件事。
          只给「话」开（Turn 里的 canEdit 挡住分界线／场景签／失败提示），
          所以那张「没成」的提示照旧走它自己的「重新写」（见 retry）。 */}
      {menuEntry ? (
        <div
          onClick={() => setMenuEntry(null)}
          style={{
            position: "absolute",
            inset: 0,
            /* 45：与场景签同层、在编辑底单（46）之下——「改字」会把它换成那张底单。 */
            zIndex: 45,
            background: "rgba(20,19,24,.28)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#FFFFFF",
              borderRadius: "22px 22px 0 0",
              padding: `18px 18px calc(var(--safe-area-bottom, 0px) + 18px)`,
              boxShadow: "0 -12px 30px -14px rgba(20,19,24,.25)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 16, letterSpacing: ".06em" }}>
              {menuEntry.role === "user" ? "你说的这一句" : "他写的这一轮"}
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              {menuEntry.role === "user"
                ? "改一下自己说的话——他往后记的就是改后的这句。"
                : "改他几个字，还是把这一轮整段重写？重写＝他这一轮写的整段抹掉，拿你刚说的那句重新请他写一遍。"}
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button
                type="button"
                className="of-soft"
                onClick={() => {
                  const e = menuEntry;
                  setMenuEntry(null);
                  openEdit(e);
                }}
                style={{
                  width: 88,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${T.line}`,
                  background: "#FFFFFF",
                  color: T.ink2,
                  fontSize: 13.5,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                }}
              >
                改字
              </button>
              {menuEntry.role === "assistant" ? (
                <button
                  type="button"
                  className="of-soft"
                  onClick={() => {
                    const e = menuEntry;
                    setMenuEntry(null);
                    regenerate(e.id);
                  }}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: 14,
                    border: "none",
                    background: T.pink,
                    color: "#FFFFFF",
                    fontSize: 13.5,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: "pointer",
                    boxShadow: "0 3px 10px rgba(232,106,155,.30)",
                  }}
                >
                  <RotateCcw size={13} strokeWidth={2} />
                  重新生成
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 改一条（1.7.50）：长按记录里那一整条弹这张底单。皮照「此刻在哪儿」那张。
          改的是**存档里的原话**——改完他往后按改后的记（下一次发送／点爱心时
          `run` 从 `entriesRef` 现取，喂他的历史里就是改后的这句）。1.7.62 起长按先弹
          上面那张小菜单，从菜单的「改字」才进这里。 */}
      {editEntry ? (
        <div
          onClick={() => setEditEntry(null)}
          style={{
            position: "absolute",
            inset: 0,
            /* 46：压在场景签（45）上面——两张底单不会同时开，给个次序免得打架。 */
            zIndex: 46,
            background: "rgba(20,19,24,.28)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#FFFFFF",
              borderRadius: "22px 22px 0 0",
              padding: `18px 18px calc(var(--safe-area-bottom, 0px) + 18px)`,
              boxShadow: "0 -12px 30px -14px rgba(20,19,24,.25)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 16, letterSpacing: ".06em" }}>
              {editEntry.role === "user" ? "改你说的" : "改他说的"}
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              改完存档也跟着换——他往后记的就是改后的这句。
            </div>
            <textarea
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              className="chat-input"
              style={{
                marginTop: 14,
                width: "100%",
                height: 116,
                padding: "10px 14px",
                borderRadius: 14,
                border: `1px solid ${T.line}`,
                background: "#FFFFFF",
                fontFamily: editEntry.act ? KAI : SANS,
                fontSize: 14,
                lineHeight: 1.7,
                color: T.ink,
                outline: "none",
                resize: "none",
              }}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setEditEntry(null)}
                className="of-soft"
                style={{
                  width: 88,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${T.line}`,
                  background: "#FFFFFF",
                  color: T.ink2,
                  fontSize: 13.5,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                }}
              >
                算了
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={editDraft.trim() === ""}
                className="of-soft"
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 14,
                  border: "none",
                  background: T.pink,
                  color: "#FFFFFF",
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: editDraft.trim() === "" ? "default" : "pointer",
                  opacity: editDraft.trim() === "" ? 0.4 : 1,
                  boxShadow: "0 3px 10px rgba(232,106,155,.30)",
                }}
              >
                <PenLine size={14} strokeWidth={2.2} />
                就改这样
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 线下设置：字数要求 ＋ 结束这一场 ＋ 重开一场。 */}
      {showSet ? (
        <div
          onClick={() => setShowSet(false)}
          style={{
            position: "absolute",
            inset: 0,
            /* 40：要压住顶栏（20）与输入栏（30）——以前写 6，底部那颗「重开一场」
               被输入栏盖掉一半，点不着（1.7.9 修）。 */
            zIndex: 40,
            background: "rgba(20,19,24,.28)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#FFFFFF",
              borderRadius: "22px 22px 0 0",
              padding: `18px 18px calc(var(--safe-area-bottom, 0px) + 18px)`,
              boxShadow: "0 -12px 30px -14px rgba(20,19,24,.25)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 16, letterSpacing: ".06em" }}>线下设置</div>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              他要写多长，按一场的量算。写太短会草草收尾，太长容易灌水。
            </div>

            <Stepper
              label="每段至少"
              value={words.min}
              onMinus={() => stepW("min", -50)}
              onPlus={() => stepW("min", 50)}
              minusOff={words.min <= OFFLINE_WORDS_FLOOR}
              plusOff={words.min >= OFFLINE_WORDS_CEIL}
            />
            <Stepper
              label="每段至多"
              value={words.max}
              onMinus={() => stepW("max", -50)}
              onPlus={() => stepW("max", 50)}
              minusOff={words.max <= OFFLINE_WORDS_FLOOR}
              plusOff={words.max >= OFFLINE_WORDS_CEIL}
            />

            {/* 连续发送那颗开关（1.7.11 加的）在 1.7.33 拿掉了：线下从此**锁死连发**，
                不必再让她开——小飞机只管记下、攒够了按爱心让他一次回完。 */}

            {/* 记忆 · 带最近 __ 轮（1.7.46，恩熙定的）：一个数管两件事——
                每次只把最近这么多轮的原文摆给他（再往前的已经归总进记忆，不再整段重放）；
                每攒够这么多轮，就把这段归总一次进记忆。默认 10 轮。 */}
            <div style={{ marginTop: 20, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              记忆：带最近几轮。再往前的已经记在心里，不再整段摆给他；每攒够这么多轮就归总一次。
            </div>
            <Stepper
              label="记忆 · 带最近（轮）"
              value={rounds}
              onMinus={() => stepRounds(-1)}
              onPlus={() => stepRounds(1)}
              minusOff={rounds <= OFFLINE_ROUNDS_FLOOR}
              plusOff={rounds >= OFFLINE_ROUNDS_CEIL}
            />

            <div style={{ marginTop: 18, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              左上角那个箭头是「返回」：回线上看记录，这一场还接着写——那会儿线上还发不了消息，
              想找他说话就先回到这一场。点下面这颗才算结束，结束之后线上才又能打字。
            </div>
            <button
              type="button"
              onClick={() => {
                setShowSet(false);
                endScene();
              }}
              className="of-soft"
              style={{
                marginTop: 8,
                width: "100%",
                height: 44,
                borderRadius: 14,
                border: "none",
                background: T.pink,
                color: "#FFFFFF",
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: ".04em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
                boxShadow: "0 3px 10px rgba(232,106,155,.30)",
              }}
            >
              <Flag size={14} strokeWidth={2.2} />
              结束这一场（他回去了，下次是全新一场）
            </button>

            <button
              type="button"
              onClick={() => {
                setShowSet(false);
                persist([]);
                void clearOfflineScene(characterId, maskId);
              }}
              className="of-soft"
              style={{
                marginTop: 10,
                width: "100%",
                height: 44,
                borderRadius: 14,
                border: `1px solid ${T.line}`,
                background: "#FFFFFF",
                color: T.danger,
                fontSize: 13.5,
                fontWeight: 700,
                letterSpacing: ".04em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <Trash2 size={14} strokeWidth={2.2} />
              重开一场（清掉线下记录）
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 一轮里的一个块：动作描述（旁白）或台词（气泡）。 */
type SceneBlock = { kind: "act" | "line"; text: string };

const OPEN_QUOTES = "\u201C\u300C\u300E"; // “ 「 『
const CLOSE_QUOTES = "\u201D\u300D\u300F"; // ” 」 』

/** 半角标点 → 全角：**只在紧挨着汉字时才换**——免得把「3.5」「OK?」这种也一并改了。 */
const HALF_TO_FULL: Record<string, string> = {
  ",": "，",
  "?": "？",
  "!": "！",
  ":": "：",
  ";": "；",
};
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3001-\u303f\uff01-\uff60]/;
function tidyPunct(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const full = HALF_TO_FULL[ch];
    if (full && (CJK_RE.test(s[i - 1] ?? "") || CJK_RE.test(s[i + 1] ?? ""))) out += full;
    else out += ch;
  }
  return out;
}

/** **转述的凭据**（1.7.23）：引号**紧前头**那一小截（只往后看 8 个字，见 `ECHO_WINDOW`）
 *  里出现这些词，就说明这句引号是在**转述别人（多半是她）说过的话**，不是他自己在说
 *  ——恩熙那句「我听到你那句『我好想你啊』，心里颤动了一下」里，被引的「我好想你啊」
 *  是他的话没错，但**那不是他说的**，不该成气泡。
 *  ⚠️ 只收**转述味道明确**的词，别把「他说」「问」这种（那是他自己在说）也塞进来。
 *  ⚠️ **数词式**才收（1.7.44）：原先这里挂着一个**裸的「个字」**，把「但每**个字**都很清晰」
 *  这种（他自己在说、只是提到「字」）也判成了转述凭据 ⇒ 后头那对引号里的台词被留在旁白，
 *  恩熙看到的「本应该是气泡、文字没显现出来」就是它。现在只认**前头带数词**的写法
 *  （那两个字／三个字／一个字／四五个字），光一句「每个字」不再命中（「几个字」及其
 *  「这几个字／那几个字」照旧保留）。 */
const ECHO_RE = /(听到|听见|说的|说过|那句|这句|几个字|这几个字|那几个字|[两三一四五]个字|想起|回想|回响|回荡|重复)/;
/** 只看引号前头这 8 个字（1.7.23）：看太远会把上一句里的「听见」也算进来。 */
const ECHO_WINDOW = 8;

/** **引号后头的凭据**（1.7.41，恩熙发来他写歪的那一段）：
 *  引号**闭掉以后**紧跟着「的／的时候／那两个字」这类**把话变成句中成分**的词，说明这一截
 *  是被**嵌在句子里**的引用（「他……。她说「保护」的时候语气很自然……」里那个「保护」），
 *  引的是**她的话**、不是他在说——连引号一起留在旁白里，不切台词。见 splitLine。
 *  ⚠️ 只收**名词化**的那几个（的／时／（这|那）两个字／那句话／这个词／了），别把「然后」「就」
 *  这种也塞进来——那是他真在说话、后头接着写旁白，那几句本来就该留在台词位上。 */
const MENTION_AFTER_RE = /^(的|时|了|[这那][两几]?(?:个字|句|词)|[两三一]个字|几个字)/;

/** 一整行**只是个被引的片断**（引号外头一个字都没有，只余标点／空白）——缝句那一路用，见下。 */
const QUOTE_ONLY_RE = /^[「『“"'][^」』”"']*[」』”"'][。，、,.;；!！?？~～…]*$/;
/** 这一行**话已经说完了**：末字是句末标点（闭引号挂在标点后头也算，如「「你走吧。」」）。 */
const TAIL_RE = /[。！？…～?!.~]\s*[」』”"']?$/;
/** **行首孤零零的标点**（1.7.43，恩熙发来的那一幕）：模型偶尔在**句子中间换行**，把紧跟的
 *  逗号甩到下一行行首（「他听见那句“我是喜欢你的」／「，脚步顿住。」）——这个逗号本是连着
 *  上一句的，单拎出来就孤零零挂在段首，上一句也被切成两段。她说的「有些断句也有问题」就是它。
 *  标点**绝不可能起头**，所以下一行一上来就是这些标点时，一律并回上一行末（见 isContinuation）。
 *  ⚠️ 只收**不可能起头**的那些：逗号／顿号／分号／冒号／问叹／闭引号／右括号。
 *  ① 省略号「…」、破折号「——」不收——「……」起头的行是模型在顿一下，那是正常写法；
 *  ② 半角 `"` 不收——它既可能是开引号也可能是闭引号，缝错了会把一句真台词并进旁白。 */
const LEAD_PUNCT_RE = /^[，,、；;：:！!？?）」』”》】]/;

/** 这一行是不是**上一句的续行**（1.7.41）：上一行话没说完（没有句末标点），而这一行要么整行
 *  只是个被引的片断、要么一上来就是「的／那两个字」这种**接在句中**的词。
 *  1.7.43 又添一条：这一行**一上来就是标点**（见 LEAD_PUNCT_RE）——标点不会起头，
 *  这一眼认得最死，所以先于后头两条看它。
 *  ⚠️ 上一行说完了就一定不接——正常「一句一行」的写法一个字都不会动，也不会缝出
 *  「。，」这种连排标点。 */
function isContinuation(prev: string, next: string): boolean {
  if (TAIL_RE.test(prev)) return false;
  if (LEAD_PUNCT_RE.test(next)) return true;
  return QUOTE_ONLY_RE.test(next) || MENTION_AFTER_RE.test(next);
}

/** **旁白尾巴上悬着的那个逗号**（1.7.42，恩熙发来的那一幕）：「他的声音更低了，“我不在乎。”」
 *  这句切在引号前头、旁白单拎成一行时，尾巴上那个**逗号本来是连着后头那句台词的**，单拎出来
 *  就成了断在半句上的多余标点——她说的「断在了奇怪的位置／多出一个逗号」就是它。
 *  凡是**旁白块紧挨着一块台词**、而旁白末尾正好是逗号／顿号／分号，就把这个尾巴摘掉
 *  （摘掉比换成「：」少动一个字，读着也更顺）。
 *  ⚠️ 只在**下一块是台词**时摘：旁白后头还是旁白（模型自己断的行）不动，旁白是这一轮最后一块
 *  也不动。她那侧（`narrate=false`）整条不碰——那是她自己写下的字。 */
const DANGLING_COMMA_RE = /[，,、；;]\s*$/;
function dropDanglingComma(blocks: SceneBlock[]): SceneBlock[] {
  const out: SceneBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "act" && blocks[i + 1]?.kind === "line") {
      const t = b.text.replace(DANGLING_COMMA_RE, "").trim();
      if (t) out.push({ kind: "act", text: t });
      continue;
    }
    out.push(b);
  }
  return out;
}

/** 把一行切成「引号里的台词」与「引号外头的旁白」；半角 " 也算引号（模型爱写半角）。
 *  **引号只是切法的凭据，不进气泡**（1.7.17）：台词落进气泡时不再包引号，直接是文字。
 *  例：「"哟,还玩这套?"他声音里带着笑,"老婆你想干嘛?"」
 *   → 台词「哟，还玩这套？」＋旁白「他声音里带着笑，」＋台词「老婆你想干嘛？」。
 *  **转述的引号不切气泡**（1.7.23）：引号前头那几个字若带着「听到／那句／说的」这类凭据，
 *  说明这是在**引述谁的原话**，这一整句（连引号）留在旁白里，见 ECHO_RE。
 *  **嵌进句子里的引用也不切**（1.7.41）：引号**后头**紧跟着「的／那两个字」这类名词化的词
 *  （「她说「保护」的时候……」），这一截同样是引述、不是他说的，退回旁白，见 MENTION_AFTER_RE。 */
function splitLine(line: string, out: SceneBlock[]) {
  let plain = "";
  let inner = "";
  let open: string | null = null; // 当前这一对引号的开引号；半角 " 也记作 `"`（靠配对开关）
  let keep = false; // 这一对引号是**转述**的：连引号一起留在旁白里（见 ECHO_RE）
  const flushPlain = () => {
    const t = tidyPunct(plain).trim();
    if (t) out.push({ kind: "act", text: t });
    plain = "";
  };
  const flushQuote = () => {
    const t = tidyPunct(inner).trim();
    if (t) out.push({ kind: "line", text: t });
    inner = "";
    open = null;
  };
  /* 闭引号用哪个字（半角 " 自己配自己）。 */
  const closeOf = (q: string) => (q === '"' ? '"' : CLOSE_QUOTES[OPEN_QUOTES.indexOf(q)]);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (open === null) {
      if (ch === '"' || OPEN_QUOTES.includes(ch)) {
        /* 嵌在句子里的引用（1.7.41）：**开引号这里先往后看一眼**——这一对引号闭掉以后
           紧跟着「的／那两个字」这类名词化的词，说明这一截是当**句中成分**用的引述
           （「她说「保护」的时候语气很自然」），不是他在说话；连引号一起留在旁白里。
           这一眼定的是**要不要在这儿把旁白断成两截**：断早了，前头那半句会被单拎出来。 */
        const j = line.indexOf(closeOf(ch), i + 1);
        const nested = j > i && MENTION_AFTER_RE.test(line.slice(j + 1, j + 6));
        if (nested || ECHO_RE.test(plain.slice(-ECHO_WINDOW))) {
          keep = true;
          plain += ch;
        } else {
          flushPlain();
          open = ch;
        }
      } else {
        plain += ch;
      }
      continue;
    }
    /* 转述：引号、被引的字，原样留在旁白里。 */
    if (keep) {
      plain += ch;
      if (ch === closeOf(open)) {
        open = null;
        keep = false;
      }
      continue;
    }
    if (ch === closeOf(open)) flushQuote();
    else inner += ch;
  }
  /* 引号还没闭上（流式途中，或模型漏了闭引号）——这一截仍当**台词**兜住，不丢字；
     转述的那一截（`keep`）例外：它本来就该留在旁白里。 */
  if (open !== null && !keep) flushQuote();
  else flushPlain();
}

/* 切法（1.7.13）：`*…*` 段整体当动作描述（模型对 markdown 斜体最熟；她那侧那颗斜体钮写下的
   也是这个写法）；剩下按行看——`narrate`（TA 那侧）时，行里**引号包住的**当台词进气泡，
   **引号外头的**当动作描述（灰斜体＋底，跟她说的话分得清清楚楚）；她那侧自己手打的话
   （`narrate=false`）不吃这一条：没标 `act` 就整条当台词，免得把她说的话当成旁白。
   ⚠️ 切不开的行一律当**台词**——宁可多一只气泡，不可丢字。
   **一句话被硬拆成几行时先缝回去**（1.7.41，见 `isContinuation`）：模型有时把一句话写成
   三行（「他……。她说」／「「保护」」／「的时候语气很自然……」），缝不缝结果差很多
   ——缝回去才是一句完整的旁白，不缝中间那截被引的字会被单拎出来当台词。 */
function parseScene(text: string, narrate = false): SceneBlock[] {
  const out: SceneBlock[] = [];
  const pushTail = (s: string) => {
    const lines: string[] = [];
    for (const raw of s.split("\n")) {
      const line = raw.trim();
      if (line) lines.push(line);
    }
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      /* 星号还没闭合（流式途中）——这一行也是动作，别先当台词闪一下气泡。 */
      if (line.startsWith("*")) {
        const act = line.replace(/^\*{1,2}/, "").replace(/\*{1,2}$/, "").trim();
        if (act) out.push({ kind: "act", text: narrate ? tidyPunct(act) : act });
        continue;
      }
      /* 她（`narrate=false`）自己手打的那条原样进气泡：**一个字都不动**，连引号也照留
         （那是她自己写下的，不是模型写的台词）。 */
      if (!narrate) {
        out.push({ kind: "line", text: line });
        continue;
      }
      /* 缝句（1.7.41）：上一行话没说完、这一行接着往下写，就并成一整句再交给 splitLine。
         凭据很窄（见 isContinuation）——正常一句一行的写法一个字都不会动。 */
      while (i + 1 < lines.length && isContinuation(line, lines[i + 1])) line += lines[++i];
      splitLine(line, out);
    }
  };
  const re = /\*{1,2}([^*\n]+?)\*{1,2}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    pushTail(text.slice(last, m.index));
    const act = m[1].trim();
    if (act) out.push({ kind: "act", text: narrate ? tidyPunct(act) : act });
    last = m.index + m[0].length;
  }
  pushTail(text.slice(last));
  /* 旁白尾巴上的逗号（1.7.42，见 dropDanglingComma）：只收拾**他那侧**切出来的旁白；
     她那侧自己打的一个字都不动。 */
  return narrate ? dropDanglingComma(out) : out;
}

/** **换景口令**（1.7.35）：他单独起一行写下的 `【换到：地点】`。
 *  这一行由他照着提示词第 11 条写，正文里不留——认出来以后摘成一条**场景签**记录
 *  （与她自己标的那条同形，见 setScene），底下那条「此刻在 ××」与下一轮喂料的
 *  「【场景】××」就都跟着换了。必须**独占一行**才认（提示词里就这么要求），
 *  所以前后还可以有别的字不算——宁可认不出来当普通正文，也不要把句子从中间截断。
 *  冒号半角全角都收；外头那对引号／书名号也收（模型爱把示例里的「」一起抄下来）。
 *  **1.7.40 放宽**（恩熙报「还是需要手动动变更场景啊」）：他写歪了也照样认——
 *  ①行首可带装饰符号（列表符 `- * · •`、引用符 `>`、空白）；
 *  ②方括号半／全角都收（【】、[]、［］）；
 *  ③冒号可以漏（`【换到公寓楼下】`）；
 *  ④行尾多带标点（。，、；！？… 之类）不影响。
 *  收窄风险：仍要求整行只有这一个口令（行首行尾只允许装饰与标点），不会把正文从中间截断。 */
const MOVE_RE =
  /^[-*·•>＞»\s]*[「『“"']?\s*[【\[［]\s*换到\s*[:：]?\s*([^】\]］]+?)\s*[】\]］]\s*[」』”"']?[\s。，、,.;；!！?？~～…]*$/;

/** **此地行**（1.7.47）：TA 每一轮结尾另起一行写的「【此地】地点」——报的是**这一轮结束时**
 *  你们在哪儿。这一版把 1.7.35 那条「挪了地方才写」的**条件口令**换成这条**每轮无条件都写**的
 *  （见 chatApi 提示词第 11 条）：条件口令他会判断不出来就干脆不写，无条件的那行（对照 1.7.45
 *  的「【本轮】××」）他会照写。
 *  这里拿这一行跟当前那条签一比，**不一样就换签**——同一条路走 `moveSplit`（与 `MOVE_RE` 并
 *  到一处认，认出来都当换景行：地点在前、正文在后，落在末段的这一行就把签压在整轮下头）。
 *  写法容错与 `MOVE_RE` 同一套（行首装饰符、方括号半／全角、行尾多带标点、冒号可省）；
 *  没挪地方他照写原处＝跟此刻同名，不重复压签（`scene !== now` 那道闸）。
 *  **两种摆法都认**（与 `BEAT_RE`／`BEAT_IN_RE` 同一套）：`【此地】地点`——方括号只包住「此地」、
 *  地点写在括号外头（**这是提示词里给他看的样子**，第 1.7.47 版漏认的就是这一种：他照例子写了
 *  「【此地】星穹公寓602门口」，却被认成普通正文上了屏）；`【此地：地点】`——地点也写在括号里。
 *  故 `m[1]`＝括号里的（可空），`m[2]`＝括号外的（可空），两处哪处有点名就取哪处（见 `moveSplit`）。 */
const SITE_RE =
  /^[-*·•>＞»\s]*[「『“"']?\s*[【\[［]\s*(?:此地|此刻在|现在在|如今在)\s*[:：]?\s*([^】\]］]*?)\s*[】\]］]\s*[:：]?\s*([^」』”"'\n]*?)\s*[」』”"']?[\s。，、,.;；!！?？~～…]*$/;

/** **进度行**（1.7.45）：TA 每一轮结尾另起一行写的「【本轮】××」——一句话说清这一轮刚发生的
 *  那一件事。照参考项目那套「每轮自报一条事件小结」的做法，专治**跨轮绕回同一个话题／复读
 *  老台词**（提示词第 12 条要求这么写）。
 *  **独占一行才认**（提示词里就这么要求），所以前后还可以有别的字不算——宁可认不出来当普通
 *  正文，也不要把句子从中间截断。写法容错与 MOVE_RE 同一套：行首装饰符、方括号半／全角、
 *  行尾多带标点；「本轮／这一轮」两种叫法都收。
 *  **两种摆法都认**：`BEAT_RE` 认提示词里要求的那种——「【本轮】**××**」（方括号只包住「本轮」，
 *  小结写在括号外头）；`BEAT_IN_RE` 认「【本轮 ××】」（小结也写在括号里，TA 常会这么写）。
 *  摘出来的这一行**不进正文、不显示**，只挂在末条 `assistant` 记录上当下一轮的进度单（见 beat）。 */
const BEAT_RE =
  /^[-*·•>＞»\s]*[「『“"']?\s*[【\[［]\s*(?:本轮|这一轮)\s*[】\]］][:：]?\s*(.*?)\s*[」』”"']?[\s。，、,.;；!！?？~～…]*$/;
/** 进度行的另一种摆法：「【本轮 ××】」——小结也写在方括号里。 */
const BEAT_IN_RE =
  /^[-*·•>＞»\s]*[「『“"']?\s*[【\[［]\s*(?:本轮|这一轮)\s*[:：]?\s*([^】\]］]+?)\s*[】\]］]\s*[」』”"']?[\s。，、,.;；!！?？~～…]*$/;

/** 从 TA 这一段里把进度行摘出来（1.7.45）：正文原样留下，进度行单独收成一份（可能有多条）。
 *  写歪了认不出来＝当普通正文，与从前一模一样，不会出错。写了标记却没写小结的那一行也摘掉
 *  （它本来就是标记行、不该上屏），只是不产生进度。 */
function takeBeats(text: string): { text: string; beats: string[] } {
  const beats: string[] = [];
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = BEAT_RE.exec(line) ?? BEAT_IN_RE.exec(line);
    if (m) {
      const one = (m[1] ?? "").trim();
      if (one) beats.push(one);
      continue;
    }
    kept.push(raw);
  }
  return { text: kept.join("\n"), beats };
}

/** 标记行（1.7.45，**只给打字机预览用**）：整行以【（可带行首装饰符）起头的那些——换景口令与
 *  进度行都是这个长相，都不该在预览里露面（正式落盘由 moveSplit／takeBeats 摘掉）。
 *  流式尾截是半行（「【本」）也一并挡住；正常句子以字起头，不会被误伤。 */
const MARK_LINE_RE = /^[-*·•>＞»\s]*[「『“"']?\s*[【\[]/;
function stripMarkLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => !MARK_LINE_RE.test(l.trim()))
    .join("\n");
}

/** 把他这一段按换景行切开（1.7.35；1.7.47 起「【此地】地点」也当换景行，见 SITE_RE）：
 *  切出来是一段段「地点 ＋ 正文」。第一段的地点为空＝**还在原地**（见 entriesOfReply）；
 *  没有换景行时只有一段，与从前一模一样。换景行本身不进正文——那块地方由场景签来显示。
 *  `declared`＝这一轮他**自己交代过**在哪儿没有（写没写「【此地】／【换到】」那一行）——
 *  交代过就全听他的；一字没交代，才轮得到 `guessSpot` 从他的话里认（1.7.47 的兜底）。 */
function moveSplit(text: string): {
  parts: { scene?: string; content: string }[];
  declared: boolean;
} {
  const out: { scene?: string; content: string }[] = [];
  let buf: string[] = [];
  let scene: string | undefined;
  let declared = false;
  const flush = () => {
    out.push({ scene, content: buf.join("\n").trim() });
    buf = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = MOVE_RE.exec(line) ?? SITE_RE.exec(line);
    if (m) {
      /* 地点可能写在方括号里（`【此地：××】`／`【换到：××】`），也可能写在方括号外头
         （`【此地】××`——提示词给的样子，见 SITE_RE）；两处哪处有点名就取哪处。
         认出了标记却没写出地点（`【此地】`光秃秃一行的畸形写法）也把这行摘掉——它本就是
         标记行、不该上屏；只是不换签。 */
      const spot = ((m[1] ?? "") + "").trim() || ((m[2] ?? "") + "").trim();
      flush();
      if (spot) {
        scene = spot;
        declared = true;
      }
      continue;
    }
    buf.push(raw);
  }
  flush();
  return { parts: out, declared };
}

/** **认景兜底**（1.7.47）：他这一轮**自己没交代**在哪儿时，从他自己的话里认那个落脚点。
 *  只认**「到了哪儿」**——走进／进了／来到／抵达／拐进／踏进／回到，以及「推开…的门」；
 *  不认「从哪儿出来」（「走出公寓大门」只说明离开了哪儿，新地方得等他把落脚点写出来）。
 *  取**最后一个**（他最后停在哪），认不出、认出跟此刻同名、或认出来的不像地名，都不动——
 *  宁可不动，也不乱标（标歪了她点「场景签」照样能改）。 */
const ARRIVE_RE =
  /(?:走进|走入|进了|进入|来到|到了|抵达|拐进|踏进|回到)([^，。！？；：、\n「」『』【】…]{1,12})/g;
/** 「推开咖啡馆的门」这种落脚也认——地名夹在「推开」与「的门」中间。 */
const DOOR_RE = /推开([^，。！？；：、\n「」『』【】…]{1,10}?)的门/g;
/** 不像地名的：人称／身体心思／时间词，一律不认。 */
const SPOT_BAD_RE =
  /[你我他她它]|心|话|神|梦|^(?:晚上|白天|早上|中午|下午|夜里|夜深|第二|最后|后来|这时|那时|此时|这时候|那时候)/;
const SPOT_VAGUE = new Set(["这里", "那里", "这儿", "那儿", "此处", "那边", "这边", "原地"]);

/** 把认出来的那句收拾成一个地名（1.7.47）：去掉领头的「了／到／在／于／往」与
 *  尾巴的「的时候／时／之后／以后／后」，嫌长、像人不像地方、或太含糊的就不要。 */
function cleanSpot(raw: string): string {
  const name = raw
    .trim()
    .replace(/^(?:了|到|在|于|往)/, "")
    .replace(/(?:的时候|时|之后|以后|后)$/, "")
    .replace(/[的了着]$/, "")
    .trim();
  if (name.length < 2 || name.length > 12) return "";
  if (SPOT_BAD_RE.test(name) || SPOT_VAGUE.has(name)) return "";
  return name;
}

/** 从他这一段正文里认出最后那处落脚点（1.7.47）：认不出＝空串（什么也不动）。 */
function guessSpot(text: string): string {
  const found: { at: number; name: string }[] = [];
  for (const re of [ARRIVE_RE, DOOR_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const name = cleanSpot(m[1] ?? "");
      if (name) found.push({ at: m.index, name });
    }
  }
  if (found.length === 0) return "";
  found.sort((a, b) => a.at - b.at);
  return found[found.length - 1].name;
}

/** 一条记录（或正在写的那条草稿）＝一行：TA 在左、她在右。 */
function Turn({
  entry,
  charName,
  charAvatar,
  myName,
  myAvatar,
  first,
  onRetry,
  onLongPress,
  typing,
}: {
  entry: OfflineEntry;
  charName: string;
  charAvatar?: string;
  myName: string;
  myAvatar?: string;
  /** 组首（上一条是另一个人的）——上边距松一点，跟线上同一套节奏。 */
  first: boolean;
  onRetry: (id: string) => void;
  /** 长按整条 → 弹菜单（1.7.62：改字／重新生成；1.7.50 起原本是**直接**进编辑器）。
   *  只在真写下的那几条上挂（草稿不算、失败提示不算），见 Turn 里的 canEdit。 */
  onLongPress?: (entry: OfflineEntry) => void;
  /** 他正写着（1.7.18）：末尾那一块跟一枚会闪的细竖线（打字光标，见 .of-caret）。 */
  typing?: boolean;
}) {
  /* 长按（1.7.50）：按住半秒把这一条交给外头弹菜单（1.7.62 起是菜单，先前直接开编辑器）。
     计时器写在组件里、`canEdit` 为假时一枚也不起——这张卡片是**不可编辑**的
     （正写着的草稿、以及分界线／场景签／失败提示那三种 system），
     长按它就不该有任何反应。手指一挪（滚动）／一松即撤，跟线上 `onLongCancel` 同一套。 */
  const longRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (longRef.current) clearTimeout(longRef.current);
  }, []);
  const canEdit = entry.id !== "draft" && !typing && entry.role !== "system" && !!onLongPress;
  const longStart = () => {
    if (!canEdit) return;
    if (longRef.current) clearTimeout(longRef.current);
    longRef.current = setTimeout(() => {
      longRef.current = null;
      onLongPress?.(entry);
    }, 520);
  };
  const longCancel = () => {
    if (longRef.current) {
      clearTimeout(longRef.current);
      longRef.current = null;
    }
  };
  const longHandlers = canEdit
    ? {
        onMouseDown: longStart,
        onTouchStart: longStart,
        onMouseMove: longCancel,
        onTouchMove: longCancel,
        onMouseUp: longCancel,
        onTouchEnd: longCancel,
      }
    : {};

  if (entry.role === "system") {
    /* 分界线（1.7.9）：两场之间那一道——**只是给屏幕看的**，不进记忆、不喂模型
       （offlineAsMessages 滤掉的就是 system）。 */
    if (entry.divider) {
      return (
        <div className="of-in" style={dividerStyle} aria-hidden>
          <span style={dividerLineStyle} />
          <span style={dividerTextStyle}>这一场到此</span>
          <span style={dividerLineStyle} />
        </div>
      );
    }
    /* 场景签（1.7.32）：她手标的地点。与分界线同一路（只给屏幕看、不进记忆），
       长相不同——一条粉虚线夹一枚地名，像换了一处景。 */
    if (entry.scene) {
      return (
        <div className="of-in" style={sceneMarkStyle}>
          <span style={sceneMarkLineStyle} />
          <span style={sceneMarkTextStyle}>
            <MapPin size={11} strokeWidth={2.1} />
            {entry.scene}
          </span>
          <span style={sceneMarkLineStyle} />
        </div>
      );
    }
    return (
      <div className="of-in" style={{ margin: "12px 18px 6px", textAlign: "center" }}>
        <div style={{ fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>{entry.content}</div>
        {entry.retryable ? (
          <button type="button" onClick={() => onRetry(entry.id)} className="of-soft" style={retryBtn}>
            <RotateCcw size={12} strokeWidth={2.2} />
            重新写
          </button>
        ) : null}
      </div>
    );
  }

  const mine = entry.role === "user";
  /* 两侧同一套切法：她也能在自己的输入里写动作（`*…*`）。
     她标了 `act` 的那条（1.7.11，输入栏那颗斜体钮开着时写的）**整条都是旁白**，
     不切、不成气泡、不挂名牌——直接当一段动作描述（1.7.28 起两边长相完全一样，都左对齐）。
     TA 那侧（1.7.13）走 `narrate`：**只有引号里的当台词**，引号外头的一律落成旁白段
     （她那张图里「视野突然被…堵死」这种整段旁白，就是这么剥出来的）。 */
  const blocks: SceneBlock[] =
    mine && entry.act ? [{ kind: "act", text: entry.content }] : parseScene(entry.content, !mine);

  return (
    <div
      className="of-in of-turn"
      {...longHandlers}
      style={{
        /* 一轮＝**一段剧本**（1.7.28，照恩熙给的参考图）：起手先亮一次身份
           （头像 ＋ 名字 ＋ 一条虚线拉到右边），底下整段**不再挂头像、不再有气泡**——
           旁白与台词都是一段一段的正文，左边界一律对齐到名字那条线。
           换人（`first`）时上面留得松一点，同一个人接着说时只留一段的缝。 */
        paddingTop: first ? 20 : 10,
      }}
    >
      {first ? (
        <TurnHead
          name={mine ? myName : charName}
          avatar={mine ? myAvatar : charAvatar}
          mine={mine}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          /* 段落的左边界＝名字那条线（头像 34 ＋ 缝 9 ＋ 左边距 16 ＝ 59）。
             **她那一侧整段镜像到右边**（1.7.29）：右边距 59、左边 16、字右对齐——
             照恩熙说的「从右边长出来」。 */
          padding: mine ? "0 59px 0 16px" : "0 16px 0 59px",
        }}
      >
        {/* 末尾那一块才挂光标（1.7.18）：他正写着的时候，字是从这一块尾巴上长出来的。 */}
        {blocks.map((b, i) => {
          const caret = typing === true && i === blocks.length - 1;
          return b.kind === "act" ? (
            <Act key={i} text={b.text} caret={caret} right={mine} />
          ) : (
            <Line key={i} text={b.text} caret={caret} right={mine} />
          );
        })}
      </div>
    </div>
  );
}

/** 一轮的起手（1.7.28）：**方头像（圆角方）＋ 名字 ＋ 一条虚线**——
 *  整轮只亮这一次身份，底下的段落不再逐条挂头像、不再有气泡（见文件头 1.7.28）。
 *  头像仍是 `Avatar`（这一版改成 34 见方的圆角方，见那里）；虚线一头接名字、一头拉到版心外缘，
 *  像剧本里割角色名的横线。只在这一处分色：她＝粉（T.pink），TA＝墨（T.ink）。
 *  **她那一侧整条镜像**（1.7.29，恩熙说「用户的地方应该也是要右对齐的，从右边长出来的感觉」）：
 *  头像靠右、名字在头像左侧、虚线从名字往左拉——左右相对，跟正文那一列的镜像对齐。 */
function TurnHead({
  name,
  avatar,
  mine,
}: {
  name: string;
  avatar?: string;
  mine: boolean;
}) {
  const head = (
    <span
      style={{
        flex: "none",
        fontFamily: SERIF,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: ".12em",
        color: mine ? T.pink : T.ink,
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </span>
  );
  /* 虚线（1.7.30 精细化）：**靠名字那头实、往外那头渐隐**——剧本里割角色名的那种引线，
     不是一根截断的线。方向随镜像翻：她那一侧引线往左拉，所以淡的是左端。 */
  const line = (
    <span
      style={{
        flex: 1,
        minWidth: 10,
        marginTop: 1,
        borderTop: `1px dashed ${mine ? "rgba(232,106,155,.30)" : "rgba(20,19,24,.16)"}`,
        WebkitMaskImage: mine
          ? "linear-gradient(90deg, rgba(0,0,0,0) 0, #000 18%)"
          : "linear-gradient(90deg, #000 82%, rgba(0,0,0,0) 100%)",
        maskImage: mine
          ? "linear-gradient(90deg, rgba(0,0,0,0) 0, #000 18%)"
          : "linear-gradient(90deg, #000 82%, rgba(0,0,0,0) 100%)",
      }}
    />
  );
  /* 头像（1.7.30）：外圈一枚**极细的白描边**，让它在半透明的纸上「坐得住」。 */
  const face = (
    <span
      style={{
        flex: "none",
        display: "block",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 0 0 1px rgba(255,255,255,.85), 0 2px 6px rgba(20,19,24,.14)",
      }}
    >
      <Avatar
        avatar={avatar}
        fallbackChar={name.charAt(0)}
        gradient={mine ? "linear-gradient(135deg,#F49BBE,#E86A9B)" : AVATAR_GRADIENT}
      />
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 16px 9px" }}>
      {mine ? (
        <>
          {line}
          {head}
          {face}
        </>
      ) : (
        <>
          {face}
          {head}
          {line}
        </>
      )}
    </div>
  );
}

/** 台词：**不再是气泡**（1.7.28），就是正文里**带引号的一段**——与旁白同个版心、同一副字
 *  （见文件头 1.7.28）。引号在**拼进正文时补上**（切法照旧靠引号认台词，只是拼回时也带着）：
 *  她手打的那条若本就带引号，就按它的原样。
 *  **她那一侧右对齐**（1.7.29）：整段镜像到右边（见 Turn 那一列的内距）。 */
function Line({
  text,
  caret,
  right,
}: {
  text: string;
  caret?: boolean;
  right?: boolean;
}) {
  const t = text.trim();
  const quoted = /^[“「『"]/.test(t) ? t : `“${t}”`;
  return (
    <p style={right ? { ...lineStyle, textAlign: "right" } : lineStyle}>
      {quoted}
      {caret ? <span className="of-caret" /> : null}
    </p>
  );
}

/** 动作描述／旁白：**不成气泡、不挂名牌**，就是一段一段的正文（1.7.28 起改剧本体，
 *  见文件头）。**不成卡片、不描边、不铺底**——底下已经垫了「纸」（滚动容器那层），
 *  字有纸可依，就不必再往字上做文章（1.7.26／1.7.27 那两版白晕／硬边**都撤了**）。
 *  她那一侧与 TA 那侧**同一副长相**（1.7.28：不再一灰一粉；「谁在说」由每轮开头那截
 *  `TurnHead` 认；1.7.29 起她侧整段右对齐，见 `right`）。
 *  **旁白与台词怎么分**（1.7.29，恩熙说「要更明显，颜色或者字号都行，不是字体是字体大小」）：
 *  同一个版心、同一副字，只**字号与明暗**拉档——旁白小一号半、淡一档，台词大一号半、深一档。
 *  **括号里的小动作再降一级**（1.7.18）：整块旁白里被（…）括着的那一小截，小半号、淡一档
 *  ——「（叹气）」这类不再跟外头的叙述一样重（纯显示层，见 ActText）。
 *  **末尾那枚光标**（1.7.18）：他正写着时挂在这一块尾巴上，见 .of-caret。 */
function Act({
  text,
  caret,
  right,
}: {
  text: string;
  caret?: boolean;
  right?: boolean;
}) {
  return (
    <p style={right ? { ...actStyle, textAlign: "right" } : actStyle}>
      <ActText text={text} />
      {caret ? <span className="of-caret" /> : null}
    </p>
  );
}

/** 旁白里被括号括着的那一小截（1.7.18）：整块旁白里**再降一级**——小半号、淡一档。
 *  **纯显示层**：只动长相，她／模型写下的字一个都不改（切法、提示词都没动）。
 *  半角、全角两副括号都认。 */
function ActText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /（[^）]*）|\([^)]*\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} style={actAsideStyle}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (!parts.length) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** 旁白／动作：**剧本体**（1.7.28）——通篇一副字（宋体／思源宋，**正体、不斜**）、
 *  行距松、字距略开；不成卡片、不描边、不铺底（底下有「纸」，见滚动容器那层）。
 *  版心由 Turn 那一列统一给（对齐到名字那条线），这里只管字本身。
 *  **比台词小一号半、淡一档**（1.7.29，见 Act 注释）：旁白是「看的」，退到后头去。 */
const actStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontSize: 12.5,
  lineHeight: 1.95,
  letterSpacing: ".03em",
  color: "#8B828A",
  textAlign: "left",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** 台词：跟旁白同一副骨架，只**大一号半、深一档**——靠引号分「说的」与「看的」，
 *  不再靠气泡（1.7.28）；两档的差在 1.7.29 拉开（见 Act 注释）。 */
const lineStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontSize: 14,
  lineHeight: 1.95,
  letterSpacing: ".03em",
  color: "#28232A",
  textAlign: "left",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** 旁白里那一截小动作／心声（1.7.18，见 ActText）：比旁白再小半号、再淡一档。 */
const actAsideStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#A79EA5",
};

/** 两场之间那一道分界线（1.7.9）：一条细线，中间压一句小字——把上一场与这一场分开。 */
const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "16px 22px 10px",
};
const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "rgba(20,19,24,.10)",
};
const dividerTextStyle: React.CSSProperties = {
  flex: "none",
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".14em",
  whiteSpace: "nowrap",
};

/** 她手标的场景签（1.7.32）：一条粉虚线夹着地名——「换到这儿了」。
 *  与分界线（灰、实线、「这一场到此」）刻意分开：一个是**收场**，一个是**换景**。 */
const sceneMarkStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "18px 22px 12px",
};
const sceneMarkLineStyle: React.CSSProperties = {
  flex: 1,
  borderTop: "1px dashed rgba(232,106,155,.30)",
};
const sceneMarkTextStyle: React.CSSProperties = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontFamily: SERIF,
  fontSize: 12,
  letterSpacing: ".1em",
  color: T.pink,
  whiteSpace: "nowrap",
};

/** 输入框上方那条**淡功能条**（1.7.32，恩熙定的入口）：眼下只挂「场景签」一样。
 *  刻意不碰输入栏那一行——左边那颗斜体钮（动作／心声）要快、常用，她说了不要动。
 *  1.9.91 换新脸：整条改成墨底上的**淡纸白条**，跟线上输入区一个调子。 */
const sceneBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "8px 12px 0",
  padding: "5px 8px",
  borderRadius: 12,
  background: "rgba(255,253,248,.06)",
  border: "1px solid rgba(255,253,248,.10)",
};
const sceneBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  flex: "none",
  height: 24,
  padding: "0 9px",
  borderRadius: 8,
  border: "1px solid rgba(255,253,248,.35)",
  background: "#0F0D13",
  color: "#FFFDF8",
  fontFamily: SANS,
  fontSize: 11.5,
  letterSpacing: ".04em",
  cursor: "pointer",
};
/** 功能条右边那行小字：报了此刻在哪儿，她一眼知道标没标。 */
const sceneNowStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  color: "rgba(255,253,248,.55)",
};

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusOff,
  plusOff,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  minusOff: boolean;
  plusOff: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ fontSize: 13.5, color: T.ink }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StepBtn label="−" onClick={onMinus} off={minusOff} />
        <div
          style={{
            minWidth: 58,
            textAlign: "center",
            fontFamily: KAI,
            fontSize: 15,
            letterSpacing: ".02em",
            color: T.ink,
          }}
        >
          {value}
        </div>
        <StepBtn label="＋" onClick={onPlus} off={plusOff} />
      </div>
    </div>
  );
}

function StepBtn({ label, onClick, off }: { label: string; onClick: () => void; off: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={off}
      className="of-soft"
      style={{
        width: 34,
        height: 34,
        borderRadius: 12,
        border: `1px solid ${off ? T.lineSoft : T.line}`,
        background: "#FFFFFF",
        color: off ? T.ink3 : T.pink,
        fontSize: 16,
        lineHeight: 1,
        cursor: off ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/** 正文里的头像（1.7.28 改**圆角方**：34 见方、圆角 10）——挂在每轮开头那一截 `TurnHead` 上，
 *  跟参考图里那种「剧本角色名的方头像」一个意思。顶栏那颗 32 正圆是 `HeaderAvatar`，不是这一颗。 */
function Avatar({
  avatar,
  fallbackChar,
  gradient,
}: {
  avatar?: string;
  fallbackChar: string;
  gradient: string;
}) {
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatar}
      alt=""
      style={{
        display: "block",
        width: 34,
        height: 34,
        borderRadius: 10,
        objectFit: "cover",
        flex: "none",
      }}
    />
  ) : (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        flex: "none",
        background: gradient,
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {fallbackChar}
    </div>
  );
}

/* ---------- 顶栏（1.7.8 整副照抄线上，数值见 ChatWindow 那头 header） ---------- */

/** 顶栏那两颗钮的底（1.9.91 换新脸，线上同款）：无边框透明，图标自己带纸白色。 */
const headerBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  color: "#FFFDF8",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  transition: "all .18s",
};

/** 顶栏里的名字（1.9.91 换新脸，线上同款）：衬线大字 26／700，纸白 ＋ `2px 2px 0` 粉错影。 */
const headerNameStyle: React.CSSProperties = {
  display: "block",
  fontFamily: SERIF,
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: ".03em",
  lineHeight: 1.05,
  color: "#FFFDF8",
  textShadow: "2px 2px 0 rgba(224,65,122,.55)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 名字底下那行签名（1.9.91 换新脸，线上同款）：纸白 .55。 */
const headerSignStyle: React.CSSProperties = {
  display: "block",
  marginTop: 5,
  fontSize: 10,
  color: "rgba(255,253,248,.55)",
  letterSpacing: ".05em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 顶栏里的 44 见方头像（1.9.91 换新脸，线上同款）：3px 描边 ＋ 硬错影；
 *  `variant="me"` 是我的那颗——粉描边、粉字、粉错影。 */
function HeaderAvatar({
  avatar,
  fallbackChar,
  variant = "char",
}: {
  avatar?: string;
  fallbackChar: string;
  variant?: "char" | "me";
}) {
  const mine = variant === "me";
  return (
    <span
      style={{
        flex: "none",
        width: 44,
        height: 44,
        background: avatar ? `url(${avatar}) center/cover` : "transparent",
        border: mine ? `3px solid ${T.pink}` : "3px solid rgba(255,253,248,.85)",
        color: mine ? T.pink : "#FFFDF8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 19,
        fontWeight: 700,
        fontFamily: SERIF,
        boxShadow: mine ? "4px 4px 0 rgba(224,65,122,.55)" : "-4px 4px 0 rgba(255,253,248,.20)",
        overflow: "hidden",
      }}
    >
      {avatar ? null : fallbackChar}
    </span>
  );
}

/** 名字底下那行签名；没有签名就留一行等高占位——两侧才平、两个名字才在同一条线上（线上同款）。 */
function HeaderSign({ text }: { text?: string }) {
  const s = (text ?? "").trim();
  return s ? (
    <span style={headerSignStyle}>{s}</span>
  ) : (
    <span aria-hidden style={{ display: "block", height: 15, marginTop: 5 }} />
  );
}

/* ---------- 输入区（1.9.91 换新脸：整副照抄线上，数值见 ChatWindow 那头输入区） ---------- */

/** 输入栏那一行（1.9.91 换新脸，线上同款）：**只是一条 flex 行**——墨底上直接摆控件，
 *  不再套白胶囊（旧版那颗 `T.card` 白胶囊已撤）。 */
const inputBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 9,
};

/** 书写框（1.9.91 换新脸，线上同款）：深墨里压出的一道**墨槽**——内阴影 ＋ 一圈极淡的纸白内描边，
 *  读起来是「凹进去的一块」，不是浮在上头的白框；光标染粉。 */
const inputTextStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxHeight: 106,
  border: "none",
  outline: "none",
  resize: "none",
  background: "rgba(255,253,248,.10)",
  borderRadius: 8,
  padding: "8px 13px",
  fontSize: 15,
  fontFamily: SANS,
  color: "#FFFDF8",
  caretColor: T.pink,
  lineHeight: 1.45,
  letterSpacing: ".02em",
  boxShadow: "inset 0 3px 8px rgba(0,0,0,.42), inset 0 0 0 1px rgba(255,253,248,.09)",
};

/** 左端那颗斜体方钮（1.9.91 换新脸，照线上那颗「＋」做）：墨底 `#0F0D13` ＋ 1.5px 纸白边
 *  ＋ `0 3px 0` 灰白硬错影；开着时整颗换粉渐层（调用处覆盖）。 */
const inputSideBtnStyle: React.CSSProperties = {
  flex: "none",
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "1.5px solid #FFFDF8",
  padding: 0,
  background: "#0F0D13",
  color: "#FFFDF8",
  boxShadow: "0 3px 0 rgba(255,253,248,.30)",
  cursor: "pointer",
  transition: "all .18s",
};

/** 右端那颗 36 方钮（1.9.91 换新脸，线上同款）：粉渐变 ＋ 纸白图标 ＋ 硬错影，写下去／停下共用一副长相。 */
const inputRoundBtnStyle: React.CSSProperties = {
  flex: "none",
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)",
  color: "#FFFDF8",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)",
  cursor: "pointer",
  transition: "opacity .18s",
};

const retryBtn: React.CSSProperties = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 28,
  padding: "0 12px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 700,
  color: T.pink,
  background: "transparent",
  border: "1px solid rgba(232,106,155,.34)",
  cursor: "pointer",
};
