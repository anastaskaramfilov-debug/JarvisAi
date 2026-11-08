// Interface sounds, spoken replies (streamed edge-tts with browser fallback) and the PC microphone.
import { api, state, setAssistant, settle, wait } from "./core.js";

/* ---------- interface sounds (synthesised, very quiet) ---------- */
let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
function tone(freq, at, len, type = "sine", vol = 0.04) {
  const c = audioCtx(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + len);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + at); o.stop(c.currentTime + at + len + 0.05);
}
const SOUNDS = {
  start() { tone(587, 0, 0.1); tone(880, 0.07, 0.16); },
  end() { tone(880, 0, 0.08); tone(587, 0.06, 0.14); },
  reply() { tone(1318, 0, 0.4, "sine", 0.016); },
  alert() { [0, 0.26, 0.52].forEach(t => tone(988, t, 0.2, "triangle", 0.045)); },
  error() { tone(196, 0, 0.28, "triangle", 0.045); },
};
export function sfx(name) {
  if (state.config.sfx === false) return;
  try { SOUNDS[name](); } catch (_) { /* audio not allowed yet */ }
}
document.addEventListener("pointerdown", () => { try { audioCtx(); } catch (_) {} }, { once: true });

/* ---------- speaking ---------- */
let current = null;
let activeQueue = null;
export const speechBusy = () => !!activeQueue;
export function stopSpeaking() {
  try { current && current.pause(); } catch (_) {}
  current = null;
  if (activeQueue) { activeQueue.cancel(); activeQueue = null; }
  try { speechSynthesis.cancel(); } catch (_) {}
  if (state.speaking) { state.speaking = false; state.level = 0; settle(); }
}

// Play one piece of speech (an <audio> already loading, or text the browser speaks). Resolves when done.
async function playOne(text, audio, begin) {
  if (!audio) { begin(); if (state.speaking) await browserSpeak(text); return; }
  current = audio;
  try {
    const c = audioCtx(), src = c.createMediaElementSource(audio), an = c.createAnalyser();
    an.fftSize = 512; src.connect(an); an.connect(c.destination);
    const buf = new Uint8Array(an.fftSize);
    const meter = () => {
      if (!state.speaking || current !== audio) return;
      an.getByteTimeDomainData(buf);
      let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
      state.level = Math.min(1, Math.sqrt(s / buf.length) * 3);
      requestAnimationFrame(meter);
    };
    meter();
  } catch (_) { /* level unavailable; visual stays steady */ }
  const ok = await new Promise(res => {
    audio.onplaying = begin;
    audio.onended = () => res(true); audio.onerror = () => res(false);
    audio.play().catch(() => res(false));
  });
  if (!ok && state.speaking && current === audio && !audio.currentTime) { begin(); await browserSpeak(text); }
}

/* A queue of sentences that arrive while Jarvis is still thinking: each one is spoken as soon as
   the previous finishes. onSentence(text) fires as a sentence starts (captions, typing). */
export function speechQueue({ onSentence, onFirst } = {}) {
  stopSpeaking();
  let resolve, playing = false, closed = false, cancelled = false, finished = false, first = true;
  const items = [];
  const done = new Promise(r => { resolve = r; });
  const finish = () => {
    if (finished) return;
    finished = true;
    if (activeQueue === q) activeQueue = null;
    if (state.speaking) { state.speaking = false; state.level = 0; state.lastReply = Date.now(); settle(); }
    resolve();
  };
  const next = async () => {
    if (cancelled) return finish();
    const it = items.shift();
    if (!it) { playing = false; if (closed) finish(); return; }
    playing = true;
    const begin = () => {
      if (it.begun) return;
      it.begun = true;
      if (state.speaking && state.spoken) setAssistant("speaking");
      if (first) { first = false; try { onFirst && onFirst(); } catch (_) {} }
      try { onSentence && onSentence(it.text); } catch (_) {}
    };
    if (!state.spoken) { begin(); await wait(Math.min(1800, 300 + it.text.length * 18)); }
    else { state.speaking = true; await playOne(it.text, it.audio, begin); }
    begin();
    next();
  };
  const q = {
    done,
    push(text, id) {
      if (cancelled || !text) return;
      let audio = null;
      if (state.spoken && id) { audio = new Audio("/api/tts/" + id); audio.preload = "auto"; }   // starts loading now
      items.push({ text, audio });
      if (!playing) next();
    },
    close() { closed = true; if (!playing) finish(); },
    cancel() { cancelled = true; items.length = 0; finish(); },
  };
  activeQueue = q;
  return q;
}

export async function speak(text, id, onStart) {
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    if (state.speaking) setAssistant("speaking");      // only once sound is actually playing
    try { onStart && onStart(); } catch (_) {}
  };
  if (!state.spoken || !text) { begin(); return; }
  stopSpeaking();
  state.speaking = true;
  try {
    if (!id) id = (await api("/api/tts/start", { text }))?.id;
    if (!id) throw new Error("no voice");
    await playOne(text, new Audio("/api/tts/" + id), begin);
  } catch (_) {
    if (state.speaking) { begin(); await browserSpeak(text); }
  }
  begin();
  if (state.speaking) { state.speaking = false; state.level = 0; state.lastReply = Date.now(); settle(); }
}

// Offline fallback. The browser voice exposes no audio level, so the visual stays steady (level 0).
function browserSpeak(text) {
  return new Promise(res => {
    try {
      const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
      const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
      const v = voices.find(v => /Ryan|George|Daniel|UK English Male/.test(v.name)) || voices.find(v => v.lang === "en-GB") || voices[0];
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p.trim()); u.voice = v; u.rate = 1.03;
        if (i === parts.length - 1) u.onend = u.onerror = () => res();
        speechSynthesis.speak(u);
      });
    } catch (_) { res(); }
  });
}

/* ---------- listening (the Jarvis server records with the Windows microphone) ---------- */
let levelTimer = null;
function pollLevel(on) {
  clearInterval(levelTimer);
  if (!on) { if (!state.speaking) state.level = 0; return; }
  levelTimer = setInterval(async () => {
    try {
      const m = await api("/api/miclevel");
      if (!state.speaking) state.level = Math.min(1, (m.level / Math.max(m.thr, 0.001)) * 0.18);
    } catch (_) {}
  }, 100);
}

export const IS_REMOTE = !["127.0.0.1", "localhost"].includes(location.hostname);

/* ---------- phone: record with the phone's own microphone, transcribe on the PC ---------- */
let phoneStop = false;
async function listenOnPhone(pushToTalk) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    return { text: "", error: e.name === "NotAllowedError" ? "microphone permission was refused - allow it in your phone's settings for this app" : "no microphone available" };
  }
  const c = audioCtx();
  const src = c.createMediaStreamSource(stream);
  const proc = c.createScriptProcessor(4096, 1, 1);
  const sink = c.createGain(); sink.gain.value = 0;              // keep the graph running without playing the mic back
  const chunks = [];
  let started = false, quietMs = 0, noise = 0.006, thr = 0.015, smooth = 0;
  const t0 = performance.now(), blockMs = 4096 / c.sampleRate * 1000;
  const waitMs = pushToTalk ? 7000 : 30000, endMs = pushToTalk ? 1500 : 1100, maxMs = 40000;
  phoneStop = false;
  const done = await new Promise(resolve => {
    proc.onaudioprocess = ev => {
      const d = ev.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      state.level = Math.min(1, (rms / Math.max(thr, 0.001)) * 0.18);
      if (phoneStop) return resolve(started);
      if (!started) {
        if (rms <= thr) { noise = noise * 0.9 + rms * 0.1; thr = Math.min(0.04, Math.max(0.01, noise * 3)); }
        if (rms > thr) { started = true; smooth = rms; }
        else if (performance.now() - t0 > waitMs) return resolve(false);
      }
      if (started) {
        chunks.push(new Float32Array(d));
        smooth = smooth * 0.6 + rms * 0.4;
        quietMs = smooth > Math.max(thr * 0.55, noise * 1.8) ? 0 : quietMs + blockMs;
        if (quietMs >= endMs || chunks.length * blockMs >= maxMs) resolve(true);
      }
    };
    src.connect(proc); proc.connect(sink); sink.connect(c.destination);
  });
  proc.disconnect(); src.disconnect(); sink.disconnect();
  stream.getTracks().forEach(t => t.stop());
  state.level = 0;
  if (!done || !chunks.length) return { text: "", silent: true };
  // 16 kHz mono WAV for the speech model on the PC
  const len = chunks.reduce((n, a) => n + a.length, 0), all = new Float32Array(len);
  let o = 0; for (const a of chunks) { all.set(a, o); o += a.length; }
  const ratio = c.sampleRate / 16000, outLen = Math.floor(len / ratio), pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) { const v = all[Math.floor(i * ratio)]; pcm[i] = Math.max(-1, Math.min(1, v)) * 32767; }
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  try {
    const r = await fetch("/api/transcribe", { method: "POST", body: buf });
    const j = await r.json();
    if (j.stt_s !== undefined) state.sttSeconds = j.stt_s;
    return { text: (j.text || "").trim(), error: j.error || "" };
  } catch (_) { return { text: "", error: "Jarvis's PC isn't reachable" }; }
}

// Returns {text, error, silent, busy}
export async function listen(pushToTalk) {
  if (IS_REMOTE) {
    state.micBusy = true; state.listening = true;
    try { return await listenOnPhone(pushToTalk); }
    finally { state.micBusy = false; state.listening = false; }
  }
  state.micBusy = true; state.listening = true; pollLevel(true);
  try {
    const r = await fetch("/api/listen" + (pushToTalk ? "?ptt=1" : ""), { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) return { text: "", busy: true };
    if (j.stt_s !== undefined) state.sttSeconds = j.stt_s;
    return { text: (j.text || "").trim(), error: j.error || "", silent: !!j.silent };
  } catch (_) {
    return { text: "", error: "Jarvis's server isn't reachable" };
  } finally {
    state.micBusy = false; state.listening = false; pollLevel(false);
  }
}
export const stopListening = () => { phoneStop = true; return IS_REMOTE ? Promise.resolve() : api("/api/listen/stop", {}).catch(() => {}); };

export const WAKE_WORDS = ["jarvis", "javis", "jervis", "jarvi", "travis"];
export const FOLLOW_UP_MS = 20000;
export { wait };
