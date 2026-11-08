// The Jarvis core: an asymmetrical, layered light body drawn on canvas.
// Everything it reacts to is real: the assistant state, the microphone level while
// listening and the playback level while speaking (both from `state.level`).
import { state } from "./core.js";

const TAU = Math.PI * 2;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const lerp = (a, b, k) => a + (b - a) * k;

// Targets per state. All of these are eased, so moving between states is continuous.
const MOOD = {
  idle:       { energy: 0.34, flow: 1.0, glow: 0.90, focus: 0, size: 1.00, sat: 1 },
  listening:  { energy: 0.52, flow: 1.4, glow: 1.05, focus: 0, size: 1.00, sat: 1 },
  processing: { energy: 0.24, flow: 2.6, glow: 1.00, focus: 1, size: 0.95, sat: 1 },
  speaking:   { energy: 0.48, flow: 1.6, glow: 1.10, focus: 0, size: 1.00, sat: 1 },
  error:      { energy: 0.14, flow: 0.5, glow: 0.50, focus: 0, size: 0.96, sat: 0.15 },
};

// Body and internal currents. `f` are lobe frequencies; low ones (2) make the silhouette asymmetrical.
const BODY = { amp: 0.075, f: [2, 3, 5], sp: [0.13, -0.21, 0.29], ph: 0.4 };
// Translucent lobes behind the body. They drift independently and peek past its edge, which
// gives the core its asymmetrical, layered silhouette.
const LOBES = [
  { c0: "rgba(231,165,255,0.85)", c1: "rgba(200,140,255,0.25)", r: 0.88, amp: 0.10, f: [2, 3, 4], sp: [0.11, -0.17, 0.23], ph: 1.1, dx: 0.20, dy: -0.16, drift: 0.07, rate: 0.23 },
  { c0: "rgba(110,190,255,0.85)", c1: "rgba(91,140,255,0.25)", r: 0.86, amp: 0.11, f: [3, 2, 5], sp: [-0.14, 0.19, -0.21], ph: 3.7, dx: -0.19, dy: 0.17, drift: 0.07, rate: 0.19 },
  { c0: "rgba(255,196,170,0.7)", c1: "rgba(255,160,200,0.2)", r: 0.60, amp: 0.12, f: [2, 4, 3], sp: [0.17, 0.13, -0.19], ph: 5.2, dx: 0.26, dy: 0.30, drift: 0.06, rate: 0.27 },
];
const SHELL = { amp: 0.09, f: [2, 4, 3], sp: [-0.10, 0.17, -0.23], ph: 2.2 };
const CURRENTS = [
  { col: ["rgba(255,150,236,1)", "rgba(226,140,255,0.55)"], r: 0.92, amp: 0.09, f: [2, 4, 3], sp: [-0.28, 0.31, 0.12], ph: 1.7, alpha: 0.72, mode: "screen", orbit: [0.30, -0.22, 0.26, 0.21] },
  { col: ["rgba(90,210,255,1)", "rgba(91,140,255,0.55)"], r: 0.92, amp: 0.09, f: [3, 2, 5], sp: [0.24, 0.19, -0.33], ph: 3.1, alpha: 0.68, mode: "screen", orbit: [-0.32, 0.26, 0.24, -0.17] },
  { col: ["rgba(255,205,165,1)", "rgba(255,160,190,0.45)"], r: 0.58, amp: 0.11, f: [2, 3, 4], sp: [-0.40, 0.27, 0.21], ph: 4.4, alpha: 0.50, mode: "screen", orbit: [0.16, 0.40, 0.30, 0.27] },
  { col: ["rgba(64,36,196,0.95)", "rgba(64,36,196,0.35)"], r: 0.66, amp: 0.10, f: [3, 4, 2], sp: [0.31, -0.36, 0.15], ph: 5.6, alpha: 0.38, mode: "multiply", orbit: [0.05, 0.08, 0.22, 0.31] },
];

export class Orb {
  constructor(canvas, { rings = true } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.off = document.createElement("canvas");
    this.octx = this.off.getContext("2d");
    this.rings = rings;
    this.t = Math.random() * 100;
    this.inner = 0;
    this.last = performance.now();
    this.m = { ...MOOD.idle, level: 0, hover: 0, px: 0, py: 0, ringL: 0, ringS: 0 };
    this.target = { px: 0, py: 0, hover: 0 };
    this.visible = true;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.kick(); }).observe(canvas);
    document.addEventListener("visibilitychange", () => this.kick());

    const host = canvas.closest("button") || canvas;
    host.addEventListener("pointermove", e => {
      const r = host.getBoundingClientRect();
      this.target.px = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      this.target.py = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      this.target.hover = 1;
    });
    host.addEventListener("pointerleave", () => { this.target.px = 0; this.target.py = 0; this.target.hover = 0; });
    this.running = false;
    this.kick();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth || 1, h = this.cv.clientHeight || 1;
    this.w = w; this.h = h; this.dpr = dpr;
    for (const c of [this.cv, this.off]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.draw();
  }

  kick() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = now => {
      if (!this.visible || document.hidden) { this.running = false; return; }
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  step(dt) {
    const s = MOOD[state.assistant] || MOOD.idle;
    const m = this.m;
    const kFast = 1 - Math.pow(0.002, dt), kMood = 1 - Math.pow(0.12, dt), kRing = 1 - Math.pow(0.05, dt);
    for (const key of ["energy", "flow", "glow", "focus", "size", "sat"]) m[key] = lerp(m[key], s[key], kMood);
    const live = state.assistant === "listening" || state.assistant === "speaking";
    const lvl = live ? state.level : 0;
    m.level = lerp(m.level, lvl, lvl > m.level ? kFast : kFast * 0.4);
    m.ringL = lerp(m.ringL, state.assistant === "listening" ? 1 : 0, kRing);
    m.ringS = lerp(m.ringS, state.assistant === "speaking" ? 1 : 0, kRing);
    m.hover = lerp(m.hover, this.target.hover, kMood);
    m.px = lerp(m.px, this.target.px, kMood);
    m.py = lerp(m.py, this.target.py, kMood);
    const speed = reduced.matches ? 0.12 : 1;
    this.t += dt * m.flow * speed;
    this.inner += dt * (0.5 + m.focus * 1.6) * speed;
  }

  path(ctx, cx, cy, r, L, t, energy) {
    const n = 80;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const w = Math.sin(L.f[0] * a + t * L.sp[0] * 2 + L.ph) * 0.52
              + Math.sin(L.f[1] * a + t * L.sp[1] * 2 + L.ph * 1.3) * 0.30
              + Math.sin(L.f[2] * a + t * L.sp[2] * 2 + L.ph * 0.7) * 0.18;
      const rr = r * (1 + L.amp * energy * 1.7 * w);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  draw() {
    const { ctx, octx, w, h, dpr, m } = this;
    if (!w) return;
    const t = this.t;
    const small = w < 140;
    const cx = w / 2 + m.px * w * 0.012, cy = h / 2 + m.py * h * 0.012;
    const breathe = reduced.matches ? 0 : Math.sin(t * 0.8) * 0.02;
    const R = Math.min(w, h) * (small ? 0.40 : 0.30) * m.size * (1 + breathe + m.level * 0.09 + m.hover * 0.02);
    const energy = m.energy + m.level * 0.9;
    const err = state.assistant === "error";

    /* ---------- the body, drawn offscreen so light can be composited onto it only ---------- */
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    octx.globalCompositeOperation = "source-over";
    let g = octx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.15);
    g.addColorStop(0, "#A88CFF"); g.addColorStop(0.5, "#6B56F3"); g.addColorStop(1, "#4A72F2");
    octx.fillStyle = g;
    this.path(octx, cx, cy, R, BODY, t, energy);
    octx.fill();

    octx.save();
    this.path(octx, cx, cy, R, BODY, t, energy);
    octx.clip();
    // Colour currents: each drifts on its own slow orbit, at its own depth
    CURRENTS.forEach((L, i) => {
      const depth = (i + 1) / CURRENTS.length;
      const o = L.orbit;
      const ox = cx + o[0] * R + Math.cos(t * o[3] + L.ph) * R * o[2] + m.px * R * 0.08 * depth;
      const oy = cy + o[1] * R + Math.sin(t * o[3] * 1.2 + L.ph) * R * o[2] + m.py * R * 0.08 * depth;
      const cg = octx.createRadialGradient(ox, oy, 0, ox, oy, R * L.r);
      cg.addColorStop(0, L.col[0]); cg.addColorStop(0.55, L.col[1]); cg.addColorStop(1, "rgba(0,0,0,0)");
      octx.globalCompositeOperation = L.mode;
      octx.globalAlpha = L.alpha;
      octx.fillStyle = cg;
      this.path(octx, ox, oy, R * L.r, L, t, energy);
      octx.fill();
    });
    // Inner light filaments: soft bands of light circling inside. They tighten and brighten while thinking.
    octx.globalCompositeOperation = "screen";
    for (let k = 0; k < 3; k++) {
      const a = this.inner * (k % 2 ? -0.9 : 1.1) + k * 2.1;
      const rx = R * (0.62 - m.focus * 0.22 + k * 0.08), ry = R * (0.26 + k * 0.05);
      octx.save();
      octx.translate(cx, cy);
      octx.rotate(a);
      octx.globalAlpha = m.focus * 0.42 + m.level * 0.12;
      if (octx.globalAlpha < 0.01) { octx.restore(); continue; }
      octx.lineWidth = R * (0.08 - k * 0.015);
      octx.strokeStyle = k === 1 ? "rgba(190,230,255,1)" : "rgba(245,220,255,1)";
      if (!small) octx.filter = `blur(${(R * 0.04).toFixed(1)}px)`;
      octx.beginPath();
      octx.ellipse(0, 0, rx, ry, 0, -0.9, 1.6);
      octx.stroke();
      octx.restore();
    }
    octx.filter = "none";
    octx.globalAlpha = 1;
    // Concentrated light at the centre while thinking
    if (m.focus > 0.02) {
      const pulse = 0.75 + Math.sin(this.inner * 3) * 0.25;
      g = octx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
      g.addColorStop(0, `rgba(255,255,255,${0.42 * m.focus * pulse})`); g.addColorStop(1, "rgba(255,255,255,0)");
      octx.globalCompositeOperation = "screen";
      octx.fillStyle = g; octx.fillRect(0, 0, w, h);
    }
    octx.restore();

    // Volume, rim light and a small specular highlight that follows the cursor
    octx.globalCompositeOperation = "source-atop";
    g = octx.createRadialGradient(cx + R * 0.55, cy + R * 0.65, R * 0.1, cx + R * 0.3, cy + R * 0.35, R * 1.2);
    g.addColorStop(0, "rgba(46,28,140,0.30)"); g.addColorStop(1, "rgba(46,28,140,0)");
    octx.fillStyle = g; octx.fillRect(0, 0, w, h);
    g = octx.createRadialGradient(cx, cy, R * 0.70, cx, cy, R * 1.06);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.8, "rgba(235,228,255,0.16)"); g.addColorStop(1, "rgba(255,255,255,0.55)");
    octx.fillStyle = g; octx.fillRect(0, 0, w, h);
    const hx = cx - R * 0.38 + m.px * R * 0.18, hy = cy - R * 0.42 + m.py * R * 0.18;
    g = octx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.55);
    g.addColorStop(0, `rgba(255,255,255,${0.48 + m.hover * 0.14})`); g.addColorStop(0.3, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)");
    octx.fillStyle = g; octx.fillRect(0, 0, w, h);
    octx.globalCompositeOperation = "source-over";

    /* ---------- compose ---------- */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Ambient light on the page: kept inside the canvas and soft at the edge
    const glow = m.glow * (1 + m.hover * 0.3 + m.level * 0.5);
    g = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * (small ? 1.25 : 1.7));
    g.addColorStop(0, err ? `rgba(217,80,106,${0.15 * glow})` : `rgba(140,110,255,${0.26 * glow})`);
    g.addColorStop(0.5, err ? `rgba(217,80,106,${0.05 * glow})` : `rgba(120,150,255,${0.10 * glow})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    if (!small) {
      // Back shell: a larger translucent layer that moves on its own, offset for asymmetry
      ctx.save();
      ctx.globalAlpha = (err ? 0.08 : 0.15) + m.hover * 0.05 + m.level * 0.15;
      const sx = cx - R * 0.06 + Math.cos(t * 0.2) * R * 0.04, sy = cy - R * 0.05 + Math.sin(t * 0.17) * R * 0.04;
      const sg = ctx.createRadialGradient(sx, sy, R * 0.8, sx, sy, R * 1.18);
      sg.addColorStop(0, "rgba(155,120,255,0.95)"); sg.addColorStop(1, "rgba(120,170,255,0.15)");
      ctx.fillStyle = sg;
      this.path(ctx, sx, sy, R * (1.09 + m.level * 0.06), SHELL, t * 0.7, energy * 1.25);
      ctx.fill();
      ctx.restore();
      if (this.rings) this.drawRings(ctx, cx, cy, R);
      LOBES.forEach((L, i) => {
        const lx = cx + (L.dx + Math.cos(t * L.rate + L.ph) * L.drift) * R + m.px * R * 0.05 * (i + 1);
        const ly = cy + (L.dy + Math.sin(t * L.rate * 1.3 + L.ph) * L.drift) * R + m.py * R * 0.05 * (i + 1);
        const lg = ctx.createRadialGradient(lx, ly, R * 0.1, lx, ly, R * L.r * 1.05);
        lg.addColorStop(0, L.c0); lg.addColorStop(1, L.c1);
        ctx.save();
        ctx.globalAlpha = (err ? 0.25 : 0.62) + m.level * 0.25;
        if (m.sat < 0.98) ctx.filter = `saturate(${m.sat.toFixed(2)})`;
        ctx.fillStyle = lg;
        this.path(ctx, lx, ly, R * L.r * (1 + m.level * 0.08), L, t, energy * 1.2);
        ctx.fill();
        ctx.restore();
      });
      // Bloom: a blurred copy of the body underneath it
      ctx.save();
      ctx.globalAlpha = 0.28 + m.level * 0.25;
      ctx.filter = `blur(${(R * 0.14).toFixed(1)}px) saturate(${m.sat.toFixed(2)})`;
      ctx.drawImage(this.off, 0, 0, w, h);
      ctx.restore();
    }

    ctx.save();
    if (m.sat < 0.98) ctx.filter = `saturate(${m.sat.toFixed(2)})`;
    ctx.drawImage(this.off, 0, 0, w, h);
    ctx.restore();
  }

  // Orbital rings appear only when they carry information: audio in or out.
  drawRings(ctx, cx, cy, R) {
    const m = this.m;
    const show = Math.max(m.ringL, m.ringS, m.hover * 0.35);
    if (show < 0.01) return;
    const green = m.ringL >= m.ringS && m.ringL > 0.05;
    for (let i = 0; i < 3; i++) {
      const strength = i === 0 ? show : Math.max(m.ringL, m.ringS);
      if (strength < 0.01) continue;
      const rr = R * (1.20 + i * 0.10 + m.level * (0.10 + i * 0.07));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * (0.985 - i * 0.01), this.t * 0.05 * (i + 1), 0, TAU);
      ctx.strokeStyle = green ? `rgba(23,166,115,${(0.32 - i * 0.09) * strength})` : `rgba(116,87,245,${(0.30 - i * 0.08) * strength})`;
      ctx.lineWidth = 1.4 - i * 0.3;
      ctx.stroke();
    }
  }
}
