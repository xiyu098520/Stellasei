/**
 * 语音识别（浏览器 Web Speech API）。
 *
 * 只做一件事：把麦克风里说的话转成文字——**在浏览器本地／系统侧识别，不调我们自己的接口**，
 * 也不走 Whisper。真录音本体是另一条线（MediaRecorder，见 ChatWindow 的语音弹窗）。
 *
 * 蓝本＝参考项目 `lib/stt-service.ts`（Float 小手机）。这里只把 `any` 换成了手写的最小类型
 * （ESLint 开着 `@typescript-eslint/no-explicit-any`），行为逐字对齐。
 */

export type STTCallbacks = {
  /** 边说边出的中间结果（含已定稿的 final 前缀）。 */
  onInterim: (text: string) => void;
  /** 一段说完了、定稿的文字。 */
  onFinal: (text: string) => void;
  /** 识别出错（权限／麦克风／网络等），带一句给人看的中文。 */
  onError: (error: string) => void;
  /** 没识别到任何内容就结束了。 */
  onEnd: () => void;
  /** 压根没检测到语音（用于提示改用文字）。 */
  onNoSpeech: () => void;
};

export type STTSession = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  isSupported: boolean;
};

/* Web Speech API 没有进 TS 标准库，手描一份够用的最小类型。 */
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEventLike = { results: SpeechRecognitionResultList };
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 取当前浏览器上的识别构造器（标准名或 webkit 前缀名），没有就返回 null。 */
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 开一段识别会话。`start()` 才开始听，`stop()` 结束并触发回调，`abort()` 直接丢弃。
 */
export function createSTTSession(callbacks: STTCallbacks, lang = "zh-CN"): STTSession {
  const Ctor = getSpeechRecognitionCtor();

  if (!Ctor) {
    return {
      start: () => callbacks.onError("浏览器不支持语音识别"),
      stop: () => {},
      abort: () => {},
      isSupported: false,
    };
  }

  const recognition = new Ctor();
  recognition.lang = lang;
  /* 一次只说一句：说完自动停，交给上层收尾（跟参考项目一致）。 */
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let aborted = false;
  let finalText = "";
  let hadNoSpeech = false;

  recognition.onresult = (event) => {
    if (aborted) return;

    let interim = "";
    finalText = "";
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }

    callbacks.onInterim(finalText + interim);
  };

  recognition.onerror = (event) => {
    if (aborted) return;
    /* 主动 abort 会带一个 aborted 错误，那是我们自己叫停的，不算错。 */
    if (event.error === "aborted") return;

    if (event.error === "no-speech") {
      hadNoSpeech = true;
      return;
    }

    const errorMap: Record<string, string> = {
      "audio-capture": "无法访问麦克风",
      "not-allowed": "麦克风权限被拒绝",
      network: "网络错误",
    };
    callbacks.onError(errorMap[event.error] || `语音识别错误: ${event.error}`);
  };

  recognition.onend = () => {
    if (aborted) return;

    if (finalText.trim()) {
      callbacks.onFinal(finalText.trim());
    } else if (hadNoSpeech) {
      hadNoSpeech = false;
      callbacks.onNoSpeech();
    } else {
      callbacks.onEnd();
    }
  };

  return {
    start: () => {
      aborted = false;
      finalText = "";
      hadNoSpeech = false;
      try {
        recognition.start();
      } catch {
        /* 已经开着——忽略。 */
      }
    },
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* 已经停了——忽略。 */
      }
    },
    abort: () => {
      aborted = true;
      try {
        recognition.abort();
      } catch {
        /* 已经停了——忽略。 */
      }
    },
    isSupported: true,
  };
}
