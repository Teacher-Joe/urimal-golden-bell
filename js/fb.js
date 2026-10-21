// Firebase 연결: 로그인, 데이터베이스, 서버 시각, 접속 표시.
// 주소 끝에 ?emu=1 을 붙이면 실제 Firebase 대신 이 PC의 에뮬레이터를 쓴다(시험용).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeAuth, browserLocalPersistence, browserSessionPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential, signInAnonymously, onAuthStateChanged, signOut, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getDatabase, ref, onValue, set, update, get, remove, push, runTransaction, serverTimestamp, onDisconnect, connectDatabaseEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { serverClock } from './common.js';

export const EMU = new URLSearchParams(location.search).has('emu');
export { ref, onValue, set, update, get, remove, push, runTransaction, serverTimestamp, onDisconnect };

let app, auth, db;

/** persistence: 'local'(교사, 브라우저를 닫아도 로그인 유지) | 'session'(조·발표 화면, 탭마다 따로) */
export function initFirebase({ persistence = 'session' } = {}) {
  const cfg = EMU
    ? { apiKey: 'demo-key', authDomain: '127.0.0.1', projectId: 'demo-golden-bell', databaseURL: 'http://127.0.0.1:9000/?ns=demo-golden-bell-default-rtdb', appId: 'demo' }
    : firebaseConfig;
  app = initializeApp(cfg);
  auth = initializeAuth(app, {
    persistence: persistence === 'local' ? browserLocalPersistence : browserSessionPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  db = getDatabase(app);
  if (EMU) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
  // 서버 시각 차이: 타이머는 모두 서버 시각으로 계산한다
  onValue(ref(db, '.info/serverTimeOffset'), (s) => (serverClock.offset = s.val() || 0));
  return { app, auth, db };
}

export const dbRef = (path) => ref(db, path);
export const roomRef = (code, path = '') => ref(db, `rooms/${code}${path ? '/' + path : ''}`);

export function waitForUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => {
      off();
      resolve(u);
    });
  });
}
export const currentUser = () => auth.currentUser;
export const onUser = (fn) => onAuthStateChanged(auth, fn);

export async function googleLogin() {
  if (EMU) {
    // 시험(에뮬레이터)용 가짜 구글 계정. 실제 사이트에서는 쓰이지 않는다.
    const fake = GoogleAuthProvider.credential(JSON.stringify({ sub: 'emu-teacher', email: 'teacher@example.com', email_verified: true }));
    return (await signInWithCredential(auth, fake)).user;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return (await signInWithPopup(auth, provider)).user;
  } catch (e) {
    // 팝업이 막힌 브라우저에서는 페이지 이동 방식으로 로그인
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return new Promise(() => {});
    }
    throw e;
  }
}
export async function anonymousLogin() {
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}
export const logout = () => signOut(auth);

// 연결 상태(파이어베이스 서버와 이어져 있는지)
export function onConnection(fn) {
  return onValue(ref(db, '.info/connected'), (s) => fn(!!s.val()));
}

// 접속 표시: 연결되면 presence/{uid}에 쓰고, 끊기면 서버가 자동으로 지운다.
export function startPresence(code, info) {
  const uid = auth.currentUser.uid;
  const pref = roomRef(code, `presence/${uid}`);
  return onValue(ref(db, '.info/connected'), async (s) => {
    if (!s.val()) return;
    try {
      await onDisconnect(pref).remove();
      await set(pref, { ...info, at: serverTimestamp() });
    } catch {}
  });
}

// 쓰기가 서버에 실제로 저장될 때까지 기다린다. 오래 걸리면(오프라인) 시간 초과로 실패 처리.
export function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('서버에 연결하지 못했어요. Wi-Fi 연결을 확인해 주세요.'), { code: 'timeout' })), ms)),
  ]);
}

export const isDenied = (e) => /permission[_ -]?denied/i.test(String(e?.code || e?.message || ''));

// 사이트 기본 주소 (GitHub Pages는 https://아이디.github.io/저장소이름/ 아래에 있음)
export function siteBase() {
  return new URL('.', location.href).href.replace(/\/$/, '');
}
