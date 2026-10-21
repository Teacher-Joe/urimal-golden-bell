// 무대 연출: 금빛 입자(배경)와 금빛 색종이(정답 공개). '화면 움직임 줄이기'면 크게 줄인다.

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// 천천히 떠오르는 금빛 먼지. reduce면 그리지 않는다.
export function goldDust(canvas, { reduce = () => false, density = 50 } = {}) {
  const parts = [];
  let raf = 0;
  const spawn = (w, h, init) => ({
    x: Math.random() * w,
    y: init ? Math.random() * h : h + 10,
    r: 0.8 + Math.random() * 2.2,
    vy: 0.15 + Math.random() * 0.45,
    vx: (Math.random() - 0.5) * 0.2,
    tw: Math.random() * Math.PI * 2,
  });
  function frame() {
    raf = requestAnimationFrame(frame);
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (reduce() || document.hidden) return;
    while (parts.length < density) parts.push(spawn(w, h, parts.length < density));
    for (const p of parts) {
      p.y -= p.vy;
      p.x += p.vx;
      p.tw += 0.03;
      if (p.y < -10) Object.assign(p, spawn(w, h, false));
      const a = 0.35 + 0.35 * Math.sin(p.tw);
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 214, 102, ${a})`;
      ctx.shadowColor = 'rgba(255, 200, 80, .9)';
      ctx.shadowBlur = 8;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  frame();
  return () => cancelAnimationFrame(raf);
}

// 금빛 색종이. reduce면 화면 위쪽에서 조용히 반짝이는 별 몇 개만(큰 움직임·점멸 없음).
export function confetti(canvas, { reduce = false, duration = 4200 } = {}) {
  const colors = ['#ffd84d', '#ffe9a3', '#f5b40f', '#fff4cc', '#ff5a7a', '#ffffff', '#c98b00'];
  const { w, h } = fitCanvas(canvas);
  const count = reduce ? 0 : Math.min(260, Math.round(w / 6));
  const parts = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4,
    y: h * 0.25 + (Math.random() - 0.5) * 60,
    vx: (Math.random() - 0.5) * 16,
    vy: -6 - Math.random() * 12,
    s: 6 + Math.random() * 10,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
    shape: Math.random() < 0.3 ? 'circle' : 'rect',
  }));
  const start = performance.now();
  let raf = 0;
  function frame(now) {
    const t = now - start;
    const { ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (reduce) {
      // 움직임 줄이기: 고정된 반짝임이 천천히 사라짐
      const a = Math.max(0, 1 - t / 2500);
      ctx.fillStyle = `rgba(255, 216, 77, ${a})`;
      for (let i = 0; i < 9; i++) {
        const x = (w * (i + 1)) / 10;
        const y = h * 0.12 + (i % 2) * 30;
        star(ctx, x, y, 10);
      }
    } else {
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - t / duration);
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.s / 3, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2.2);
        ctx.restore();
      }
    }
    if (t < (reduce ? 2600 : duration)) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.35 : r;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// 직접 그린 황금 종 (방송 로고와 무관한 독창 그래픽).
// 그라데이션 id가 겹치면 숨겨진 종을 참조해 안 보이게 되므로 종마다 고유 id를 쓴다.
let bellSeq = 0;
export function bellSVG() {
  const n = ++bellSeq;
  return BELL_TEMPLATE.replace(/(bellG|rimG|glowG)/g, `$1${n}`);
}
const BELL_TEMPLATE = `<svg class="bell-svg" viewBox="0 0 200 220" aria-hidden="true">
  <defs>
    <linearGradient id="bellG" x1="0" x2="1">
      <stop offset="0" stop-color="#8a5a00"/><stop offset=".25" stop-color="#f7c844"/><stop offset=".45" stop-color="#fff2b0"/>
      <stop offset=".6" stop-color="#f5bd2c"/><stop offset="1" stop-color="#7a4a00"/>
    </linearGradient>
    <linearGradient id="rimG" x1="0" x2="1">
      <stop offset="0" stop-color="#6b3f00"/><stop offset=".5" stop-color="#ffd75e"/><stop offset="1" stop-color="#6b3f00"/>
    </linearGradient>
    <radialGradient id="glowG"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffcc33" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="100" cy="115" r="98" fill="url(#glowG)" class="bell-glow"/>
  <g class="bell-body">
    <path d="M100 18c-8 0-12 6-12 12h24c0-6-4-12-12-12z" fill="url(#rimG)"/>
    <path d="M100 28c-38 0-58 30-60 74c-1 28-8 48-22 62h164c-14-14-21-34-22-62c-2-44-22-74-60-74z" fill="url(#bellG)" stroke="#5c3600" stroke-width="2"/>
    <rect x="12" y="160" width="176" height="18" rx="9" fill="url(#rimG)" stroke="#5c3600" stroke-width="2"/>
    <path d="M66 70c6-14 16-22 28-24" stroke="#fffbe0" stroke-width="7" stroke-linecap="round" fill="none" opacity=".8"/>
    <path d="M52 132h96" stroke="#7a4a00" stroke-width="3" opacity=".5"/>
    <path d="M100 82l7 14 15 2-11 10 3 15-14-7-14 7 3-15-11-10 15-2z" fill="#fff6c8" stroke="#a46a00" stroke-width="2"/>
    <circle cx="100" cy="194" r="16" fill="url(#bellG)" stroke="#5c3600" stroke-width="2" class="bell-clapper"/>
  </g>
</svg>`;
