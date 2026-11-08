// The fun layer: orb skins and moods, live answer cards (now playing, weather, scores, calendar),
// confetti, and the idle screen. Purely visual: everything here can fail quietly.
import { $, $$, api, esc, state, on, emit, hhmm } from "./core.js";
import { icon, weatherIcon } from "./icons.js";

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const IS_REMOTE = !/^(127\.0\.0\.1|localhost)$/.test(location.hostname);

/* =========================================================================
   1. Orb skins
   ========================================================================= */
export const SKINS = [["auto", "Classic"], ["arc", "Arc reactor"], ["galaxy", "Galaxy"], ["liquid", "Liquid metal"]];
export function setSkin(s) {
  if (!SKINS.some(([k]) => k === s)) s = "auto";
  store.set("jarvis.orbSkin", s);
  if (s === "auto") delete root.dataset.orbSkin; else root.dataset.orbSkin = s;
  $$("[data-skin-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.skinChoice === s)));
}

/* =========================================================================
   2. Orb moods: happy bounce, confused wobble, oops shake, and a beat while music plays
   ========================================================================= */
const MOODS = ["happy", "confused", "oops"];
let moodTimer = 0;
export function orbMood(kind) {
  const orb = $("#orb");
  if (!orb || reduced.matches) return;
  orb.classList.remove(...MOODS.map(m => "mood-" + m));
  void orb.offsetWidth;                                   // restart the animation
  orb.classList.add("mood-" + kind);
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => orb.classList.remove("mood-" + kind), kind === "confused" ? 1600 : 1300);
  if (kind === "happy") sparkles(orb);
}
function sparkles(orb) {
  const host = orb.querySelector(".orb-rings");
  if (!host) return;
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
    s.style.setProperty("--dx", (Math.cos(a) * (60 + Math.random() * 30)).toFixed(0) + "%");
    s.style.setProperty("--dy", (Math.sin(a) * (60 + Math.random() * 30)).toFixed(0) + "%");
    s.style.animationDelay = (Math.random() * 120).toFixed(0) + "ms";
    host.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }
}
function moodFor(r) {
  const acts = r.actions || [];
  if (r.brain === "none") return;
  if (acts.some(a => a.result && a.result.error)) return orbMood("oops");
  if (/\?\s*$/.test((r.reply || "").trim())) return orbMood("confused");
  if (acts.length || (r.confirm || []).length) orbMood("happy");
}

/* =========================================================================
   3. Now playing: one poller shared by the orb beat, the cards and the idle screen
   ========================================================================= */
const np = { data: null, at: 0, subs: new Set() };
let lastSong = null, dismissedSong = null, stoppedPolls = 0;
async function pollNow() {
  if (document.hidden) return;
  try { np.data = await api("/api/nowplaying"); np.at = Date.now(); } catch (_) { return; }
  root.classList.toggle("music-on", !!(np.data && np.data.playing && np.data.title));
  np.subs.forEach(fn => fn(np.data));
  // A new song started: pop the Now Playing card up under the orb
  const d = np.data, key = d && d.playing && d.title ? `${d.title}|${d.artist}` : null;
  if (key && key !== lastSong) { lastSong = key; songPopup(); }
  else if (key && key !== dismissedSong) songPopup(true);             // e.g. after an answer's cards went away
  stoppedPolls = key ? 0 : stoppedPolls + 1;
  if (stoppedPolls >= 6 && $("#liveCards .np-card") && !$("#liveCards .fcard:not(.np-card)")) hideLive();  // ~30s after the music stops
}
async function npControl(action) {
  try { np.data = await api("/api/nowplaying/control", { action }); np.at = Date.now(); np.subs.forEach(fn => fn(np.data)); }
  catch (e) { /* no media session: nothing to control */ }
  setTimeout(pollNow, 900);
}
const fmtT = s => (s == null || isNaN(s)) ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function npPos(d) {
  if (!d || d.position == null) return null;
  return Math.min(d.duration || 1e9, d.position + (d.playing ? (Date.now() - np.at) / 1000 : 0));
}
const artSrc = u => !u ? "" : (u.startsWith("data:") || u.startsWith("/")) ? u : "/api/img?u=" + encodeURIComponent(u);

const npCards = [];
// A Now Playing card that keeps itself up to date (and stops when it leaves the page)
function nowPlayingCard() {
  const el = document.createElement("div");
  el.className = "fcard np-card";
  const paint = d => {
    if (!el.isConnected && el.dataset.mounted) { np.subs.delete(paint); clearInterval(tick); return; }
    if (!d || !d.title) { el.innerHTML = `<div class="np-empty">${icon("music")}<span>Nothing is playing right now.</span></div>`; return; }
    el.dataset.mounted = "1";
    const pos = npPos(d), pct = pos != null && d.duration ? (pos / d.duration) * 100 : null;
    el.classList.toggle("is-playing", !!d.playing);
    el.innerHTML = `
      <div class="np-art">${d.art ? `<img src="${esc(artSrc(d.art))}" alt="">` : icon("music")}</div>
      <div class="np-main">
        <span class="np-app">${d.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ""}${esc(d.app || "Now playing")}</span>
        <strong class="np-title">${esc(d.title)}</strong>
        <span class="np-artist">${esc(d.artist || "")}</span>
        ${pct != null ? `<div class="np-bar"><span style="width:${pct.toFixed(1)}%"></span></div><div class="np-times"><span>${fmtT(pos)}</span><span>${fmtT(d.duration)}</span></div>` : ""}
      </div>
      <div class="np-ctrl">
        <button class="icon-btn" data-np="previous" aria-label="Previous">${icon("skip-back")}</button>
        <button class="icon-btn np-pp" data-np="toggle" aria-label="${d.playing ? "Pause" : "Play"}">${icon(d.playing ? "pause" : "play")}</button>
        <button class="icon-btn" data-np="next" aria-label="Next">${icon("skip-fwd")}</button>
      </div>`;
    $$("[data-np]", el).forEach(b => b.onclick = () => npControl(b.dataset.np));
  };
  const tick = setInterval(() => {                       // move the progress bar between polls
    const d = np.data, bar = el.querySelector(".np-bar span");
    if (!el.isConnected && el.dataset.mounted) { np.subs.delete(paint); clearInterval(tick); return; }
    if (!bar || !d || !d.duration) return;
    const pos = npPos(d);
    bar.style.width = ((pos / d.duration) * 100).toFixed(2) + "%";
    const t = el.querySelector(".np-times span"); if (t) t.textContent = fmtT(pos);
  }, 1000);
  np.subs.add(paint);
  paint(np.data);
  setTimeout(pollNow, 1200);                             // the song may have just started
  npCards.push(() => { np.subs.delete(paint); clearInterval(tick); el.classList.add("frozen"); });
  while (npCards.length > 2) npCards.shift()();          // only the newest cards stay live
  return el;
}

/* =========================================================================
   4. Answer cards
   ========================================================================= */
const MUSIC_TOOLS = /^(spotify_play|spotify_control|spotify_now_playing|play_music|media_control|now_playing)$/;
const dayName = d => new Date(d + "T12:00").toLocaleDateString([], { weekday: "short" });

function weatherCard(w) {
  const f = (w.forecast || []).slice(0, 5);
  return `<div class="fcard wx-card" data-code="${w.code}">
    <div class="wx-now">${icon(weatherIcon(w.code), "wx-ic")}<span class="wx-temp num">${w.now_c}°</span>
      <span class="wx-txt"><strong>${esc(w.place.split(",")[0])}</strong><small>${esc(w.sky)} · feels ${w.feels_like_c}° · wind ${w.wind_kmh} km/h</small></span></div>
    <div class="wx-days">${f.map((d, i) => `<span class="wx-day"><small>${i ? dayName(d.date) : "Today"}</small><b class="num">${d.high}°</b><em class="num">${d.low}°</em>${d.rain_chance ? `<i class="num">${d.rain_chance}%</i>` : ""}</span>`).join("")}</div>
  </div>`;
}

function teamRow(t, other) {
  if (!t) return "";
  const lead = t.score != null && other && other.score != null && +t.score > +other.score;
  return `<div class="sb-team${t.winner || lead ? " lead" : ""}">${t.logo ? `<img src="${esc(artSrc(t.logo))}" alt="" loading="lazy">` : `<span class="sb-dot"></span>`}
    <span class="sb-name">${esc(t.name || t.abbr)}${t.record ? ` <small>${esc(t.record)}</small>` : ""}</span><b class="num">${t.score ?? ""}</b></div>`;
}
function scoreCard(r) {
  if (!r.games || !r.games.length) return "";
  return `<div class="fcard sb-card"><div class="sb-head">${icon("trophy")}<strong>${esc(r.league)}</strong></div>
    ${r.games.slice(0, 6).map(g => `<div class="sb-game ${g.state === "in" ? "live" : ""}">
      <div class="sb-teams">${teamRow(g.away, g.home)}${teamRow(g.home, g.away)}</div>
      <span class="sb-status">${g.state === "in" ? '<span class="live-pill">LIVE</span>' : ""}${esc(g.state === "pre" ? g.start : g.status || "")}</span>
    </div>`).join("")}</div>`;
}

function eventCard(title, events) {
  if (!Array.isArray(events) || !events.length) return "";
  return `<div class="fcard ev-card"><div class="sb-head">${icon("calendar")}<strong>${esc(title)}</strong></div>
    ${events.slice(0, 5).map(e => `<div class="ev-row"><span class="ev-when num">${esc(e.when || e.start || "")}</span><span class="ev-title">${esc(e.title || e.summary || "")}</span></div>`).join("")}</div>`;
}

// Cards for one answer, as DOM nodes
export function cardsFor(r) {
  const out = [], acts = r.actions || [];
  const last = name => [...acts].reverse().find(a => a.tool === name && a.result && !a.result.error);
  const w = last("get_weather");
  if (w && w.result.now_c != null) out.push(weatherCard(w.result));
  const sc = last("sports_scores");
  if (sc) out.push(scoreCard(sc.result));
  const add = last("gcal_add");
  if (add && add.result.added) out.push(eventCard("Added to your calendar", [add.result.added]));
  const ev = last("gcal_events") || last("calendar_events");
  if (ev && Array.isArray(ev.result.events)) out.push(eventCard("Your calendar", ev.result.events));
  const nodes = out.filter(Boolean).map(html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; });
  if (acts.some(a => MUSIC_TOOLS.test(a.tool) && !(a.result && a.result.error))) nodes.unshift(nowPlayingCard());
  return nodes;
}

// The newest cards also appear under the orb on Home for a minute
let liveTimer = 0;
function showLive(r) {
  const box = $("#liveCards");
  if (!box) return;
  const nodes = cardsFor(r);
  if (!nodes.length) return;
  box.innerHTML = "";
  nodes.slice(0, 2).forEach(n => box.appendChild(n));
  box.insertAdjacentHTML("beforeend", `<button class="icon-btn live-x" aria-label="Hide">${icon("x")}</button>`);
  box.querySelector(".live-x").onclick = hideLive;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("in"));
  clearTimeout(liveTimer);
  const music = nodes.some(n => n.classList.contains("np-card"));
  liveTimer = setTimeout(hideLive, music ? 120000 : 60000);
}
function songPopup(onlyIfHidden = false) {
  const box = $("#liveCards");
  if (!box || state.busy || state.assistant !== "idle") return;
  if (!box.hidden && !box.querySelector(".np-card")) return;    // don't cover an answer's cards
  if (onlyIfHidden && !box.hidden) return;
  if (!box.hidden && box.querySelector(".np-card")) return;     // already showing: it updates itself
  box.innerHTML = "";
  box.appendChild(nowPlayingCard());
  box.insertAdjacentHTML("beforeend", `<button class="icon-btn live-x" aria-label="Hide">${icon("x")}</button>`);
  box.querySelector(".live-x").onclick = () => { dismissedSong = lastSong; hideLive(); };
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("in"));
  clearTimeout(liveTimer);                                       // stays while the music plays
}
function hideLive() {
  const box = $("#liveCards");
  if (!box || box.hidden) return;
  box.classList.remove("in");
  setTimeout(() => { box.hidden = true; box.innerHTML = ""; }, 300);
}

/* =========================================================================
   5. Confetti
   ========================================================================= */
export function confetti(x = innerWidth / 2, y = innerHeight / 2) {
  if (reduced.matches) return;
  const cv = document.createElement("canvas");
  cv.className = "confetti";
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  c.scale(dpr, dpr);
  const cols = ["#7B6CF6", "#3EE6FF", "#FF7AC6", "#FFD166", "#3DDC97", "#FFFFFF"];
  const ps = Array.from({ length: 110 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9, v = 6 + Math.random() * 9;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
             w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, col: cols[(Math.random() * cols.length) | 0], life: 1 };
  });
  let t0 = performance.now();
  const step = now => {
    const dt = Math.min(2, (now - t0) / 16.7); t0 = now;
    c.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of ps) {
      p.vy += 0.32 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= 0.006 * dt;
      if (p.life <= 0 || p.y > innerHeight + 20) continue;
      alive++;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = Math.min(1, p.life * 1.5);
      c.fillStyle = p.col; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
    }
    if (alive) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

/* =========================================================================
   6. Idle screen: an ambient display after a few minutes without use
   ========================================================================= */
let lastInput = Date.now(), idleEl = null, idleTick = 0;
const idleMinutes = () => +store.get("jarvis.idleMin", "3");
const idleOn = () => store.get("jarvis.idle", "on") === "on";

function greet() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
async function nextEvent() {
  try {
    const c = await api("/api/calendar?days=2");
    const ev = Array.isArray(c.events) ? c.events : [];
    return ev[0] || null;
  } catch (_) { return null; }
}
function nextTask() {
  const now = Date.now();
  return (state.reminders || []).map(r => ({ ...r, t: new Date(r.due).getTime() })).filter(r => r.t > now).sort((a, b) => a.t - b.t)[0] || null;
}

async function openIdle() {
  if (idleEl || !idleOn() || document.hidden) return;
  idleEl = document.createElement("div");
  idleEl.className = "idle-screen";
  idleEl.setAttribute("role", "dialog");
  idleEl.setAttribute("aria-label", "Idle screen. Move the mouse or press a key to wake Jarvis.");
  idleEl.innerHTML = `<div class="idle-glow"></div><div class="idle-inner">
      <p class="idle-greet"></p><div class="idle-clock num"></div><p class="idle-date"></p>
      <div class="idle-row">
        <div class="idle-tile" data-k="wx" hidden></div>
        <div class="idle-tile" data-k="ev" hidden></div>
        <div class="idle-tile" data-k="task" hidden></div>
      </div>
      <div class="idle-np" hidden></div></div>
      <p class="idle-hint">Move the mouse or say "Jarvis"</p>`;
  document.body.appendChild(idleEl);
  requestAnimationFrame(() => idleEl && idleEl.classList.add("in"));
  const paintClock = () => {
    if (!idleEl) return;
    const d = new Date();
    idleEl.querySelector(".idle-clock").textContent = hhmm(d);
    idleEl.querySelector(".idle-date").textContent = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    idleEl.querySelector(".idle-greet").textContent = greet() + (state.config?.user_name ? `, ${state.config.user_name}` : "");
    // drift a little every minute so nothing burns into the screen
    const inner = idleEl.querySelector(".idle-inner");
    inner.style.translate = `${Math.round(Math.sin(d.getMinutes()) * 18)}px ${Math.round(Math.cos(d.getMinutes() * 1.3) * 14)}px`;
  };
  paintClock();
  idleTick = setInterval(paintClock, 5000);
  const w = state.weather, wx = idleEl.querySelector('[data-k="wx"]');
  if (w && !w.error) { wx.hidden = false; wx.innerHTML = `${icon(weatherIcon(w.code))}<span><b class="num">${w.now_c}°</b><small>${esc(w.sky)} · ${esc(w.place.split(",")[0])}</small></span>`; }
  const t = nextTask(), tk = idleEl.querySelector('[data-k="task"]');
  if (t) { tk.hidden = false; tk.innerHTML = `${icon("clock")}<span><b>${esc(hhmm(new Date(t.t)))}</b><small>${esc(t.message)}</small></span>`; }
  const npBox = idleEl.querySelector(".idle-np");
  const paintNp = d => {
    if (!idleEl) return;
    if (!d || !d.title) { npBox.hidden = true; return; }
    npBox.hidden = false;
    npBox.innerHTML = `<div class="np-art">${d.art ? `<img src="${esc(artSrc(d.art))}" alt="">` : icon("music")}</div>
      <span><b>${esc(d.title)}</b><small>${esc(d.artist || "")}${d.playing ? "" : " · paused"}</small></span>
      ${d.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ""}`;
  };
  idleEl._np = paintNp;
  np.subs.add(paintNp);
  paintNp(np.data);
  const ev = await nextEvent(), evEl = idleEl?.querySelector('[data-k="ev"]');
  if (ev && evEl) { evEl.hidden = false; evEl.innerHTML = `${icon("calendar")}<span><b>${esc(ev.when || ev.start || "")}</b><small>${esc(ev.title || ev.summary || "")}</small></span>`; }
}
function closeIdle() {
  if (!idleEl) return;
  const el = idleEl; idleEl = null;
  np.subs.delete(el._np);
  clearInterval(idleTick);
  el.classList.remove("in");
  setTimeout(() => el.remove(), 400);
}
function noteInput(e) {
  if (e && e.type === "pointermove" && idleEl && (Math.abs(e.movementX) + Math.abs(e.movementY) < 3)) return;
  lastInput = Date.now();
  closeIdle();
}
function idleCheck() {
  const quiet = state.assistant === "idle" && !state.busy && !state.speaking;
  if (!quiet) { lastInput = Date.now(); closeIdle(); return; }
  if (!idleOn() || idleEl || document.hidden || IS_REMOTE) return;
  if ($("dialog[open], .modal.open, .confirm-dialog[open]")) return;
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value) return;
  if (Date.now() - lastInput > idleMinutes() * 60000) openIdle();
}
export function setIdle(on, minutes) {
  if (on !== undefined) store.set("jarvis.idle", on ? "on" : "off");
  if (minutes !== undefined) store.set("jarvis.idleMin", String(minutes));
}
export function previewIdle() { lastInput = 0; openIdle(); }

/* =========================================================================
   Settings controls + start-up
   ========================================================================= */
function initSettingsControls() {
  $$("[data-skin-choice]").forEach(b => b.onclick = () => { setSkin(b.dataset.skinChoice); orbMood("happy"); });
  const sw = $("#setIdle"), sel = $("#setIdleMin"), pv = $("#idlePreview");
  if (sw) { sw.checked = idleOn(); sw.onchange = () => setIdle(sw.checked); }
  if (sel) { sel.value = String(idleMinutes()); sel.onchange = () => setIdle(undefined, +sel.value); }
  if (pv) pv.onclick = () => setTimeout(previewIdle, 150);
}

export function initFun() {
  setSkin(store.get("jarvis.orbSkin", "auto"));
  initSettingsControls();
  on("chat-done", r => { moodFor(r); showLive(r); });
  on("action-confirmed", () => orbMood("happy"));
  on("task-done", pos => { confetti(pos?.x, pos?.y); orbMood("happy"); });
  on("asking", hideLive);
  if (!IS_REMOTE) { pollNow(); setInterval(pollNow, 5000); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNow(); });
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(t => addEventListener(t, noteInput, { passive: true, capture: true }));
  setInterval(idleCheck, 4000);
}
