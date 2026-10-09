/**
 * 页面音频「点亮」与解锁（本文件两件事，互不影响）。
 *
 * 一、ensurePlaybackSession()（1.10.22）：把 navigator.audioSession.type 设成 "playback"。
 *     背景：iOS 18 主屏 PWA（standalone）里，网页/媒体音频会被系统整体掐掉，而页面自己完全
 *     看不出来——<audio> 元素 paused=false、时长也解出来了、事件也照走，可 currentTime 恒 0、
 *     一点声没有（「假播放」）。WebKit 官方对这类症状给的一条解药是
 *     `navigator.audioSession.type = "playback"`（Bug 251532 / 237322）。
 *     注意：**这条对聊天语音那条「假播放」已被证实无效**（见 1.12.30），仅设置页试听等
 *     带原生播放键的 <audio controls> 还留着调用；没有这个 API 的浏览器静默跳过。
 *
 * 二、「首触解锁」（1.12.32）：抄参考项目 lib/tts-service.ts 的
 *     installUnlockListener()/unlockAudioPlayback()。这是同机唯一被证实能响的那套接法里，
 *     星绥此前**完全缺失**的一环——模块加载即挂全局首触监听，第一次触摸时用一个共享
 *     <audio> 极短地播一段静音 WAV，把本页的音频会话「点亮」；此后所有程序化 play()
 *     都落在已激活的会话上，不再假播放。参考项目「合成后手势外再 play() 也能响」正靠它。
 *
 * 与「播放铁律」的关系：铁律管的是**播放元素**（一点就新建、用完即弃、不共用、不保活）；
 * 这里解锁用的是**另建的一个一次性元素**，不参与、不接管任何语音播放，二者不冲突。
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

/* ------------------------------------------------------------------ */
/* 首触解锁（1.12.32）                                                */
/* ------------------------------------------------------------------ */

let _voiceUnlocked = false;
let _voiceUnlockInstalled = false;

/** 48kHz 单声道 16bit 的极短（2ms）静音 WAV——合法音源，play() 才会真的起播＝解锁。
    采样率用 48kHz 而非 8kHz：iOS 的系统音频会话采样率会跟着最近一次播放的媒体走，
    解锁音若太低，紧接着播的语音会被压到低采样率而发闷（与参考项目保活音同理）。 */
function silentWavUrl(): string {
  const sampleRate = 48000;
  const numSamples = 96; /* 2ms */
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, dataSize, true);
  /* 16bit PCM 静音为 0，ArrayBuffer 默认全 0，无需再写 */
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

/** 在用户手势里解锁一次即可（重复调无副作用）。参考项目 unlockAudioPlayback 的 <audio> 那半。 */
function unlockOnce(): void {
  if (_voiceUnlocked || typeof window === "undefined") return;
  const audio = new Audio();
  audio.setAttribute("playsinline", "");
  const url = silentWavUrl();
  audio.muted = true;
  audio.src = url;
  const finish = () => {
    try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
    audio.muted = false;
    URL.revokeObjectURL(url);
    _voiceUnlocked = true;
  };
  try {
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(finish).catch(() => { audio.muted = false; URL.revokeObjectURL(url); });
    } else {
      finish();
    }
  } catch {
    audio.muted = false;
    URL.revokeObjectURL(url);
  }
}

/** 供播放路径在手势内兜底调用：首触那下通常已解过，这里是「万一监听器还没装上」的保险。 */
export function ensureVoiceUnlocked(): void {
  unlockOnce();
}

function installVoiceUnlock(): void {
  if (_voiceUnlockInstalled || typeof window === "undefined") return;
  _voiceUnlockInstalled = true;
  const handler = () => unlockOnce();
  /* 三件都挂：iOS 主屏 PWA 里 touchend／pointerdown 先于 click 抵达，能赶在播放前解开。 */
  window.addEventListener("touchend", handler, { passive: true });
  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("mousedown", handler, { passive: true });
}

/* 模块在客户端一加载就装上监听（参考项目同款：加载早于用户第一次触摸）。 */
if (typeof window !== "undefined") installVoiceUnlock();
