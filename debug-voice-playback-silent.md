# Debug Session: voice-playback-silent

- **Status**: [未闭环 · 进行中]（1.12.30 audioSession、1.12.31 挂 DOM **均已证伪**；1.12.32 补齐参考项目「首触解锁」，待复验）
- **Issue**: 聊天语音条点播放**没声音**（点击能进播放态）。播放路径 `playVoiceViaElement` 已与参考项目 `playSrc` 逐行一致，静态分析无法定位。
- **Debug Server**: http://192.168.1.2:7777/event
- **Log File**: .dbg/trae-debug-log-voice-playback-silent.ndjson

## Reproduction Steps
1. 手机主屏 PWA（iOS 18）打开 App。
2. 进任一会话，点一条 TA 的〔语音〕气泡的播放键。
3. 观察：有没出声；是否出现「播放失败，没出声」。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence | 结论 |
|----|------------|------------|--------|----------|------|
| A | data URL 数据坏了／iOS 解不了 | Med | Low | entry: `data:audio/mpeg;base64,SUQz…` 126KB；loadedmetadata duration=5.878 | **排除** |
| B | 不是真音频／非 audio 前缀 | Med | Low | 同上，isAudioDataUrl=true、isBlobUrl=false | **排除** |
| C | iOS 主屏 PWA「假播放」（元素自称在播、currentTime 恒 0、无报错） | High | Low | 见下 | **命中** |
| D | 2.5s 探针误报 | Med | Low | 探针触发时 currentTime 确为 0，非误报 | 排除 |
| E | 不同气泡表现不同 | Med | Low | 未复现 | 搁置 |
| F | 音频会话类型没钉成 `playback` | — | Low | 1.12.30 加了 `ensurePlaybackSession()`，post-fix 仍 `currentTime:0` | **证伪** |
| G | 播放元素**脱离 DOM** 时在主屏 PWA 上「假播放」 | High | Low | 1.12.31 改为「挂 DOM 再设源」后复验仍无声 | **证伪** |
| H | 缺参考项目的**「首触解锁」**（模块加载即挂全局触摸监听→静音 WAV 点亮音频会话）；星绥从无此机制 | High | Low | 1.12.32 补齐，待 `post-fix` | 复验中 |

## Log Evidence（pre-fix 一轮，8 条）
- `entry`：`{"len":126027,"head":"data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPA","isAudioDataUrl":true,"isBlobUrl":false,"hasBase64":true}`
- `evt:loadedmetadata` / `evt:durationchange`：`readyState:1, networkState:2, duration:5.878` → **iOS 能解码**
- `evt:canplay`：`readyState:4`（已缓存完）
- `evt:playing` + `play-resolved`：`readyState:4, paused:false, currentTime:0, duration:5.878, errCode:0`
- `probe-2500-silent`：`settled:false, paused:false, currentTime:0`（2.5s 后仍 0）

**判定**：数据没问题、元素能解码、元素自称在播且非暂停，**唯独 `currentTime` 一秒不走、无声、也不报错**——教科书式的 iOS 主屏 PWA「假播放」。

## Root Cause
**两次判定，一次被推翻：**
- ~~`App` 里**已有**专治此症的函数 `ensurePlaybackSession()`……聊天这条播放路径一直漏调~~ —— **本题证伪**：1.12.30 补调后 post-fix 证据仍 `probe-2500-silent: currentTime:0`，故「漏调 audioSession」**不是**根因。
- **当前最可能（F/G）**：根因在**元素／环境层**——播放元素此前是**脱离 DOM** 的 `new Audio(dataUrl)`，而本 App 内唯一能响的设置页试听是 **DOM 内的 `<audio controls>`**＋用户点原生播放键。Apple adv22945 亦要求「元素已挂进 DOM、初始不设 src，点击时再设 src 并立刻 play」。

## Verification Conclusion
**1.12.30（已证伪）**：在 `togglePlay` 里同步调 `ensurePlaybackSession()`。复验失败——`post-fix` 一轮 `probe-2500-silent` 仍 `currentTime:0`。**该句待 1.12.31 定案时回退。**

**1.12.31（进行中）**：`playVoiceViaElement` 单变量改动——播放元素「先建 → 挂 DOM → 再设 src → 立刻 play」，`finalize`／`stopVoiceEl` 补 `el.remove()`。

**复验标准**：冷启 PWA 点一条聊天语音——`post-fix-2` 一轮里 `probe-2500-silent` **不再出现**（`currentTime` 明显 > 0）且**真的出声**。
