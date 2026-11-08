// Home screen widgets: choose which ones show, expand them, and use them (tasks, inbox, last conversation, watchlist).
import { $, $$, api, esc, hhmm, state, on, emit, relTime, dayLabel, toast } from "./core.js";
import { icon } from "./icons.js";

const ALL = ["today", "weather", "tasks", "markets", "inbox", "history"];
const DEFAULT_ON = { today: true, weather: true, tasks: true, markets: true, inbox: true, history: false };
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch (_) { return { ...d }; } };
const saveKey = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

let shown = load("jarvis.widgets", DEFAULT_ON);
let expanded = load("jarvis.widgets.open", {});

/* ---------- which widgets show ---------- */
function applyShown() {
  ALL.forEach(name => { const w = $(`[data-widget="${name}"]`); if (w) w.hidden = !shown[name]; });
  $$(".w-col").forEach(col => col.classList.toggle("empty", ![...col.children].some(c => !c.hidden)));
  $$("[data-wtoggle]").forEach(cb => { cb.checked = !!shown[cb.dataset.wtoggle]; });
}
function initMenu() {
  const btn = $("#widgetsBtn"), menu = $("#widgetsMenu");
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); };
  menu.onclick = e => e.stopPropagation();
  document.addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  $$("[data-wtoggle]").forEach(cb => cb.onchange = () => {
    shown[cb.dataset.wtoggle] = cb.checked;
    saveKey("jarvis.widgets", shown);
    applyShown();
  });
}

/* ---------- expand / collapse ---------- */
function setExpanded(name, open) {
  const w = $(`[data-widget="${name}"]`);
  if (!w) return;
  expanded[name] = open;
  saveKey("jarvis.widgets.open", expanded);
  w.toggleAttribute("data-expanded", open);
  const b = $(".w-exp", w);
  if (b) b.setAttribute("aria-expanded", String(open));
}
function initExpand() {
  $$("[data-widget]").forEach(w => {
    const name = w.dataset.widget, b = $(".w-exp", w);
    if (expanded[name]) setExpanded(name, true);
    if (b) b.onclick = () => setExpanded(name, !w.hasAttribute("data-expanded"));
  });
  on("widget-toggle", name => setExpanded(name, !$(`[data-widget="${name}"]`).hasAttribute("data-expanded")));
}

/* ---------- tasks: tick off, quick add ---------- */
function renderTasks(list = state.reminders || []) {
  const ul = $("#wTasks"), live = $("#tasksLive");
  const soon = list.filter(r => new Date(r.due) - Date.now() < 3600e3).length;
  live.className = "live-dot " + (soon ? "ok pulse" : list.length ? "ok" : "idle");
  live.title = soon ? `${soon} due within an hour` : `${list.length} upcoming`;
  if (!list.length) { ul.innerHTML = `<li class="w-note">No tasks. Add one below.</li>`; return; }
  ul.innerHTML = list.slice(0, 8).map((r, i) => {
    const d = new Date(r.due);
    return `<li class="w-task${i >= 3 ? " w-extra" : ""}" data-id="${esc(r.id)}">
      <button class="w-check" type="button" aria-label="Done: ${esc(r.message)}">${icon("check")}</button>
      <span class="w-task-text"><span>${esc(r.message)}</span><small class="num">${dayLabel(d)} ${hhmm(d)} · ${relTime(d)}${r.repeat && r.repeat !== "none" ? " · " + esc(r.repeat) : ""}</small></span>
    </li>`;
  }).join("");
  $$(".w-check", ul).forEach(b => b.onclick = async () => {
    const li = b.closest("li");
    li.classList.add("done");
    try {
      await api(`/api/reminders/${li.dataset.id}/done`, {});
      { const rc = b.getBoundingClientRect(); emit("task-done", { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 }); }
      setTimeout(() => emit("reminders-changed"), 450);
    } catch (e) { li.classList.remove("done"); toast(e.message); }
  });
}
function initTasks() {
  on("reminders", renderTasks);
  $("#wTaskAdd").onsubmit = async e => {
    e.preventDefault();
    const inp = $("#wTaskInput"), err = $("#wTaskErr"), text = inp.value.trim();
    err.textContent = "";
    if (!text) return;
    inp.disabled = true;
    try {
      const r = await api("/api/reminders/quick", { text });
      if (r.error) { err.textContent = r.error; }
      else { inp.value = ""; toast(`Task added for ${r.fires_at}`); emit("reminders-changed"); }
    } catch (e2) { err.textContent = e2.message; }
    inp.disabled = false; inp.focus();
  };
}

/* ---------- inbox ---------- */
async function loadInboxWidget() {
  const box = $("#wInbox"), live = $("#inboxLive");
  let d;
  try { d = await api("/api/email"); } catch (_) { live.className = "live-dot warn"; box.innerHTML = `<span class="w-note">Inbox unavailable.</span>`; return; }
  if (d.error) {
    live.className = "live-dot idle";
    box.innerHTML = d.setup
      ? `<p class="w-note">Gmail isn't connected.</p><button class="btn xs" type="button" data-goto-settings="integrations">${icon("mail")}<span>Connect Gmail</span></button>`
      : `<span class="w-note">Couldn't check email right now.</span>`;
    return;
  }
  live.className = "live-dot " + (d.unread ? "ok pulse" : "ok");
  live.title = `Checked ${hhmm(new Date())}`;
  const mails = d.emails || [];
  box.innerHTML = `<button class="w-big w-hit" type="button" data-goto="inbox"><span class="num">${d.unread > 999 ? "999+" : d.unread}</span><small>unread</small></button>` +
    (mails.length ? `<ul class="w-list">${mails.slice(0, 4).map((m, i) => `<li class="w-mail${i >= 2 ? " w-extra" : ""}"><button type="button" data-goto="inbox"><b>${esc(m.from)}</b><span>${esc(m.subject)}</span><small class="num">${esc(m.when || "")}</small></button></li>`).join("")}</ul>` : "");
}

/* ---------- last conversation ---------- */
async function loadHistoryWidget() {
  const box = $("#wHist"), live = $("#histLive");
  let items = [];
  try { items = await api("/api/history") || []; } catch (_) {}
  const lastUser = [...items].reverse().find(m => m.role === "user");
  const lastJ = [...items].reverse().find(m => m.role === "assistant");
  live.className = "live-dot " + (items.length ? "ok" : "idle");
  if (!lastUser) { box.innerHTML = `<span class="w-note">No conversation yet.</span>`; return; }
  box.innerHTML = `<button class="w-conv w-hit" type="button" data-goto="conversation">
      <span class="w-q">${esc(lastUser.text)}</span>
      ${lastJ ? `<span class="w-a">${esc(lastJ.text)}</span>` : ""}
      <small>${esc(lastUser.t || "")} · ${items.length} messages · tap to continue</small></button>`;
}

/* ---------- watchlist: add / remove ---------- */
async function setWatchlist(list) {
  try { state.config = await api("/api/config", { watchlist: list.join(",") }); emit("watchlist-changed"); }
  catch (e) { toast(e.message); }
}
function initMarkets() {
  const form = $("#mktAdd"), inp = $("#mktAddInput");
  $("#mktAddBtn").onclick = () => { form.hidden = !form.hidden; if (!form.hidden) inp.focus(); };
  form.onsubmit = async e => {
    e.preventDefault();
    const t = inp.value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
    if (!t) return;
    const list = [...(state.config.watchlist || [])];
    if (list.includes(t)) { toast(`${t} is already on your watchlist`); return; }
    if (list.length >= 8) { toast("The watchlist holds up to 8 tickers. Remove one first."); return; }
    inp.value = ""; form.hidden = true;
    await setWatchlist([...list, t]);
  };
  on("watchlist-remove", t => setWatchlist((state.config.watchlist || []).filter(x => x !== t)));
}

// When a column is taller than the screen it scrolls, with a soft fade at the bottom.
function watchOverflow() {
  const check = () => $$(".w-col").forEach(c => {
    const scrolls = c.scrollHeight > c.clientHeight + 2;
    c.classList.toggle("scrolls", scrolls);
    c.classList.toggle("at-end", scrolls && c.scrollTop + c.clientHeight >= c.scrollHeight - 4);
  });
  $$(".w-col").forEach(c => c.addEventListener("scroll", check, { passive: true }));
  new ResizeObserver(check).observe($(".stage"));
  $$(".w-col .widget").forEach(w => new ResizeObserver(check).observe(w));
  check();
}

/* Narrow window or History panel open: all widgets line up in one scrollable strip above the orb,
   instead of two squeezed columns. Wide again: they go back to their sides. */
function stripLayout() {
  const stage = $(".stage"), left = $(".w-left"), right = $(".w-right");
  const apply = () => {
    const narrow = stage.clientWidth < 1060 && stage.clientWidth > 700;
    if (narrow === stage.classList.contains("strip")) return;
    stage.classList.toggle("strip", narrow);
    if (narrow) [...right.children].forEach(w => { w.dataset.home = "right"; left.appendChild(w); });
    else $$('[data-home="right"]', left).forEach(w => { delete w.dataset.home; right.appendChild(w); });
    applyShown();
  };
  new ResizeObserver(apply).observe(stage);
  apply();
}

/* ---------- "Jarvis was updated" bar ---------- */
let webSig = null, dismissed = false;
async function checkUpdate() {
  let v;
  try { v = await api("/api/version"); } catch (_) { return; }
  if (webSig === null) webSig = v.web_sig;
  const bar = $("#updateBar");
  if (dismissed || document.documentElement.classList.contains("is-remote")) return;
  if (v.app_update) {
    $("#updateText").textContent = `Jarvis ${v.app_update} is ready. Restart to update (takes about 20 seconds).`;
    $("#updateBtn").textContent = "Update now";
    $("#updateBtn").onclick = installUpdate;
    bar.hidden = false;
  } else if (v.server_updated) {
    $("#updateText").textContent = "Jarvis was updated. Restart to use the new version.";
    $("#updateBtn").textContent = "Restart now";
    $("#updateBtn").onclick = restartJarvis;
    bar.hidden = false;
  } else if (v.web_sig > webSig + 0.5) {
    $("#updateText").textContent = "Jarvis's screen was updated.";
    $("#updateBtn").textContent = "Reload";
    $("#updateBtn").onclick = () => location.reload();
    bar.hidden = false;
  }
}
// Settings > Help > Check for updates
export function initUpdateCheck() {
  const b = $("#updCheck"); if (!b) return;
  b.onclick = async () => {
    const out = $("#updOut"); b.disabled = true; out.className = "test-out"; out.textContent = "Checking…";
    try {
      const r = await api("/api/update/check", {});
      out.className = "test-out ok"; out.textContent = r.message || "";
      if (r.ready) checkUpdate();
    } catch (e) { out.className = "test-out bad"; out.textContent = e.message; }
    finally { b.disabled = false; }
  };
}
async function installUpdate() {
  const btn = $("#updateBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  $("#updateText").textContent = "Updating Jarvis… he'll be back in a moment.";
  try { const r = await api("/api/update/install", {}); if (r && r.error) { $("#updateText").textContent = r.error; btn.disabled = false; btn.textContent = "Try again"; return; } }
  catch (e) { if (e && e.message && !/isn't reachable/.test(e.message)) { $("#updateText").textContent = "Couldn't update: " + e.message; btn.disabled = false; btn.textContent = "Try again"; return; } }
}
async function restartJarvis() {
  const btn = $("#updateBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  $("#updateText").textContent = "Restarting Jarvis… (new packages may take a minute)";
  try {
    const r = await api("/api/restart", {});
    if (r && r.error) { $("#updateText").textContent = r.error + " Use Settings > General > Turn off, then Ctrl+Alt+J."; btn.disabled = false; btn.textContent = "Try again"; return; }
  } catch (e) {          // the server stopping mid-reply is expected; a real refusal is shown
    if (e && e.message && !/isn't reachable/.test(e.message)) {
      $("#updateText").textContent = "Couldn't restart: " + e.message; btn.disabled = false; btn.textContent = "Try again"; return;
    }
  }
  await new Promise(r => setTimeout(r, 2500));
  for (let i = 0; i < 120; i++) {                 // wait up to 2 minutes for the new Jarvis
    try { const r = await fetch("/api/ping", { cache: "no-store" }); if (r.ok) { location.reload(); return; } } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  $("#updateText").textContent = "Jarvis didn't come back. Open it with Ctrl+Alt+J.";
}

export function initWidgets() {
  stripLayout();
  watchOverflow();
  $("#updateClose").onclick = () => { dismissed = true; $("#updateBar").hidden = true; };
  checkUpdate(); setInterval(checkUpdate, 30000);
  applyShown();
  initMenu();
  initExpand();
  initTasks();
  initMarkets();
  if (state.reminders) renderTasks();
  loadInboxWidget(); setInterval(loadInboxWidget, 120000);
  loadHistoryWidget();
  on("chat-done", () => { loadHistoryWidget(); });
  on("config", () => loadInboxWidget());
}
