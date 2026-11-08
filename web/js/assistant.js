// Assistant workspace: visual + state, the answer area, the composer and the conversation panel.
import { $, $$, api, ApiError, esc, hhmm, state, on, emit, setAssistant, settle, confirmDialog, toast, wait } from "./core.js";
import { cardsFor } from "./fun.js";
import { icon } from "./icons.js";
import { sparkline } from "./core.js";
import { renderChart, chartThumb } from "./chart.js";
import { sfx, speak, speechQueue, speechBusy, stopSpeaking, listen, stopListening, audioCtx, WAKE_WORDS, FOLLOW_UP_MS, IS_REMOTE } from "./voice.js";

const STATE_TEXT = {
  idle: "Ready",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong",
};

const TOOL_NAMES = {
  get_current_time: "Clock", market_status: "Market hours", stock_price: "Stock quote", web_search: "Web search",
  read_webpage: "Read a page", open_app: "Opened an app", open_website: "Opened a site", open_path: "Opened a file",
  find_files: "Searched files", set_volume: "Volume", media_control: "Media", take_screenshot: "Screenshot",
  lock_pc: "Lock", power_action: "Power", send_email: "Email draft", reply_email: "Reply draft",
  list_folder: "Folder", read_file: "Read a file", write_file: "Wrote a file", move_file: "Moved", copy_file: "Copied",
  make_folder: "New folder", zip_files: "Zipped", unzip_file: "Unzipped", delete_file: "Delete", list_processes: "Running apps",
  close_app: "Close app", open_settings: "Settings", run_command: "PowerShell", calendar_events: "Calendar",
  add_calendar_event: "New event", create_reminder: "Added a task", list_reminders: "Tasks",
  cancel_reminder: "Removed a task", get_weather: "Weather", remember: "Saved to About you", forget: "Removed from About you",
  check_email: "Inbox", search_email: "Email search", manage_email: "Inbox", block_sender: "Block sender", unblock_sender: "Unblock", list_blocked: "Blocked senders", unsubscribe_email: "Unsubscribe", window_control: "Windows", press_keys: "Keyboard", type_text: "Typing", look_at_screen: "Looked at screen", show_images: "Pictures", generate_image: "Made a picture", pc_stats: "System",
};

let lastAsked = "";
let errorAction = null;

/* =========================================================================
   Visual + state label
   ========================================================================= */
function renderState({ state: s }) {
  $("#orb").setAttribute("aria-label", s === "listening" ? "Stop listening" : s === "speaking" ? "Stop speaking" : "Talk to Jarvis");
  const label = s === "listening" && state.handsFree && !state.micBusyPtt ? 'Listening for "Jarvis"' : STATE_TEXT[s];
  const lead = s === "listening" ? `<span class="mic-live">${icon("mic")}<span class="lvl" aria-hidden="true"><i></i><i></i><i></i></span></span>`
    : s === "processing" ? '<span class="spinner" aria-hidden="true"></span>'
    : s === "error" ? icon("alert")
    : s === "speaking" ? icon("volume-2") : '<span class="pulse-dot" aria-hidden="true"></span>';
  $$("[data-state-label]").forEach(n => { n.dataset.state = s; n.innerHTML = lead + `<span>${esc(label)}</span>`; });
  $$("[data-act=stop-speaking]").forEach(b => b.hidden = s !== "speaking");
  $$("[data-act=stop-listening]").forEach(b => b.hidden = s !== "listening");
  $$("[data-act=error-action]").forEach(b => {
    b.hidden = s !== "error" || !errorAction;
    if (errorAction) b.querySelector("span").textContent = errorAction.label;
  });
  const mic = $("#micBtn");
  const recording = state.micBusyPtt;
  mic.setAttribute("aria-pressed", String(!!recording));
  mic.setAttribute("aria-label", recording ? "Stop listening" : "Talk to Jarvis");
  mic.dataset.tip = recording ? "Stop listening (Esc)" : "Talk (Ctrl+Space)";
  $(".composer").classList.toggle("recording", !!recording);
  updateSend();
}
on("assistant", renderState);

/* Your words appear live while you talk (the browser's own speech recogniser, PC only; Whisper still
   makes the real transcript). Only for push-to-talk, not while hands-free waits for "Jarvis". */
let liveRec = null;
function liveCaptions(on) {
  if (!on) { try { liveRec && liveRec.abort(); } catch (_) {} liveRec = null; return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (liveRec || !SR || IS_REMOTE || localStorage.getItem("jarvis-live-captions") === "off") return;
  const rec = new SR();
  rec.interimResults = true; rec.continuous = true; rec.lang = navigator.language || "en-US";
  rec.onresult = e => {
    let t = "";
    for (const r of e.results) t += r[0].transcript;
    if (state.assistant === "listening" && t.trim()) setCaption(t.trim(), "you");
  };
  rec.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") localStorage.setItem("jarvis-live-captions", "off"); };
  rec.onend = () => { if (liveRec === rec) liveRec = null; };
  try { rec.start(); liveRec = rec; } catch (_) {}
}
on("assistant", s => {
  if (s === "listening" && (!state.handsFree || state.micBusyPtt)) liveCaptions(true);
  else if (s !== "listening") { liveCaptions(false); if (s === "idle" && !state.busy && !state.speaking) setCaption(""); }
});

// Live microphone bars in the status chip, driven by the real level.
(function micBars() {
  if (state.assistant === "listening") {
    const l = Math.min(1, state.level);
    $$(".mic-live .lvl i").forEach((b, i) => b.style.transform = `scaleY(${(0.25 + Math.min(1, l * (1.4 - i * 0.25)) * 0.75).toFixed(2)})`);
    $("#micBtn").style.setProperty("--mic", l.toFixed(3));
  } else if ($("#micBtn").style.getPropertyValue("--mic") !== "0") {
    $("#micBtn").style.setProperty("--mic", "0");
  }
  requestAnimationFrame(micBars);
})();

/* =========================================================================
   The orb: CSS-drawn layers. JavaScript only picks the mode and eases the
   animation speed and the real audio level, so changes never jump.
   ========================================================================= */
const ORB_SPEED = { idle: 1, primed: 1.7, compute: 3.4, listening: 1.6, speaking: 1.8, error: 0.35 };
let streaming = false;
function orbMode() {
  if (state.assistant === "speaking") return "speaking";
  if (streaming || state.assistant === "processing") return "compute";
  if (state.assistant === "listening") return "listening";
  if (state.assistant === "speaking") return "speaking";
  if (state.assistant === "error") return "error";
  return $("#composerInput").value.trim() ? "primed" : "idle";
}
let orbRate = 1, orbLvl = 0, orbAnims = [];
on("orb-moved", () => { orbAnims = []; orbRate = 1; });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ORB = $("#orb");
(function orbLoop() {
  const orb = ORB;
  const mode = orbMode();
  if (orb.dataset.mode !== mode) orb.dataset.mode = mode;
  if (!orbAnims.length) orbAnims = orb.getAnimations({ subtree: true });
  const target = reducedMotion.matches ? 0.15 : ORB_SPEED[mode];
  if (Math.abs(target - orbRate) > 0.005) {
    orbRate += (target - orbRate) * 0.05;
    orbAnims.forEach(a => { try { a.updatePlaybackRate ? a.updatePlaybackRate(orbRate) : (a.playbackRate = orbRate); } catch (_) {} });
  }
  const lvl = mode === "listening" || mode === "speaking" ? Math.min(1, state.level) : 0;
  orbLvl += (lvl - orbLvl) * (lvl > orbLvl ? 0.35 : 0.12);
  orb.style.setProperty("--lvl", orbLvl < 0.002 ? "0" : orbLvl.toFixed(3));
  requestAnimationFrame(orbLoop);
})();

/* =========================================================================
   Stage vs answer
   ========================================================================= */
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
export function renderGreeting() {
  $("#greeting").textContent = greeting();
}
function showHero() {
  endThinking();
  $("#composerInput").focus();
}
// While Jarvis works, the question shows under the orb.
const IDLE_LINE = "Ask anything, or click the orb to talk.";
function showThinking(text) {
  $("#view-assistant").classList.add("thinking");
  $("#contextLine").className = "context-line";
  $("#contextLine").innerHTML = `<span class="asking">${esc(text)}</span>`;
}
function endThinking() {
  $("#view-assistant").classList.remove("thinking");
  setCaption("");
}
/* Live captions under the orb: what Jarvis is doing, the sentence it is saying, or your words as you speak. */
export function setCaption(text, kind = "") {
  const lines = [$("#contextLine"), ...(window.__miniCaption ? [window.__miniCaption] : [])];
  lines.forEach(el => {
    if (!el) return;
    if (!text) { el.className = "context-line"; el.textContent = el.id === "contextLine" ? IDLE_LINE : ""; return; }
    el.className = "context-line caption " + kind;
    el.textContent = text;
  });
}
// Make sure the History panel is visible when something new lands in it.
function revealHistory(force = false) {
  // The panel stays closed while you talk; it only opens itself when something needs a click (Confirm buttons).
  if (!force) return;
  if (isDrawerMode()) { if (!$("#conversation").classList.contains("open")) openPanel(); }
  else if ($("#appBody").classList.contains("panel-hidden")) setPanelHidden(false);
}

// Reveal a real reply progressively (the full text is already here). Long replies finish within ~0.9 s.
async function typeOut(nodes, text) {
  streaming = true;
  const steps = Math.min(text.length, 110);
  const per = Math.max(1, Math.ceil(text.length / steps));
  const delay = Math.max(6, Math.min(16, 900 / steps));
  for (let i = 0; i < text.length; i += per) {
    const part = text.slice(0, i + per);
    nodes.forEach(n => { n.textContent = part; });
    const t = nodes[0].closest(".thread"); if (t) t.scrollTop = t.scrollHeight;
    if (reducedMotion.matches) break;
    await wait(delay);
  }
  nodes.forEach(n => { n.textContent = text; });
  streaming = false;
}

function formatAnswer(text) {
  // Light formatting for model output: bold, inline code. Everything else stays plain, escaped text.
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, '<code class="mono">$1</code>')
    .replace(/^#{1,4}\s+/gm, "");
}

const money = (v, cur) => (cur === "USD" ? "$" : cur ? cur + " " : "") + Number(v).toFixed(2);
const pct = v => (v >= 0 ? "+" : "−") + Math.abs(v ?? 0).toFixed(2) + "%";
export function quoteRows(rows) {
  return rows.map(q => {
    if (q.error || q.price == null) {
      return `<tr><td class="sym">${esc(q.ticker || "?")}</td><td colspan="4" class="muted">No data. ${esc(q.error || "")}</td></tr>`;
    }
    const up = (q.change_percent ?? 0) >= 0;
    const sym = encodeURIComponent(String(q.ticker).replace("^", ""));
    return `<tr>
      <td><span class="sym">${esc(q.ticker)}</span> <span class="muted">${esc(q.exchange || "")}</span></td>
      <td class="spark-cell">${q.spark ? sparkline(q.spark, up, 96, 26) : ""}</td>
      <td class="r num price">${money(q.price, q.currency)}</td>
      <td class="r">${q.change_percent != null ? `<span class="chg ${up ? "up" : "down"}">${icon(up ? "trending-up" : "trending-down")}<span>${pct(q.change_percent)}</span></span>` : '<span class="muted">n/a</span>'}</td>
      <td class="r"><a class="icon-btn tooltip" href="https://www.tradingview.com/symbols/${sym}/" target="_blank" rel="noopener" aria-label="Open ${esc(q.ticker)} chart on TradingView" data-tip="Open chart">${icon("external")}</a></td>
    </tr>`;
  }).join("");
}
export const quotesTable = rows => `<table class="quotes"><thead><tr><th scope="col">Symbol</th><th scope="col"><span class="sr-only">Today's trend</span></th><th scope="col" class="r">Price</th><th scope="col" class="r">Today</th><th scope="col"><span class="sr-only">Chart</span></th></tr></thead><tbody>${quoteRows(rows)}</tbody></table>`;

// Extras under a reply in History: quotes, sources, power confirmation and a small meta line.
// One confirmation card. Every copy of the same request (History + under the orb) changes together.
const KIND_ICON = { power: "power", email: "mail", delete: "trash", write: "file", close: "x", command: "keyboard" };
function confirmCard(c) {
  const d = document.createElement("div");
  d.dataset.cid = c.id;
  d.className = "confirm-box" + (c.kind === "power" || c.kind === "delete" || c.kind === "command" ? " risky" : "");
  d.innerHTML = `<div class="cb-title">${icon(KIND_ICON[c.kind] || "alert")}<strong>${esc(c.title)}</strong></div>
    ${c.detail ? `<div class="cb-detail">${esc(c.detail)}</div>` : ""}
    <span class="row"><button class="btn sm ghost">Cancel</button><button class="btn sm ${c.kind === "email" ? "primary" : "danger"}">${esc(c.button || "Confirm")}</button></span>`;
  const [no, yes] = d.querySelectorAll("button");
  yes.onclick = async () => {
    copies(c).forEach(x => x.querySelectorAll("button").forEach(b => (b.disabled = true)));
    yes.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    try {
      const m = await api("/api/confirm/" + c.id, {});
      settleCard(c, m.ok === false ? "failed" : "done", m.ok === false ? "alert" : "check", m.message);
      if (m.ok !== false && c.kind !== "command") speak(m.message.split("\n")[0]);
      emit("action-confirmed", c);
    } catch (e) { settleCard(c, "failed", "alert", e.message); }
  };
  no.onclick = async () => {
    try { await api("/api/cancel/" + c.id, {}); } catch (_) {}
    settleCard(c, "done", "x", "Cancelled. Nothing was changed.");
  };
  return d;
}
function copies(c) { return $$(`.confirm-box[data-cid="${CSS.escape(String(c.id))}"]`); }
function settleCard(c, cls, ic, msg) {
  copies(c).forEach(d => {
    d.classList.add(cls);
    d.innerHTML = `<div class="cb-title">${icon(ic)}<strong>${esc(c.title)}</strong></div><div class="cb-detail">${esc(msg || "")}</div>`;
    const live = d.closest("#liveConfirms");
    if (live) setTimeout(() => { d.remove(); if (!live.children.length) live.hidden = true; }, 4000);
  });
}

function renderExtras(r, msgEl) {
  const box = document.createElement("div");
  box.className = "msg-extras";

  const seen = new Set();
  const quotes = (r.actions || []).filter(a => a.tool === "stock_price" && a.result && !seen.has(a.result.ticker) && seen.add(a.result.ticker)).map(a => a.result);
  if (quotes.length) {
    box.insertAdjacentHTML("beforeend", `<div class="msg-quotes">${quotes.map(q => {
      if (q.error || q.price == null) return `<div class="w-tick"><span class="w-sym">${esc(q.ticker || "?")}</span><span class="w-note">No data</span></div>`;
      const up = (q.change_percent ?? 0) >= 0, sym = encodeURIComponent(String(q.ticker).replace("^", ""));
      return `<a class="w-tick" href="https://www.tradingview.com/symbols/${sym}/" target="_blank" rel="noopener" title="Open ${esc(q.ticker)} chart on TradingView">
        <span class="w-sym">${esc(q.ticker)}</span><span class="w-spark">${q.spark ? sparkline(q.spark, up, 64, 22) : ""}</span>
        <span class="w-price num">${money(q.price, q.currency)}</span>
        <span class="w-chg num ${up ? "up" : "down"}">${icon(up ? "trending-up" : "trending-down")}${pct(q.change_percent)}</span></a>`;
    }).join("")}<p class="data-note">Yahoo Finance, delayed up to 15 minutes.</p></div>`);
  }

  try { cardsFor(r).forEach(n => box.appendChild(n)); } catch (e) { console.error(e); }

  const pics = [...(r.charts || []).map(c => ({ chart: c, title: `${c.ticker} · ${c.period}` })), ...(r.images || [])];
  if (pics.length) {
    const g = document.createElement("div");
    g.className = "msg-pics";
    g.innerHTML = pics.slice(0, 6).map((im, k) => `<button class="msg-pic${im.chart ? " is-chart" : ""}" data-k="${k}" aria-label="${im.chart ? "Show chart " + esc(im.title) : `Show picture ${k + 1}`}">${im.chart ? chartThumb(im.chart) : `<img src="${esc(im.thumb || im.src)}" alt="" loading="lazy">`}</button>`).join("");
    const title = msgEl.dataset.asked || "";
    $$(".msg-pic", g).forEach(b => {
      b.onclick = () => { showViewer(pics, title); viewerGo(+b.dataset.k); };
      const im = b.querySelector("img"); if (im) im.onerror = () => b.remove();
    });
    box.appendChild(g);
  }

  const src = r.sources || [];
  if (src.length) box.insertAdjacentHTML("beforeend", `<div class="sources">${src.map(s => `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.url)}">${icon("link")}<span>${esc(s.title || s.url)}</span></a>`).join("")}</div>`);

  // Anything that sends, deletes, replaces, closes or changes the PC waits for a click here
  // ...shown both in History and under the orb on Home; either one works and both update
  (r.confirm || []).forEach(c => {
    box.appendChild(confirmCard(c));
    const live = $("#liveConfirms");
    if (live && !live.querySelector(`[data-cid="${CSS.escape(String(c.id))}"]`)) {
      live.appendChild(confirmCard(c));
      live.hidden = false;
    }
  });

  const used = new Map();
  (r.actions || []).forEach(a => { const n = TOOL_NAMES[a.tool] || a.tool; used.set(n, used.get(n) || !!(a.result && a.result.error)); });
  const bits = [];
  if (used.size) bits.push(`<span>${icon("wrench")} ${[...used].map(([n, bad]) => bad ? `<span class="bad">${esc(n)} failed</span>` : esc(n)).join(", ")}</span>`);
  if (state.sttSeconds !== null) bits.push(`<span>Heard in ${state.sttSeconds}s</span>`);
  if (r.think_s != null) bits.push(`<span>Answered in ${r.think_s}s${r.model ? ` · ${esc(r.model)}` : ""}</span>`);
  if (r.note) bits.push(`<span class="warn">${esc(r.note)}</span>`);
  state.sttSeconds = null;
  if (bits.length) box.insertAdjacentHTML("beforeend", `<div class="answer-meta">${bits.join("")}</div>`);
  if (box.childNodes.length) msgEl.appendChild(box);
  const t = $("#thread"); t.scrollTop = t.scrollHeight;
}

/* =========================================================================
   Picture viewer: web pictures and generated images, shown big on Home
   ========================================================================= */
const viewer = { items: [], i: 0, title: "" };
export function showViewer(items, title = "") {
  if (!items || !items.length) return;
  viewer.items = items; viewer.i = 0; viewer.title = title;
  emit("navigate", "assistant");
  $("#view-assistant").classList.add("viewing");
  $("#viewer").hidden = false;
  $("#viewerTitle").textContent = title;
  const strip = $("#viewerStrip");
  strip.hidden = items.length < 2;
  strip.innerHTML = items.map((im, k) => `<button class="viewer-thumb${im.chart ? " is-chart" : ""}" role="option" data-k="${k}" aria-label="${im.chart ? esc(im.title) : `Picture ${k + 1}`}">${im.chart ? chartThumb(im.chart) : `<img src="${esc(im.thumb || im.src)}" alt="" loading="lazy">`}</button>`).join("");
  $$(".viewer-thumb", strip).forEach(b => {
    b.onclick = () => viewerGo(+b.dataset.k);
    const im = b.querySelector("img"); if (im) im.onerror = () => b.remove();
  });
  viewerGo(0);
}
function viewerGo(k) {
  const n = viewer.items.length;
  viewer.i = (k + n) % n;
  const im = viewer.items[viewer.i];
  const img = $("#viewerImg"), chartBox = $("#viewerChart");
  $("#viewerFail").hidden = true;
  $$(".viewer-thumb").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.k === viewer.i)));
  $("#viewerCount").textContent = n > 1 ? `${viewer.i + 1} / ${n}` : "";
  $("#viewerPrev").hidden = $("#viewerNext").hidden = n < 2;
  if (im.chart) {                                   // a live price chart instead of a picture
    img.hidden = true; img.removeAttribute("src");
    chartBox.hidden = false;
    renderChart(chartBox, im.chart);
    $("#viewerTitle").textContent = im.title || viewer.title;
    $("#viewerCaption").textContent = im.chart.name || "";
    $("#viewerOpen").href = `https://www.tradingview.com/symbols/${encodeURIComponent(String(im.chart.ticker).replace("^", ""))}/`;
    $("#viewerSource").hidden = true;
    return;
  }
  chartBox.hidden = true;
  $("#viewerTitle").textContent = viewer.title;
  img.hidden = false;
  img.classList.add("loading");
  img.onload = () => img.classList.remove("loading");
  img.onerror = () => {
    img.hidden = true;
    if (n > 1 && !im.failed) { im.failed = true; const next = viewer.items.findIndex(x => !x.failed); if (next >= 0) { viewerGo(next); return; } }
    $("#viewerFail").hidden = false;
  };
  img.src = im.src;
  img.alt = im.title || viewer.title;
  $("#viewerCaption").textContent = im.generated ? "Made by Jarvis · saved to Pictures\\Jarvis\\Generated" : (im.title || "");
  $("#viewerCount").textContent = n > 1 ? `${viewer.i + 1} / ${n}` : "";
  $("#viewerOpen").href = im.src;
  $("#viewerSource").hidden = !im.page;
  if (im.page) $("#viewerSource").href = im.page;
  $("#viewerPrev").hidden = $("#viewerNext").hidden = n < 2;
  $$(".viewer-thumb").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.k === viewer.i)));
  const cur = $(`.viewer-thumb[data-k="${viewer.i}"]`);
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}
export function closeViewer() {
  $("#viewer").hidden = true;
  $("#view-assistant").classList.remove("viewing");
  $("#viewerImg").removeAttribute("src");
}
function initViewer() {
  $("#viewerClose").onclick = closeViewer;
  $("#viewerPrev").onclick = () => viewerGo(viewer.i - 1);
  $("#viewerNext").onclick = () => viewerGo(viewer.i + 1);
  document.addEventListener("keydown", e => {
    if ($("#viewer").hidden || e.target.closest("input, textarea")) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowRight") viewerGo(viewer.i + 1);
    else if (e.key === "ArrowLeft") viewerGo(viewer.i - 1);
  });
  let x0 = null;     // swipe on phones
  $("#viewer .viewer-main").addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  $("#viewer .viewer-main").addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) viewerGo(viewer.i + (dx < 0 ? 1 : -1));
  });
}

/* =========================================================================
   Asking: the reply goes to History, the orb stays centre stage
   ========================================================================= */
export async function ask(text, { fromVoice = false } = {}) {
  text = (text || "").trim();
  if (!text || state.busy) return;
  stopSpeaking();
  lastAsked = text; errorAction = null;
  emit("asking", text);
  state.busy = true;
  setAssistant("processing");
  showThinking(text);
  addMessage("user", text);
  revealHistory();

  // The answer streams in sentence by sentence; each sentence is spoken (and captioned) as soon as it arrives.
  let msgBody = null, typing = Promise.resolve();
  const ensureMsg = () => {
    if (msgBody) return;
    endThinking();
    sfx("reply");
    if (state.assistant === "processing") setAssistant("idle");
    msgBody = addMessage("assistant", "");
    msgBody.closest(".msg").dataset.asked = text;
  };
  const q = speechQueue({
    onSentence: sentence => {
      ensureMsg();
      setCaption(sentence, "jarvis");
      const span = document.createElement("span");
      msgBody.appendChild(span);
      typing = typing.then(() => typeOut([span], sentence + " "));
    },
  });

  let r = null;
  try {
    r = await streamChat(text, ev => {
      if (ev.t === "status" && !msgBody) setCaption(ev.text + "…", "status");
      else if (ev.t === "say") q.push(ev.text, ev.id);
    });
  } catch (e) {
    q.cancel();
    state.busy = false;
    endThinking();
    fail(e instanceof ApiError ? e.message + " Open Jarvis again from the desktop icon." : String(e), { label: "Try again", run: () => ask(lastAsked) });
    return;
  }
  state.busy = false;
  state.lastReply = Date.now();

  if (r.brain === "none") {
    q.cancel();
    endThinking();
    addMessage("error", r.reply);
    emit("provider-failed", r.reply);
    fail("The AI provider didn't answer", { label: "Try again", run: () => ask(lastAsked) }, false);
    return;
  }
  emit("provider-ok", r.model);
  const visuals = [...(r.charts || []).map(c => ({ chart: c, title: `${c.ticker} · ${c.period}` })), ...(r.images || [])];
  if (visuals.length) showViewer(visuals, text);
  if (r.fallback) q.push(r.reply, r.tts_id);        // old server without streaming
  q.close();
  ensureMsg();
  const msgEl = msgBody.closest(".msg");
  renderExtras(r, msgEl);
  emit("chat-done", r);
  if (!fromVoice) $("#composerInput").focus();
  await q.done;
  await typing;
  msgBody.innerHTML = formatAnswer(r.reply || "");
  if (!state.busy && state.assistant !== "listening") setCaption("");
}

// POST /api/chat/stream and hand each event to onEvent; resolves with the final "done" event.
async function streamChat(text, onEvent) {
  let res;
  try {
    res = await fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: state.spoken }) });
  } catch (_) { throw new ApiError("Jarvis's server isn't reachable."); }
  if (res.status === 401) { location.href = "/login"; throw new ApiError("Please log in again."); }
  if (res.status === 404 || !res.body) {                 // older server: one-shot reply
    const r = await api("/api/chat", { text, voice: state.spoken });
    return { ...r, fallback: true };
  }
  if (!res.ok) throw new ApiError(`Jarvis's server had a problem (${res.status}).`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      if (ev.t === "done") done = ev; else onEvent(ev);
    }
    if (end) break;
  }
  if (!done) throw new ApiError("The answer was cut off. Please try again.");
  return done;
}

function fail(message, action, showText = true) {
  errorAction = action || null;
  sfx("error");
  if (showText) { addMessage("error", message); revealHistory(); }
  setAssistant("error", message);
}

/* =========================================================================
   Voice input
   ========================================================================= */
export async function talk() {
  if (state.micBusyPtt) { stopListening(); return; }
  if (state.busy) return;
  stopSpeaking();
  if (state.handsFree && state.micBusy) { await stopListening(); await wait(150); }
  try { audioCtx(); } catch (_) {}
  errorAction = null;
  state.micBusyPtt = true;
  sfx("start");
  setAssistant("listening");
  const r = await listen(true);
  state.micBusyPtt = false;
  sfx("end");
  if (r.busy) { setAssistant("idle"); return; }
  if (r.error) {
    fail(`Microphone problem: ${r.error}.`, { label: "Microphone settings", run: () => emit("open-settings", "voice") });
    return;
  }
  if (r.silent || !r.text) {
    setAssistant("idle");
    toast(r.silent ? "Didn't hear anything. Check the microphone in Settings → Voice." : "Couldn't make that out. Try again a little closer to the mic.");
    return;
  }
  heard(r.text, true);
}

function heard(text, pushToTalk) {
  if (!pushToTalk) {
    const low = text.toLowerCase(), wake = WAKE_WORDS.find(w => low.includes(w));
    if (wake) {
      text = text.slice(low.indexOf(wake) + wake.length).replace(/^[\s,.!?]+/, "");
      if (!text) { sfx("start"); speak("Yes?"); return; }
    } else if (Date.now() - state.lastReply > FOLLOW_UP_MS) {
      return;      // not addressed to Jarvis
    }
  }
  ask(text, { fromVoice: true });
}

async function handsFreeLoop() {
  while (state.handsFree) {
    if (state.busy || state.speaking || state.micBusy || state.micBusyPtt) { await wait(250); continue; }
    if (state.assistant !== "error") setAssistant("listening");
    const r = await listen(false);
    if (!state.handsFree) break;
    if (r.error) { fail(`Microphone problem: ${r.error}.`, { label: "Microphone settings", run: () => emit("open-settings", "voice") }); state.handsFree = false; syncToggles(); break; }
    if (r.text) heard(r.text, false);
    else if (!state.busy && !state.speaking) settle();
  }
  if (!state.busy && !state.speaking && state.assistant === "listening") setAssistant("idle");
}

function syncToggles() {
  const hf = $("#handsFreeBtn"), sp = $("#spokenBtn");
  hf.setAttribute("aria-pressed", String(state.handsFree));
  sp.setAttribute("aria-pressed", String(state.spoken));
  sp.innerHTML = icon(state.spoken ? "volume-2" : "volume-x") + `<span>${state.spoken ? "Spoken replies on" : "Spoken replies off"}</span>`;
  hf.innerHTML = icon("ear") + `<span>${state.handsFree ? "Hands-free on" : "Hands-free off"}</span>`;
}

/* =========================================================================
   Conversation panel
   ========================================================================= */
const NAMES = { user: "You", assistant: "Jarvis", alert: "Reminder", error: "Jarvis" , notice: "Jarvis"};
export function addMessage(kind, text, time) {
  const thread = $("#thread");
  $(".thread-empty", thread)?.remove();
  const m = document.createElement("article");
  m.className = "msg " + kind;
  m.innerHTML = `<div class="msg-head">${kind === "user" ? "" : '<span class="msg-mark" aria-hidden="true"></span>'}<strong>${NAMES[kind]}</strong><time>${esc(time || hhmm(new Date()))}</time></div><div class="msg-body"></div>`;
  $(".msg-body", m).textContent = text;
  thread.appendChild(m);
  thread.scrollTop = thread.scrollHeight;
  emit("thread-count", $$(".msg", thread).length);
  return $(".msg-body", m);
}
function threadEmpty() {
  $("#thread").innerHTML = `<div class="thread-empty">
    <span class="thread-mark" aria-hidden="true"></span>
    <h3>No messages yet</h3>
    <p>Type below, or click the core to talk. Messages are kept on this PC.</p></div>`;
  emit("thread-count", 0);
}
async function loadHistory() {
  try {
    const items = await api("/api/history");
    if (!items || !items.length) { threadEmpty(); return; }
    $("#thread").innerHTML = "";
    items.forEach(m => addMessage(m.role === "user" ? "user" : "assistant", m.text, m.t));
  } catch (_) {
    $("#thread").innerHTML = `<div class="error-state"><h3>Couldn't load the conversation</h3><p>The server didn't respond. It will load next time Jarvis opens.</p></div>`;
  }
}
async function clearConversation() {
  const ok = await confirmDialog({
    title: "Clear the conversation?",
    body: "This removes all messages from Jarvis's short-term history on this PC. Saved memories and tasks are kept. This can't be undone.",
    confirm: "Clear conversation", danger: true,
  });
  if (!ok) return;
  try { await api("/api/clear", {}); threadEmpty(); showHero(); toast("Conversation cleared"); }
  catch (e) { toast(e.message); }
}

/* Conversation panel: a drawer on medium windows, a collapsible column on wide ones */
const isDrawerMode = () => matchMedia("(max-width: 1240px)").matches;
function setPanelHidden(hidden) {
  $("#appBody").classList.toggle("panel-hidden", hidden);
  try { localStorage.setItem("jarvis.panel2", hidden ? "hidden" : "shown"); } catch (_) {}
  syncPanelButton();
}
function syncPanelButton() {
  const open = isDrawerMode() ? $("#conversation").classList.contains("open") : !$("#appBody").classList.contains("panel-hidden");
  const b = $("#panelToggle");
  b.setAttribute("aria-expanded", String(open));
  b.setAttribute("aria-label", open ? "Hide conversation" : "Show conversation");
  b.dataset.tip = open ? "Hide conversation" : "Show conversation";
  b.setAttribute("aria-pressed", String(open));
}
export function openPanel() {
  if (!isDrawerMode()) { setPanelHidden(false); $("#thread").focus(); return; }
  $("#conversation").classList.add("open"); $("#scrim").classList.add("open");
  $("#thread").scrollTop = $("#thread").scrollHeight;
  syncPanelButton();
}
export function closePanel() {
  $("#conversation").classList.remove("open"); $("#scrim").classList.remove("open");
  syncPanelButton();
}
export function togglePanel() {
  if (isDrawerMode()) { $("#conversation").classList.contains("open") ? closePanel() : openPanel(); }
  else setPanelHidden(!$("#appBody").classList.contains("panel-hidden"));
}
const isDrawer = () => matchMedia("(max-width: 1240px)").matches;

/* =========================================================================
   Reminders firing (server events)
   ========================================================================= */
let eventCursor = -1;
async function pollEvents() {
  try {
    const list = await api("/api/events?since=" + Math.max(0, eventCursor));
    if (eventCursor < 0) {         // baseline: don't replay old ones (but keep a briefing that's being made right now)
      eventCursor = list.reduce((m, e) => Math.max(m, e.id), 0);
      return;
    }
    for (const e of list) {
      eventCursor = Math.max(eventCursor, e.id);
      if (e.type === "announce") { announcements.push(e); continue; }
      sfx("alert");
      const ack = () => api(`/api/events/${e.id}/ack`, {}).catch(() => {});
      // Voice, message and the Windows pop-up arrive together: the pop-up waits for the voice to start
      speak("Reminder. " + e.text, e.tts_id, () => { ack(); addMessage("alert", e.text, e.time); revealHistory(); });
      try { if (Notification.permission === "granted") new Notification("Jarvis", { body: e.text }); } catch (_) {}
    }
    if (list.length) emit("reminders-changed");
  } catch (_) { /* server offline; header status shows it */ }
  sayAnnouncements();
}

/* Things Jarvis says on its own (briefing, important email, market open) wait politely until
   you're not talking to it, then speak with captions and land in History. */
const announcements = [];
let announcing = false;
async function sayAnnouncements() {
  if (announcing || !announcements.length) return;
  if (state.busy || state.speaking || speechBusy() || state.assistant === "listening" || state.micBusyPtt) return;
  announcing = true;
  const e = announcements.shift();
  const ack = () => api(`/api/events/${e.id}/ack`, {}).catch(() => {});
  const fresh = Date.now() / 1000 - (e.t || 0) < 100;          // voice jobs expire after 2 minutes
  if (e.kind !== "briefing") sfx("alert");
  const q = speechQueue({
    onFirst: () => { ack(); addMessage(e.kind === "briefing" ? "assistant" : "notice", e.text, e.time); revealHistory(); },
    onSentence: t => setCaption(t, "jarvis"),
  });
  let id = fresh ? e.tts_id : null;
  if (!id && state.spoken) { try { id = (await api("/api/tts/start", { text: e.speech || e.text }))?.id; } catch (_) {} }
  q.push(e.speech || e.text, id);
  q.close();
  try { if (e.kind !== "briefing" && Notification.permission === "granted") new Notification("Jarvis", { body: e.text }); } catch (_) {}
  await q.done;
  if (!state.busy && state.assistant !== "listening") setCaption("");
  announcing = false;
}

/* =========================================================================
   Composer
   ========================================================================= */
function updateSend() {
  const input = $("#composerInput"), send = $("#sendBtn");
  const empty = !input.value.trim();
  send.disabled = empty || state.busy;
  send.setAttribute("aria-label", state.busy ? "Jarvis is answering" : "Send message");
  send.classList.toggle("busy", state.busy);
  const want = state.busy ? "busy" : "idle";
  if (send.dataset.mode !== want) { send.dataset.mode = want; send.innerHTML = state.busy ? '<span class="spinner" aria-hidden="true"></span>' : icon("arrow-up"); }
  $("#micBtn").disabled = state.busy && !state.micBusyPtt;
}
function autosize() {
  const t = $("#composerInput");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 160) + "px";
}
function submit() {
  const t = $("#composerInput");
  const v = t.value;
  if (!v.trim() || state.busy) return;
  t.value = ""; autosize(); updateSend();
  ask(v);
}

/* =========================================================================
   Wiring
   ========================================================================= */
export function initAssistant() {
  initViewer();
  on("ask", text => ask(text));
  renderGreeting();
  setInterval(renderGreeting, 60000);

  const input = $("#composerInput");
  input.addEventListener("input", () => { autosize(); updateSend(); });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  $("#sendBtn").onclick = submit;
  $("#micBtn").onclick = talk;
  $$("#orb").forEach(v => v.onclick = () => { if (state.assistant === "speaking") stopSpeaking(); else if (state.assistant === "listening" && state.handsFree && !state.micBusyPtt) { state.handsFree = false; syncToggles(); stopListening(); } else talk(); });
  $$("[data-act=stop-speaking]").forEach(b => b.onclick = stopSpeaking);
  $$("[data-act=stop-listening]").forEach(b => b.onclick = () => { stopListening(); if (state.handsFree) { state.handsFree = false; syncToggles(); } });
  $$("[data-act=error-action]").forEach(b => b.onclick = () => { const a = errorAction; errorAction = null; setAssistant("idle"); a && a.run(); });

  $("#spokenBtn").onclick = () => {
    state.spoken = !state.spoken;
    try { localStorage.setItem("jarvis.spoken", state.spoken ? "1" : "0"); } catch (_) {}
    if (!state.spoken) stopSpeaking();
    syncToggles();
  };
  $("#handsFreeBtn").onclick = () => {
    state.handsFree = !state.handsFree;
    syncToggles();
    if (state.handsFree) { sfx("start"); handsFreeLoop(); }
    else { if (state.micBusy && !state.micBusyPtt) stopListening(); settle(); }
  };
  try { state.spoken = localStorage.getItem("jarvis.spoken") !== "0"; } catch (_) {}
  syncToggles();

  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ask]");
    if (b) { if (isDrawer()) closePanel(); ask(b.dataset.ask); }
  });

  $("#clearThread").onclick = clearConversation;
  $("#panelToggle").onclick = togglePanel;
  $("#closePanel").onclick = () => isDrawerMode() ? closePanel() : setPanelHidden(true);
  try { if (localStorage.getItem("jarvis.panel2") !== "shown") $("#appBody").classList.add("panel-hidden"); } catch (_) { $("#appBody").classList.add("panel-hidden"); }
  matchMedia("(max-width: 1240px)").addEventListener("change", () => { closePanel(); syncPanelButton(); });
  syncPanelButton();
  $("#scrim").onclick = closePanel;

  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.code === "Space") { e.preventDefault(); emit("navigate", "assistant"); talk(); return; }
    if (e.key === "Escape") {
      if (document.querySelector("dialog[open]")) return;
      if (state.speaking) stopSpeaking();
      if (state.micBusy) stopListening();
      if (state.handsFree) { state.handsFree = false; syncToggles(); }
      closePanel();
      return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (e.key === "/" && !typing && !e.ctrlKey) { e.preventDefault(); emit("navigate", "assistant"); $("#composerInput").focus(); }
  });

  loadHistory();
  pollEvents();
  setInterval(pollEvents, 1000);
  renderState({ state: "idle" });
  updateSend();
}
