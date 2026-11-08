// Shared helpers, app state and a tiny event bus.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const hhmm = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export class ApiError extends Error {}

export async function api(path, body, method) {
  const opts = body !== undefined
    ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: method || "GET" };
  let r;
  try { r = await fetch(path, opts); }
  catch (_) { throw new ApiError("Jarvis's server isn't reachable."); }
  if (r.status === 401 && !path.startsWith("/api/login")) { location.href = "/login"; throw new ApiError("Please log in"); }
  if (r.status === 204) return null;
  let data = null;
  try { data = await r.json(); } catch (_) { /* non-JSON */ }
  if (!r.ok && r.status !== 409 && r.status !== 400) throw new ApiError((data && data.error) || `Request failed (${r.status})`);
  return data;
}

export const state = {
  assistant: "idle",          // idle | listening | processing | speaking | error
  busy: false, speaking: false, listening: false, micBusy: false,
  handsFree: false, spoken: true,
  level: 0, lastReply: 0, sttSeconds: null, error: "",
  config: {}, reminders: [], provider: null, weather: null,
};

const subs = {};
export const on = (ev, fn) => (subs[ev] ||= []).push(fn);
export const emit = (ev, data) => (subs[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

export function toast(text, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Accessible confirmation dialog; resolves true/false.
export function confirmDialog({ title, body, confirm = "Confirm", danger = false }) {
  return new Promise(res => {
    const d = document.createElement("dialog");
    d.className = "dialog";
    d.setAttribute("aria-labelledby", "dlgTitle");
    d.innerHTML = `<h2 id="dlgTitle">${esc(title)}</h2><p>${esc(body)}</p>
      <div class="row"><button class="btn ghost" value="no">Cancel</button><button class="btn ${danger ? "danger" : "primary"}" value="yes">${esc(confirm)}</button></div>`;
    document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); res(v); };
    d.querySelector('[value="no"]').onclick = () => done(false);
    d.querySelector('[value="yes"]').onclick = () => done(true);
    d.addEventListener("cancel", e => { e.preventDefault(); done(false); });
    d.showModal();
    d.querySelector('[value="no"]').focus();
  });
}

// "in 2h 10m", "in 5 min", "now"
export function relTime(date) {
  const m = Math.round((date - Date.now()) / 60000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return `in ${h}h${mm ? ` ${mm}m` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d > 1 ? "s" : ""}`;
}

export function dayLabel(date) {
  const today = new Date(); const tmr = new Date(); tmr.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tmr.toDateString()) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function repeatLabel(r) {
  return { daily: "Every day", weekdays: "Every weekday", weekly: "Every week" }[r] || "";
}

// Assistant state: idle | listening | processing | speaking | error
export function setAssistant(s, detail = "") {
  state.assistant = s;
  state.error = s === "error" ? detail : "";
  emit("assistant", { state: s, detail });
}
export function settle() {
  if (state.busy || state.speaking || state.listening) return;
  if (state.assistant === "error") return;
  setAssistant("idle");
}

// Small trend line from real intraday closes. Returns an SVG string.
export function sparkline(values, up, w = 72, h = 22) {
  const v = (values || []).filter(x => typeof x === "number");
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 2) + 1, h - 2 - ((y - min) / span) * (h - 4)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const col = up ? "var(--up)" : "var(--down)";
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L ${w - 1} ${h} L 1 ${h} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
