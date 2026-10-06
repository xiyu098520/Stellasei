/**
 * 把当前页面的音频会话声明成「媒体播放」（1.10.22）。
 *
 * 背景：iOS 18 主屏 PWA（standalone）里，网页/媒体音频会被系统整体掐掉，而页面自己完全
 * 看不出来——<audio> 元素 paused=false、时长也解出来了、事件也照走，可 currentTime 恒 0、
 * 一点声没有（「假播放」）。WebKit 官方对这类症状给的解药就一条：
 * `navigator.audioSession.type = "playback"`（Bug 251532 / 237322）。它管的是**整个页面**
 * 的音频会话，设置一次，本页所有 HTMLMediaElement 都按「媒体播放」走，不再被系统静音。
 *
 * 用法：在用户的点击手势里、起播之前同步调一次即可（页级生效，重复调无副作用）。
 * 没有这个 API 的浏览器（非 iOS）静默跳过，绝不影响后续播放。
 */
export function ensurePlaybackSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type?: string } };
    if (nav.audioSession && nav.audioSession.type !== "playback") {
      nav.audioSession.type = "playback";
    }
  } catch {
    /* 没这 API／被拒就算了，别影响后面的播放 */
  }
}
