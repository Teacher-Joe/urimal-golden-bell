// 노래 카드 그래픽. 곡명·가수 글자와 직접 그린 단순 도형만 사용한다(앨범 이미지 사용 안 함).
import { esc } from './common.js';

export const SONGS = [
  { id: 's1', title: '오늘만 I LOVE YOU', artist: 'BOYNEXTDOOR' },
  { id: 's2', title: 'Not Cute Anymore', artist: 'ILLIT' },
  { id: 's3', title: '한 페이지가 될 수 있게', artist: 'DAY6' },
  { id: 's4', title: 'Welcome to the Show', artist: 'DAY6' },
  { id: 's5', title: 'STYLE', artist: 'Hearts2Hearts' },
  { id: 's6', title: '레몬탱', artist: 'Hearts2Hearts' },
  { id: 's7', title: '퇴사할게요', artist: '전소연' },
  { id: 's8', title: 'LOVE ATTACK', artist: 'RESCENE' },
  { id: 's9', title: 'I AM', artist: 'IVE' },
  { id: 's10', title: '첫 만남은 계획대로 되지 않아', artist: 'TWS' },
];
export const songById = (id) => SONGS.find((s) => s.id === id);
export const songNo = (id) => SONGS.findIndex((s) => s.id === id) + 1;

const HEART = 'M50 82C24 64 14 50 20 36c6-13 22-14 30-2c8-12 24-11 30 2c6 14-4 28-30 46z';
// 큰 화면에서도 서로 확실히 구분되도록 색상 계열을 겹치지 않게 골랐다.
export const ART = {
  s1: {
    c1: '#ff4f8b', c2: '#7b1e7a', tag: '오늘 하루 고백 공연',
    svg: `<rect x="20" y="22" width="60" height="58" rx="9" fill="#fff" opacity=".95"/><rect x="20" y="22" width="60" height="16" rx="8" fill="var(--c2)"/><circle cx="34" cy="22" r="4" fill="#ffd34d"/><circle cx="66" cy="22" r="4" fill="#ffd34d"/><path transform="translate(25 35) scale(.5)" d="${HEART}" fill="var(--c1)"/>`,
  },
  s2: {
    c1: '#b48cff', c2: '#3c1a8c', tag: '이제는 멋쟁이',
    svg: `<path d="M50 50L22 32q-8 18 0 36zM50 50l28-18q8 18 0 36z" fill="#fff"/><circle cx="50" cy="50" r="8" fill="#ffd34d"/><path d="M58 60l-10 22 4-14h-8l12-22-4 14z" fill="#ffd34d" stroke="#3c1a8c" stroke-width="2"/>`,
  },
  s3: {
    c1: '#36c2ff', c2: '#123b8a', tag: '추억의 책장 무대',
    svg: `<path d="M50 30C40 24 26 24 16 28v46c10-4 24-4 34 2c10-6 24-6 34-2V28c-10-4-24-4-34 2z" fill="#fff"/><path d="M50 30v46" stroke="var(--c2)" stroke-width="3"/><path d="M24 40h18M24 50h18M24 60h14M58 40h18M58 50h18M58 60h12" stroke="var(--c1)" stroke-width="3" stroke-linecap="round"/>`,
  },
  s4: {
    c1: '#ff9f2e', c2: '#8a2b07', tag: '막이 오르는 쇼',
    svg: `<path d="M14 34h72v10a6 6 0 0 0 0 12v10H14V56a6 6 0 0 0 0-12z" fill="#fff"/><path d="M50 38l4 9 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z" fill="var(--c1)"/><path d="M30 34v32" stroke="var(--c2)" stroke-width="2" stroke-dasharray="3 3"/>`,
  },
  s5: {
    c1: '#ff5ac8', c2: '#1b1464', tag: '반짝반짝 패션쇼',
    svg: `<path d="M50 14c3 22 14 33 36 36c-22 3-33 14-36 36c-3-22-14-33-36-36c22-3 33-14 36-36z" fill="#fff"/><path d="M76 18c1 7 4 10 10 11c-6 1-9 4-10 11c-1-7-4-10-11-11c7-1 10-4 11-11z" fill="#ffd34d"/><circle cx="50" cy="50" r="7" fill="var(--c1)"/>`,
  },
  s6: {
    c1: '#ffe14a', c2: '#2f8f2f', tag: '새콤달콤 상큼 무대',
    svg: `<ellipse cx="50" cy="54" rx="30" ry="24" fill="#ffe14a" stroke="#fff" stroke-width="4"/><path d="M50 54l-22-6M50 54l-24 8M50 54l-10 22M50 54l12 21M50 54l24 6M50 54l20-14" stroke="#fff6b0" stroke-width="3"/><path d="M52 30c4-10 14-14 22-12c-2 9-11 14-22 12z" fill="#3cc44a"/>`,
  },
  s7: {
    c1: '#2ee6b6', c2: '#0b4d5a', tag: '씩씩한 작별 인사',
    svg: `<rect x="18" y="36" width="50" height="38" rx="6" fill="#fff"/><path d="M33 36v-6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v6" stroke="#fff" stroke-width="5" fill="none"/><rect x="18" y="50" width="50" height="5" fill="var(--c2)"/><path d="M66 58h20m-7-8l8 8-8 8" stroke="#ffd34d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  s8: {
    c1: '#ff3b3b', c2: '#5a0a1e', tag: '두근두근 사랑 작전',
    svg: `<path transform="translate(8 8) scale(.84)" d="${HEART}" fill="#fff"/><path d="M16 80L84 22" stroke="#ffd34d" stroke-width="5" stroke-linecap="round"/><path d="M84 22l-14 2 4 4zM84 22l-2 14-4-4z" fill="#ffd34d"/><path d="M16 80l6-12M16 80l12-6" stroke="#ffd34d" stroke-width="4" stroke-linecap="round"/>`,
  },
  s9: {
    c1: '#ffc83d', c2: '#6b1fa8', tag: '당당한 주인공',
    svg: `<path d="M18 70l-4-38 20 16 16-26 16 26 20-16-4 38z" fill="#fff"/><rect x="18" y="70" width="64" height="9" rx="3" fill="#fff"/><circle cx="50" cy="50" r="6" fill="var(--c2)"/><circle cx="31" cy="58" r="4" fill="var(--c1)"/><circle cx="69" cy="58" r="4" fill="var(--c1)"/>`,
  },
  s10: {
    c1: '#5be35b', c2: '#1d3f8c', tag: '설레는 첫 만남',
    svg: `<path d="M18 78c18-6 4-22 22-28s28 8 30-12" stroke="#fff" stroke-width="5" fill="none" stroke-dasharray="7 6" stroke-linecap="round"/><circle cx="18" cy="78" r="6" fill="#ffd34d"/><path d="M70 14a9 9 0 0 1 9 9c0 6-9 15-9 15s-9-9-9-15a9 9 0 0 1 9-9z" fill="#fff"/><circle cx="70" cy="23" r="3.5" fill="var(--c1)"/>`,
  },
};

export function songArtSVG(id) {
  return `<svg class="sc-svg" viewBox="0 0 100 100" aria-hidden="true">${ART[id]?.svg || ''}</svg>`;
}

/** 노래 카드(공연 포스터·음반 모양). tag: 'button' | 'div' */
export function songCard(song, { tag = 'button', selected = false, extra = '', attrs = '' } = {}) {
  const a = ART[song.id];
  const no = songNo(song.id);
  return `<${tag} class="song-card ${selected ? 'is-selected' : ''} ${extra}" data-song="${song.id}" style="--c1:${a.c1};--c2:${a.c2}" ${tag === 'button' ? `type="button" aria-pressed="${selected}"` : ''} ${attrs}>
    <span class="sc-no" aria-hidden="true">${no}</span>
    <span class="sc-art"><span class="sc-disc" aria-hidden="true"></span>${songArtSVG(song.id)}</span>
    <span class="sc-text"><span class="sc-title">${esc(song.title)}</span><span class="sc-artist">${esc(song.artist)}</span><span class="sc-tagline">${esc(a.tag)}</span></span>
    <span class="sc-check" aria-hidden="true">✔</span>
  </${tag}>`;
}
