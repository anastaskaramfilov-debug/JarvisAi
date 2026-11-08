// Header (clock, real provider status) and the sidebar context area (next task, weather, system).
import { $, api, esc, hhmm, state, on, emit, relTime, dayLabel, sparkline } from "./core.js";
import { icon, weatherIcon } from "./icons.js";
import { countUp } from "./alive.js";

/* ---------- clock ---------- */
function tick() {
  const n = new Date();
  $("#clockTime").textContent = hhmm(n);
  $("#clockDate").textContent = n.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/* ---------- provider status: only green after a real successful check or answer ---------- */
function renderProvider(p) {
  state.provider = p;
  const b = $("#providerBtn");
  const name = p.provider === "claude" ? "Claude" : "Gemini";
  let dot = "pending", text = "Checking…";
  if (!p.configured) { dot = "warn"; text = "No API key"; }
  else if (p.ok === true) { dot = "ok"; text = "Connected"; }
  else if (p.ok === false) { dot = "bad"; text = p.error || "Not connected"; }
  b.innerHTML = `<span class="status-dot ${dot}" aria-hidden="true"></span><strong>${name}</strong><span>${esc(text)}</span>`;
  b.setAttribute("aria-label", `AI provider ${name}: ${text}. Open AI provider settings.`);
  b.dataset.tip = p.ok === true && p.model ? `${p.model}${p.checked ? ` · checked ${p.checked}` : ""}` : "AI provider settings";
  emit("provider", p);
}
export async function checkProvider(force = true) {
  renderProvider({ ...(state.provider || {}), ok: null, configured: state.provider?.configured ?? true });
  try { renderProvider(await api("/api/status" + (force ? "?check=1" : ""))); }
  catch (e) { renderProvider({ provider: state.config.brain || "gemini", configured: true, ok: false, error: "Jarvis server offline" }); }
}
on("provider-ok", model => {
  if (state.provider) renderProvider({ ...state.provider, ok: true, error: "", configured: true, model: model || state.provider.model, checked: hhmm(new Date()) });
});
on("provider-failed", () => { if (state.provider) renderProvider({ ...state.provider, ok: false, error: "Not answering" }); });

/* ---------- next task (calendar widget) ---------- */
export async function loadReminders() {
  try {
    state.reminders = await api("/api/reminders") || [];
  } catch (_) {
    $("#ctxNext").innerHTML = `<span class="w-note">Couldn't load tasks.</span>`;
    return;
  }
  // Merge tasks with real Google Calendar events (if connected)
  let events = [];
  try {
    const cal = await api("/api/calendar?days=2");
    events = (cal.events || []).map(e => ({ when: new Date(e.all_day ? e.start + "T00:00" : e.start.replace(" ", "T")), title: e.title, allDay: e.all_day, cal: true }));
  } catch (_) {}
  const now = Date.now();
  const items = state.reminders.map(r => ({ when: new Date(r.due), title: r.message }))
    .concat(events.filter(e => e.allDay ? e.when.toDateString() === new Date().toDateString() || e.when > now : e.when > now))
    .sort((a, b) => a.when - b.when).slice(0, 1);
  $("#ctxNext").innerHTML = items.length
    ? items.map((it, i) => `<div class="w-event${i ? " later" : ""}"><span class="w-when num">${it.allDay ? "All day" : hhmm(it.when)}</span><span class="w-what"><span>${esc(it.title)}</span><small>${dayLabel(it.when)}${it.allDay ? "" : " · " + relTime(it.when)}${it.cal ? " · Calendar" : ""}</small></span></div>`).join("")
    : `<span class="w-note">Nothing scheduled.</span>`;
  const c = $("#navCountTasks");
  c.textContent = state.reminders.length; c.hidden = !state.reminders.length;
  const today = state.reminders.filter(r => new Date(r.due).toDateString() === new Date().toDateString()).length;
  $("#sugTasks").textContent = state.reminders.length ? `${state.reminders.length}${today ? ` · ${today} today` : ""}` : "";
  emit("reminders", state.reminders);
}
on("provider", p => {
  if (p && !p.configured && !document.querySelector("#view-assistant.thinking")) {
    $("#contextLine").innerHTML = `Add an AI key in <button class="link-btn" data-goto-settings="ai" type="button">Settings</button> to get started.`;
  }
});

/* ---------- weather ---------- */
export async function loadWeather() {
  const box = $("#ctxWeather"), live = $("#weatherLive");
  let w;
  try { w = await api("/api/weather"); } catch (_) { w = { error: "offline" }; }
  if (w.error) {
    live.className = "live-dot warn";
    if (state.weather) {
      box.querySelector(".stale")?.remove();
      box.insertAdjacentHTML("beforeend", `<span class="w-note stale">Couldn't refresh. From ${esc(state.weather.fetched_at)}.</span>`);
    } else {
      box.innerHTML = `<span class="w-note">Weather unavailable. <button class="link-btn" data-goto-settings="general" type="button">Check the city</button></span>`;
    }
    return;
  }
  state.weather = w;
  emit("weather", w);
  live.className = "live-dot ok";
  live.title = `Updated ${w.fetched_at || hhmm(new Date())}`;
  $("#wWeatherT").textContent = `Weather · ${w.place.split(",")[0]}`;
  const day = d => new Date(d.date + "T12:00").toLocaleDateString([], { weekday: "short" });
  box.innerHTML = `
    <button class="w-weather w-hit" type="button" aria-label="Show forecast">
      ${icon(weatherIcon(w.code), "md")}
      <span class="w-temp num" data-temp="${w.now_c}">${w.now_c}°</span>
      <span class="w-sky"><span>${esc(cap(w.sky))}</span><small>Feels ${w.feels_like_c}° · ${w.forecast[0] ? `${w.forecast[0].high}°/${w.forecast[0].low}°` : ""}</small></span>
    </button>
    <div class="w-more">
      <div class="w-forecast num" title="Open-Meteo, updated ${esc(w.fetched_at)}">${w.forecast.map(d => `<span><b>${day(d)}</b>${d.high}°<i>${d.low}°</i><small>${d.rain_chance ?? 0}% rain</small></span>`).join("")}</div>
      <div class="w-facts num"><span>Wind <b>${w.wind_kmh} km/h</b></span><span>Humidity <b>${w.humidity}%</b></span><span>Sunrise <b>${esc(w.sunrise || "-")}</b></span><span>Sunset <b>${esc(w.sunset || "-")}</b></span></div>
    </div>`;
  box.querySelector(".w-hit").onclick = () => emit("widget-toggle", "weather");
  const t = box.querySelector("[data-temp]");
  countUp(t, w.now_c, { from: lastTemp ?? Math.max(0, w.now_c - 6), suffix: "°" });
  lastTemp = w.now_c;
}
let lastTemp = null;
const lastPrice = {};
const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());

/* ---------- system ---------- */
export async function loadSystem() {
  const box = $("#ctxSystem");
  try {
    const s = await api("/api/system");
    if (s.error) { box.innerHTML = `<span class="muted">System stats unavailable.</span>`; return; }
    const row = (k, v) => `<dt>${k}</dt><dd class="num">${v}</dd>`;
    box.innerHTML = row("Processor", `${s.cpu}%`) + row("Memory", `${s.ram}% of ${s.ram_total_gb} GB`) +
      row("Disk", `${s.disk}% used, ${s.disk_free_gb} GB free`) +
      (s.battery != null ? row(s.plugged ? "Charging" : "Battery", `${s.battery}%`) : "") + row("On for", esc(s.uptime));
  } catch (_) {
    box.innerHTML = `<span class="muted">Jarvis server isn't reachable.</span>`;
  }
}

/* ---------- market widget: real, delayed quotes with today's trend ---------- */
let openTicker = null;
export async function loadMarketWidget() {
  const box = $("#mktWidget"), live = $("#mktLive");
  let d;
  try { d = await api("/api/watchlist"); }
  catch (_) { live.className = "live-dot warn"; if (!box.querySelector(".w-tick")) box.innerHTML = `<span class="w-note">Quotes unavailable.</span>`; return; }
  const m = d.market || {};
  live.className = "live-dot " + (m.status === "open" ? "ok pulse" : "idle");
  const mstate = m.status === "open" ? `Open · closes ${m.closes_at_local}` : m.opens_at_local ? `Closed · opens ${m.opens_at_local.replace(/^(\w{3})\w*/, "$1")}` : "";
  const rows = d.rows || [];
  if (!rows.length) { box.innerHTML = `<span class="w-note">Watchlist is empty. Add a ticker with +.</span>`; $("#mktWidgetNote").textContent = ""; return; }
  box.innerHTML = rows.map((q, i) => {
    const sym = esc(q.ticker || "?"), more = i >= 4 ? " w-extra" : "";
    if (q.error || q.price == null) return `<div class="w-tick${more}" data-sym="${sym}"><span class="w-sym">${sym}</span><span class="w-note">No data</span><button class="icon-btn xs w-rm" data-rm="${sym}" aria-label="Remove ${sym}">${icon("x")}</button></div>`;
    const up = (q.change_percent ?? 0) >= 0, tv = encodeURIComponent(String(q.ticker).replace("^", ""));
    return `<div class="w-tick-wrap${more}${openTicker === q.ticker ? " open" : ""}" data-sym="${sym}">
      <button class="w-tick" type="button" aria-expanded="${openTicker === q.ticker}">
        <span class="w-sym">${sym}</span>
        <span class="w-spark">${q.spark ? sparkline(q.spark, up, 64, 22) : ""}</span>
        <span class="w-price num" data-sym="${sym}" data-price="${q.price}">${Number(q.price).toFixed(2)}</span>
        <span class="w-chg num ${up ? "up" : "down"}">${icon(up ? "trending-up" : "trending-down")}${Math.abs(q.change_percent ?? 0).toFixed(2)}%</span>
      </button>
      <div class="w-tick-more">
        ${q.spark ? `<div class="w-bigspark">${sparkline(q.spark, up, 236, 54)}</div>` : ""}
        <div class="w-tick-facts num"><span>Prev close <b>${q.previous_close != null ? Number(q.previous_close).toFixed(2) : "-"}</b></span><span>${esc(q.currency || "")}</span></div>
        <div class="w-tick-acts">
          <a class="btn xs" href="https://www.tradingview.com/symbols/${tv}/" target="_blank" rel="noopener">${icon("external")}<span>Chart</span></a>
          <button class="btn xs" type="button" data-askt="${sym}">${icon("sparkle")}<span>Ask Jarvis</span></button>
          <button class="icon-btn xs tooltip danger" type="button" data-rm="${sym}" aria-label="Remove ${sym} from the watchlist" data-tip="Remove">${icon("trash")}</button>
        </div>
      </div>
    </div>`;
  }).join("");
  $("#mktWidgetNote").innerHTML = `${mstate ? `<span class="mkt-state">${esc(mstate)}</span> · ` : ""}delayed up to 15 min`;
  box.querySelectorAll(".w-tick-wrap > .w-tick").forEach(b => b.onclick = () => {
    const wrap = b.parentElement, sym = wrap.dataset.sym;
    openTicker = openTicker === sym ? null : sym;
    box.querySelectorAll(".w-tick-wrap").forEach(x => { x.classList.toggle("open", x.dataset.sym === openTicker); x.firstElementChild.setAttribute("aria-expanded", String(x.dataset.sym === openTicker)); });
  });
  box.querySelectorAll("[data-askt]").forEach(b => b.onclick = () => emit("ask", `How is ${b.dataset.askt} doing today, and what's moving it?`));
  box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => emit("watchlist-remove", b.dataset.rm));
  // prices count to their new value and flash green/red when they move
  box.querySelectorAll("[data-price]").forEach(el => {
    const sym = el.dataset.sym, now = +el.dataset.price, before = lastPrice[sym];
    countUp(el, now, { from: before ?? now * 0.985, decimals: 2, ms: before == null ? 900 : 600 });
    if (before != null && before !== now) {
      const row = el.closest(".w-tick");
      row.classList.add(now > before ? "tick-up" : "tick-down");
      setTimeout(() => row.classList.remove("tick-up", "tick-down"), 1300);
    }
    lastPrice[sym] = now;
  });
}

export function initContext() {
  tick(); setInterval(tick, 1000);
  checkProvider(true);
  setInterval(() => checkProvider(true), 10 * 60000);
  loadReminders(); setInterval(loadReminders, 30000);
  loadWeather(); setInterval(loadWeather, 15 * 60000);
  loadSystem(); setInterval(loadSystem, 10000);
  loadMarketWidget(); setInterval(loadMarketWidget, 60000);
  on("config", () => loadMarketWidget());
  on("watchlist-changed", () => loadMarketWidget());
  on("reminders-changed", loadReminders);
  on("chat-done", r => {
    const tools = (r.actions || []).map(a => a.tool);
    if (tools.some(t => /reminder/.test(t))) loadReminders();
    if (tools.includes("get_weather")) loadWeather();
  });
}
