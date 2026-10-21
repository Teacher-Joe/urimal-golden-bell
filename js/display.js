// 발표 화면(프로젝터·대형 TV). 교사 제어 버튼과 제출함은 없다.
import { $, esc, remainingMs, reduceMotionPreferred, enterFullscreen, serverClock, toast } from './common.js';
import { SONGS, songById, songCard } from './songs-art.js';
import { goldDust, confetti, bellSVG } from './fx.js';
import { createSoundHost } from './sound-host.js';
import { initFirebase } from './fb.js';
import { joinDisplay, audioApi } from './room-sync.js';

// 발표 화면 주소: display.html#방코드.발표열쇠
const [code, token] = location.hash.slice(1).split('.');
window.addEventListener('hashchange', () => location.reload());
let S = null;
let prevKey = '';
let soundHost = null;

$('#lobbyBell').innerHTML = bellSVG();
$('#gateBell').innerHTML = bellSVG();
$('#choices').innerHTML = SONGS.map((s) => songCard(s, { tag: 'div' })).join('');

const reduce = () => reduceMotionPreferred(S?.settings?.reduceMotion);
goldDust($('canvas.dust'), { reduce, density: 60 });

function fatal(msg) {
  $('#fatal').hidden = false;
  $('#fatal').innerHTML = `<div>🎭<p>${esc(msg)}</p></div>`;
  $('#soundGate').hidden = true;
}

if (!code || !token) fatal('발표 화면 주소가 올바르지 않아요. 교사 화면의 "발표 화면 열기"로 다시 열어 주세요.');
else {
  initFirebase({ persistence: 'session' });
  const joined = joinDisplay({
    code,
    key: token,
    onState,
    onStatus: (s, msg) => {
      const el = $('#conn');
      el.textContent = { live: '연결됨', reconnecting: '다시 연결 중…', offline: '연결 안 됨', denied: '접속 불가', deleted: '수업방 없음' }[s] || '연결 중…';
      el.className = 'conn ' + (s === 'live' ? 'live' : s === 'reconnecting' ? '' : 'bad');
      if (s === 'denied') fatal(msg || '발표 화면 권한이 없어요.');
      if (s === 'deleted') fatal('수업방이 삭제되었어요.');
    },
  }).catch((e) => fatal(`연결하지 못했어요: ${e.message}`));
  soundHost = createSoundHost({
    audio: audioApi(code, 'display', joined),
    onChange: (st) => {
      const el = $('#soundState');
      el.textContent = st.isHost ? (st.speaking ? '🔊 읽는 중' : '🔊 소리 담당') : '🔇 소리 꺼짐';
      el.className = 'conn ' + (st.isHost ? 'live' : '');
      document.body.classList.toggle('speaking', !!st.speaking);
    },
  });
  window.goldenBell = { sound: soundHost }; // 점검용(개발자 도구에서 소리 상태 확인)
  $('#soundOn').onclick = async () => {
    try {
      await joined; // 참여 등록이 끝나야 소리 담당을 맡을 수 있다
      await soundHost.enable();
      $('#soundGate').hidden = true;
      toast('이 화면에서 소리를 내요 🔔', 'ok');
    } catch (e) {
      toast(e.message || '소리를 켜지 못했어요.', 'error');
    }
  };
  $('#soundOff').onclick = () => ($('#soundGate').hidden = true);
  $('#soundBtn').onclick = () => ($('#soundGate').hidden = false);
}
$('#fsBtn').onclick = () => enterFullscreen();

function onState(s) {
  S = s;
  soundHost?.onState(s);
  document.body.classList.toggle('reduce-motion', reduce());
  render();
}

function render() {
  const L = S.live;
  const phase = L.phase;
  document.body.dataset.phase = phase;
  $('#lobby').hidden = phase !== 'lobby';
  $('#play').hidden = phase === 'lobby' || phase === 'final';
  $('#final').hidden = phase !== 'final';
  $('#pauseBox').hidden = phase !== 'paused';
  $('#drum').hidden = phase !== 'revealing';
  $('#drum').classList.toggle('skip', !!S.settings.skipRevealFx);

  const key = `${L.runId || ''}:${phase}`;
  const changed = key !== prevKey;
  const prevPhase = prevKey.split(':')[1];

  if (phase === 'lobby') renderLobby();
  else if (phase === 'final') renderFinal(changed);
  else renderPlay(changed, prevPhase);
  prevKey = key;
}

function renderLobby() {
  const online = new Set(S.connectedTeamIds || []);
  $('#lobbyTeams').innerHTML = S.teams.map((t) => `<span class="team-chip ${online.has(t.id) ? 'on' : ''}">${online.has(t.id) ? '🎤' : '⌛'} ${esc(t.name)}</span>`).join('');
}

function renderPlay(changed, prevPhase) {
  const L = S.live;
  const phase = L.phase;
  $('#qNo').textContent = `제${L.number}문제`;
  const titles = {
    listening: '귀를 기울여 주세요!',
    answering: '어떤 노래일까요?',
    paused: '잠시 멈춤',
    closed: '선택 마감!',
    revealing: '정답은…',
    revealed: '정답 공개!',
  };
  $('#phaseTitle').textContent = titles[phase] || '';
  $('#listen').hidden = phase !== 'listening';

  // 교사가 켰을 때만 문제 문장 표시
  const lt = $('#lyricText');
  lt.hidden = !L.text;
  if (L.text && lt.dataset.t !== L.text) {
    lt.textContent = L.text;
    lt.dataset.t = L.text;
  }

  // 응답 현황(어느 조가 무엇을 골랐는지는 보여 주지 않음)
  $('#answered').innerHTML = ['answering', 'paused', 'closed', 'revealing'].includes(phase) ? `응답한 조 <b class="led">${L.answeredCount ?? 0} / ${L.answeringTeamCount ?? S.teams.length}</b>` : '';
  $('#presenter').textContent = L.presenterTeamName ? (L.presenterExcluded ? `🎤 ${L.presenterTeamName} 작품 · 발표 조는 이번 문제를 쉬어요` : `🎤 ${L.presenterTeamName} 작품`) : '';

  const reveal = L.reveal;
  for (const card of document.querySelectorAll('#choices .song-card')) {
    card.classList.toggle('is-correct', !!reveal && card.dataset.song === reveal.correctSongId);
    card.classList.toggle('is-dim', !!reveal && card.dataset.song !== reveal.correctSongId);
  }

  // 문제 시작 연출
  if (changed && phase === 'listening' && serverClock.now() - (L.introAt || 0) < 2500) playIntro(L.number);

  // 선택 마감 도장
  const stamp = $('#stamp');
  if (changed && phase === 'closed' && (prevPhase === 'answering' || prevPhase === 'paused')) {
    stamp.hidden = false;
    stamp.classList.remove('show');
    void stamp.offsetWidth;
    stamp.classList.add('show');
    setTimeout(() => (stamp.hidden = true), 2200);
  }
  if (phase !== 'closed') stamp.hidden = true;

  // 정답 공개
  const box = $('#revealBox');
  box.hidden = phase !== 'revealed' || !reveal;
  $('#scoreStrip').hidden = phase !== 'revealed';
  if (phase === 'revealed' && reveal) {
    const song = songById(reveal.correctSongId);
    const names = reveal.correctTeamIds.map((id) => S.teams.find((t) => t.id === id)?.name).filter(Boolean);
    // 진행 단계와 정답 데이터가 따로 도착할 수 있으므로, 이 회차 정답을 처음 받았을 때 한 번 그린다
    const firstTime = box.dataset.run !== L.runId;
    box.dataset.run = L.runId;
    if (firstTime) box.innerHTML = `<div class="bell rv-bell ringing">${bellSVG()}</div><div class="rv-label">정답</div>
      <div class="rv-song gold-text">${esc(song?.title)}</div>
      <div class="rv-artist">${esc(song?.artist)}</div>
      <div class="rv-teams led">${names.length ? `맞힌 조: ${names.map(esc).join(' · ')}` : '모두 좋은 도전이었어요!'}</div>
      <div class="rv-points">맞힌 조 +${reveal.pointsPerCorrect}점</div>`;
    const correct = new Set(reveal.correctTeamIds);
    $('#scoreStrip').innerHTML = S.ranking
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((r) => `<div class="ss-team ${correct.has(r.id) ? 'hit' : ''}"><span>${esc(r.name)}</span><b>${r.score}</b></div>`)
      .join('');
    if (firstTime) confetti($('canvas.confetti'), { reduce: reduce() });
  }
  tick();
}

function playIntro(n) {
  const el = $('#intro');
  $('#introText').textContent = `제${n}문제!`;
  el.hidden = false;
  // 애니메이션을 처음부터 다시 실행
  el.querySelectorAll('.ic, .it').forEach((x) => {
    x.style.animation = 'none';
    void x.offsetWidth;
    x.style.animation = '';
  });
  clearTimeout(playIntro.t);
  playIntro.t = setTimeout(() => (el.hidden = true), 2000);
}

function renderFinal(changed) {
  const rk = S.ranking;
  const groups = [1, 2, 3].map((place) => rk.filter((r) => r.rank === place));
  const order = [1, 0, 2]; // 2위-1위-3위 단상
  $('#podium').innerHTML = order
    .map((i) => {
      const g = groups[i];
      if (!g.length) return `<div class="pod p${i + 1} empty"></div>`;
      return `<div class="pod p${i + 1} ${g.length > 2 ? 'many' : ''}"><div class="pod-names">${g.map((r) => `<div class="pod-name">${esc(r.name)}</div>`).join('')}<div class="pod-score">${g[0].score}점</div></div><div class="pod-block"><span>${i + 1}</span></div></div>`;
    })
    .join('');
  $('#finalList').innerHTML = rk.map((r) => `<li class="${r.rank === 1 ? 'first' : ''}"><span class="rk">${r.rank}위</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}점</span></li>`).join('');
  if (changed) confetti($('canvas.confetti'), { reduce: reduce(), duration: 6000 });
}

function tick() {
  if (!S) return;
  const L = S.live;
  const el = $('#timer');
  const ring = $('#ringFg');
  if (!L || ['lobby', 'final'].includes(L.phase)) return;
  const total = L.durationMs || 30000;
  const rem = L.phase === 'closed' || L.phase === 'revealing' || L.phase === 'revealed' ? 0 : remainingMs(L);
  const sec = Math.ceil(rem / 1000);
  el.textContent = L.phase === 'revealed' || L.phase === 'revealing' || L.phase === 'closed' ? '0' : String(sec);
  const last5 = L.phase === 'answering' && sec <= 5;
  el.classList.toggle('hot', last5);
  el.classList.toggle('last5', last5);
  document.body.classList.toggle('last5', last5);
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - rem / total);
  ring.classList.toggle('hot', last5);
}
setInterval(tick, 100);
