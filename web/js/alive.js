// Makes Jarvis feel alive: a living aurora background, orb effects, a weather scene and motion & depth.
// Everything is decorative, pauses when the window is hidden and calms down with "reduce motion".
import { $, $$, state, on } from "./core.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;

/* ---------- 1. Living background: mood + time of day ---------- */
function daypart() {
  const h = new Date().getHours();
  return h >= 5 && h < 11 ? "morning" : h >= 11 && h < 17 ? "day" : h >= 17 && h < 21 ? "evening" : "night";
}
function mood() {
  const m = $("#orb")?.dataset.mode || "idle";
  return m === "primed" ? "idle" : m;
}

/* ---------- 2. Orb effects: speaking rings, listening waveform, click ripple ---------- */
let orb, rings, wave, wctx, lastRing = 0, phase = 0;
function setupOrb() {
  orb = $("#orb");
  rings = orb.querySelector(".orb-rings");
  wave = orb.querySelector(".orb-wave");
  wctx = wave.getContext("2d");
  orb.addEventListener("pointerdown", () => ring("tap"));
}
function ring(kind) {
  if (reduced.matches || !rings) return;
  const r = document.createElement("span");
  r.className = "ring " + kind;
  rings.appendChild(r);
  r.addEventListener("animationend", () => r.remove());
  while (rings.children.length > 6) rings.firstChild.remove();
}
function drawWave(listening) {
  const size = orb.offsetWidth * 1.5;
  const px = Math.round(size * Math.min(2, devicePixelRatio || 1));
  if (wave.width !== px) { wave.width = wave.height = px; }
  const c = wctx, w = px, mid = w / 2;
  c.clearRect(0, 0, w, w);
  if (!listening) return;
  const lvl = Math.min(1, state.level * 1.2);
  const base = w * 0.345, amp = w * (0.010 + lvl * 0.05);
  c.lineWidth = Math.max(1.5, w * 0.004);
  const grad = c.createLinearGradient(0, 0, w, w);
  grad.addColorStop(0, "rgba(62,230,255,0.9)"); grad.addColorStop(1, "rgba(139,123,255,0.9)");
  c.strokeStyle = grad;
  c.shadowColor = "rgba(62,230,255,0.6)"; c.shadowBlur = w * 0.02;
  c.beginPath();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const n = Math.sin(a * 6 + phase * 2.1) * 0.55 + Math.sin(a * 11 - phase * 3.3) * 0.3 + Math.sin(a * 3 + phase) * 0.15;
    const r = base + n * amp;
    const x = mid + Math.cos(a) * r, y = mid + Math.sin(a) * r;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath(); c.stroke();
}

/* ---------- 3. Weather scene (canvas behind everything) ---------- */
let fx, fctx, scene = "none", parts = [], flash = 0, nextFlash = 0;
const W = () => fx.width, H = () => fx.height;
function sceneFor(w) {
  if (!w || w.code == null) return "none";
  const c = +w.code, now = new Date();
  const hm = s => { const [h, m] = String(s || "").split(":").map(Number); return isNaN(h) ? null : h * 60 + m; };
  const mins = now.getHours() * 60 + now.getMinutes(), rise = hm(w.sunrise) ?? 420, set = hm(w.sunset) ?? 1080;
  const night = mins < rise || mins > set;
  if (c >= 95) return "storm";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if (c === 45 || c === 48) return "fog";
  if (c === 3) return night ? "clouds-night" : "clouds";
  if (c === 2) return night ? "stars-clouds" : "sun-clouds";
  return night ? "stars" : "sun";
}
function buildScene() {
  parts = [];
  const w = W(), h = H(), rnd = Math.random;
  const add = (n, f) => { for (let i = 0; i < n; i++) parts.push(f(i)); };
  if (scene === "rain" || scene === "storm") add(scene === "storm" ? 140 : 100, () => ({ k: "rain", x: rnd() * w, y: rnd() * h, l: 10 + rnd() * 18, v: 9 + rnd() * 7, a: 0.08 + rnd() * 0.14 }));
  if (scene === "snow") add(90, () => ({ k: "snow", x: rnd() * w, y: rnd() * h, r: 0.8 + rnd() * 2.2, v: 0.3 + rnd() * 0.8, s: rnd() * 6.28, a: 0.25 + rnd() * 0.5 }));
  if (scene.startsWith("stars")) add(scene === "stars" ? 130 : 70, () => ({ k: "star", x: rnd() * w, y: rnd() * h * 0.75, r: 0.4 + rnd() * 1.2, s: rnd() * 6.28, t: 0.5 + rnd() * 1.5 }));
  if (scene.includes("clouds") || scene === "fog" || scene === "rain" || scene === "storm" || scene === "snow")
    add(scene === "fog" ? 7 : scene.includes("sun") || scene.includes("stars") ? 3 : 5, () => ({ k: scene === "fog" ? "fog" : "cloud", x: rnd() * w, y: (scene === "fog" ? 0.3 + rnd() * 0.6 : rnd() * 0.45) * h, r: (0.18 + rnd() * 0.22) * Math.max(w, h), v: 0.08 + rnd() * 0.18 }));
}
function drawScene(t) {
  const c = fctx, w = W(), h = H(), light = root.dataset.theme === "light";
  c.clearRect(0, 0, w, h);
  if (scene === "sun" || scene === "sun-clouds") {
    const pulse = 0.85 + Math.sin(t / 2600) * 0.15;
    const g = c.createRadialGradient(w * 0.88, -h * 0.05, 0, w * 0.88, -h * 0.05, Math.max(w, h) * 0.55);
    g.addColorStop(0, `rgba(255,200,120,${(light ? 0.35 : 0.20) * pulse})`); g.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  for (const p of parts) {
    if (p.k === "cloud" || p.k === "fog") {
      p.x += p.v; if (p.x - p.r > w) p.x = -p.r;
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const col = light ? "120,130,170" : p.k === "fog" ? "170,175,210" : "150,160,210";
      g.addColorStop(0, `rgba(${col},${p.k === "fog" ? 0.09 : light ? 0.10 : 0.07})`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    } else if (p.k === "rain") {
      p.y += p.v; p.x -= p.v * 0.18;
      if (p.y > h) { p.y = -p.l; p.x = Math.random() * w * 1.1; }
      c.strokeStyle = light ? `rgba(60,70,130,${p.a})` : `rgba(170,190,255,${p.a})`;
      c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + p.l * 0.18, p.y - p.l); c.stroke();
    } else if (p.k === "snow") {
      p.y += p.v; p.s += 0.012; p.x += Math.sin(p.s) * 0.4;
      if (p.y > h + 4) { p.y = -4; p.x = Math.random() * w; }
      c.fillStyle = light ? `rgba(110,120,170,${p.a})` : `rgba(235,240,255,${p.a})`;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    } else if (p.k === "star") {
      if (light) continue;                       // stars only read as stars on the dark theme
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.s + t / 1000 * p.t));
      c.fillStyle = light ? `rgba(90,100,160,${a * 0.5})` : `rgba(220,225,255,${a})`;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    }
  }
  if (scene === "storm") {
    if (t > nextFlash) { flash = 1; nextFlash = t + 7000 + Math.random() * 14000; }
    if (flash > 0.01) { c.fillStyle = `rgba(210,220,255,${flash * 0.10})`; c.fillRect(0, 0, w, h); flash *= 0.86; }
  }
}
function resizeFx() {
  fx.width = Math.round(innerWidth * 0.75); fx.height = Math.round(innerHeight * 0.75);   // a bit under full size: cheaper, still soft
  buildScene();
}
export function setWeatherScene(w) {
  const s = sceneFor(w);
  if (s === scene) return;
  scene = s; root.dataset.weather = s;
  buildScene();
  if (reduced.matches) drawScene(0);
}

/* ---------- 4. Motion & depth: tilt, parallax, cursor glow, number count-up ---------- */
let mx = 0.5, my = 0.5, tiltDirty = false;
function onMove(e) {
  mx = e.clientX / innerWidth; my = e.clientY / innerHeight;
  tiltDirty = true;
  const el = e.target.closest?.(".widget, .suggestion, .btn");
  if (el) { const r = el.getBoundingClientRect(); el.style.setProperty("--mx", `${e.clientX - r.left}px`); el.style.setProperty("--my", `${e.clientY - r.top}px`); }
}
function applyTilt() {
  if (!tiltDirty) return;
  tiltDirty = false;
  $(".aurora")?.style.setProperty("translate", `${(mx - 0.5) * -24}px ${(my - 0.5) * -18}px`);
  $$(".widget").forEach(w => {
    if (!w.matches(":hover")) { w.style.removeProperty("--rx"); w.style.removeProperty("--ry"); return; }
    const r = w.getBoundingClientRect();
    const x = ((mx * innerWidth - r.left) / r.width - 0.5), y = ((my * innerHeight - r.top) / r.height - 0.5);
    w.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`); w.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
  });
}

// Animate a number from one value to another (prices, temperature).
export function countUp(el, to, { from = null, decimals = 0, ms = 700, suffix = "" } = {}) {
  if (!el || to == null || isNaN(to)) return;
  const start = from ?? +(el.dataset.v ?? to);
  el.dataset.v = to;
  if (reduced.matches || start === to) { el.textContent = (+to).toFixed(decimals) + suffix; return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (start + (to - start) * e).toFixed(decimals) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- the loop ---------- */
let lastFrame = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  // mood & time of day for the aurora
  const m = mood();
  if (root.dataset.mood !== m) root.dataset.mood = m;
  const aur = $(".aurora");
  if (aur) aur.style.opacity = (0.82 + Math.min(1, state.level) * (m === "speaking" ? 0.25 : 0.1)).toFixed(3);
  if (reduced.matches) return;
  // orb: rings while speaking, waveform while listening (~60 fps)
  phase += 0.05;
  if (orb) {
    if (m === "speaking" && state.level > 0.18 && t - lastRing > 420) { ring("speak"); lastRing = t; }
    else if (m === "compute" && t - lastRing > 900) { ring("think"); lastRing = t; }
    drawWave(m === "listening");
  }
  applyTilt();
  // weather particles at ~30 fps
  if (t - lastFrame > 33 && scene !== "none") { lastFrame = t; drawScene(t); }
}

export function initAlive() {
  root.dataset.daypart = daypart();
  setInterval(() => { root.dataset.daypart = daypart(); }, 60000);
  setupOrb();
  fx = $("#weatherFx"); fctx = fx.getContext("2d");
  resizeFx();
  addEventListener("resize", resizeFx);
  if (matchMedia("(hover: hover)").matches) addEventListener("pointermove", onMove, { passive: true });
  on("weather", setWeatherScene);
  if (state.weather) setWeatherScene(state.weather);
  requestAnimationFrame(frame);
}
