// 효과음은 모두 Web Audio로 직접 합성한다(외부 음원 없음 → 저작권 문제 없음).
// 한국어 음성은 브라우저 내장 Web Speech API(speechSynthesis)를 쓴다.

export class StageAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
    this.drumrollOn = true;
    this.speaking = false; // TTS 재생 중이면 효과음을 내지 않는다
    this.active = new Set();
    this.noiseBuf = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // 브라우저 자동 재생 제한 때문에 반드시 사용자가 누른 버튼 안에서 호출해야 한다.
  async unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    try {
      await this.ctx.resume();
    } catch {}
    return this.ready;
  }

  configure({ sfxOn, sfxVolume, drumrollOn } = {}) {
    if (typeof sfxOn === 'boolean') {
      this.enabled = sfxOn;
      if (!sfxOn) this.stopAll();
    }
    if (typeof sfxVolume === 'number') {
      this.volume = Math.max(0, Math.min(1, sfxVolume / 100));
      if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
    if (typeof drumrollOn === 'boolean') this.drumrollOn = drumrollOn;
  }

  can() {
    return this.ready && this.enabled && !this.speaking && this.volume > 0;
  }

  setSpeaking(on) {
    this.speaking = on;
    if (on) this.stopAll(); // 문장이 또렷하게 들리도록 배경음·드럼롤·카운트다운을 모두 멈춤
  }

  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const n of this.active) {
      try {
        n.gain?.gain.cancelScheduledValues(t);
        n.gain?.gain.setTargetAtTime(0, t, 0.02);
        n.src.stop(t + 0.08);
      } catch {}
    }
    this.active.clear();
  }

  track(src, gain) {
    const item = { src, gain };
    this.active.add(item);
    src.onended = () => this.active.delete(item);
  }

  tone(freq, start, dur, { type = 'sine', gain = 0.3, attack = 0.01, release = null, detune = 0, lowpass = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    let node = o;
    if (lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + (release ?? dur));
    o.start(start);
    o.stop(start + (release ?? dur) + 0.05);
    this.track(o, g);
  }

  noise(start, dur, { gain = 0.3, type = 'bandpass', freq = 1000, q = 1, attack = 0.002 } = {}) {
    const c = this.ctx;
    if (!this.noiseBuf) {
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.start(start, Math.random() * 0.5);
    s.stop(start + dur + 0.05);
    this.track(s, g);
  }

  // ── 무대 효과음 ──
  // 문제 시작: 짧은 금관 팡파르
  intro() {
    if (!this.can()) return;
    const t = this.ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, t + i * 0.11, 0.5, { type: 'sawtooth', gain: 0.12, lowpass: 2200, release: i === 3 ? 0.9 : 0.3 });
      this.tone(f * 1.005, t + i * 0.11, 0.5, { type: 'square', gain: 0.04, lowpass: 1800, release: i === 3 ? 0.9 : 0.3 });
    });
    this.noise(t + 0.33, 0.6, { gain: 0.06, type: 'highpass', freq: 6000 });
  }

  // 남은 시간 표시(부드러운 째깍)
  tick() {
    if (!this.can()) return;
    const t = this.ctx.currentTime;
    this.tone(1800, t, 0.05, { type: 'triangle', gain: 0.05 });
  }

  // 마지막 5초 카운트다운: 숫자가 줄어들수록 조금씩 높아지는 삑
  countdown(n) {
    if (!this.can()) return;
    const t = this.ctx.currentTime;
    const f = 660 + (5 - n) * 90;
    this.tone(f, t, 0.18, { type: 'square', gain: 0.09, lowpass: 3000 });
    this.tone(f * 2, t, 0.12, { type: 'sine', gain: 0.05 });
  }

  // 선택 마감: 밝은 '딩-동' (놀리는 느낌 없이 중립적으로)
  closeChime() {
    if (!this.can()) return;
    const t = this.ctx.currentTime;
    this.tone(880, t, 0.6, { type: 'sine', gain: 0.22 });
    this.tone(659.25, t + 0.22, 0.9, { type: 'sine', gain: 0.22 });
  }

  // '두구두구두구…' 드럼롤: 빠른 스네어 연타가 커지다가 심벌로 끝남
  drumroll(ms) {
    if (!this.can() || !this.drumrollOn) return;
    const t0 = this.ctx.currentTime + 0.02;
    const dur = Math.max(0.6, ms / 1000 - 0.1);
    const step = 0.055;
    for (let t = 0; t < dur; t += step) {
      const k = t / dur;
      this.noise(t0 + t, 0.07, { gain: 0.05 + 0.18 * k, type: 'bandpass', freq: 1700 + 400 * Math.random(), q: 0.8 });
      if (Math.round(t / step) % 2 === 0) this.tone(140 + 30 * k, t0 + t, 0.08, { type: 'sine', gain: 0.07 + 0.08 * k });
    }
    // 마지막 '쾅'
    this.tone(90, t0 + dur, 0.5, { type: 'sine', gain: 0.35 });
    this.noise(t0 + dur, 1.2, { gain: 0.18, type: 'highpass', freq: 5000 });
  }

  // 황금 종소리: 종 특유의 비배음(1, 2, 2.76, 5.4, 8.93배)을 겹쳐 오래 울림
  bell(delay = 0) {
    if (!this.can()) return;
    const t = this.ctx.currentTime + delay;
    const base = 784;
    [
      [0.5, 0.12, 2.5],
      [1, 0.22, 3.2],
      [2, 0.1, 2.2],
      [2.76, 0.07, 1.6],
      [5.4, 0.04, 1.0],
      [8.93, 0.02, 0.6],
    ].forEach(([m, g, d]) => this.tone(base * m, t, d, { type: 'sine', gain: g, attack: 0.004 }));
    this.noise(t, 0.08, { gain: 0.12, type: 'highpass', freq: 7000 });
  }

  // 최종 점수판: 축하 팡파르 + 종
  finale() {
    if (!this.can()) return;
    const t = this.ctx.currentTime + 0.02;
    const notes = [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, t + i * 0.14, 0.4, { type: 'sawtooth', gain: 0.1, lowpass: 2400, release: i === notes.length - 1 ? 1.4 : 0.3 }));
    this.bell(0.9);
  }
}

// ───────────────────────── 한국어 TTS ─────────────────────────
export class Speech {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.supported = !!this.synth && 'SpeechSynthesisUtterance' in window;
    this.all = [];
    this.seq = 0;
    this.listeners = new Set();
    if (!this.supported) return;
    const load = () => {
      this.all = this.synth.getVoices();
      this.listeners.forEach((fn) => fn(this.korean()));
    };
    load();
    // 크롬·엣지는 음성 목록을 나중에 채운다(voiceschanged). 이벤트가 없는 브라우저를 위해 몇 번 더 확인.
    if ('onvoiceschanged' in this.synth) this.synth.addEventListener('voiceschanged', load);
    let tries = 0;
    const poll = setInterval(() => {
      load();
      if (++tries > 10 || this.all.length) clearInterval(poll);
    }, 500);
  }

  onVoices(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // 한국어 음성만, 기기 내 음성(오프라인에서도 동작)을 먼저
  korean() {
    return this.all
      .filter((v) => /^ko([-_]|$)/i.test(v.lang) || /korean|한국/i.test(v.name))
      .sort((a, b) => Number(b.localService) - Number(a.localService) || Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
  }

  listForServer() {
    return this.korean().map((v) => ({ name: v.name, voiceURI: v.voiceURI, lang: v.lang, localService: v.localService, default: v.default }));
  }

  pick(voiceURI) {
    const ko = this.korean();
    return ko.find((v) => v.voiceURI === voiceURI) || ko.find((v) => v.localService) || ko[0] || null;
  }

  // 긴 문장은 크롬에서 중간에 끊기는 문제가 있어 문장 단위로 나눠 차례로 읽는다.
  static chunks(text) {
    const parts = String(text)
      .split(/\n+|(?<=[.!?。…~])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (p.length <= 140) {
        out.push(p);
        continue;
      }
      let buf = '';
      for (const w of p.split(/(?<=[,，])\s*|\s+/)) {
        if ((buf + ' ' + w).length > 140 && buf) {
          out.push(buf);
          buf = w;
        } else buf = buf ? buf + ' ' + w : w;
      }
      if (buf) out.push(buf);
    }
    return out;
  }

  speak(text, { voiceURI, rate = 1, onstart, onend, onerror } = {}) {
    if (!this.supported) {
      onerror?.('이 브라우저는 음성 읽기를 지원하지 않아요.');
      return;
    }
    this.cancel(); // 겹치지 않도록 기존 재생 취소
    const token = ++this.seq;
    const voice = this.pick(voiceURI);
    const parts = Speech.chunks(text);
    if (!parts.length) {
      onerror?.('읽을 문장이 없어요.');
      return;
    }
    let i = 0;
    let started = false;
    const next = () => {
      if (token !== this.seq) return;
      if (i >= parts.length) {
        onend?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = voice?.lang || 'ko-KR';
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = 1;
      u.onstart = () => {
        if (!started && token === this.seq) {
          started = true;
          onstart?.();
        }
      };
      u.onend = next;
      u.onerror = (e) => {
        if (token !== this.seq || e.error === 'interrupted' || e.error === 'canceled') return;
        onerror?.(e.error === 'not-allowed' ? "브라우저가 소리를 막았어요. '소리 켜고 시작하기'를 다시 눌러 주세요." : `음성 오류: ${e.error}`);
      };
      this.synth.speak(u);
    };
    // 일부 브라우저는 cancel 직후 바로 speak하면 무시하므로 아주 잠깐 기다린다.
    setTimeout(next, 60);
    // onstart가 오지 않는 경우(음성 엔진 없음)를 대비
    setTimeout(() => {
      if (!started && token === this.seq && !this.synth.speaking) onerror?.('음성이 시작되지 않았어요. 한국어 음성이 설치되어 있는지 확인해 주세요.');
    }, 4000);
  }

  cancel() {
    this.seq++;
    try {
      this.synth?.cancel();
    } catch {}
  }
}

export const KOREAN_VOICE_HELP = [
  'Windows: 설정 → 시간 및 언어 → 음성 → 음성 추가 → "한국어" 설치 후 브라우저를 다시 여세요.',
  'Chrome/Edge는 인터넷에 연결되어 있으면 온라인 한국어 음성(예: Google 한국의)도 쓸 수 있어요.',
  'iPad: 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 한국어에서 음성을 내려받으세요.',
  'Android: 설정 → 일반 → 텍스트 음성 변환(TTS) → Google 음성 엔진의 한국어 데이터를 설치하세요.',
  '그래도 안 되면 선생님이 화면의 문장을 직접 읽어 주시면 그대로 진행할 수 있어요.',
];
