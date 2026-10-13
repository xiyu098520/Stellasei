/**
 * 思源宋体「第二批」：进 App 后纯后台、无进度地静默补齐其余全部字形。
 *
 * 首批（界面基础文字子集 ui-0/1/2，family 'Noto Serif SC UI'）随开屏下载并上屏；
 * 这一批把整量 000–100 共 101 片拉进浏览器 HTTP 缓存——此后凡界面／聊天／长文里
 * 出现的字，浏览器直接从缓存取字形，不必再等网络（含生僻字、其他语种）。首次全部
 * 下载成功后落 localStorage 标记，之后每次启动直接跳过、不再发请求。
 *
 * 失败策略：中途失败**一直重试到成功**——网络错误／超时／5xx 都按指数退避重排
 * （最长 60s，不放弃，网络恢复后自动接上）；只有 4xx（地址或文件真不存在）视为
 * 致命、跳过，免得对着一个不存在的地址无限重试。并发 3，不抢首屏、不显示进度。
 */

const FILE_COUNT = 101; // 000 … 100
const CONCURRENCY = 3;
const BASE_DELAY = 1000;
const MAX_DELAY = 60000;
const DONE_KEY = "stellasei:font-full-done";

/** 同一次会话里只启一次（防 React StrictMode 双跑）。 */
let started = false;

export function startFontPrefetch(basePath: string): void {
  if (typeof window === "undefined" || started) return;
  started = true;

  try {
    if (localStorage.getItem(DONE_KEY) === "1") return;
  } catch {
    /* 隐私模式等拿不到 localStorage：照常下，只是下次不记得。 */
  }

  let cursor = 0;
  let active = 0;
  let settled = 0;

  const settle = () => {
    settled += 1;
    active -= 1;
    if (settled === FILE_COUNT) {
      try {
        localStorage.setItem(DONE_KEY, "1");
      } catch {
        /* 存不了就算了。 */
      }
    }
  };

  const load = (index: number, attempt: number) => {
    const name = String(index).padStart(3, "0");
    fetch(`${basePath}/fonts/siyuan/${name}.woff2`, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        return res.arrayBuffer();
      })
      .then(() => {
        settle();
        pump();
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        /* 4xx：地址或文件本身有问题，重试无意义 → 跳过，不拖住整批。 */
        if (status && status >= 400 && status < 500) {
          settle();
          pump();
          return;
        }
        const delay = Math.min(MAX_DELAY, BASE_DELAY * 2 ** attempt);
        window.setTimeout(() => load(index, attempt + 1), delay);
      });
  };

  /* 自排程并发泵：每有一片落地（或放弃）就补位，直到 101 片都 settle。 */
  function pump() {
    while (active < CONCURRENCY && cursor < FILE_COUNT) {
      const index = cursor;
      cursor += 1;
      active += 1;
      load(index, 0);
    }
  }

  pump();
}
