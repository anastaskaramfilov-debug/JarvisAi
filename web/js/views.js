// Tasks, Inbox and Market Watch views. Every list shows loading, empty and error states.
import { $, $$, api, esc, hhmm, state, on, emit, confirmDialog, toast, dayLabel, relTime, repeatLabel } from "./core.js";
import { icon } from "./icons.js";
import { sparkline } from "./core.js";

const loading = text => `<div class="loading-state"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`;
const errorBox = (title, body, retryId) => `<div class="error-state" role="alert"><h3>${esc(title)}</h3><p>${esc(body)}</p>${retryId ? `<button class="btn" id="${retryId}">${icon("refresh")}<span>Try again</span></button>` : ""}</div>`;

/* =========================================================================
   Tasks
   ========================================================================= */
function renderTasks(list) {
  const box = $("#tasksList");
  $("#tasksMeta").textContent = list.length ? `${list.length} upcoming` : "";
  if (!list.length) {
    box.innerHTML = `<div class="empty-state card glass"><h3>No upcoming tasks</h3><p>Add one on the right, or just tell Jarvis: "remind me at 18:00 to study".</p></div>`;
    return;
  }
  const groups = new Map();
  list.forEach(r => { const d = new Date(r.due), k = dayLabel(d); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
  box.innerHTML = [...groups].map(([day, rows]) => `<h2 class="section-title">${esc(day)}</h2><div class="card glass task-card">${rows.map(r => {
    const d = new Date(r.due), soon = d - Date.now() < 3600e3;
    const extra = [repeatLabel(r.repeat), r.action ? "Then: " + (r.action_input ? `${r.action.replace(/_/g, " ")} ${r.action_input}` : r.action.replace(/_/g, " ")) : ""].filter(Boolean).join(" · ");
    return `<div class="task-row${soon ? " soon" : ""}" data-id="${esc(r.id)}">
      <button class="w-check" type="button" data-done="${esc(r.id)}" aria-label="Done: ${esc(r.message)}">${icon("check")}</button>
      <span class="when num">${hhmm(d)}<small>${relTime(d)}</small></span>
      <span class="what">${esc(r.message)}${extra ? `<small>${esc(extra)}</small>` : ""}</span>
      <span class="row-actions"><button class="icon-btn tooltip" data-del="${esc(r.id)}" data-tip="Delete" aria-label="Delete task: ${esc(r.message)}">${icon("trash")}</button></span>
    </div>`;
  }).join("")}</div>`).join("");
  $$("[data-done]", box).forEach(b => b.onclick = async () => {
    const row = b.closest(".task-row");
    row.classList.add("done");
    try {
      const r = await api(`/api/reminders/${b.dataset.done}/done`, {});
      { const rc = b.getBoundingClientRect(); emit("task-done", { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 }); }
      if (r.next) toast(`Done. Next time: ${new Date(r.next).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`);
      setTimeout(() => emit("reminders-changed"), 450);
    } catch (e) { row.classList.remove("done"); toast(e.message); }
  });
  $$("[data-del]", box).forEach(b => b.onclick = async () => {
    const item = list.find(r => r.id === b.dataset.del);
    const ok = await confirmDialog({ title: "Delete this task?", body: `"${item?.message}" will be removed${item?.repeat && item.repeat !== "none" ? ", including all future repeats" : ""}.`, confirm: "Delete", danger: true });
    if (!ok) return;
    try { await api("/api/reminders/" + b.dataset.del, undefined, "DELETE"); toast("Task deleted"); emit("reminders-changed"); }
    catch (e) { toast(e.message); }
  });
}

function initTaskForm() {
  $("#taskQuick").onsubmit = async e => {
    e.preventDefault();
    const inp = $("#taskQuickInput"), err = $("#taskQuickErr"), text = inp.value.trim();
    err.textContent = "";
    if (!text) { inp.focus(); return; }
    try {
      const r = await api("/api/reminders/quick", { text });
      if (r.error) { err.textContent = r.error; return; }
      inp.value = ""; toast(`Task added for ${r.fires_at}`); emit("reminders-changed");
    } catch (e2) { err.textContent = e2.message; }
  };
  const f = $("#taskForm");
  const now = new Date(Date.now() + 60 * 60000);
  $("#taskDate").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  $("#taskTime").value = `${String(now.getHours()).padStart(2, "0")}:00`;
  f.onsubmit = async e => {
    e.preventDefault();
    const err = $("#taskError"), btn = $("#taskAdd");
    err.textContent = "";
    const message = $("#taskText").value.trim(), date = $("#taskDate").value, time = $("#taskTime").value;
    if (!message) { err.textContent = "Write what the task is."; $("#taskText").focus(); return; }
    if (!date || !time) { err.textContent = "Pick a date and time."; return; }
    if (new Date(`${date}T${time}`) <= new Date() && $("#taskRepeat").value === "none") { err.textContent = "That time has already passed."; return; }
    btn.disabled = true;
    try {
      const r = await api("/api/reminders", { message, at: `${date} ${time}`, repeat: $("#taskRepeat").value });
      if (r.error) { err.textContent = r.error; return; }
      $("#taskText").value = "";
      toast(`Task added for ${r.fires_at}`);
      emit("reminders-changed");
    } catch (e2) { err.textContent = e2.message; }
    finally { btn.disabled = false; }
  };
}

/* =========================================================================
   Inbox (read-only)
   ========================================================================= */
let inboxUnreadOnly = true, inboxItems = [], inboxSel = -1;
export async function loadInbox() {
  const box = $("#inboxList");
  box.innerHTML = loading("Opening your inbox…");
  $("#inboxMeta").textContent = "";
  let m;
  try { m = await api(`/api/email?list=1&limit=15&unread=${inboxUnreadOnly ? 1 : 0}`); }
  catch (e) { box.innerHTML = errorBox("Couldn't reach Jarvis", e.message, "inboxRetry"); $("#inboxRetry").onclick = loadInbox; return; }
  if (m.error) {
    if (m.setup) {
      box.innerHTML = `<div class="empty-state"><h3>Gmail isn't connected</h3>
        <p>Connect Gmail with an app password and Jarvis can read, sort and answer your email. Sending and deleting always wait for your click.</p>
        <button class="btn primary" data-goto-settings="integrations">${icon("mail")}<span>Connect Gmail</span></button></div>`;
    } else { box.innerHTML = errorBox("Couldn't open your inbox", m.error, "inboxRetry"); $("#inboxRetry").onclick = loadInbox; }
    return;
  }
  setUnread(m.unread);
  $("#inboxMeta").textContent = `${m.unread} unread · updated ${m.fetched_at}`;
  inboxItems = m.emails || [];
  inboxSel = -1;
  showMail(-1);
  if (!inboxItems.length) {
    box.innerHTML = `<div class="empty-state"><h3>${inboxUnreadOnly ? "No unread mail" : "Inbox is empty"}</h3><p>${inboxUnreadOnly ? "You're all caught up." : ""}</p></div>`;
    return;
  }
  box.innerHTML = inboxItems.map((e, i) => `
    <button class="mail-item" type="button" data-i="${i}" aria-pressed="false">
      ${inboxUnreadOnly ? '<span class="unread" aria-label="Unread"></span>' : "<span></span>"}
      <span class="mi-main"><span class="from">${esc(e.from)}</span><span class="subject">${esc(e.subject)}</span><span class="preview">${esc((e.preview || "").slice(0, 110))}</span></span>
      <span class="time num">${esc(e.when)}</span>
    </button>`).join("") + `<p class="data-note">Latest ${inboxItems.length}. Opening an email here doesn't mark it as read.</p>`;
  $$(".mail-item", box).forEach(b => b.onclick = () => showMail(+b.dataset.i));
}
function showMail(i) {
  inboxSel = i;
  $$(".mail-item").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
  const pane = $("#inboxRead"), e = inboxItems[i];
  if (!e) { pane.innerHTML = `<div class="empty-state"><h3>Select an email</h3><p>Its text appears here, with buttons to archive it, mark it read, or have Jarvis draft a reply.</p></div>`; return; }
  pane.innerHTML = `
    <header class="mr-head"><h2>${esc(e.subject)}</h2><p><b>${esc(e.from)}</b> · <span class="num">${esc(e.when)}</span></p></header>
    <div class="mr-actions">
      <button class="btn sm primary" data-ma="reply">${icon("sparkle")}<span>Draft reply</span></button>
      <button class="btn sm" data-ma="summary">${icon("message-square")}<span>Summarise</span></button>
      ${e.uid ? `<button class="btn sm" data-ma="read">${icon("check")}<span>Mark read</span></button>
      <button class="btn sm" data-ma="archive">${icon("inbox")}<span>Archive</span></button>
      <button class="btn sm ghost danger" data-ma="trash">${icon("trash")}<span>Trash</span></button>` : ""}
    </div>
    <div class="mr-body">${esc(e.preview || "(no text)")}${(e.preview || "").length >= 1500 ? "<p class='data-note'>Long email: only the start is shown. Ask Jarvis to summarise it.</p>" : ""}</div>`;
  $$("[data-ma]", pane).forEach(b => b.onclick = () => mailAction(b.dataset.ma, e, b));
}
async function mailAction(act, e, btn) {
  if (act === "reply") { emit("ask", `Draft a reply to the email from ${e.from} with the subject "${e.subject}". Show me the draft first.`); emit("navigate", "assistant"); return; }
  if (act === "summary") { emit("ask", `Summarise the email from ${e.from} with the subject "${e.subject}".`); emit("navigate", "assistant"); return; }
  if (act === "trash") {
    const ok = await confirmDialog({ title: "Move to Trash?", body: `"${e.subject}" from ${e.from}. Gmail keeps it in Trash for 30 days.`, confirm: "Move to Trash", danger: true });
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    const r = await api("/api/email/action", { uid: e.uid, action: act });
    if (r.error) { toast(r.error); btn.disabled = false; return; }
    toast(r.message);
    if (act !== "read" || inboxUnreadOnly) {
      inboxItems.splice(inboxSel, 1);
      const el = $(`.mail-item[data-i="${inboxSel}"]`);
      el?.classList.add("gone");
      setTimeout(() => { el?.remove(); $$(".mail-item").forEach((b, k) => b.dataset.i = k); showMail(Math.min(inboxSel, inboxItems.length - 1)); }, 300);
    } else btn.disabled = false;
    refreshUnreadCount();
  } catch (err) { toast(err.message); btn.disabled = false; }
}
/* Clean up: who fills your inbox, with one-click Unsubscribe / Block / Mark read per sender */
async function showCleanup() {
  const pane = $("#inboxRead");
  $$(".mail-item").forEach(b => b.setAttribute("aria-pressed", "false"));
  pane.innerHTML = `<header class="mr-head"><h2>Clean up your inbox</h2><p>Looking through your unread emails…</p></header>${loading("Counting senders…")}`;
  let d;
  try { d = await api("/api/email/senders"); } catch (e) { pane.innerHTML = errorBox("Couldn't check", e.message, "cleanRetry"); $("#cleanRetry").onclick = showCleanup; return; }
  if (d.error) { pane.innerHTML = errorBox("Couldn't check your inbox", d.error, "cleanRetry"); $("#cleanRetry").onclick = showCleanup; return; }
  const max = Math.max(1, ...d.top_senders.map(x => x.count));
  pane.innerHTML = `<header class="mr-head"><h2>Who fills your inbox</h2><p>Top senders among your ${d.scanned} newest unread emails. Each button acts on that sender right away.</p></header>
    <div class="clean-list">${d.top_senders.map(x => `
      <div class="clean-row" data-sender="${esc(x.sender)}">
        <div class="cl-who"><b>${esc(x.name)}</b><small>${esc(x.sender)}</small><span class="cl-bar"><i style="width:${Math.round(x.count / max * 100)}%"></i></span></div>
        <span class="cl-count num">${x.count}</span>
        <div class="cl-acts">
          ${x.can_unsubscribe ? `<button class="btn xs" data-ca="unsubscribe">Unsubscribe</button>` : ""}
          <button class="btn xs" data-ca="read">Mark read</button>
          <button class="btn xs ghost danger" data-ca="block">Block</button>
        </div>
      </div>`).join("") || `<div class="empty-state"><h3>Nothing to clean</h3><p>No unread emails.</p></div>`}</div>
    <p class="data-note">Unsubscribe uses the sender's own link. Block moves their emails to Trash (kept 30 days) and keeps doing it for new ones while Jarvis runs.</p>`;
  $$("[data-ca]", pane).forEach(b => b.onclick = async () => {
    const row = b.closest(".clean-row"), sender = row.dataset.sender, act = b.dataset.ca;
    if (act === "block") {
      const ok = await confirmDialog({ title: `Block ${sender}?`, body: "Their emails go to Trash now and in future (while Jarvis runs). Trash keeps them for 30 days.", confirm: "Block", danger: true });
      if (!ok) return;
    }
    $$("button", row).forEach(x => x.disabled = true);
    b.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    try {
      const r = await api("/api/email/sender-action", { sender, action: act });
      if (r.error) { toast(r.error); $$("button", row).forEach(x => x.disabled = false); b.textContent = act === "read" ? "Mark read" : act[0].toUpperCase() + act.slice(1); return; }
      toast(r.message);
      row.classList.add("done");
      row.querySelector(".cl-acts").innerHTML = `<span class="cl-done">${icon("check")}${esc(act === "read" ? "Marked read" : act === "block" ? "Blocked" : "Unsubscribed")}</span>`;
      refreshUnreadCount();
    } catch (e) { toast(e.message); $$("button", row).forEach(x => x.disabled = false); }
  });
}

function setUnread(n) {
  const c = $("#navCountInbox");
  c.textContent = n > 99 ? "99+" : n; c.hidden = !n; c.title = `${n} unread`;
}
async function refreshUnreadCount() {
  try {
    const m = await api("/api/email");
    if (!m.error) { setUnread(m.unread); $("#sugInbox").textContent = m.unread ? `${m.unread} new` : ""; }
    else { setUnread(0); $("#sugInbox").textContent = m.setup ? "not connected" : "unavailable"; }
  } catch (_) {}
}

/* =========================================================================
   Market Watch
   ========================================================================= */
function nyMarket() {
  const now = new Date(), ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = Math.round((now - ny) / 60000) / 60, day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
  const fmt = h => { h = (h + 24) % 24; return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round(h % 1 * 60)).padStart(2, "0")}`; };
  return { open: day > 0 && day < 6 && mins >= 570 && mins < 960, opens: fmt(9.5 + offset), closes: fmt(16 + offset), weekend: day === 0 || day === 6 };
}
let marketsTimer = null;
export async function loadMarkets(quiet = false) {
  const box = $("#marketsBody");
  const k = nyMarket();
  $("#marketState").innerHTML = k.open
    ? `<span class="status-dot ok" aria-hidden="true"></span><span>US market open, closes ${k.closes} your time</span>`
    : `<span class="status-dot" aria-hidden="true"></span><span>US market closed${k.weekend ? " for the weekend" : ""}, regular hours open ${k.opens} your time</span>`;
  if (!quiet) box.innerHTML = loading("Fetching quotes…");
  let d;
  try { d = await api("/api/watchlist"); }
  catch (e) {
    if (!quiet || !box.querySelector("table")) { box.innerHTML = errorBox("Couldn't load quotes", e.message, "mktRetry"); $("#mktRetry").onclick = () => loadMarkets(); }
    else $("#marketsMeta").textContent = "Couldn't refresh. Showing earlier quotes.";
    return;
  }
  const rows = d.rows || [];
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state"><h3>Your watchlist is empty</h3><p>Add up to 8 symbols below, for example TSLA, SPY, TTWO.</p></div>`;
    $("#marketsMeta").textContent = "";
    return;
  }
  box.innerHTML = rows.map(q => {
    const sym = esc(q.ticker || "?");
    if (q.error || q.price == null) return `<div class="mkt-card card glass"><div class="mc-top"><b>${sym}</b><button class="icon-btn sm" data-wrm="${sym}" aria-label="Remove ${sym}">${icon("x")}</button></div><p class="w-note">No data for this symbol.</p></div>`;
    const up = (q.change_percent ?? 0) >= 0, tv = encodeURIComponent(String(q.ticker).replace("^", ""));
    const ch = q.previous_close != null ? q.price - q.previous_close : null;
    return `<div class="mkt-card card glass">
      <div class="mc-top"><span><b>${sym}</b><small>${esc(q.exchange || "")}</small></span>
        <span class="mc-acts"><a class="icon-btn sm tooltip" href="https://www.tradingview.com/symbols/${tv}/" target="_blank" rel="noopener" data-tip="TradingView" aria-label="Open ${sym} on TradingView">${icon("external")}</a>
        <button class="icon-btn sm tooltip" data-wrm="${sym}" data-tip="Remove" aria-label="Remove ${sym}">${icon("x")}</button></span></div>
      <div class="mc-price num">${Number(q.price).toFixed(2)}<small>${esc(q.currency || "")}</small></div>
      <div class="mc-chg num ${up ? "up" : "down"}">${icon(up ? "trending-up" : "trending-down")}${ch != null ? (ch >= 0 ? "+" : "") + ch.toFixed(2) + " · " : ""}${up ? "+" : ""}${(q.change_percent ?? 0).toFixed(2)}%</div>
      <div class="mc-chart">${q.spark ? sparkline(q.spark, up, 320, 84) : ""}</div>
      <div class="mc-foot num"><span>Prev close <b>${q.previous_close != null ? Number(q.previous_close).toFixed(2) : "-"}</b></span>
        <button class="btn xs" data-wask="${sym}">${icon("sparkle")}<span>Ask Jarvis</span></button></div>
    </div>`;
  }).join("");
  $$("[data-wask]", box).forEach(b => b.onclick = () => { emit("ask", `How is ${b.dataset.wask} doing today, and what's moving it?`); emit("navigate", "assistant"); });
  $$("[data-wrm]", box).forEach(b => b.onclick = () => setWatch((state.config.watchlist || []).filter(t => t !== b.dataset.wrm)));
  $("#marketsMeta").textContent = `${d.note || "Delayed quotes"} · updated ${d.fetched_at}`;
}
async function setWatch(list) {
  try { state.config = await api("/api/config", { watchlist: list.join(",") }); emit("watchlist-changed"); loadMarkets(true); }
  catch (e) { toast(e.message); }
}
function initMarkets() {
  $("#watchAdd").onsubmit = async e => {
    e.preventDefault();
    const inp = $("#watchAddInput"), t = inp.value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
    if (!t) return;
    const list = [...(state.config.watchlist || [])];
    if (list.includes(t)) { toast(`${t} is already on your watchlist`); return; }
    if (list.length >= 8) { toast("Up to 8 tickers. Remove one first."); return; }
    inp.value = "";
    await setWatch([...list, t]);
  };
  on("watchlist-changed", () => { if ($("#view-markets").classList.contains("active")) loadMarkets(true); });
}

/* =========================================================================
   Wiring
   ========================================================================= */
export function onViewShown(name) {
  clearInterval(marketsTimer);
  if (name === "tasks") renderTasks(state.reminders || []);
  if (name === "inbox") loadInbox();
  if (name === "markets") { loadMarkets(); marketsTimer = setInterval(() => loadMarkets(true), 60000); }
}

export function initViews() {
  initTaskForm();
  initMarkets();
  on("reminders", list => renderTasks(list));
  $("#tasksRefresh").onclick = () => emit("reminders-changed");
  $("#inboxRefresh").onclick = loadInbox;
  $("#inboxClean").onclick = showCleanup;
  $("#marketsRefresh").onclick = () => loadMarkets();
  $$("[data-inbox-filter]").forEach(b => b.onclick = () => {
    inboxUnreadOnly = b.dataset.inboxFilter === "unread";
    $$("[data-inbox-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    loadInbox();
  });
  on("config", c => {
    const n = (c.watchlist || []).length;
    $("#sugMarkets").textContent = n ? "" : "empty";
  });
  on("chat-done", r => { if ((r.actions || []).some(a => /email/.test(a.tool))) refreshUnreadCount(); });
  refreshUnreadCount();
  setInterval(refreshUnreadCount, 120000);
}
