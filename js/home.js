// 처음 화면: 교사 구글 로그인 → 수업방 만들기 / 내 수업방 이어서 하기
import { $, esc, storage, formatTime } from './common.js';
import { bellSVG, goldDust } from './fx.js';
import { initFirebase, waitForUser, googleLogin, logout, dbRef, roomRef, get, set, remove, withTimeout, serverTimestamp, EMU } from './fb.js';
import { newRoomData, newRoomCode } from './engine.js';

const emuQ = EMU ? '?emu=1' : '';
const ROOM_TTL_MS = 30 * 86400000; // 30일 지난 수업방은 정리

$('#bell').innerHTML = bellSVG();
goldDust($('canvas.dust'), { reduce: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches });
$('#teamCount').innerHTML = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${n === 6 ? 'selected' : ''} value="${n}">${n}조</option>`).join('');

initFirebase({ persistence: 'local' });
let user = null;

waitForUser().then((u) => (u && !u.isAnonymous ? showUser(u) : showLoggedOut()));

function showLoggedOut() {
  $('#loggedOut').hidden = false;
  $('#loggedIn').hidden = true;
}

async function showUser(u) {
  user = u;
  $('#loggedOut').hidden = true;
  $('#loggedIn').hidden = false;
  $('#who').textContent = u.email || u.displayName || '선생님';
  await listRooms();
}

$('#loginBtn').onclick = async () => {
  $('#err').textContent = '';
  try {
    showUser(await googleLogin());
  } catch (e) {
    $('#err').textContent = e.code === 'auth/unauthorized-domain'
      ? '이 사이트 주소가 Firebase에 등록되지 않았어요. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 이 주소를 추가해 주세요.'
      : `로그인하지 못했어요: ${e.code || e.message}`;
  }
};
$('#logoutBtn').onclick = async () => {
  await logout();
  location.reload();
};

async function listRooms() {
  const box = $('#recent');
  try {
    const snap = await withTimeout(get(dbRef(`owners/${user.uid}/rooms`)));
    const rooms = Object.entries(snap.val() || {}).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    // 30일 지난 방은 자동으로 정리(학생 자료 보관 기간 최소화)
    const now = Date.now();
    for (const [c, r] of rooms.filter(([, r]) => r.createdAt && now - r.createdAt > ROOM_TTL_MS)) {
      await remove(roomRef(c)).catch(() => {});
      await remove(dbRef(`owners/${user.uid}/rooms/${c}`)).catch(() => {});
    }
    const keep = rooms.filter(([, r]) => !(r.createdAt && now - r.createdAt > ROOM_TTL_MS));
    box.innerHTML = keep.length
      ? `<h3>내 수업방</h3>${keep.map(([c, r]) => `<a class="btn ghost" href="teacher.html${emuQ}#${esc(c)}">📂 ${esc(r.title || '수업방')} · ${esc(c)} <small>${r.createdAt ? new Date(r.createdAt).toLocaleDateString('ko-KR') : ''}</small></a>`).join('')}<p class="muted small">만든 지 30일이 지난 수업방은 자동으로 지워져요.</p>`
      : '';
  } catch (e) {
    box.innerHTML = `<p class="err">수업방 목록을 불러오지 못했어요: ${esc(e.message)}</p>`;
  }
}

$('#createForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#err').textContent = '';
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const data = newRoomData({ uid: user.uid, title: $('#title').value, teamCount: Number($('#teamCount').value) });
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = newRoomCode();
      try {
        // 이미 있는 방 코드면 보안 규칙이 거절한다 → 다른 코드로 다시
        await withTimeout(set(roomRef(c), data));
        code = c;
      } catch (err) {
        if (!/permission/i.test(String(err.code || err.message))) throw err;
      }
    }
    if (!code) throw new Error('방 코드를 만들지 못했어요. 다시 시도해 주세요.');
    await withTimeout(set(dbRef(`owners/${user.uid}/rooms/${code}`), { title: data.meta.title, createdAt: serverTimestamp() }));
    storage(`gb-new-${code}`, true);
    location.href = `teacher.html${emuQ}#${code}`;
  } catch (err) {
    $('#err').textContent = /permission/i.test(String(err.code || err.message))
      ? '저장 권한이 없어요. Firebase 콘솔에서 보안 규칙(database.rules.json)을 게시했는지 확인해 주세요.'
      : err.message;
    btn.disabled = false;
  }
};
