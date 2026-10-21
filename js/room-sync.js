// 조 화면·발표 화면: 읽을 수 있는 부분만 실시간으로 구독해서 화면용 데이터로 만든다.
import { roomRef, onValue, set, update, push, serverTimestamp, anonymousLogin, startPresence, onConnection, withTimeout, isDenied, currentUser } from './fb.js';
import { serverClock, clientId, AppError } from './common.js';
import { normalize, settingsOf, teamsOf, publicLive, totalsOf, rankTeams } from './views.js';

// 여러 경로를 구독하고, 바뀔 때마다 parts를 넘겨준다. 경로를 나중에 바꿀 수도 있다(현재 회차 답안 등).
function multiSub(code, onChange, onDenied) {
  const parts = {};
  const offs = {};
  let queued = false;
  const fire = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      onChange(parts);
    });
  };
  return {
    parts,
    sub(name, path) {
      path = path || null;
      // 같은 경로(구독 안 함 포함)면 아무것도 하지 않는다 — 다시 알리면 화면 갱신이 끝없이 반복된다
      if (name in offs && offs[name].path === path) return;
      offs[name]?.off?.();
      parts[name] = null; // 이전 경로(지난 회차 등)의 값이 남지 않게
      if (!path) {
        offs[name] = { path: null };
        fire();
        return;
      }
      const off = onValue(
        roomRef(code, path),
        (s) => {
          parts[name] = normalize(s.val());
          parts[`${name}$loaded`] = true;
          fire();
        },
        (err) => onDenied?.(err, name),
      );
      offs[name] = { path, off };
    },
  };
}

// ───────────── 조(학생) ─────────────
export async function joinTeam({ code, teamId, key, onState, onStatus }) {
  await anonymousLogin();
  const uid = currentUser().uid;
  try {
    await withTimeout(set(roomRef(code, `members/${uid}`), { role: 'team', teamId: String(teamId), key, at: serverTimestamp() }));
  } catch (e) {
    onStatus(isDenied(e) ? 'denied' : 'offline', isDenied(e) ? '참여 주소가 올바르지 않거나 바뀌었어요.' : e.message);
    if (isDenied(e)) return null;
  }
  startPresence(code, { role: 'team', teamId: String(teamId), clientId });
  onConnection((on) => onStatus(on ? 'live' : 'reconnecting'));

  const tid = String(teamId);
  const build = (p) => {
    if (!p.meta$loaded || !p.live$loaded) return;
    if (!p.meta) return onStatus('deleted');
    const teams = teamsOf(p.teams);
    const team = teams.find((t) => t.id === Number(tid));
    if (!team) return onState({ removed: true });
    const live = publicLive(p.live, p.reveals, teams);
    // 회차가 바뀌면 그 회차의 우리 조 답안만 구독
    S.sub('myAnswer', live.runId ? `answers/${live.runId}/${tid}` : null);
    const excluded = !!live.presenterExcluded && live.presenterTeamId === team.id;
    const closed = !!p.meta.closed;
    const rv = p.reveals?.[live.questionId];
    const revealed = live.phase === 'revealed' && rv && rv.runId === live.runId;
    const totals = totalsOf(teams, p.reveals);
    const mine = p.myAnswer && live.runId ? p.myAnswer : null;
    onState({
      role: 'team',
      serverNow: serverClock.now(),
      code,
      title: p.meta.title,
      closed,
      team: { id: team.id, name: team.name },
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      settings: { reduceMotion: !!settingsOf(p.settings).reduceMotion },
      submissionsOpen: !closed && (p.meta.submissionsOpen !== false || p.reopened === true),
      submission: p.submission || null,
      draft: p.draft || null,
      live,
      myAnswer: mine && live.phase !== 'lobby' ? mine : null,
      isPresenter: !!live.questionId && live.presenterTeamId === team.id,
      canAnswer: !closed && live.phase === 'answering' && serverClock.now() < live.endsAt && !excluded,
      excluded,
      myResult: revealed ? rv.perTeam?.[tid] || { status: 'none', points: 0 } : null,
      totals,
      ranking: live.phase === 'final' ? rankTeams(teams, totals) : null,
    });
  };
  const S = multiSub(code, build, (err) => onStatus(isDenied(err) ? 'denied' : 'offline', '참여 권한이 없어요.'));
  for (const [n, p] of [['meta', 'meta'], ['teams', 'teams'], ['settings', 'settings'], ['live', 'live'], ['reveals', 'reveals'], ['submission', `submissions/${tid}`], ['draft', `drafts/${tid}`], ['reopened', `reopened/${tid}`]]) S.sub(n, p);

  const note = (message) => push(roomRef(code, 'notices'), { teamId: tid, message: String(message).slice(0, 300), at: serverTimestamp() }).catch(() => {});
  return {
    async saveDraft({ songId, lyrics }) {
      await withTimeout(set(roomRef(code, `drafts/${tid}`), { songId: songId || null, lyrics: lyrics || '', savedAt: serverTimestamp() }));
    },
    // 서버(Firebase)가 실제로 저장을 마친 뒤에만 성공으로 끝난다
    async submitWork({ songId, lyrics }, state) {
      if (!songId) throw new AppError('노래를 선택해 주세요.');
      if (!lyrics.trim()) throw new AppError('고유어로 바꾼 가사를 입력해 주세요.');
      if ([...lyrics].length > 4000) throw new AppError('최대 4,000자까지 쓸 수 있어요.');
      const version = (state.submission?.version || 0) + 1;
      try {
        await withTimeout(set(roomRef(code, `submissions/${tid}`), { songId, lyrics: lyrics.replace(/\r\n/g, '\n'), submittedAt: serverTimestamp(), version, editedByTeacher: false }));
      } catch (e) {
        if (!isDenied(e)) throw e;
        const msg = state.closed ? '수업이 마감되었어요.' : !state.submissionsOpen ? '작품 제출이 마감되었어요. 선생님께 말씀드려 주세요.' : '저장을 거절당했어요. 화면을 새로 고친 뒤 다시 보내 주세요.';
        note(msg);
        throw new AppError(msg, { denied: true });
      }
    },
    async submitAnswer({ runId, songId }, state) {
      try {
        await withTimeout(update(roomRef(code), { [`answers/${runId}/${tid}`]: { songId, at: serverTimestamp(), by: 'team' }, [`answered/${runId}/${tid}`]: true }), 8000);
      } catch (e) {
        if (!isDenied(e)) throw e;
        const ph = state.live.phase;
        const msg = state.excluded ? '이번 문제는 우리 조 작품이라 답을 고르지 않아요.' : ph === 'paused' ? '잠시 멈춤 중이에요.' : ph === 'answering' || ph === 'closed' ? '선택이 마감되었어요.' : '지금은 답을 고를 수 없어요.';
        note(msg);
        throw new AppError(msg, { denied: true });
      }
    },
  };
}

// ───────────── 발표 화면 ─────────────
export async function joinDisplay({ code, key, onState, onStatus }) {
  await anonymousLogin();
  const uid = currentUser().uid;
  try {
    await withTimeout(set(roomRef(code, `members/${uid}`), { role: 'display', key, at: serverTimestamp() }));
  } catch (e) {
    onStatus(isDenied(e) ? 'denied' : 'offline', isDenied(e) ? '발표 화면 주소가 올바르지 않아요.' : e.message);
    if (isDenied(e)) return null;
  }
  startPresence(code, { role: 'display', clientId });
  onConnection((on) => onStatus(on ? 'live' : 'reconnecting'));

  const build = (p) => {
    if (!p.meta$loaded || !p.live$loaded) return;
    if (!p.meta) return onStatus('deleted');
    const teams = teamsOf(p.teams);
    const live = publicLive(p.live, p.reveals, teams);
    S.sub('answered', live.runId ? `answered/${live.runId}` : null);
    live.answeredCount = Object.keys(p.answered || {}).length;
    const totals = totalsOf(teams, p.reveals);
    const s = settingsOf(p.settings);
    const presence = Object.values(p.presence || {});
    onState({
      role: 'display',
      serverNow: serverClock.now(),
      code,
      title: p.meta.title,
      closed: !!p.meta.closed,
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      settings: { reduceMotion: s.reduceMotion, skipRevealFx: s.skipRevealFx, drumrollOn: s.drumrollOn, sfxOn: s.sfxOn, sfxVolume: s.sfxVolume },
      live,
      totals,
      ranking: rankTeams(teams, totals),
      audio: { hostClientId: p.audio?.host?.clientId || null, hostRole: p.audio?.host?.role || null, speaking: !!p.audio?.status?.speaking },
      connectedTeamIds: [...new Set(presence.filter((x) => x.role === 'team').map((x) => Number(x.teamId)))],
    });
  };
  const S = multiSub(code, build, (err) => onStatus(isDenied(err) ? 'denied' : 'offline', '발표 화면 권한이 없어요.'));
  for (const n of ['meta', 'teams', 'settings', 'live', 'reveals', 'presence', 'audio']) S.sub(n, n);
  return { code };
}

// 소리 담당 기기(발표 화면 또는 교사 화면)가 쓰는 함수들
// ready: 로그인·참여 등록이 끝났을 때 풀리는 약속 (그 전에 구독하면 권한 거부로 끊긴다)
export function audioApi(code, role, ready = Promise.resolve()) {
  return {
    claim: (voices, ttsSupported) => withTimeout(update(roomRef(code, 'audio'), { host: { clientId, role, at: serverTimestamp() }, voices, ttsSupported, status: { speaking: false, at: serverTimestamp() } })),
    voices: (voices, ttsSupported) => update(roomRef(code, 'audio'), { voices, ttsSupported }),
    status: (st) => set(roomRef(code, 'audio/status'), { speaking: !!st.speaking, error: st.error || null, ttsId: st.ttsId || null, at: serverTimestamp() }),
    // 교사가 보낸 음성 명령 받기. 페이지를 연 뒤에 온 명령만 실행한다.
    onTts(fn) {
      ready.then((ok) => {
        if (ok === null) return;
        let first = true;
        onValue(roomRef(code, 'tts'), (s) => {
          const cmd = s.val();
          if (first) {
            first = false;
            return;
          }
          if (cmd) fn(cmd);
        });
      }).catch(() => {});
    },
  };
}
