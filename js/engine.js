// 교사 엔진: 서버 없이 교사 화면이 수업 규칙(타이머 마감·채점·점수·문제 관리)을 맡는다.
// 학생 쪽 제한(마감 후 제출 거부, 다른 조 자료 차단 등)은 Firebase 보안 규칙이 서버에서 지킨다.
import { roomRef, dbRef, update, set, remove, runTransaction, serverTimestamp, withTimeout } from './fb.js';
import { AppError, serverClock, randomCode, randomKey, randomId, charLen } from './common.js';
import { SONGS } from './songs-art.js';
import { DEFAULT_SETTINGS, REVEAL_FX_MS, MAX_LYRICS, settingsOf, teamsOf, questionsOf, liveOf, totalsOf, rankTeams, numOrNull, normalize } from './views.js';

const SONG_IDS = new Set(SONGS.map((s) => s.id));
const RUNNING = new Set(['listening', 'answering', 'paused', 'closed', 'revealing']);

function intIn(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${label}은(는) ${min}~${max} 사이의 정수로 입력해 주세요.`);
  return n;
}
function songOf(v, { allowNull = false } = {}) {
  if (allowNull && (v === null || v === '' || v === undefined)) return null;
  if (!SONG_IDS.has(v)) throw new AppError('노래를 선택해 주세요.');
  return v;
}
function textOf(v, label) {
  if (typeof v !== 'string') throw new AppError(`${label}을(를) 입력해 주세요.`);
  const t = v.replace(/\r\n/g, '\n');
  if (charLen(t) > MAX_LYRICS) throw new AppError(`${label}은(는) 최대 4,000자까지 쓸 수 있어요.`);
  return t;
}

// 새 수업방 데이터
export function newRoomData({ uid, title, teamCount }) {
  const count = intIn(teamCount, 2, 10, '조 수');
  const teams = {};
  const teamKeys = {};
  for (let i = 1; i <= count; i++) {
    teams[i] = { name: `${i}조` };
    teamKeys[i] = randomKey();
  }
  const questions = {};
  for (let i = 0; i < 10; i++) questions['q' + randomId(5)] = { order: i, songId: null, text: '', sourceTeamId: null, presenterTeamId: null };
  return {
    meta: { ownerUid: uid, title: String(title || '').trim().slice(0, 40) || '우리말 골든벨', createdAt: serverTimestamp(), closed: false, submissionsOpen: true },
    teams,
    teamKeys,
    displayKey: randomKey(),
    settings: { ...DEFAULT_SETTINGS, pointsPerCorrect: null },
    questions,
    live: { phase: 'lobby' },
  };
}
export const newRoomCode = () => randomCode(6);

export class TeacherEngine {
  constructor(code) {
    this.code = code;
    this.R = null;
    this.timer = null;
  }

  // ── 원본 읽기 도우미 ──
  get teams() { return teamsOf(this.R?.teams, this.R?.teamKeys); }
  get questions() { return questionsOf(this.R?.questions); }
  get settings() { return settingsOf(this.R?.settings); }
  get live() { return liveOf(this.R?.live); }
  q(qid) {
    const q = this.questions.find((x) => x.id === qid);
    if (!q) throw new AppError('문제를 찾을 수 없어요.');
    return q;
  }
  teamName(id) { return this.teams.find((t) => t.id === Number(id))?.name || `${id}조`; }
  hasTeam(id) { return this.teams.some((t) => t.id === Number(id)); }
  write(updates) { return withTimeout(update(roomRef(this.code), updates)); }

  setRoom(R) {
    this.R = normalize(R);
    this.schedule();
  }

  // ── 교사 화면용 데이터 ──
  view() {
    const R = this.R || {};
    const teams = this.teams;
    const L = this.live;
    const questions = this.questions.map((q) => ({ ...q, graded: !!R.grades?.[q.id] }));
    const presence = Object.values(R.presence || {});
    const subs = {};
    for (const [tid, s] of Object.entries(R.submissions || {})) subs[tid] = s;
    const songCounts = {};
    for (const s of Object.values(subs)) songCounts[s.songId] = (songCounts[s.songId] || 0) + 1;
    const answersNow = {};
    if (L.questionId && L.runId) answersNow[L.questionId] = Object.fromEntries(Object.entries(R.answers?.[L.runId] || {}).map(([tid, a]) => [tid, a]));
    const totals = totalsOf(teams, R.grades);
    const host = R.audio?.host || null;
    return {
      role: 'teacher',
      serverNow: serverClock.now(),
      code: this.code,
      title: R.meta?.title || '우리말 골든벨',
      closed: !!R.meta?.closed,
      teams,
      displayToken: R.displayKey,
      settings: this.settings,
      submissionsOpen: R.meta?.submissionsOpen !== false,
      reopenedTeams: Object.keys(R.reopened || {}).map(Number),
      submissions: subs,
      songCounts,
      questions,
      answers: answersNow,
      results: R.grades || {},
      live: { ...L, number: L.questionId ? questions.find((q) => q.id === L.questionId)?.number ?? null : null },
      totals,
      ranking: rankTeams(teams, totals),
      audio: {
        hostClientId: host?.clientId || null,
        hostRole: host?.role || null,
        hostConnected: !!host && presence.some((p) => p.clientId === host.clientId),
        speaking: !!R.audio?.status?.speaking,
        voices: R.audio?.voices || [],
        ttsSupported: R.audio?.ttsSupported ?? null,
        status: R.audio?.status || null,
      },
      notices: Object.values(R.notices || {}).sort((a, b) => b.at - a.at).slice(0, 20).map((n) => ({ ...n, teamName: this.teamName(n.teamId) })),
      connections: {
        teamIds: [...new Set(presence.filter((p) => p.role === 'team').map((p) => Number(p.teamId)))],
        displays: presence.filter((p) => p.role === 'display').length,
        teachers: presence.filter((p) => p.role === 'teacher').length,
      },
    };
  }

  // ── 타이머: 교사 화면이 열려 있는 동안 마감·공개를 진행한다 ──
  schedule() {
    clearTimeout(this.timer);
    const L = this.R?.live;
    if (!L) return;
    const now = serverClock.now();
    if (L.phase === 'answering' && L.endsAt) this.timer = setTimeout(() => this.autoClose(L.runId).catch(() => {}), Math.max(0, L.endsAt - now) + 50);
    else if (L.phase === 'revealing') this.timer = setTimeout(() => this.finishReveal(L.runId).catch(() => {}), Math.max(0, (L.revealAt || now) - now));
  }

  async autoClose(runId) {
    const L = this.R?.live;
    if (!L || L.runId !== runId || L.phase !== 'answering') return;
    if (serverClock.now() < L.endsAt) return this.schedule();
    await this.write({ 'live/phase': 'closed', 'live/remainingMs': 0, 'live/endsAt': null, 'live/closedBy': 'timer' });
  }

  publicReveal(g) {
    const perTeam = {};
    for (const [tid, row] of Object.entries(g.perTeam || {})) perTeam[tid] = { status: row.status, points: row.points };
    return { runId: g.runId, correctSongId: g.correctSongId, pointsPerCorrect: g.pointsPerCorrect, perTeam };
  }

  async finishReveal(runId) {
    const L = this.R?.live;
    if (!L || L.runId !== runId || L.phase !== 'revealing') return;
    const g = this.R.grades?.[L.questionId];
    if (!g) return;
    await this.write({ [`reveals/${L.questionId}`]: this.publicReveal(g), 'live/phase': 'revealed', 'live/revealAt': serverClock.now() });
  }

  requirePhase(phases, msg) {
    if (!phases.includes(this.live.phase)) throw new AppError(msg);
  }

  // ───────────── 명령들 (teacher.js의 act(이름, 내용)으로 호출) ─────────────
  async settingsCmd({ settings: patch = {} }) {
    const u = {};
    if ('pointsPerCorrect' in patch) u['settings/pointsPerCorrect'] = intIn(patch.pointsPerCorrect, 1, 1000, '정답 점수');
    if ('timeLimitSec' in patch) u['settings/timeLimitSec'] = intIn(patch.timeLimitSec, 5, 300, '제한시간(초)');
    if ('sfxVolume' in patch) u['settings/sfxVolume'] = intIn(patch.sfxVolume, 0, 100, '음량');
    for (const k of ['sfxOn', 'drumrollOn', 'reduceMotion', 'skipRevealFx', 'presenterCanAnswer']) if (k in patch) u[`settings/${k}`] = !!patch[k];
    if ('ttsVoiceURI' in patch) u['settings/ttsVoiceURI'] = String(patch.ttsVoiceURI || '').slice(0, 300);
    if ('ttsRate' in patch) {
      const r = Number(patch.ttsRate);
      if (!(r >= 0.5 && r <= 2)) throw new AppError('읽기 속도는 0.5~2 사이여야 해요.');
      u['settings/ttsRate'] = Math.round(r * 100) / 100;
    }
    await this.write(u);
  }

  async teamsCmd({ count, names, force = false }) {
    const u = {};
    const R = this.R;
    const cur = this.teams;
    if (count !== undefined) {
      const n = intIn(count, 2, 10, '조 수');
      if (n < cur.length) {
        const removed = cur.filter((t) => t.id > n).map((t) => String(t.id));
        const hasData = removed.some((id) => R.submissions?.[id] || Object.values(R.answers || {}).some((a) => a[id]) || Object.values(R.grades || {}).some((g) => g.perTeam?.[id]));
        if (hasData && !force) throw new AppError(`없어지는 조(${removed.map((id) => this.teamName(id)).join(', ')})의 작품·답안·점수가 함께 지워져요. 계속할까요?`, { needsConfirm: true });
        for (const id of removed) {
          for (const p of ['teams', 'teamKeys', 'submissions', 'drafts', 'reopened']) u[`${p}/${id}`] = null;
          for (const run of Object.keys(R.answers || {})) u[`answers/${run}/${id}`] = null;
          for (const run of Object.keys(R.answered || {})) u[`answered/${run}/${id}`] = null;
          for (const qid of Object.keys(R.grades || {})) u[`grades/${qid}/perTeam/${id}`] = null;
          for (const qid of Object.keys(R.reveals || {})) u[`reveals/${qid}/perTeam/${id}`] = null;
          for (const [uid, m] of Object.entries(R.members || {})) if (m.teamId === id) u[`members/${uid}`] = null;
          for (const q of this.questions) {
            if (q.presenterTeamId === Number(id)) u[`questions/${q.id}/presenterTeamId`] = null;
            if (q.sourceTeamId === Number(id)) u[`questions/${q.id}/sourceTeamId`] = null;
          }
        }
      } else {
        for (let id = cur.length + 1; id <= n; id++) {
          u[`teams/${id}`] = { name: `${id}조` };
          u[`teamKeys/${id}`] = randomKey();
        }
      }
    }
    for (const [id, v] of Object.entries(names || {})) {
      if (!this.hasTeam(id) || u[`teams/${id}`] === null) continue;
      const name = String(v).trim().slice(0, 16);
      if (!name) throw new AppError('조 이름을 비워 둘 수 없어요.');
      u[`teams/${id}/name`] = name;
    }
    await this.write(u);
  }

  async teamTokenCmd({ teamId }) {
    if (!this.hasTeam(teamId)) throw new AppError('조를 찾을 수 없어요.');
    const u = { [`teamKeys/${teamId}`]: randomKey() };
    // 예전 QR로 들어온 기기의 참여 등록을 지운다
    for (const [uid, m] of Object.entries(this.R.members || {})) if (m.teamId === String(teamId)) u[`members/${uid}`] = null;
    await this.write(u);
  }

  async submissionsOpenCmd({ open }) {
    await this.write({ 'meta/submissionsOpen': !!open, ...(open ? { reopened: null } : {}) });
  }

  async reopenTeamCmd({ teamId }) {
    if (!this.hasTeam(teamId)) throw new AppError('조를 찾을 수 없어요.');
    await this.write({ [`reopened/${teamId}`]: true });
  }

  async editSubmissionCmd({ teamId, songId, lyrics }) {
    if (!this.hasTeam(teamId)) throw new AppError('조를 찾을 수 없어요.');
    const text = textOf(lyrics, '가사');
    if (!text.trim()) throw new AppError('가사를 입력해 주세요.');
    const prev = this.R.submissions?.[teamId];
    await this.write({
      [`submissions/${teamId}`]: { songId: songOf(songId), lyrics: text, submittedAt: prev?.submittedAt || serverTimestamp(), version: prev?.version || 0, editedByTeacher: true, editedAt: serverTimestamp() },
    });
  }

  assertNotRunning(qid) {
    const L = this.live;
    if (L.questionId === qid && RUNNING.has(L.phase)) throw new AppError('지금 진행 중인 문제는 수정할 수 없어요. 대기 화면으로 돌아간 뒤 수정해 주세요.');
  }

  async applyCmd({ teamId, questionId, overwrite = false }) {
    const sub = this.R.submissions?.[teamId];
    if (!sub) throw new AppError('이 조는 아직 작품을 보내지 않았어요.');
    const q = this.q(questionId);
    this.assertNotRunning(q.id);
    if (this.R.grades?.[q.id]) throw new AppError('이미 채점한 문제에는 덮어쓸 수 없어요. 다른 문제 번호를 고르거나, 그 문제를 다시 풀기 한 뒤 바꿔 주세요.');
    if ((q.songId || q.text.trim()) && !overwrite) throw new AppError(`문제 ${q.number}에 이미 내용이 있어요. 덮어쓸까요?`, { needsConfirm: true });
    const p = `questions/${q.id}`;
    await this.write({ [`${p}/songId`]: sub.songId, [`${p}/text`]: sub.lyrics, [`${p}/sourceTeamId`]: String(teamId), [`${p}/presenterTeamId`]: String(teamId), [`${p}/updatedAt`]: serverTimestamp() });
  }

  async questionCmd({ questionId, patch = {} }) {
    const q = this.q(questionId);
    this.assertNotRunning(q.id);
    const p = `questions/${q.id}`;
    const u = { [`${p}/updatedAt`]: serverTimestamp() };
    if (patch.clear) Object.assign(u, { [`${p}/songId`]: null, [`${p}/text`]: '', [`${p}/sourceTeamId`]: null, [`${p}/presenterTeamId`]: null });
    else {
      if ('songId' in patch) u[`${p}/songId`] = songOf(patch.songId, { allowNull: true });
      if ('text' in patch) u[`${p}/text`] = textOf(patch.text, '문제 문장');
      if ('presenterTeamId' in patch) {
        const t = numOrNull(patch.presenterTeamId);
        if (t !== null && !this.hasTeam(t)) throw new AppError('발표 조를 다시 골라 주세요.');
        u[`${p}/presenterTeamId`] = t === null ? null : String(t);
      }
    }
    await this.write(u);
  }

  async reorderCmd({ ids }) {
    const cur = this.questions.map((q) => q.id);
    if (!Array.isArray(ids) || ids.length !== cur.length || new Set(ids).size !== cur.length || !ids.every((id) => cur.includes(id))) throw new AppError('문제 순서 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.');
    const u = {};
    ids.forEach((id, i) => (u[`questions/${id}/order`] = i));
    const L = this.live;
    if (L.questionId && ids.includes(L.questionId)) u['live/number'] = ids.indexOf(L.questionId) + 1;
    await this.write(u);
  }

  // ── 퀴즈 진행 ──
  async startCmd({ questionId, retry = false }) {
    const q = this.q(questionId);
    if (!q.songId) throw new AppError(`문제 ${q.number}의 정답 노래가 정해지지 않았어요. 문제 관리에서 먼저 정해 주세요.`);
    if (this.R.grades?.[q.id] && !retry) throw new AppError("이미 채점한 문제예요. 다시 하려면 '다시 풀기'를 눌러 주세요.");
    if (this.live.phase === 'revealing') throw new AppError('정답 공개 연출이 끝난 뒤에 시작해 주세요.');
    const s = this.settings;
    const durationMs = s.timeLimitSec * 1000; // 제한시간은 문제를 시작할 때 고정
    const presenter = q.presenterTeamId;
    const excluded = !!presenter && !s.presenterCanAnswer;
    const u = {
      live: {
        phase: 'listening',
        questionId: q.id,
        number: q.number,
        runId: 'r' + randomId(6),
        introAt: serverClock.now(),
        durationMs,
        remainingMs: durationMs,
        endsAt: null,
        presenterTeamId: presenter ? String(presenter) : null,
        presenterExcluded: excluded,
        answeringTeamCount: this.teams.filter((t) => !(excluded && t.id === presenter)).length,
        showText: false,
        text: null,
        revealAt: null,
        retry: !!retry,
      },
    };
    if (retry) {
      // 다시 풀기: 이 문제의 기존 점수만 회수
      u[`grades/${q.id}`] = null;
      u[`reveals/${q.id}`] = null;
    }
    await this.write(u);
  }

  async retryCmd({ questionId }) {
    await this.startCmd({ questionId: questionId || this.live.questionId, retry: true });
  }

  async timerCmd() {
    this.requirePhase(['listening'], '가사 듣기 단계에서만 타이머를 시작할 수 있어요.');
    const L = this.live;
    await this.write({ 'live/phase': 'answering', 'live/endsAt': serverClock.now() + (L.remainingMs || L.durationMs) });
  }

  async pauseCmd() {
    this.requirePhase(['answering'], '답을 고르는 중일 때만 일시 정지할 수 있어요.');
    const rem = Math.max(0, this.R.live.endsAt - serverClock.now());
    await this.write({ 'live/phase': rem > 0 ? 'paused' : 'closed', 'live/remainingMs': rem, 'live/endsAt': null });
  }

  async resumeCmd() {
    this.requirePhase(['paused'], '일시 정지 상태가 아니에요.');
    await this.write({ 'live/phase': 'answering', 'live/endsAt': serverClock.now() + this.R.live.remainingMs });
  }

  async closeCmd() {
    this.requirePhase(['answering', 'paused'], '마감할 답안 선택이 없어요.');
    const L = this.R.live;
    const rem = L.phase === 'answering' ? Math.max(0, L.endsAt - serverClock.now()) : L.remainingMs;
    await this.write({ 'live/phase': 'closed', 'live/remainingMs': rem, 'live/endsAt': null, 'live/closedBy': 'teacher' });
  }

  grade() {
    const L = this.live;
    const q = this.q(L.questionId);
    const points = this.settings.pointsPerCorrect;
    const answers = this.R.answers?.[L.runId] || {};
    const perTeam = {};
    for (const t of this.teams) {
      if (L.presenterExcluded && t.id === L.presenterTeamId) {
        perTeam[t.id] = { status: 'presenter', songId: null, correct: false, points: 0 };
        continue;
      }
      const a = answers[t.id];
      const correct = !!a && a.songId === q.songId;
      perTeam[t.id] = { status: a ? (correct ? 'correct' : 'wrong') : 'none', songId: a?.songId || null, correct, points: correct ? points : 0 };
    }
    return { questionId: q.id, runId: L.runId, gradedAt: serverClock.now(), correctSongId: q.songId, pointsPerCorrect: points, perTeam };
  }

  // 공개를 시작하는 순간 채점을 한 번만 확정한다(트랜잭션). 학생에게는 연출이 끝날 때 공개본(reveals)만 쓴다.
  async revealCmd({ instant = false } = {}) {
    const L = this.live;
    if (['revealing', 'revealed'].includes(L.phase) && this.R.grades?.[L.questionId]) return;
    this.requirePhase(['answering', 'paused', 'closed'], '선택을 마감한 뒤에 정답을 공개할 수 있어요.');
    if (!this.settings.pointsPerCorrect) throw new AppError("정답 점수가 아직 정해지지 않았어요. '환경설정'에서 정답 점수를 먼저 입력해 주세요.", { needsPoints: true });
    if (L.phase !== 'closed') await this.write({ 'live/phase': 'closed', 'live/endsAt': null, 'live/closedBy': 'reveal' });
    const fresh = this.grade();
    const tx = await withTimeout(runTransaction(roomRef(this.code, `grades/${L.questionId}`), (cur) => (cur ? undefined : fresh)));
    const g = tx.snapshot.val() || fresh;
    const delay = instant || this.settings.skipRevealFx ? 0 : REVEAL_FX_MS;
    const now = serverClock.now();
    const u = { 'live/revealStartedAt': now, 'live/revealAt': now + delay, 'live/phase': delay ? 'revealing' : 'revealed' };
    if (!delay) u[`reveals/${L.questionId}`] = this.publicReveal(g);
    await this.write(u);
  }

  async revealNowCmd() {
    const L = this.live;
    if (L.phase === 'revealed') return;
    this.requirePhase(['revealing'], '공개 연출 중이 아니에요.');
    const g = this.R.grades?.[L.questionId];
    if (!g) throw new AppError('채점 결과를 찾지 못했어요. 다시 시도해 주세요.');
    await this.write({ [`reveals/${L.questionId}`]: this.publicReveal(g), 'live/phase': 'revealed', 'live/revealAt': serverClock.now() });
  }

  async showTextCmd({ show }) {
    const L = this.live;
    const q = L.questionId ? this.questions.find((x) => x.id === L.questionId) : null;
    await this.write({ 'live/showText': !!show, 'live/text': show && q ? q.text : null });
  }

  async finalCmd() {
    const ph = this.live.phase;
    if (ph === 'revealing') throw new AppError('정답 공개 연출이 끝난 뒤에 점수판을 열어 주세요.');
    if (['answering', 'paused'].includes(ph)) throw new AppError('답안 선택을 먼저 마감해 주세요.');
    await this.write({ 'live/phase': 'final', 'live/finalAt': serverClock.now() });
  }

  async lobbyCmd() {
    if (this.live.phase === 'revealing') throw new AppError('정답 공개 연출이 끝난 뒤에 돌아가 주세요.');
    await this.write({ live: { phase: 'lobby' } });
  }

  // 학생 기기가 안 될 때 교사가 대신 입력 (채점 전까지, 마감 후 포함)
  async proxyAnswerCmd({ teamId, questionId, songId }) {
    const L = this.live;
    if (!this.hasTeam(teamId)) throw new AppError('조를 찾을 수 없어요.');
    if (L.questionId !== questionId || !['answering', 'paused', 'closed'].includes(L.phase)) throw new AppError('답을 고르는 중이거나 마감 직후(공개 전)에만 대신 입력할 수 있어요.');
    if (this.R.grades?.[questionId]) throw new AppError('이미 채점한 문제예요.');
    if (L.presenterExcluded && L.presenterTeamId === Number(teamId)) throw new AppError('발표 조는 이번 문제에 참여하지 않도록 설정되어 있어요.');
    const p = `answers/${L.runId}/${teamId}`;
    if (!songId) await this.write({ [p]: null, [`answered/${L.runId}/${teamId}`]: null });
    else await this.write({ [p]: { songId: songOf(songId), at: serverTimestamp(), by: 'teacher' }, [`answered/${L.runId}/${teamId}`]: true });
  }

  // 교사의 재생 버튼 → 소리 담당 기기 한 곳에만 전달
  async ttsCmd({ action, text }) {
    if (!['play', 'stop', 'test'].includes(action)) throw new AppError('알 수 없는 음성 명령이에요.');
    const v = this.view();
    if (!v.audio.hostClientId) throw new AppError("소리 담당 기기가 없어요. 발표 화면이나 교사 화면에서 '소리 켜고 시작하기'를 눌러 주세요.");
    if (!v.audio.hostConnected) throw new AppError('소리 담당 기기의 연결이 끊겼어요. 그 기기의 화면을 새로 고치고 소리를 다시 켜 주세요.');
    let speak = '';
    if (action === 'play') {
      const q = this.questions.find((x) => x.id === this.live.questionId);
      speak = typeof text === 'string' && text.trim() ? text : q?.text || '';
      if (!speak.trim()) throw new AppError('읽을 문장이 없어요. 문제 관리에서 문제 문장을 입력해 주세요.');
    }
    if (action === 'test') speak = '안녕하세요. 우리말 골든벨 음성 시험입니다. 잘 들리나요?';
    const s = this.settings;
    await this.write({ tts: { ttsId: randomId(5), action, text: speak, voiceURI: s.ttsVoiceURI || '', rate: s.ttsRate, at: serverTimestamp() } });
  }

  async roomClosedCmd({ closed }) {
    const u = { 'meta/closed': !!closed };
    if (closed && ['answering', 'paused'].includes(this.live.phase)) Object.assign(u, { 'live/phase': 'closed', 'live/endsAt': null, 'live/closedBy': 'teacher' });
    await this.write(u);
  }

  async deleteRoom(uid) {
    await withTimeout(remove(roomRef(this.code)));
    await withTimeout(remove(dbRef(`owners/${uid}/rooms/${this.code}`))).catch(() => {});
  }

  // ── 백업·복원·CSV ──
  exportRoom() {
    const R = this.R;
    const { teamKeys, displayKey, members, presence, audio, tts, notices, ...rest } = R;
    return { format: 'urimal-golden-bell-backup', version: 2, exportedAt: serverClock.now(), code: this.code, ...rest, songs: SONGS };
  }

  async restoreCmd({ backup: d }) {
    if (!d || d.format !== 'urimal-golden-bell-backup') throw new AppError('우리말 골든벨 백업 파일이 아니에요.');
    if (d.version !== 2) throw new AppError('이 백업 파일은 다른 버전(서버용)에서 만든 파일이라 복원할 수 없어요.');
    const R = this.R;
    const ids = Object.keys(d.teams || {}).filter((k) => /^(10|[1-9])$/.test(k));
    if (ids.length < 2) throw new AppError('백업 파일의 조 정보가 올바르지 않아요.');
    const teams = {};
    const teamKeys = {};
    for (const id of ids) {
      teams[id] = { name: String(d.teams[id]?.name || `${id}조`).slice(0, 16) };
      teamKeys[id] = R.teamKeys?.[id] || randomKey(); // 참여 주소는 지금 것 유지
    }
    const okSong = (s) => SONG_IDS.has(s);
    const clean = (obj, fn) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => fn(k, v)));
    const questions = clean(d.questions, (k, q) => /^q[0-9a-f]{10}$/.test(k) && q && typeof q === 'object');
    for (const q of Object.values(questions)) if (q.songId && !okSong(q.songId)) q.songId = null;
    const settings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (d.settings?.[k] !== undefined && d.settings[k] !== null) settings[k] = d.settings[k];
    await this.write({
      meta: { ...R.meta, title: String(d.meta?.title || R.meta?.title || '우리말 골든벨').slice(0, 40), closed: false, submissionsOpen: d.meta?.submissionsOpen !== false },
      teams,
      teamKeys,
      settings,
      questions,
      submissions: clean(d.submissions, (k, s) => k in teams && okSong(s?.songId) && typeof s.lyrics === 'string' && s.lyrics.length > 0 && s.lyrics.length <= MAX_LYRICS),
      drafts: null,
      reopened: null,
      answers: d.answers || null,
      answered: d.answered || null,
      grades: clean(d.grades, (k, g) => k in questions && okSong(g?.correctSongId) && Number.isInteger(g.pointsPerCorrect)),
      reveals: clean(d.reveals, (k) => k in questions),
      live: { phase: 'lobby' },
    });
  }

  csv() {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const teams = this.teams;
    const qs = this.questions;
    const grades = this.R.grades || {};
    const totals = totalsOf(teams, grades);
    const rows = [['순위', '조', ...qs.map((q) => `문제${q.number}`), '합계']];
    for (const r of rankTeams(teams, totals)) {
      rows.push([r.rank, r.name, ...qs.map((q) => {
        const row = grades[q.id]?.perTeam?.[r.id];
        if (!row) return '';
        return row.status === 'presenter' ? '발표(제외)' : row.points;
      }), totals[r.id] || 0]);
    }
    rows.push(['', '이 문제 정답 점수', ...qs.map((q) => grades[q.id]?.pointsPerCorrect ?? '미채점'), '']);
    rows.push(['', '정답 노래', ...qs.map((q) => SONGS.find((s) => s.id === (grades[q.id]?.correctSongId || q.songId))?.title || ''), '']);
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // 오래된 방 정리용 생성 시각
  get createdAt() { return this.R?.meta?.createdAt || 0; }
}

// teacher.js에서 쓰는 명령 이름 → 엔진 메서드
export const ACTIONS = {
  settings: 'settingsCmd', teams: 'teamsCmd', 'team-token': 'teamTokenCmd', 'submissions-open': 'submissionsOpenCmd', 'reopen-team': 'reopenTeamCmd',
  'edit-submission': 'editSubmissionCmd', apply: 'applyCmd', question: 'questionCmd', reorder: 'reorderCmd', start: 'startCmd', timer: 'timerCmd',
  pause: 'pauseCmd', resume: 'resumeCmd', close: 'closeCmd', reveal: 'revealCmd', 'reveal-now': 'revealNowCmd', retry: 'retryCmd', 'show-text': 'showTextCmd',
  final: 'finalCmd', lobby: 'lobbyCmd', 'proxy-answer': 'proxyAnswerCmd', tts: 'ttsCmd', 'room-closed': 'roomClosedCmd', restore: 'restoreCmd',
};
export { set };
