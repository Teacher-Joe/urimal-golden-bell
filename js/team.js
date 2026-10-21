// 학생(조) 화면: 작품 만들기 + 퀴즈 답안 고르기. 소리는 내지 않는다(소리는 교사/발표 기기 한 곳에서만).
import { $, esc, storage, charLen, formatTime, remainingMs, reduceMotionPreferred, toast, sleep } from './common.js';
import { SONGS, songById, songCard } from './songs-art.js';
import { goldDust, confetti } from './fx.js';
import { initFirebase } from './fb.js';
import { joinTeam } from './room-sync.js';

const MAX = 4000;
// 참여 주소: join.html#방코드.조번호.열쇠  (열쇠는 # 뒤에 있어 서버 기록에 남지 않음)
const [code, teamId, token] = (location.hash.slice(1) || storage('gb-team-last') || '').split('.');
if (location.hash.length > 1) storage('gb-team-last', location.hash.slice(1));
window.addEventListener('hashchange', () => location.reload());

let S = null; // 서버가 보낸 최신 상태
let live = null;
let draftKey = '';
let initialized = false;
let workSong = null;
let sendState = { kind: 'idle' };
let answer = { inflight: false, want: null, error: null };
let lastPhaseKey = '';
let manualTab = null;

const els = {
  teamName: $('#teamName'), conn: $('#conn'), myScore: $('#myScore'), fatal: $('#fatal'),
  tabWork: $('#tabWork'), tabQuiz: $('#tabQuiz'), quizBadge: $('#quizBadge'), work: $('#work'), quiz: $('#quiz'),
  workSongs: $('#workSongs'), lyrics: $('#lyrics'), count: $('#count'), draftState: $('#draftState'),
  sendBtn: $('#sendBtn'), sendStatus: $('#sendStatus'), dirtyNote: $('#dirtyNote'), closedNote: $('#closedNote'),
  qNumber: $('#qNumber'), qTimer: $('#qTimer'), qBanner: $('#qBanner'), qChoices: $('#qChoices'), qStatus: $('#qStatus'), qRanking: $('#qRanking'),
  pause: $('#pauseOverlay'),
};

const reduce = () => reduceMotionPreferred(S?.settings?.reduceMotion);
goldDust($('canvas.dust'), { reduce, density: 28 });

let room = null; // joinTeam이 돌려주는 저장 함수들
if (!code || !teamId || !token) {
  fatal('참여 주소가 올바르지 않아요.<br>선생님이 보여 주는 <b>우리 조 QR 코드</b>로 다시 들어와 주세요.');
} else {
  initFirebase({ persistence: 'session' });
  joinTeam({
    code,
    teamId,
    key: token,
    onState,
    onStatus: (s, msg) => {
      const label = { live: '무대와 연결됨', reconnecting: '⚠ 다시 연결 중…', offline: '⚠ 연결 안 됨', denied: '접속 불가', deleted: '수업방 없음' }[s] || '연결 중…';
      els.conn.textContent = label;
      els.conn.className = 'conn ' + (s === 'live' ? 'live' : s === 'reconnecting' ? '' : 'bad');
      if (s === 'denied') fatal(`${esc(msg || '참여 권한이 없어요.')}<br>선생님께 새 QR 코드를 받아 주세요.`);
      if (s === 'deleted') fatal('수업방이 닫혔거나 삭제되었어요.<br>선생님께 말씀드려 주세요.');
    },
  })
    .then((r) => (room = r))
    .catch((e) => fatal(`연결하지 못했어요: ${esc(e.message)}<br>Wi-Fi를 확인하고 새로 고쳐 주세요.`));
}

function fatal(html) {
  els.fatal.innerHTML = `<div class="fatal-box">🎭<p>${html}</p></div>`;
  els.fatal.hidden = false;
  els.work.hidden = true;
  els.quiz.hidden = true;
}

// ───────────── 탭 ─────────────
function showTab(which, manual = false) {
  if (manual) manualTab = which;
  const quiz = which === 'quiz';
  els.tabWork.setAttribute('aria-selected', String(!quiz));
  els.tabQuiz.setAttribute('aria-selected', String(quiz));
  els.work.hidden = quiz || !els.fatal.hidden;
  els.quiz.hidden = !quiz || !els.fatal.hidden;
}
els.tabWork.onclick = () => showTab('work', true);
els.tabQuiz.onclick = () => showTab('quiz', true);

// ───────────── 상태 받기 ─────────────
function onState(s) {
  if (s.removed) return fatal('우리 조가 수업방에서 빠졌어요. 선생님께 말씀드려 주세요.');
  S = s;
  live = s.live;
  document.body.classList.toggle('reduce-motion', reduce());
  els.teamName.textContent = s.team.name;
  document.title = `${s.team.name} 작사가 대기실 · 우리말 골든벨`;
  if (!initialized) initWork();
  renderWork();
  renderQuiz();
  const quizActive = live.phase !== 'lobby';
  els.quizBadge.hidden = !quizActive;
  // 퀴즈가 새로 시작되면 자동으로 퀴즈 탭으로 이동
  const key = `${live.runId || ''}:${live.phase === 'lobby' ? 'lobby' : 'on'}`;
  if (key !== lastPhaseKey) {
    if (quizActive) showTab('quiz');
    else if (!manualTab) showTab('work');
    lastPhaseKey = key;
  }
}

// ───────────── 작품 만들기 ─────────────
function initWork() {
  initialized = true;
  draftKey = `gb-draft-${code}-${S.team.id}`;
  const local = storage(draftKey);
  const server = S.draft;
  const sub = S.submission;
  // 가장 최근에 쓴 내용을 고른다: 이 기기 초안 → 서버 초안 → 제출물
  const cands = [local && { ...local, at: local.savedAt }, server && { ...server, at: server.savedAt }, sub && { songId: sub.songId, lyrics: sub.lyrics, at: sub.submittedAt }].filter(Boolean);
  cands.sort((a, b) => (b.at || 0) - (a.at || 0));
  const pick = cands[0];
  if (pick) {
    els.lyrics.value = pick.lyrics || '';
    workSong = pick.songId || null;
  }
  els.workSongs.innerHTML = SONGS.map((song) => songCard(song)).join('');
  els.workSongs.addEventListener('click', (e) => {
    const b = e.target.closest('.song-card');
    if (!b || b.disabled) return;
    workSong = b.dataset.song;
    saveDraft();
    renderWork();
  });
  els.lyrics.addEventListener('input', () => {
    saveDraft();
    renderWork();
  });
  updateCount();
}

let draftTimer = 0;
function saveDraft() {
  const d = { songId: workSong, lyrics: els.lyrics.value, savedAt: Date.now() };
  storage(draftKey, d); // 이 기기에 즉시 저장
  els.draftState.textContent = '✎ 초안 저장 중…';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      await room.saveDraft({ songId: d.songId, lyrics: d.lyrics });
      els.draftState.textContent = `✔ 초안 자동 저장됨 ${formatTime(Date.now())}`;
    } catch {
      els.draftState.textContent = '✔ 이 태블릿에 초안 저장됨 (서버 연결 대기)';
    }
  }, 1500);
}

function updateCount() {
  const n = charLen(els.lyrics.value);
  els.count.textContent = `${n.toLocaleString()} / ${MAX.toLocaleString()}자`;
  els.count.classList.toggle('over', n > MAX);
  els.count.classList.toggle('near', n > MAX * 0.9 && n <= MAX);
}

function renderWork() {
  updateCount();
  const open = S.submissionsOpen;
  for (const b of els.workSongs.querySelectorAll('.song-card')) {
    const sel = b.dataset.song === workSong;
    b.classList.toggle('is-selected', sel);
    b.setAttribute('aria-pressed', String(sel));
    b.disabled = !open;
  }
  els.lyrics.readOnly = !open;
  els.closedNote.hidden = open;
  els.closedNote.textContent = S.closed ? '🎬 수업이 마감되었어요. 멋진 공연 고마워요!' : '⏰ 작품 제출이 마감되었어요. 고칠 내용이 있으면 선생님께 말씀드려 주세요.';
  const sub = S.submission;
  const dirty = !!sub && (sub.songId !== workSong || sub.lyrics !== els.lyrics.value);
  els.dirtyNote.hidden = !dirty || !open;
  const n = charLen(els.lyrics.value);
  els.sendBtn.disabled = !open || sendState.kind === 'sending' || !workSong || !els.lyrics.value.trim() || n > MAX;
  els.sendBtn.querySelector('.send-label').textContent = sendState.kind === 'sending' ? '무대로 보내는 중…' : sub ? (dirty ? '고친 작품 다시 전송하기' : '선생님께 다시 전송하기') : '선생님께 전송하기';

  let html = '';
  if (sendState.kind === 'error') {
    html = `<div class="send-error">😥 전송하지 못했어요: ${esc(sendState.message)}<br><small>쓴 내용은 그대로 남아 있어요.</small> <button class="btn small red" id="retrySend" type="button">다시 보내기</button></div>`;
  } else if (sub) {
    const song = songById(sub.songId);
    html = `<div class="arrived ${sendState.kind === 'justSent' ? 'pop' : ''}">
      <div class="arrived-title">🌟 우리 조 작품이 무대에 도착했어요!</div>
      <div class="arrived-meta">「${esc(song?.title)}」 · ${sub.version}번째 전송 · ${formatTime(sub.submittedAt)}${sub.editedByTeacher ? ' · 선생님이 다듬어 주셨어요' : ''}</div>
    </div>`;
  } else if (!workSong) html = '<p class="hint">① 노래를 고르고 ② 가사를 쓰면 전송할 수 있어요.</p>';
  else if (!els.lyrics.value.trim()) html = '<p class="hint">② 가사를 적어 주세요.</p>';
  if (els.sendStatus.dataset.html !== html) {
    els.sendStatus.innerHTML = html;
    els.sendStatus.dataset.html = html;
    $('#retrySend')?.addEventListener('click', send);
  }
}

async function send() {
  if (sendState.kind === 'sending') return;
  if (!room) return toast('아직 무대와 연결되지 않았어요. 잠시 후 다시 눌러 주세요.', 'warn');
  const body = { songId: workSong, lyrics: els.lyrics.value };
  sendState = { kind: 'sending' };
  renderWork();
  try {
    // Firebase가 서버에 실제로 저장을 마친 뒤에만 이 줄을 지나간다 → 그때만 '도착' 표시
    await room.submitWork(body, S);
    sendState = { kind: 'justSent' };
    renderWork();
    confetti($('canvas.confetti'), { reduce: reduce(), duration: 2600 });
  } catch (e) {
    // 쓴 내용은 그대로 두고 다시 보낼 수 있게 한다. (연결이 돌아오면 Firebase가 대기 중인 전송을 마칠 수도 있다)
    sendState = { kind: 'error', message: e.data?.denied ? e.message : `${e.message} 연결이 돌아오면 자동으로 도착할 수도 있어요.` };
    renderWork();
  }
}
els.sendBtn.addEventListener('click', send);

// ───────────── 퀴즈 ─────────────
const PHASE_TEXT = {
  lobby: '🎶 곧 퀴즈가 시작돼요! 우리말의 뜻을 듣고, 숨은 노래를 찾아라!',
  listening: '👂 귀를 기울여 주세요! 가사를 들은 뒤 답을 고를 수 있어요.',
  answering: '🎯 어떤 노래일까요? 카드를 눌러 골라요. 시간 안에 바꿔도 돼요!',
  paused: '⏸ 잠시 멈춤 — 선생님이 다시 시작하면 고를 수 있어요.',
  closed: '🔒 선택 마감! 정답 공개를 기다려요.',
  revealing: '🥁 두구두구두구…',
  revealed: '🔔 정답 공개!',
  final: '🏆 최종 점수판',
};

function quizChoicesInit() {
  els.qChoices.innerHTML = SONGS.map((song) => songCard(song)).join('');
  els.qChoices.addEventListener('click', (e) => {
    const b = e.target.closest('.song-card');
    if (!b || b.disabled) return;
    pickAnswer(b.dataset.song);
  });
}
quizChoicesInit();

function pickAnswer(songId) {
  if (!S?.canAnswer) return;
  answer.want = { songId, questionId: live.questionId, runId: live.runId };
  answer.error = null;
  renderQuiz();
  flushAnswer();
}

// 한 번에 하나씩 보낸다 → 마지막으로 누른 답이 서버의 최종 답이 된다.
async function flushAnswer() {
  if (answer.inflight || !answer.want) return;
  const want = answer.want;
  answer.inflight = true;
  try {
    await room.submitAnswer(want, S); // 서버(보안 규칙)가 승인해야 성공
    if (answer.want === want) answer.want = null;
    if (S.live.runId === want.runId) S.myAnswer = { songId: want.songId, at: Date.now(), by: 'team' };
  } catch (e) {
    if (answer.want === want) answer.want = null;
    answer.error = e.message;
    if (!e.data?.denied) toast('답이 전송되지 않았어요. 다시 눌러 주세요.', 'error');
  } finally {
    answer.inflight = false;
    renderQuiz();
    if (answer.want) flushAnswer();
  }
}

let lastRevealKey = '';
function renderQuiz() {
  if (!S) return;
  const L = live;
  const phase = L.phase;
  document.body.dataset.phase = phase;
  els.qNumber.textContent = L.number ? `제${L.number}문제` : '대기 중';
  els.pause.hidden = phase !== 'paused';

  // 배너
  let banner = PHASE_TEXT[phase] || '';
  if (S.isPresenter && L.presenterExcluded && phase !== 'lobby' && phase !== 'final') banner = '🎤 이번 문제는 우리 조 작품이에요! 다른 조가 맞히는 모습을 응원해 주세요.';
  if (S.closed) banner = '🎬 수업이 마감되었어요. 모두 수고했어요!';
  els.qBanner.textContent = banner;
  els.qBanner.className = `q-banner ph-${phase}`;

  // 카드
  const reveal = L.reveal;
  const shown = answer.want?.questionId === L.questionId ? answer.want.songId : S.myAnswer?.songId;
  const pending = !!answer.want && answer.want.questionId === L.questionId;
  els.qChoices.hidden = phase === 'lobby' || phase === 'final';
  for (const b of els.qChoices.querySelectorAll('.song-card')) {
    const id = b.dataset.song;
    const sel = id === shown;
    b.classList.toggle('is-selected', sel);
    b.classList.toggle('is-pending', sel && pending);
    b.setAttribute('aria-pressed', String(sel));
    b.disabled = !S.canAnswer;
    b.classList.toggle('is-correct', !!reveal && id === reveal.correctSongId);
    b.classList.toggle('is-dim', !!reveal && id !== reveal.correctSongId);
  }
  els.qChoices.classList.toggle('locked', !S.canAnswer);

  // 제출 상태
  let st = '';
  if (phase !== 'lobby' && phase !== 'final' && !(S.isPresenter && L.presenterExcluded)) {
    const song = songById(shown);
    if (pending) st = `<span class="pill wait">📨 「${esc(song?.title)}」 보내는 중…</span>`;
    else if (answer.error && phase === 'answering') st = `<span class="pill err">⚠️ ${esc(answer.error)}</span>`;
    else if (S.myAnswer) {
      const by = S.myAnswer.by === 'teacher' ? ' (선생님이 대신 입력)' : '';
      st = `<span class="pill ok">✔ 서버가 받은 우리 조 답: 「${esc(songById(S.myAnswer.songId)?.title)}」${by} · ${formatTime(S.myAnswer.at)}</span>`;
    } else if (phase === 'answering') st = '<span class="pill">아직 고르지 않았어요</span>';
    else if (['closed', 'revealing', 'revealed'].includes(phase)) st = '<span class="pill">이번 문제는 답을 고르지 않았어요</span>';
  }
  if (phase === 'revealed' && reveal) {
    const names = reveal.correctTeamIds.map((id) => S.teams.find((t) => t.id === id)?.name).filter(Boolean);
    const r = S.myResult;
    let mine = '';
    if (r?.status === 'correct') mine = `<div class="result good">🎉 정답! 우리 조 +${reveal.pointsPerCorrect}점</div>`;
    else if (r?.status === 'presenter') mine = '<div class="result neutral">🎤 우리 조 작품 발표, 멋졌어요!</div>';
    else mine = '<div class="result neutral">💪 좋은 도전이었어요! 다음 문제에서 만나요</div>';
    st = `${mine}<div class="correct-teams">맞힌 조: ${names.length ? names.map((n) => `<b>${esc(n)}</b>`).join(' · ') : '이번엔 없어요 — 다음 문제에 도전!'}</div>`;
    const k = `${L.runId}:revealed`;
    if (lastRevealKey !== k) {
      lastRevealKey = k;
      if (r?.status === 'correct') confetti($('canvas.confetti'), { reduce: reduce() });
    }
  }
  if (els.qStatus.dataset.html !== st) {
    els.qStatus.innerHTML = st;
    els.qStatus.dataset.html = st;
  }

  // 점수
  const total = S.totals?.[S.team.id] ?? 0;
  els.myScore.hidden = false;
  els.myScore.textContent = `우리 조 ${total}점`;

  // 최종 순위
  els.qRanking.hidden = phase !== 'final';
  if (phase === 'final' && S.ranking) {
    els.qRanking.innerHTML = `<h2 class="gold-text">🏆 최종 점수판</h2><ol class="rank-list">${S.ranking
      .map((r) => `<li class="${r.id === S.team.id ? 'me' : ''} ${r.rank === 1 ? 'first' : ''}"><span class="rk">${r.rank}위</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}점</span></li>`)
      .join('')}</ol><p class="cheer">모든 조가 멋진 우리말 작사가였어요! 👏</p>`;
  }
  tickTimer();
}

function tickTimer() {
  if (!live) return;
  const p = live.phase;
  if (['answering', 'paused', 'listening', 'closed'].includes(p)) {
    const sec = p === 'closed' ? 0 : Math.ceil(remainingMs(live) / 1000);
    els.qTimer.textContent = p === 'closed' ? '마감' : `${sec}초`;
    els.qTimer.className = 'led q-timer ' + (p === 'answering' && sec <= 5 ? 'hot last5' : 'cool');
  } else els.qTimer.textContent = p === 'revealed' ? '공개' : '--';
}
setInterval(tickTimer, 200);
