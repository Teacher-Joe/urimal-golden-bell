// 세 화면(교사·조·발표)이 함께 쓰는 작은 도구들.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const charLen = (s) => [...String(s || '')].length;

const rand = (n) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};
// 화면을 열 때마다 새로 만드는 기기 표시. 소리 담당 기기를 구분하는 데 쓴다.
export const clientId = 'c' + rand(10);
export const randomId = (n = 8) => rand(n);
// 헷갈리는 0/O/1/I를 뺀 32글자
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => ALPHA[b % 32]).join('');
}
export function randomKey() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

export class AppError extends Error {
  constructor(message, data = {}) {
    super(message);
    this.data = data;
  }
}

// 서버(Firebase) 기준 시각. 타이머 표시는 모두 이 시각으로 계산한다.
export const serverClock = {
  offset: 0,
  now() {
    return Date.now() + this.offset;
  },
};

export function remainingMs(live) {
  if (!live) return 0;
  if (live.phase === 'answering' && live.endsAt) return Math.max(0, live.endsAt - serverClock.now());
  return Math.max(0, live.remainingMs ?? live.durationMs ?? 0);
}

// 화면 위쪽에 잠깐 뜨는 알림
export function toast(message, kind = 'info', ms = 3800) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function reduceMotionPreferred(setting) {
  return !!setting || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export async function enterFullscreen(el = document.documentElement) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {}
}

export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
