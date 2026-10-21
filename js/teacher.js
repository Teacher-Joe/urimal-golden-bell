// 교사 화면: 수업 관리·작품 제출함·문제 관리·퀴즈 진행·환경설정·백업.
import { $, $$, esc, randomId, storage, charLen, formatTime, remainingMs, toast, clientId, downloadText } from './common.js';
import { SONGS, songById, songNo } from './songs-art.js';
import { createSoundHost } from './sound-host.js';
import { KOREAN_VOICE_HELP } from './audio.js';
import { initFirebase, waitForUser, googleLogin, logout, roomRef, onValue, startPresence, onConnection, isDenied, siteBase, EMU } from './fb.js';
import { TeacherEngine, ACTIONS } from './engine.js';
import { audioApi } from './room-sync.js';

const code = decodeURIComponent(location.hash.slice(1) || '').toUpperCase();
const requestId = () => randomId(6);
const emuQ = EMU ? '?emu=1' : '';

let S = null;
let user = null;
let engine = null;
let sound = null;
let soundLocal = {};
let tab = storage('gb-teacher-tab') || 'live';
let selectedQ = null;
let proxyMode = false;
let joinInfo = null;
const alerts = [];
const PHASE_LABEL = { lobby: '대기 화면', listening: '가사 듣기', answering: '답 고르는 중', paused: '일시 정지', closed: '선택 마감', revealing: '정답 공개 연출 중', revealed: '정답 공개됨', final: '최종 점수판' };

initFirebase({ persistence: 'local' });
start();

async function start() {
  if (!code) return (location.href = `index.html${emuQ}`);
  user = await waitForUser();
  if (!user || user.isAnonymous) return showLogin();
  boot();
}

// ───────────────────────── 구글 로그인 ─────────────────────────
function showLogin(msg = '') {
  $('#login').hidden = false;
  $('#app').hidden = true;
  $('#loginErr').textContent = msg;
  $('#loginBtn').onclick = async () => {
    $('#loginErr').textContent = '';
    try {
      user = await googleLogin();
      $('#login').hidden = true;
      boot();
    } catch (err) {
      $('#loginErr').textContent = `로그인하지 못했어요: ${err.code || err.message}`;
    }
  };
}

function boot() {
  $('#app').hidden = false;
  $('#roomCode').textContent = code;
  $('#who').textContent = user.email || '';
  engine = new TeacherEngine(code);
  let ready;
  const readyP = new Promise((r) => (ready = r));
  // 방 전체를 실시간으로 받는다(교사만 가능 — 보안 규칙).
  onValue(
    roomRef(code),
    (snap) => {
      if (!snap.exists()) {
        addAlert('이 수업방이 없거나 삭제되었어요.', 'error', 'deleted');
        $('#conn').textContent = '⛔ 수업방 없음';
        $('#conn').className = 'conn bad';
        return;
      }
      engine.setRoom(snap.val());
      ready(true);
      onState(engine.view());
    },
    (err) => {
      if (isDenied(err)) showLogin(`이 구글 계정(${user.email})으로 만든 수업방이 아니에요. 수업방을 만든 계정으로 로그인해 주세요.`);
      else addAlert(`불러오지 못했어요: ${err.message}`);
    },
  );
  onConnection((on) => {
    const el = $('#conn');
    el.textContent = on ? 'Firebase 연결됨' : '⚠ 인터넷 연결 끊김 — 다시 연결 중…';
    el.className = 'conn ' + (on ? 'live' : 'bad');
    if (on) removeAlert('conn');
    else addAlert('인터넷 연결이 끊겼어요. 연결이 돌아오면 자동으로 이어져요. (이 화면을 닫지 마세요)', 'warn', 'conn');
  });
  readyP.then(() => startPresence(code, { role: 'teacher', clientId }));
  sound = createSoundHost({
    audio: audioApi(code, 'teacher', readyP),
    onChange: (st) => {
      soundLocal = st;
      renderHeader();
    },
  });

  $$('.t-tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  setTab(tab);
  $('#logoutBtn').onclick = async () => {
    await logout();
    location.href = `index.html${emuQ}`;
  };
  $('#openDisplay').onclick = () => S && window.open(`display.html${emuQ}#${code}.${S.displayToken}`, 'golden-bell-display');
  $('#soundHere').onclick = async () => {
    try {
      await sound.enable();
      toast('이 교사 화면에서 음성과 효과음을 내요 🔔', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  for (const id of ['live', 'subs', 'questions', 'teams', 'settings', 'backup']) {
    const el = $(`#tab-${id}`);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('focusout', () => setTimeout(() => pendingPaint && paint(), 0));
  }
  if (storage(`gb-new-${code}`)) {
    storage(`gb-new-${code}`, null);
    setTimeout(welcome, 300);
  }
}

function setTab(t) {
  tab = t;
  storage('gb-teacher-tab', t);
  $$('.t-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('.t-panel').forEach((p) => (p.hidden = p.dataset.tab !== t));
  if (t === 'teams' && !joinInfo) loadJoinInfo();
  paint(true);
}

// ───────────────────────── 알림(오류를 알기 쉽게) ─────────────────────────
function addAlert(msg, kind = 'error', id = null) {
  if (id) removeAlert(id, false);
  alerts.unshift({ id: id || requestId(), msg, kind, at: Date.now() });
  alerts.splice(6);
  renderAlerts();
}
function removeAlert(id, render = true) {
  const i = alerts.findIndex((a) => a.id === id);
  if (i >= 0) alerts.splice(i, 1);
  if (render) renderAlerts();
}
function renderAlerts() {
  const notices = (S?.notices || []).filter((n) => Date.now() - n.at < 5 * 60000).slice(0, 3);
  $('#alerts').innerHTML =
    alerts.map((a) => `<div class="alert ${a.kind}"><span>${a.kind === 'error' ? '⛔' : '⚠️'} ${esc(a.msg)}</span><small>${formatTime(a.at)}</small><button data-dismiss="${a.id}" class="btn small ghost" type="button">닫기</button></div>`).join('') +
    notices.map((n) => `<div class="alert info"><span>📱 ${esc(n.teamName)} 기기: ${esc(n.message)}</span><small>${formatTime(n.at)}</small></div>`).join('');
  $$('#alerts [data-dismiss]').forEach((b) => (b.onclick = () => removeAlert(b.dataset.dismiss)));
}

// 교사 명령 보내기. 오류는 토스트 + 상단 알림에 남긴다.
async function act(action, body = {}, { ok, confirmKey } = {}) {
  try {
    const method = ACTIONS[action];
    if (!method) throw new Error('알 수 없는 명령이에요.');
    if (!engine.R) throw new Error('아직 수업방을 불러오는 중이에요.');
    const r = await engine[method](body);
    if (ok) toast(ok, 'ok');
    return r || {};
  } catch (e) {
    if (isDenied(e)) {
      toast('저장 권한이 없어요. 수업방을 만든 구글 계정인지 확인해 주세요.', 'error', 6000);
      addAlert('저장이 거절되었어요(권한 없음).');
      return null;
    }
    if (e.code === 'timeout') {
      toast(e.message, 'error', 6000);
      addAlert(`전송 실패: ${e.message}`);
      return null;
    }
    if (e.data?.needsConfirm && confirmKey) {
      if (await confirmBox(e.message, '네, 계속할게요')) return act(action, { ...body, [confirmKey]: true }, { ok });
      return null;
    }
    if (e.data?.needsPoints) {
      addAlert(e.message, 'warn', 'points');
      setTab('settings');
      setTimeout(() => $('#setPoints')?.focus(), 100);
      return null;
    }
    toast(e.message, 'error', 5000);
    return null;
  }
}

// ───────────────────────── 대화 상자 ─────────────────────────
function dialog(html, buttons) {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    $('#dlgForm').innerHTML = `${html}<div class="modal-actions">${buttons.map((b) => `<button class="btn ${b.cls || ''}" value="${b.value}" type="submit">${esc(b.label)}</button>`).join('')}</div>`;
    dlg.onclose = () => resolve(dlg.returnValue);
    dlg.returnValue = '';
    dlg.showModal();
  });
}
async function confirmBox(msg, okLabel = '확인', danger = false) {
  const v = await dialog(`<h3>확인해 주세요</h3><p class="dlg-msg">${esc(msg)}</p>`, [
    { label: '취소', value: 'no', cls: 'ghost' },
    { label: okLabel, value: 'yes', cls: danger ? 'red' : 'gold' },
  ]);
  return v === 'yes';
}

function welcome() {
  dialog(
    `<h3>🎉 수업방이 만들어졌어요!</h3>
     <p>방 코드 <b class="led small-led">${esc(code)}</b></p>
     <p class="dlg-msg">다른 컴퓨터에서도 <b>같은 구글 계정(${esc(user.email || '')})</b>으로 로그인하면 이 수업방을 이어서 진행할 수 있어요.</p>
     <ol class="dlg-steps"><li>👥 <b>조·참여 주소</b>에서 조 이름을 정하고 QR 코드를 보여 주세요.</li><li>⚙️ <b>환경설정</b>에서 <b>정답 점수</b>를 정해 주세요.</li><li>📺 <b>발표 화면 열기</b> → 프로젝터 화면에서 ‘소리 켜고 시작하기’.</li></ol>`,
    [{ label: '시작하기', value: 'ok', cls: 'gold' }],
  );
}

// ───────────────────────── 상태 → 화면 ─────────────────────────
function onState(s) {
  S = s;
  sound.onState(s);
  if (!selectedQ || !S.questions.some((q) => q.id === selectedQ)) selectedQ = S.live.questionId || S.questions.find((q) => !q.graded && q.songId)?.id || S.questions[0].id;
  renderHeader();
  renderAlerts();
  paint();
}

let pendingPaint = false;
function paint(force = false) {
  if (!S) return;
  const panel = $(`#tab-${tab}`);
  const a = document.activeElement;
  // 입력 중인 칸은 덮어쓰지 않는다(포커스가 빠지면 다시 그림).
  if (!force && panel.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && tab !== 'questions') {
    pendingPaint = true;
    return;
  }
  pendingPaint = false;
  ({ live: renderLive, subs: renderSubs, questions: renderQuestions, teams: renderTeams, settings: renderSettings, backup: renderBackup })[tab]();
}

function renderHeader() {
  if (!S) return;
  const online = S.connections.teamIds.length;
  const ct = $('#connTeams');
  ct.textContent = `조 접속 ${online}/${S.teams.length}`;
  ct.className = 'conn ' + (online === S.teams.length ? 'live' : online ? '' : 'bad');
  const cd = $('#connDisplay');
  cd.textContent = S.connections.displays ? `발표 화면 ${S.connections.displays}대` : '발표 화면 없음';
  cd.className = 'conn ' + (S.connections.displays ? 'live' : '');
  const a = S.audio;
  const sc = $('#soundChip');
  if (!a.hostClientId) {
    sc.textContent = '🔇 소리 담당 없음';
    sc.className = 'conn bad';
  } else {
    const where = soundLocal.isHost ? '이 교사 화면' : a.hostRole === 'display' ? '발표 화면' : '다른 교사 화면';
    sc.textContent = `🔊 소리: ${where}${a.hostConnected ? '' : ' (연결 끊김)'}${a.speaking ? ' · 읽는 중' : ''}`;
    sc.className = 'conn ' + (a.hostConnected ? 'live' : 'bad');
  }
  $('#subCount').textContent = `${Object.keys(S.submissions).length}/${S.teams.length}`;
  document.title = `교사 · ${S.live.number ? `제${S.live.number}문제 ${PHASE_LABEL[S.live.phase]}` : PHASE_LABEL[S.live.phase]} · 우리말 골든벨`;
}

const teamName = (id) => S.teams.find((t) => t.id === id)?.name || `${id}조`;
const songLabel = (id) => (id ? `「${songById(id)?.title}」` : '');
const songOptions = (sel, empty = '— 노래 선택 —') => `<option value="">${empty}</option>` + SONGS.map((s, i) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${i + 1}. ${esc(s.title)} — ${esc(s.artist)}</option>`).join('');
const points = () => S.settings.pointsPerCorrect;
const pointsText = () => (points() ? `정답 ${points()}점` : '정답 점수 미정');

// ───────────────────────── 무대 진행 ─────────────────────────
function renderLive() {
  const L = S.live;
  const cur = S.questions.find((q) => q.id === L.questionId);
  const sel = S.questions.find((q) => q.id === selectedQ);
  const ph = L.phase;
  const running = ['listening', 'answering', 'paused', 'closed', 'revealing'].includes(ph);
  const result = cur ? S.results[cur.id] : null;

  const qList = S.questions
    .map((q) => {
      const st = q.id === L.questionId && ph !== 'lobby' ? `<span class="tag now">${PHASE_LABEL[ph]}</span>` : q.graded ? `<span class="tag done">채점 ${S.results[q.id].pointsPerCorrect}점</span>` : q.songId ? '<span class="tag ready">준비됨</span>' : '<span class="tag empty">비어 있음</span>';
      return `<button type="button" class="q-pick ${q.id === selectedQ ? 'sel' : ''}" data-act="pick" data-q="${q.id}"><b class="qn">${q.number}</b><span class="qs">${q.songId ? esc(songById(q.songId).title) : '정답 미정'}${q.presenterTeamId ? ` · ${esc(teamName(q.presenterTeamId))}` : ''}</span>${st}</button>`;
    })
    .join('');

  // 지금 진행 중인 문제(없으면 고른 문제 미리보기)
  const show = running || ph === 'revealed' ? cur : sel;
  const showResult = show ? S.results[show.id] : null;
  let pointsLine;
  if (showResult) pointsLine = `<div class="points ok">✅ 채점 완료 — 이 문제에 적용된 점수: 정답 <b>${showResult.pointsPerCorrect}점</b></div>`;
  else if (points()) pointsLine = `<div class="points">이번 문제 <b>정답 ${points()}점</b> · 오답·미응답 0점</div>`;
  else pointsLine = `<div class="points warn">⚠ 정답 점수를 아직 정하지 않았어요. <button class="btn small gold" data-act="goto-settings" type="button">환경설정에서 정하기</button></div>`;

  const can = {
    start: !!sel?.songId && ph !== 'revealing',
    timer: ph === 'listening',
    pause: ph === 'answering',
    resume: ph === 'paused',
    close: ph === 'answering' || ph === 'paused',
    reveal: ['answering', 'paused', 'closed'].includes(ph),
    instant: ['answering', 'paused', 'closed', 'revealing'].includes(ph),
    retry: !!cur && ph !== 'revealing' && ph !== 'lobby' && ph !== 'final',
    next: ph === 'revealed' && !!nextQuestion(),
    final: !['answering', 'paused', 'revealing'].includes(ph),
    lobby: ph !== 'revealing' && ph !== 'lobby',
  };
  const ttsStatus = S.audio.status?.error ? `<span class="tts-err">⚠ ${esc(S.audio.status.error)}</span>` : S.audio.speaking ? '<span class="tts-on">🔊 읽는 중…</span>' : S.audio.hostClientId ? (S.audio.hostConnected ? '<span>대기</span>' : '<span class="tts-err">소리 담당 기기 연결 끊김</span>') : '<span class="tts-err">소리 담당 기기 없음 → 발표 화면이나 이 화면에서 소리를 켜 주세요</span>';
  const startLabel = sel?.graded ? `🔁 제${sel.number}문제 다시 풀기` : `▶ 제${sel?.number}문제 시작`;

  $('#tab-live').innerHTML = `
  <div class="live-grid">
    <aside class="q-list"><h3>문제 고르기</h3>${qList}
      <p class="muted small">문제 번호·순서·정답은 <a href="#" data-act="goto-questions">문제 관리</a>에서 바꿀 수 있어요.</p></aside>
    <div class="live-main">
      <div class="now-card ph-${ph}">
        <div class="now-top">
          <span class="led">${show ? `제${show.number}문제` : '문제 없음'}</span>
          <span class="phase-chip">${running || ph === 'revealed' ? PHASE_LABEL[ph] : `${PHASE_LABEL[ph]} · 다음 문제 미리보기`}</span>
          <span id="tTimer" class="led cool t-timer">--</span>
        </div>
        ${show ? `<div class="answer-key">🔑 정답(교사만 보임): <b>${show.songId ? `${songNo(show.songId)}. ${esc(songById(show.songId).title)} — ${esc(songById(show.songId).artist)}` : '정해지지 않음'}</b>${show.presenterTeamId ? ` · 🎤 발표: ${esc(teamName(show.presenterTeamId))}` : ''}</div>` : ''}
        ${pointsLine}
        ${running && L.presenterExcluded ? `<div class="muted">발표 조(${esc(teamName(L.presenterTeamId))})는 이번 문제 답안에 참여하지 않아요.</div>` : ''}
        <div class="read-label">📖 읽을 문장 ${show?.text ? `<small>(${charLen(show.text).toLocaleString()}자)</small>` : ''}</div>
        <div class="read-text">${show?.text ? esc(show.text) : '<span class="muted">문장이 없어요. 문제 관리에서 입력하거나 제출함에서 ‘퀴즈로 사용’을 눌러 주세요.</span>'}</div>
        ${running || ph === 'revealed' ? `<label class="check"><input type="checkbox" data-act="show-text" ${L.showText ? 'checked' : ''}> 발표 화면에 문장 보이기</label>` : ''}
      </div>

      <div class="ctrl">
        <div class="ctrl-row">
          <button class="btn gold big" data-act="start" ${can.start ? '' : 'disabled'} type="button">${startLabel}</button>
        </div>
        <div class="ctrl-row tts-row">
          <b class="ctrl-label">① 가사 듣기</b>
          <button class="btn cyan" data-act="tts-play" ${running && cur?.text ? '' : 'disabled'} type="button">🔊 가사 읽어 주기</button>
          <button class="btn" data-act="tts-stop" type="button">⏹ 읽기 정지</button>
          <span class="tts-status">${ttsStatus}</span>
        </div>
        <div class="ctrl-row">
          <b class="ctrl-label">② 답 고르기</b>
          <button class="btn green" data-act="timer" ${can.timer ? '' : 'disabled'} type="button">⏱ 타이머 시작 (${Math.round((running ? L.durationMs : S.settings.timeLimitSec * 1000) / 1000)}초)</button>
          <button class="btn" data-act="pause" ${can.pause ? '' : 'disabled'} type="button">⏸ 일시 정지</button>
          <button class="btn" data-act="resume" ${can.resume ? '' : 'disabled'} type="button">▶ 재개</button>
          <button class="btn red" data-act="close" ${can.close ? '' : 'disabled'} type="button">🔒 선택 마감</button>
        </div>
        <div class="ctrl-row">
          <b class="ctrl-label">③ 정답</b>
          <button class="btn gold" data-act="reveal" ${can.reveal ? '' : 'disabled'} type="button">🥁 정답 공개${S.settings.skipRevealFx ? '' : ' (연출)'}</button>
          <button class="btn" data-act="instant" ${can.instant ? '' : 'disabled'} type="button">⏩ ${ph === 'revealing' ? '연출 건너뛰고 바로 공개' : '즉시 공개'}</button>
          <button class="btn" data-act="retry" ${can.retry ? '' : 'disabled'} type="button">🔁 이 문제 다시 풀기</button>
        </div>
        <div class="ctrl-row">
          <b class="ctrl-label">④ 다음</b>
          <button class="btn cyan" data-act="next" ${can.next ? '' : 'disabled'} type="button">➡ 다음 문제${nextQuestion() ? ` (제${nextQuestion().number}문제)` : ''}</button>
          <button class="btn gold" data-act="final" ${can.final ? '' : 'disabled'} type="button">🏆 점수판 공개</button>
          <button class="btn ghost" data-act="lobby" ${can.lobby ? '' : 'disabled'} type="button">🏠 대기 화면</button>
        </div>
      </div>

      ${renderAnswerTable(cur, result, running || ph === 'revealed')}
    </div>
  </div>`;
  tickTimer();
}

function nextQuestion() {
  const i = S.questions.findIndex((q) => q.id === S.live.questionId);
  return S.questions.slice(i + 1).find((q) => q.songId && !q.graded) || null;
}

function renderAnswerTable(cur, result, active) {
  const L = S.live;
  const ans = cur ? S.answers[cur.id] || {} : {};
  const online = new Set(S.connections.teamIds);
  const canProxy = active && ['answering', 'paused', 'closed'].includes(L.phase) && !result;
  const rows = S.teams
    .map((t) => {
      const a = ans[t.id];
      const excluded = active && L.presenterExcluded && L.presenterTeamId === t.id;
      const r = result?.perTeam[t.id];
      let res = '';
      if (r) res = { correct: `<span class="res good">⭕ 정답 +${r.points}</span>`, wrong: '<span class="res">✖ 오답 0</span>', none: '<span class="res">— 미응답 0</span>', presenter: '<span class="res muted">🎤 발표 조</span>' }[r.status];
      const proxy = proxyMode && canProxy && !excluded ? `<select data-act="proxy" data-team="${t.id}" aria-label="${esc(t.name)} 대신 입력">${songOptions(a?.songId, '— 대신 입력 —')}</select>` : '';
      return `<tr class="${online.has(t.id) ? '' : 'offline'}">
        <td><span class="dot ${online.has(t.id) ? 'on' : ''}"></span> <b>${esc(t.name)}</b></td>
        <td>${excluded ? '<span class="muted">발표 조 (참여 안 함)</span>' : a ? `${songNo(a.songId)}. ${esc(songById(a.songId).title)}${a.by === 'teacher' ? ' <small class="tag">교사 입력</small>' : ''}` : active ? '<span class="muted">아직 없음</span>' : ''}</td>
        <td class="muted">${a ? formatTime(a.at) : ''}</td>
        <td>${proxy}${res}</td>
        <td class="total">${S.totals[t.id]}점</td>
      </tr>`;
    })
    .join('');
  const answered = Object.keys(ans).length;
  return `<div class="answers">
    <div class="answers-head"><h3>조별 답안·점수 ${active && cur ? `<small>(응답 ${answered}조)</small>` : ''}</h3>
      <label class="check"><input type="checkbox" data-act="proxy-mode" ${proxyMode ? 'checked' : ''}> 학생 기기 대신 입력 모드</label></div>
    ${proxyMode && !canProxy ? '<p class="muted small">대신 입력은 답 고르는 중이거나 선택 마감 후(공개 전)에 할 수 있어요.</p>' : ''}
    <table class="tbl"><thead><tr><th>조</th><th>고른 노래 (교사만 보임)</th><th>시각</th><th>결과</th><th>합계</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">🟢 접속 중 · ⚪ 접속 안 됨 — 접속이 안 되는 조는 위의 ‘대신 입력 모드’를 켜고 선생님이 입력할 수 있어요.</p>
  </div>`;
}

function tickTimer() {
  const el = $('#tTimer');
  if (!el || !S) return;
  const L = S.live;
  if (['answering', 'paused', 'listening'].includes(L.phase)) {
    const sec = Math.ceil(remainingMs(L) / 1000);
    el.textContent = `${sec}초`;
    el.className = `led t-timer ${L.phase === 'answering' && sec <= 5 ? 'hot' : 'cool'}`;
  } else el.textContent = L.phase === 'closed' ? '마감' : '--';
}
setInterval(tickTimer, 200);

// ───────────────────────── 작품 제출함 ─────────────────────────
function renderSubs() {
  const subs = S.submissions;
  const n = Object.keys(subs).length;
  const used = {};
  for (const q of S.questions) if (q.sourceTeamId) (used[q.sourceTeamId] ||= []).push(q.number);
  // 노래별 선택 현황(중복 확인)
  const bySong = {};
  for (const [tid, s] of Object.entries(subs)) (bySong[s.songId] ||= []).push(Number(tid));
  const dupes = SONGS.filter((s) => bySong[s.id])
    .map((s) => `<li class="${bySong[s.id].length > 1 ? 'dup' : ''}">${songNo(s.id)}. ${esc(s.title)} — <b>${bySong[s.id].map(teamName).map(esc).join(', ')}</b>${bySong[s.id].length > 1 ? ` <span class="tag warn">중복 ${bySong[s.id].length}조</span>` : ''}</li>`)
    .join('');
  const qOpts = S.questions.map((q) => `<option value="${q.id}">문제 ${q.number}${q.graded ? ' (채점됨)' : q.songId || q.text ? ` (사용 중: ${q.songId ? esc(songById(q.songId).title) : '문장만'})` : ' (비어 있음)'}</option>`).join('');
  const online = new Set(S.connections.teamIds);
  const cards = S.teams
    .map((t) => {
      const s = subs[t.id];
      const reopened = S.reopenedTeams.includes(t.id);
      return `<article class="sub-card ${s ? '' : 'missing'}">
        <header><h3><span class="dot ${online.has(t.id) ? 'on' : ''}"></span> ${esc(t.name)}</h3>
          ${s ? `<span class="tag ok">✔ 제출 · ${s.version}번째 · ${formatTime(s.submittedAt)}</span>${s.editedByTeacher ? ' <span class="tag">교사 수정</span>' : ''}` : '<span class="tag empty">⌛ 아직 제출 전</span>'}
          ${reopened ? '<span class="tag warn">다시 받는 중</span>' : ''}</header>
        ${s ? `<div class="sub-song">${songNo(s.songId)}. <b>${esc(songById(s.songId).title)}</b> — ${esc(songById(s.songId).artist)}</div>
        <pre class="sub-lyrics">${esc(s.lyrics)}</pre>
        <div class="muted small">${charLen(s.lyrics).toLocaleString()}자${used[t.id] ? ` · 📝 문제 ${used[t.id].join(', ')}에 사용 중` : ''}</div>
        <div class="sub-actions">
          <button class="btn small" data-act="edit-sub" data-team="${t.id}" type="button">✏️ 검토·수정</button>
          <select data-role="apply-q" data-team="${t.id}" aria-label="적용할 문제 번호">${qOpts}</select>
          <button class="btn small gold" data-act="apply" data-team="${t.id}" type="button">🎯 퀴즈로 사용</button>
          ${!S.submissionsOpen && !reopened ? `<button class="btn small ghost" data-act="reopen-team" data-team="${t.id}" type="button">↩ 이 조만 다시 받기</button>` : ''}
        </div>` : `<div class="sub-actions">${!S.submissionsOpen && !reopened ? `<button class="btn small ghost" data-act="reopen-team" data-team="${t.id}" type="button">↩ 이 조만 제출 받기</button>` : ''}<button class="btn small" data-act="edit-sub" data-team="${t.id}" type="button">✏️ 선생님이 직접 입력</button></div>`}
      </article>`;
    })
    .join('');
  $('#tab-subs').innerHTML = `
    <div class="subs-head">
      <h2>📥 작품 제출함 <small>${n}/${S.teams.length}조 제출</small></h2>
      <div>${S.submissionsOpen ? '<span class="tag ok">제출 받는 중</span> <button class="btn red" data-act="subs-close" type="button">⏰ 제출 마감</button>' : '<span class="tag warn">제출 마감됨</span> <button class="btn green" data-act="subs-open" type="button">↩ 다시 받기 (모든 조)</button>'}</div>
    </div>
    <div class="dupes"><h3>🎵 노래별 선택 현황 <small class="muted">(같은 노래를 고른 조가 있어도 괜찮아요)</small></h3>${dupes ? `<ul>${dupes}</ul>` : '<p class="muted">아직 제출한 조가 없어요.</p>'}</div>
    <div class="sub-grid">${cards}</div>`;
}

async function editSubmission(teamId) {
  const s = S.submissions[teamId] || { songId: '', lyrics: '' };
  const v = await dialog(
    `<h3>✏️ ${esc(teamName(teamId))} 작품 검토·수정</h3>
     <label class="field">노래 <select id="edSong">${songOptions(s.songId)}</select></label>
     <label class="field">바꾼 가사 <textarea id="edLyrics" rows="12" maxlength="4000">${esc(s.lyrics)}</textarea></label>
     <div class="muted small" id="edCount">${charLen(s.lyrics)} / 4,000자</div>`,
    [
      { label: '취소', value: 'no', cls: 'ghost' },
      { label: '저장', value: 'save', cls: 'gold' },
    ],
  );
  if (v !== 'save') return;
  await act('edit-submission', { teamId, songId: $('#edSong').value, lyrics: $('#edLyrics').value }, { ok: '작품을 수정했어요.' });
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'edLyrics') $('#edCount').textContent = `${charLen(e.target.value).toLocaleString()} / 4,000자`;
});

// ───────────────────────── 문제 관리 ─────────────────────────
function renderQuestions() {
  const panel = $('#tab-questions');
  if (!panel.querySelector('.q-rows')) {
    panel.innerHTML = `<div class="q-head"><h2>📝 문제 1~10 관리</h2>
      <p class="muted">문제 번호(발표 순서)와 정답 노래는 따로 관리돼요. ▲▼로 순서를 바꾸고, 문장은 제출함의 ‘퀴즈로 사용’으로 가져오거나 선생님이 직접 입력할 수 있어요.</p></div>
      <div class="q-rows"></div>`;
  }
  const box = panel.querySelector('.q-rows');
  const existing = new Map($$('.q-row', box).map((r) => [r.dataset.q, r]));
  const L = S.live;
  S.questions.forEach((q, i) => {
    let row = existing.get(q.id);
    const live = q.id === L.questionId && ['listening', 'answering', 'paused', 'closed', 'revealing'].includes(L.phase);
    const status = `${q.graded ? `<span class="tag done">채점 완료 · 정답 ${S.results[q.id].pointsPerCorrect}점</span>` : ''}${live ? '<span class="tag now">진행 중 (수정 잠김)</span>' : ''}${q.sourceTeamId ? `<span class="tag">출처: ${esc(teamName(q.sourceTeamId))} 작품</span>` : q.text ? '<span class="tag">교사 직접 입력</span>' : ''}`;
    if (!row || !row.dataset.dirty) {
      const html = `<div class="q-row" data-q="${q.id}">
        <div class="q-num led">${q.number}</div>
        <div class="q-move"><button class="btn small ghost" data-act="up" ${i === 0 ? 'disabled' : ''} type="button" aria-label="위로">▲</button><button class="btn small ghost" data-act="down" ${i === S.questions.length - 1 ? 'disabled' : ''} type="button" aria-label="아래로">▼</button></div>
        <div class="q-fields">
          <div class="q-line">
            <label>정답 노래 <select data-f="songId" ${live ? 'disabled' : ''}>${songOptions(q.songId, '— 정답 미정 —')}</select></label>
            <label>발표 조 <select data-f="presenterTeamId" ${live ? 'disabled' : ''}><option value="">없음 (교사 출제)</option>${S.teams.map((t) => `<option value="${t.id}" ${t.id === q.presenterTeamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          </div>
          <label class="q-text-label">문제 문장(고유어로 바꾼 가사) <textarea data-f="text" rows="3" maxlength="4000" ${live ? 'disabled' : ''}>${esc(q.text)}</textarea></label>
          <div class="q-line"><span class="q-status">${status}</span>
            <span class="q-btns"><button class="btn small gold" data-act="save-q" ${live ? 'disabled' : ''} type="button">💾 저장</button><button class="btn small ghost" data-act="clear-q" ${live || (!q.songId && !q.text) ? 'disabled' : ''} type="button">비우기</button></span></div>
        </div>
      </div>`;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      if (row) row.replaceWith(fresh);
      row = fresh;
    } else {
      row.querySelector('.q-num').textContent = q.number;
      row.querySelector('.q-status').innerHTML = status + '<span class="tag warn">저장 안 됨</span>';
    }
    box.appendChild(row); // 순서대로 다시 배치
    existing.delete(q.id);
  });
  existing.forEach((r) => r.remove());
}

async function saveQuestion(row) {
  const patch = {};
  for (const el of $$('[data-f]', row)) patch[el.dataset.f] = el.value;
  patch.presenterTeamId = patch.presenterTeamId ? Number(patch.presenterTeamId) : null;
  patch.songId = patch.songId || null;
  const r = await act('question', { questionId: row.dataset.q, patch }, { ok: '문제를 저장했어요.' });
  if (r) {
    delete row.dataset.dirty;
    renderQuestions();
  }
}

// ───────────────────────── 조·참여 주소 ─────────────────────────
// QR 코드는 브라우저에서 바로 만든다(qrcode-generator, lib/qrcode.min.js)
function qrSvg(url) {
  const q = window.qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const qrCache = new Map();
function loadJoinInfo() {
  const base = siteBase();
  const mk = (url) => {
    if (!qrCache.has(url)) qrCache.set(url, qrSvg(url));
    return { url, qr: qrCache.get(url) };
  };
  joinInfo = {
    base,
    teams: S ? S.teams.map((t) => ({ id: t.id, ...mk(`${base}/join.html${emuQ}#${code}.${t.id}.${t.token}`) })) : [],
    display: S ? mk(`${base}/display.html${emuQ}#${code}.${S.displayToken}`) : { url: '', qr: '' },
  };
}

function renderTeams() {
  loadJoinInfo(); // 조 이름·열쇠가 바뀌면 바로 반영
  const base = joinInfo.base;
  const isLocal = /\/\/(localhost|127\.|\[::1\])/.test(base);
  $('#tab-teams').innerHTML = `
  <div class="teams-grid">
    <div class="card">
      <h2>👥 조 구성</h2>
      <label class="field">조 수 <select id="teamCount">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${n === S.teams.length ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="names">${S.teams.map((t) => `<label class="field">${t.id}번 조 이름 <input data-name="${t.id}" value="${esc(t.name)}" maxlength="16"></label>`).join('')}</div>
      <button class="btn gold" data-act="save-teams" type="button">💾 조 구성 저장</button>
      <p class="muted small">학생 개인 이름 대신 조 이름만 써요. 조를 줄이면 빠지는 조의 작품·답안·점수가 지워져요(저장 전에 확인해요).</p>
    </div>
    <div class="card">
      <h2>🔗 참여 주소</h2>
      <p>태블릿은 아래 QR 코드로 들어와요. 사이트 주소: <b>${esc(base)}</b></p>
      ${isLocal ? '<p class="alert warn">⚠ 지금은 이 PC(localhost)에서 열어 시험 중이라 태블릿에서는 이 QR이 열리지 않아요. GitHub Pages 주소로 열면 태블릿용 QR이 만들어져요.</p>' : ''}
      <p class="muted small">QR 코드 속에는 조마다 다른 비밀 열쇠가 들어 있어요. 다른 조의 QR을 찍으면 그 조로 들어가게 되니, 조별로 따로 보여 주거나 인쇄해서 나눠 주세요.</p>
      <button class="btn ghost" data-act="print" type="button">🖨 QR 인쇄</button>
    </div>
  </div>
  ${
    joinInfo
      ? `<h2 class="qr-title">📱 조별 참여 QR 코드 <small class="muted">— 각 조 태블릿 카메라로 찍어요</small></h2>
  <div class="qr-grid">${joinInfo.teams
    .map((t) => `<div class="qr-card"><h3>${esc(teamName(t.id))}</h3><div class="qr">${t.qr}</div><input class="qr-url" readonly value="${esc(t.url)}"><div class="qr-actions"><button class="btn small" data-act="copy" data-url="${esc(t.url)}" type="button">📋 주소 복사</button><button class="btn small ghost" data-act="new-token" data-team="${t.id}" type="button">🔑 새 주소 발급</button></div></div>`)
    .join('')}
    <div class="qr-card display-card"><h3>📺 발표 화면</h3><div class="qr">${joinInfo.display.qr}</div><input class="qr-url" readonly value="${esc(joinInfo.display.url)}"><div class="qr-actions"><button class="btn small" data-act="copy" data-url="${esc(joinInfo.display.url)}" type="button">📋 주소 복사</button></div><p class="muted small">발표 화면 주소는 학생에게 보여 주지 마세요.</p></div>
  </div>`
      : '<p class="muted">QR 코드를 만드는 중…</p>'
  }`;
}

// ───────────────────────── 환경설정 ─────────────────────────
function renderSettings() {
  const st = S.settings;
  const a = S.audio;
  const voices = a.voices || [];
  let voiceArea;
  if (!a.hostClientId) voiceArea = '<p class="alert warn">소리 담당 기기가 아직 없어요. 발표 화면에서 ‘🔊 소리 켜고 시작하기’를 누르거나 위쪽 ‘🔊 이 화면에서 소리 내기’를 누르면, <b>그 기기에서 쓸 수 있는 한국어 음성</b>이 여기에 나와요.</p>';
  else if (a.ttsSupported === false) voiceArea = `<p class="alert warn">소리 담당 기기의 브라우저가 음성 읽기(Web Speech API)를 지원하지 않아요. 최신 Chrome·Edge·Safari를 써 주세요. 선생님이 직접 읽어 주셔도 진행할 수 있어요.</p>`;
  else if (!voices.length) voiceArea = `<div class="alert warn"><b>소리 담당 기기에 한국어 음성이 없어요.</b><ul>${KOREAN_VOICE_HELP.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>`;
  else
    voiceArea = `<label class="field">한국어 음성 <small class="muted">(소리 담당 기기: ${a.hostRole === 'display' ? '발표 화면' : '교사 화면'})</small>
      <select data-set="ttsVoiceURI"><option value="">자동 (기기 내 한국어 음성 우선)</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === st.ttsVoiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)}) · ${v.localService ? '기기 내 음성' : '온라인 음성(인터넷 필요)'}</option>`).join('')}</select></label>`;

  $('#tab-settings').innerHTML = `
  <div class="settings-grid">
    <div class="card">
      <h2>🏅 정답 점수</h2>
      <p>현재: ${st.pointsPerCorrect ? `<b class="big-num">정답 ${st.pointsPerCorrect}점</b>` : '<b class="warn-text">아직 정하지 않았어요</b>'}</p>
      <div class="inline"><input id="setPoints" type="number" min="1" max="1000" step="1" inputmode="numeric" value="${st.pointsPerCorrect ?? ''}" placeholder="예: 10"> <span>점</span>
        <button class="btn gold" data-act="save-points" type="button">적용</button></div>
      <p class="muted small">양의 정수만 입력해요. 바꾼 점수는 <b>아직 채점하지 않은 문제부터</b> 적용되고, 이미 채점한 문제의 점수는 그대로예요. ‘다시 풀기’로 다시 채점하면 그때의 점수가 적용돼요. 오답·미응답은 0점이에요.</p>
    </div>
    <div class="card">
      <h2>⏱ 제한시간</h2>
      <div class="inline"><input id="setTime" type="number" min="5" max="300" step="1" value="${st.timeLimitSec}"> <span>초</span> <button class="btn gold" data-act="save-time" type="button">적용</button></div>
      <p class="muted small">진행 중인 타이머는 바뀌지 않고, <b>다음 문제 또는 다시 풀기부터</b> 적용돼요.</p>
    </div>
    <div class="card">
      <h2>🔔 효과음·연출</h2>
      <label class="check"><input type="checkbox" data-set="sfxOn" ${st.sfxOn ? 'checked' : ''}> 효과음 켜기</label>
      <label class="field">효과음 음량 <input type="range" min="0" max="100" step="5" data-set="sfxVolume" value="${st.sfxVolume}"> <output>${st.sfxVolume}</output></label>
      <label class="check"><input type="checkbox" data-set="drumrollOn" ${st.drumrollOn ? 'checked' : ''}> 정답 공개 전 드럼롤</label>
      <label class="check"><input type="checkbox" data-set="skipRevealFx" ${st.skipRevealFx ? 'checked' : ''}> 정답 공개 연출 건너뛰기 (바로 공개)</label>
      <label class="check"><input type="checkbox" data-set="reduceMotion" ${st.reduceMotion ? 'checked' : ''}> 화면 움직임 줄이기 (확대·흔들림·색종이 줄임)</label>
      <p class="muted small">효과음은 소리 담당 기기 한 곳에서만 나요. 음성을 읽는 동안에는 효과음이 자동으로 멈춰요.</p>
    </div>
    <div class="card">
      <h2>🗣 한국어 음성(TTS)</h2>
      ${voiceArea}
      <label class="field">읽기 속도 <input type="range" min="0.5" max="1.5" step="0.05" data-set="ttsRate" value="${st.ttsRate}"> <output>${st.ttsRate}배</output></label>
      <div class="inline"><button class="btn cyan" data-act="tts-test" type="button">🔊 음성 시험</button><button class="btn" data-act="tts-stop" type="button">⏹ 정지</button>
        <span>${S.audio.status?.error ? `<span class="tts-err">⚠ ${esc(S.audio.status.error)}</span>` : S.audio.speaking ? '🔊 읽는 중…' : ''}</span></div>
    </div>
    <div class="card">
      <h2>🎤 발표 조 참여</h2>
      <label class="check"><input type="checkbox" data-set="presenterCanAnswer" ${st.presenterCanAnswer ? 'checked' : ''}> 발표하는 조도 자기 문제에 답을 고를 수 있게 하기</label>
      <p class="muted small">기본값은 ‘발표 조 제외’예요. 바꾸면 다음 문제 시작(또는 다시 풀기)부터 적용돼요.</p>
    </div>
  </div>`;
}

// ───────────────────────── 백업·마감 ─────────────────────────
function renderBackup() {
  $('#tab-backup').innerHTML = `
  <div class="settings-grid">
    <div class="card"><h2>💾 백업·복원</h2>
      <p class="muted small">백업 파일에는 조 이름·작품·문제·답안·점수·설정이 들어가요(참여 주소와 교사 코드는 들어가지 않아요).</p>
      <div class="inline"><button class="btn gold" data-act="export" type="button">⬇ 백업 파일 내려받기</button>
      <label class="btn">⬆ 백업 파일로 복원<input id="restoreFile" type="file" accept=".json,application/json" hidden></label></div>
    </div>
    <div class="card"><h2>📊 점수 내려받기</h2>
      <p class="muted small">문제별 점수와 합계를 CSV(엑셀) 파일로 내려받아요.</p>
      <button class="btn cyan" data-act="csv" type="button">⬇ 점수 CSV 내려받기</button>
    </div>
    <div class="card"><h2>🎬 수업 마감</h2>
      <p>${S.closed ? '<b class="warn-text">수업이 마감되었어요.</b> 학생은 더 이상 제출할 수 없어요.' : '수업을 마감하면 학생 작품·답안 제출이 모두 막혀요.'}</p>
      ${S.closed ? '<button class="btn green" data-act="reopen-room" type="button">↩ 수업 다시 열기</button>' : '<button class="btn red" data-act="close-room" type="button">🎬 수업 마감</button>'}
    </div>
    <div class="card danger"><h2>🗑 자료 삭제</h2>
      <p class="muted small">수업방과 모든 작품·답안·점수를 서버에서 완전히 지워요. 되돌릴 수 없으니 먼저 백업하세요. (만든 지 30일이 지난 수업방은 자동으로 지워져요.)</p>
      <button class="btn red" data-act="delete-room" type="button">수업방 삭제</button>
    </div>
    <div class="card"><h2>🔑 교사 계정</h2>
      <p>방 코드 <b class="led small-led">${esc(code)}</b> · 구글 계정 <b>${esc(user?.email || '')}</b></p>
      <p class="muted small">다른 컴퓨터에서도 같은 구글 계정으로 로그인하면 이 수업방을 이어서 진행할 수 있어요.</p>
      <button class="btn ghost" data-act="logout" type="button">이 컴퓨터에서 로그아웃</button>
    </div>
  </div>`;
  $('#restoreFile').onchange = restoreFromFile;
}

async function restoreFromFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let backup;
  try {
    backup = JSON.parse(await f.text());
  } catch {
    return toast('백업 파일을 읽을 수 없어요.', 'error');
  }
  if (!(await confirmBox('지금 수업방의 작품·문제·답안·점수·설정이 백업 파일 내용으로 바뀌어요. 복원할까요?', '복원하기', true))) return;
  await act('restore', { backup }, { ok: '백업을 복원했어요.' });
}

// ───────────────────────── 이벤트 ─────────────────────────
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type === 'checkbox')) return;
  if (b.tagName === 'A') e.preventDefault();
  const L = S.live;
  const teamId = Number(b.dataset.team);
  switch (b.dataset.act) {
    case 'pick':
      selectedQ = b.dataset.q;
      return renderLive();
    case 'goto-settings':
      return setTab('settings');
    case 'goto-questions':
      return setTab('questions');
    case 'start': {
      const q = S.questions.find((x) => x.id === selectedQ);
      if (!q) return;
      if (['answering', 'paused'].includes(L.phase) && !(await confirmBox(`제${L.number}문제가 아직 진행 중이에요. 그만두고 제${q.number}문제를 시작할까요?`, '시작'))) return;
      if (q.graded) {
        if (!(await confirmBox(`제${q.number}문제의 기존 점수만 회수하고 다시 풀어요. 다시 채점할 때는 현재 설정 점수(${pointsText()})가 적용돼요.`, '다시 풀기'))) return;
        return act('retry', { questionId: q.id });
      }
      if (!q.text.trim() && !(await confirmBox('이 문제에는 읽을 문장이 없어요. 선생님이 직접 읽어 주실 건가요?', '그래도 시작'))) return;
      return act('start', { questionId: q.id });
    }
    case 'timer':
      return act('timer');
    case 'pause':
      return act('pause');
    case 'resume':
      return act('resume');
    case 'close':
      return act('close');
    case 'reveal':
      if (['answering', 'paused'].includes(L.phase) && !(await confirmBox('아직 시간이 남았어요. 선택을 마감하고 정답을 공개할까요?', '마감하고 공개'))) return;
      return act('reveal');
    case 'instant':
      if (L.phase === 'revealing') return act('reveal-now');
      if (['answering', 'paused'].includes(L.phase) && !(await confirmBox('아직 시간이 남았어요. 선택을 마감하고 바로 공개할까요?', '마감하고 공개'))) return;
      return act('reveal', { instant: true });
    case 'retry':
      if (!(await confirmBox(`제${L.number}문제를 다시 풀어요. 이 문제의 기존 점수만 회수되고, 다시 채점할 때 현재 설정 점수(${pointsText()})가 적용돼요.`, '다시 풀기'))) return;
      return act('retry', { questionId: L.questionId });
    case 'next': {
      const q = nextQuestion();
      if (q) {
        selectedQ = q.id;
        return act('start', { questionId: q.id });
      }
      return;
    }
    case 'final':
      return act('final');
    case 'lobby':
      return act('lobby');
    case 'tts-play':
      return act('tts', { action: 'play' });
    case 'tts-test':
      return act('tts', { action: 'test' });
    case 'tts-stop':
      return act('tts', { action: 'stop' });
    case 'subs-close':
      return act('submissions-open', { open: false }, { ok: '작품 제출을 마감했어요.' });
    case 'subs-open':
      return act('submissions-open', { open: true }, { ok: '다시 작품을 받아요.' });
    case 'reopen-team':
      return act('reopen-team', { teamId }, { ok: `${teamName(teamId)} 작품을 다시 받아요.` });
    case 'edit-sub':
      return editSubmission(teamId);
    case 'apply': {
      const qid = b.parentElement.querySelector('[data-role="apply-q"]').value;
      const q = S.questions.find((x) => x.id === qid);
      return act('apply', { teamId, questionId: qid }, { ok: `${teamName(teamId)} 작품을 문제 ${q.number}에 넣었어요.`, confirmKey: 'overwrite' });
    }
    case 'up':
    case 'down': {
      const row = b.closest('.q-row');
      const ids = S.questions.map((q) => q.id);
      const i = ids.indexOf(row.dataset.q);
      const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return act('reorder', { ids });
    }
    case 'save-q':
      return saveQuestion(b.closest('.q-row'));
    case 'clear-q': {
      const row = b.closest('.q-row');
      if (!(await confirmBox('이 문제의 정답·문장·발표 조를 비울까요?', '비우기'))) return;
      delete row.dataset.dirty;
      return act('question', { questionId: row.dataset.q, patch: { clear: true } });
    }
    case 'save-teams': {
      const names = {};
      $$('[data-name]').forEach((i) => (names[i.dataset.name] = i.value));
      await act('teams', { count: Number($('#teamCount').value), names }, { ok: '조 구성을 저장했어요.', confirmKey: 'force' });
      return;
    }
    case 'print':
      return window.print();
    case 'copy':
      try {
        await navigator.clipboard.writeText(b.dataset.url);
        toast('주소를 복사했어요.', 'ok');
      } catch {
        toast('복사하지 못했어요. 주소 칸을 길게 눌러 복사해 주세요.', 'warn');
      }
      return;
    case 'new-token':
      if (!(await confirmBox(`${teamName(teamId)}의 참여 주소를 새로 만들어요. 예전 QR 코드로는 더 이상 들어올 수 없어요.`, '새 주소 발급', true))) return;
      await act('team-token', { teamId }, { ok: '새 참여 주소를 만들었어요.' });
      return;
    case 'save-points': {
      const v = $('#setPoints').value.trim();
      if (!/^\d+$/.test(v) || Number(v) < 1) return toast('정답 점수는 1 이상의 정수로 입력해 주세요.', 'error');
      if (await act('settings', { settings: { pointsPerCorrect: Number(v) } }, { ok: `정답 점수를 ${v}점으로 정했어요. 아직 채점하지 않은 문제부터 적용돼요.` })) removeAlert('points');
      return;
    }
    case 'save-time': {
      const v = Number($('#setTime').value);
      return act('settings', { settings: { timeLimitSec: v } }, { ok: `제한시간을 ${v}초로 정했어요. 다음 문제부터 적용돼요.` });
    }
    case 'export':
      return downloadText(`golden-bell-${code}-backup.json`, JSON.stringify(engine.exportRoom(), null, 2));
    case 'csv':
      return downloadText(`golden-bell-${code}-scores.csv`, engine.csv(), 'text/csv;charset=utf-8');
    case 'close-room':
      if (await confirmBox('수업을 마감할까요? 학생 제출이 모두 막혀요.', '수업 마감', true)) act('room-closed', { closed: true }, { ok: '수업을 마감했어요.' });
      return;
    case 'reopen-room':
      return act('room-closed', { closed: false }, { ok: '수업을 다시 열었어요.' });
    case 'delete-room': {
      const v = await dialog(`<h3>🗑 수업방 삭제</h3><p class="dlg-msg">모든 자료가 지워지고 되돌릴 수 없어요. 계속하려면 방 코드 <b>${esc(code)}</b>를 입력해 주세요.</p><input id="delCode" class="field-input" autocomplete="off">`, [
        { label: '취소', value: 'no', cls: 'ghost' },
        { label: '영구 삭제', value: 'del', cls: 'red' },
      ]);
      if (v !== 'del') return;
      if ($('#delCode').value.trim().toUpperCase() !== code) return toast('방 코드가 맞지 않아 삭제하지 않았어요.', 'warn');
      try {
        await engine.deleteRoom(user.uid);
        alert('수업방과 자료를 삭제했어요.');
        location.href = `index.html${emuQ}`;
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'logout':
      if (await confirmBox('이 컴퓨터에서 구글 계정 로그아웃을 할까요? 수업방 자료는 그대로 남아요.', '로그아웃')) {
        await logout();
        location.href = `index.html${emuQ}`;
      }
      return;
  }
}

function onChange(e) {
  const el = e.target;
  const act0 = el.dataset.act;
  if (act0 === 'show-text') return act('show-text', { show: el.checked });
  if (act0 === 'proxy-mode') {
    proxyMode = el.checked;
    return renderLive();
  }
  if (act0 === 'proxy') return act('proxy-answer', { teamId: Number(el.dataset.team), questionId: S.live.questionId, songId: el.value || null }, { ok: `${teamName(Number(el.dataset.team))} 답을 대신 입력했어요.` });
  if (el.dataset.set) {
    const k = el.dataset.set;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'sfxVolume') v = Number(v);
    if (k === 'ttsRate') v = Number(v);
    return act('settings', { settings: { [k]: v } }, { ok: '설정을 저장했어요.' });
  }
}

function onInput(e) {
  const el = e.target;
  const row = el.closest('.q-row');
  if (row && el.dataset.f) {
    row.dataset.dirty = '1';
    row.querySelector('[data-act="save-q"]').classList.add('pulse');
  }
  if (el.type === 'range' && el.nextElementSibling?.tagName === 'OUTPUT') el.nextElementSibling.textContent = el.dataset.set === 'ttsRate' ? `${el.value}배` : el.value;
}

window.addEventListener('beforeunload', (e) => {
  if ($$('.q-row[data-dirty]').length) {
    e.preventDefault();
    e.returnValue = '';
  }
});
