// The interactive layer: command palette (Ctrl+K), page shortcuts, cursor glow on cards,
// charts you can hover, and keyboard moves in the inbox. Purely additive: it can fail quietly.
import { $, $$, esc, state, emit, on } from "./core.js";
import { icon } from "./icons.js";

/* =========================================================================
   1. Command palette
   ========================================================================= */
const PAGES = [
  ["assistant", "Home", "assistant", "1"], ["conversation", "History", "message-square", "2"], ["tasks", "Tasks", "list-checks", "3"],
  ["inbox", "Inbox", "inbox", "4"], ["markets", "Markets", "line-chart", "5"], ["customize", "Customize", "palette", "6"], ["settings", "Settings", "settings", "7"],
];
function commands(q) {
  const out = PAGES.map(([v, name, ic, key]) => ({ group: "Go to", name, ic, hint: "Ctrl " + key, run: () => emit("navigate", v) }));
  const act = (name, ic, run, hint = "") => out.push({ group: "Do", name, ic, hint, run });
  act("Talk to Jarvis", "mic", () => { emit("navigate", "assistant"); $("#orb")?.click(); }, "Ctrl Space");
  act("New task", "plus", () => { emit("navigate", "tasks"); setTimeout(() => $("#taskQuickInput")?.focus(), 80); });
  act("Summarize my day", "sparkle", () => ask("Summarize my day"));
  act("Read my newest email", "mail", () => ask("Read me my newest email"));
  act("Switch dark / light", "sun", () => $("#themeBtn")?.click());
  act("Check for updates", "refresh", () => { emit("open-settings", "help"); setTimeout(() => $("#updCheck")?.click(), 200); });
  (state.config.watchlist || []).forEach(t => out.push({ group: "Markets", name: `How is ${t} doing?`, ic: "trending-up", hint: "", run: () => ask(`How is ${t} doing today, and what's moving it?`) }));
  const s = q.trim().toLowerCase();
  const hits = s ? out.filter(c => c.name.toLowerCase().includes(s)) : out;
  if (s) hits.push({ group: "Ask", name: `Ask Jarvis: “${q.trim()}”`, ic: "sparkle", hint: "Enter", run: () => ask(q.trim()) });
  return hits;
}
function ask(text) { emit("navigate", "assistant"); emit("ask", text); }

let pal = null, palItems = [], palSel = 0;
function openPalette() {
  if (pal?.open || document.querySelector("dialog[open]")) return;
  if (!pal) {
    pal = document.createElement("dialog");
    pal.className = "palette";
    pal.setAttribute("aria-label", "Command palette");
    pal.innerHTML = `<div class="pal-top">${icon("sparkle")}<input class="pal-input" placeholder="Go somewhere, do something, or ask Jarvis…" aria-label="Command" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> choose</span><span><kbd>Ctrl</kbd><kbd>K</kbd> open anywhere</span></div>`;
    document.body.appendChild(pal);
    const inp = $(".pal-input", pal);
    inp.oninput = () => { palSel = 0; drawPalette(); };
    pal.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); palSel = (palSel + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % palItems.length; drawPalette(true); }
      if (e.key === "Enter") { e.preventDefault(); runPalette(palSel); }
    });
    pal.addEventListener("click", e => { if (e.target === pal) pal.close(); });
  }
  $(".pal-input", pal).value = "";
  palSel = 0;
  drawPalette();
  pal.showModal();
  $(".pal-input", pal).focus();
}
function drawPalette(keepScroll = false) {
  palItems = commands($(".pal-input", pal).value);
  const box = $(".pal-list", pal);
  let group = "";
  box.innerHTML = palItems.map((c, i) => {
    const head = c.group !== group ? `<div class="pal-group">${esc(group = c.group)}</div>` : "";
    return `${head}<button class="pal-item" type="button" role="option" data-i="${i}" aria-selected="${i === palSel}">${icon(c.ic)}<span>${esc(c.name)}</span>${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ""}</button>`;
  }).join("");
  $$(".pal-item", box).forEach(b => { b.onclick = () => runPalette(+b.dataset.i); b.onpointermove = () => { if (palSel !== +b.dataset.i) { palSel = +b.dataset.i; $$(".pal-item", box).forEach(x => x.setAttribute("aria-selected", String(x === b))); } }; });
  if (keepScroll) $(`.pal-item[aria-selected="true"]`, box)?.scrollIntoView({ block: "nearest" });
}
function runPalette(i) {
  const c = palItems[i];
  if (!c) return;
  pal.close();
  try { c.run(); } catch (e) { console.error(e); }
}

/* =========================================================================
   2. Cursor glow on every card (the Home widgets already have it)
   ========================================================================= */
function glow(e) {
  const el = e.target.closest?.(".card, .settings-group, .mail-list, .mail-read, .orb-choice");
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/* =========================================================================
   3. Charts you can hover: a dot follows the line and shows the price there
   ========================================================================= */
export function liveChart(holder, values, { prev = null, decimals = 2 } = {}) {
  const v = (values || []).filter(x => typeof x === "number");
  const svg = holder?.querySelector("svg");
  if (!svg || v.length < 2) return;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  holder.classList.add("live-chart");
  holder.insertAdjacentHTML("beforeend", `<span class="lc-line"></span><span class="lc-dot"></span><span class="lc-tip num"></span>`);
  const line = $(".lc-line", holder), dot = $(".lc-dot", holder), tip = $(".lc-tip", holder);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(f * (v.length - 1)), y = v[i];
    const x = (i / (v.length - 1)) * r.width, top = (r.top - holder.getBoundingClientRect().top) + r.height * (1 - 2 / 84) - ((y - min) / span) * r.height * (1 - 4 / 84);
    line.style.left = dot.style.left = `${x}px`;
    dot.style.top = `${top}px`;
    const base = prev ?? v[0], pct = base ? ((y - base) / base) * 100 : 0;
    tip.innerHTML = `<b>${y.toFixed(decimals)}</b><i class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</i>`;
    tip.style.left = `${Math.min(r.width - 60, Math.max(60, x))}px`;
    holder.classList.add("on");
  };
  holder.addEventListener("pointermove", move);
  holder.addEventListener("pointerleave", () => holder.classList.remove("on"));
}

/* =========================================================================
   4. A coloured letter for each sender, always the same colour for the same name
   ========================================================================= */
export function avatar(name) {
  const clean = String(name || "?").replace(/["'<>]/g, "").trim();
  const words = clean.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  const letters = ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
  let h = 0;
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar" style="--h:${h}" aria-hidden="true">${esc(letters)}</span>`;
}

/* =========================================================================
   5. Keyboard
   ========================================================================= */
function keys(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); pal?.open ? pal.close() : openPalette(); return; }
  if (document.querySelector("dialog[open]")) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); emit("navigate", PAGES[+e.key - 1][0]); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
  // Inbox: up/down (or J/K) walk the list
  if (!typing && $("#view-inbox")?.classList.contains("active") && ["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) {
    const rows = $$("#inboxList .mail-item");
    if (!rows.length) return;
    e.preventDefault();
    const cur = rows.findIndex(r => r.getAttribute("aria-pressed") === "true");
    const next = rows[Math.min(rows.length - 1, Math.max(0, cur + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)))];
    next.click(); next.scrollIntoView({ block: "nearest" });
  }
}

export function initPolish() {
  document.addEventListener("keydown", keys);
  if (matchMedia("(hover: hover)").matches) addEventListener("pointermove", glow, { passive: true });
  const b = $("#paletteBtn");
  if (b) b.onclick = openPalette;
  on("open-palette", openPalette);
}
