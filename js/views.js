// 데이터베이스 원본 → 화면에서 쓰기 좋은 모양으로 바꾸는 함수들 (교사·조·발표 화면 공용).
import { serverClock } from './common.js';

export const DEFAULT_SETTINGS = Object.freeze({
  pointsPerCorrect: null, // null = 아직 정하지 않음. 화면에 'N점'이라고 표시하지 않는다.
  timeLimitSec: 30,
  sfxOn: true,
  sfxVolume: 70,
  drumrollOn: true,
  reduceMotion: false,
  skipRevealFx: false,
  ttsVoiceURI: '',
  ttsRate: 1,
  presenterCanAnswer: false,
});
export const REVEAL_FX_MS = 2800;
export const MAX_LYRICS = 4000;

// Realtime Database는 키가 1,2,3…인 객체를 배열로 돌려줄 때가 있다 → 항상 객체로 바꾸고 빈 칸은 뺀다.
export function normalize(v) {
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => {
      if (x !== null && x !== undefined) o[i] = normalize(x);
    });
    return o;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = normalize(x);
    return o;
  }
  return v;
}

export const settingsOf = (raw) => ({ ...DEFAULT_SETTINGS, ...(raw || {}) });
export const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function teamsOf(rawTeams, rawKeys = {}) {
  return Object.entries(rawTeams || {})
    .map(([id, t]) => ({ id: Number(id), name: t?.name || `${id}조`, token: rawKeys?.[id] || null }))
    .sort((a, b) => a.id - b.id);
}

export function questionsOf(rawQ) {
  return Object.entries(rawQ || {})
    .map(([id, q]) => ({ id, songId: q.songId || null, text: q.text || '', sourceTeamId: numOrNull(q.sourceTeamId), presenterTeamId: numOrNull(q.presenterTeamId), order: q.order ?? 0, updatedAt: q.updatedAt || null }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((q, i) => ({ ...q, number: i + 1 }));
}

export function liveOf(raw) {
  const L = { phase: 'lobby', questionId: null, runId: null, ...(raw || {}) };
  L.presenterTeamId = numOrNull(L.presenterTeamId);
  L.remainingMs = L.phase === 'answering' && L.endsAt ? Math.max(0, L.endsAt - serverClock.now()) : L.remainingMs;
  return L;
}

// 동점은 같은 순위 (1, 1, 3)
export function rankTeams(teams, totals) {
  const sorted = teams.map((t) => ({ id: t.id, name: t.name, score: totals[t.id] || 0 })).sort((a, b) => b.score - a.score || a.id - b.id);
  let rank = 0;
  sorted.forEach((row, i) => {
    if (i === 0 || row.score !== sorted[i - 1].score) rank = i + 1;
    row.rank = rank;
  });
  return sorted;
}

// 점수 합계. results = 문제별 { perTeam: { 조번호: { points } } }
export function totalsOf(teams, results) {
  const totals = Object.fromEntries(teams.map((t) => [t.id, 0]));
  for (const r of Object.values(results || {})) {
    for (const [tid, row] of Object.entries(r?.perTeam || {})) if (Number(tid) in totals) totals[Number(tid)] += Number(row.points) || 0;
  }
  return totals;
}

// 학생·발표 화면용 진행 정보. 정답은 공개된(reveals에 있는) 경우에만 넣는다.
export function publicLive(rawLive, reveals, teams) {
  const L = liveOf(rawLive);
  const out = { ...L };
  delete out.text;
  if (rawLive?.showText && rawLive?.text) out.text = rawLive.text;
  out.presenterTeamName = L.presenterTeamId ? teams.find((t) => t.id === L.presenterTeamId)?.name || `${L.presenterTeamId}조` : null;
  const r = L.questionId ? reveals?.[L.questionId] : null;
  if ((L.phase === 'revealed' || L.phase === 'final') && r && r.runId === L.runId) {
    out.reveal = {
      correctSongId: r.correctSongId,
      pointsPerCorrect: r.pointsPerCorrect,
      correctTeamIds: Object.entries(r.perTeam || {}).filter(([, row]) => row.status === 'correct').map(([id]) => Number(id)),
    };
  }
  return out;
}
