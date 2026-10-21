// 소리 담당 기기(교사 화면 또는 발표 화면 중 '소리 켜고 시작하기'를 누른 한 곳)에서만 소리를 낸다.
// 학생 태블릿은 이 모듈을 쓰지 않으므로 소리가 겹치지 않는다.
import { StageAudio, Speech } from './audio.js';
import { clientId, serverClock, remainingMs } from './common.js';

/** audio: room-sync.js의 audioApi(code, role) */
export function createSoundHost({ audio: api, onChange }) {
  const audio = new StageAudio();
  const speech = new Speech();
  let isHost = false;
  let state = null;
  let lastKey = null;
  let lastSec = null;
  let speaking = false;
  let lastError = null;

  const report = (st) => api.status(st).catch(() => {});
  const emit = () => onChange?.({ isHost, unlocked: audio.ready, speaking, ttsSupported: speech.supported, voices: speech.korean(), lastError });

  speech.onVoices(() => {
    if (isHost) api.voices(speech.listForServer(), speech.supported).catch(() => {});
    emit();
  });

  // 사용자가 누른 버튼 안에서 호출 → 브라우저 자동 재생 제한 해제
  async function enable() {
    const ok = await audio.unlock();
    if (speech.supported) {
      // iPad 사파리는 첫 음성도 사용자 동작 안에서 시작해야 해서 소리 없는 짧은 발화를 한 번 보낸다.
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {}
    }
    await api.claim(speech.listForServer(), speech.supported);
    audio.bell(); // 소리 확인용 종소리 한 번
    emit();
    return ok;
  }

  function onState(s) {
    state = s;
    const wasHost = isHost;
    isHost = !!s.audio && s.audio.hostClientId === clientId;
    audio.configure(s.settings || {});
    if (!isHost) {
      if (wasHost) {
        speech.cancel();
        audio.stopAll();
      }
      lastKey = null;
      emit();
      return;
    }
    const L = s.live || {};
    const key = `${L.runId || ''}:${L.phase}`;
    if (lastKey !== null && key !== lastKey) playTransition(lastKey.split(':')[1], L);
    lastKey = key;
    emit();
  }

  function playTransition(prev, L) {
    switch (L.phase) {
      case 'listening':
        if (serverClock.now() - (L.introAt || 0) < 4000) audio.intro();
        break;
      case 'closed':
        if (prev === 'answering' || prev === 'paused') audio.closeChime();
        break;
      case 'revealing':
        audio.drumroll(Math.max(800, (L.revealAt || serverClock.now() + 2800) - serverClock.now()));
        break;
      case 'revealed':
        audio.stopAll();
        audio.bell();
        break;
      case 'final':
        audio.finale();
        break;
      default:
        if (prev === 'revealing') audio.stopAll();
    }
  }

  // 남은 시간 째깍 소리와 마지막 5초 카운트다운 (TTS 재생 중에는 audio.can()이 false라서 울리지 않음)
  setInterval(() => {
    if (!isHost || !state || state.live?.phase !== 'answering') {
      lastSec = null;
      return;
    }
    const sec = Math.ceil(remainingMs(state.live) / 1000);
    if (sec === lastSec) return;
    lastSec = sec;
    if (sec >= 1 && sec <= 5) audio.countdown(sec);
    else if (sec > 5) audio.tick();
  }, 100);

  function onTts(cmd) {
    if (!isHost) return;
    if (cmd.action === 'stop') {
      speech.cancel();
      speaking = false;
      audio.setSpeaking(false);
      report({ speaking: false, ttsId: cmd.ttsId });
      emit();
      return;
    }
    lastError = null;
    speech.speak(cmd.text, {
      voiceURI: cmd.voiceURI,
      rate: cmd.rate,
      onstart: () => {
        speaking = true;
        audio.setSpeaking(true);
        report({ speaking: true, ttsId: cmd.ttsId });
        emit();
      },
      onend: () => {
        speaking = false;
        audio.setSpeaking(false);
        report({ speaking: false, ttsId: cmd.ttsId });
        emit();
      },
      onerror: (msg) => {
        speaking = false;
        audio.setSpeaking(false);
        lastError = msg;
        report({ speaking: false, error: msg, ttsId: cmd.ttsId });
        emit();
      },
    });
  }
  api.onTts(onTts);

  return { enable, onState, audio, speech, get isHost() { return isHost; } };
}
