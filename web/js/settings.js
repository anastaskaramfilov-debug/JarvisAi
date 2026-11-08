// Settings view: General, Voice, AI provider, Integrations, Memory, Keyboard shortcuts, About.
import { $, $$, api, esc, state, on, emit, confirmDialog, toast } from "./core.js";
import { icon } from "./icons.js";
import { speak, stopSpeaking, IS_REMOTE } from "./voice.js";
import { checkProvider, loadWeather } from "./context.js";
import { initConnectors, loadConnectorPages } from "./connectors.js";

// Old page names still work (links, buttons): they open the tab that now holds them
const PAGE_OF = { ai: "apps", integrations: "apps", connectors: "apps", shortcuts: "help", about: "help" };
const PANEL_OF = { apps: "ai", help: "about" };
const SECTION_OF = { integrations: "Integrations", connectors: "Connectors", shortcuts: "Keyboard shortcuts" };
export function showSettingsPage(id) {
  if (id === "voice" || id === "appearance") { emit("navigate", "customize"); return; }
  const want = id;
  id = PAGE_OF[id] || id;
  const panel = PANEL_OF[id] || id;
  $$(".settings-nav [role=tab]").forEach(t => {
    const on = t.dataset.page === id;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  });
  $$(".settings-page").forEach(p => p.classList.toggle("active", p.id === "set-" + panel));
  const page = $("#set-" + panel);
  const h = SECTION_OF[want] && [...page.querySelectorAll("h2")].find(x => x.textContent.trim() === SECTION_OF[want]);
  if (h) setTimeout(() => h.scrollIntoView({ behavior: "smooth", block: "start" }), 60); else if (page) page.scrollTop = 0;
}

export async function loadConfig() {
  let c;
  try { c = await api("/api/config"); } catch (e) { toast(e.message); return state.config; }
  state.config = c;
  $("#setSfx").checked = c.sfx !== false;
  $("#setFast").checked = c.fast_mode !== false;
  $("#setBriefing").checked = c.proactive_briefing !== false;
  $("#setMailAlerts").checked = c.proactive_email !== false;
  $("#setMarketAlerts").checked = c.proactive_market !== false;
  $("#setBrain").value = c.brain || "gemini";
  syncBrainFields();
  $("#gKeyState").textContent = c.has_gemini_key ? "A Gemini key is saved on this PC. Paste a new one to replace it." : "No Gemini key saved yet.";
  $("#cKeyState").textContent = c.has_claude_key ? "A Claude key is saved on this PC. Paste a new one to replace it." : "No Claude key saved yet.";
  $("#setGModel").value = c.gemini_model || "";
  $("#setCModel").value = c.claude_model || "claude-sonnet-5-5";
  $("#setVoice").value = c.tts_voice || "en-GB-RyanNeural";
  $("#setStt").value = c.whisper_size || "small.en";
  $("#setCity").value = c.city || "";
  $("#setWatch").value = (c.watchlist || []).join(", ");
  $("#setMail").value = c.email_address || "";
  $("#setCfAcc").value = c.cf_account_id || "";
  $("#cfState").textContent = c.has_cf_token ? "Connected. Paste a new token to replace it." : "Not connected yet.";
  $("#calState").textContent = c.has_calendar ? "A calendar is connected. Paste a new address to replace it." : "No calendar connected yet.";
  $("#mailPwState").textContent = c.has_email_password ? "An app password is saved on this PC." : "No app password saved yet.";
  $("#aboutVersion").textContent = c.version || "unknown";
  emit("config", c);
  loadMics(c.mic_device);
  return c;
}

async function loadMics(selected) {
  const sel = $("#setMic");
  const opts = [`<option value="">Windows default</option>`];
  try {
    const mics = await api("/api/mics");
    if (Array.isArray(mics)) mics.forEach(m => opts.push(`<option value="${m.index}">${esc(m.name)}${m.default ? " (default)" : ""}</option>`));
    $("#micListNote").textContent = "";
  } catch (e) { $("#micListNote").textContent = "Couldn't list microphones: " + e.message; }
  sel.innerHTML = opts.join("");
  sel.value = selected ?? "";
}

function syncBrainFields() {
  const claude = $("#setBrain").value === "claude";
  $("#claudeFields").hidden = !claude;
}

function renderConn(p) {
  if (!p) return;
  const name = p.provider === "claude" ? "Claude (Anthropic)" : "Gemini (Google)";
  let dot = "pending", line = "Checking the connection…";
  if (!p.configured) { dot = "warn"; line = "No API key saved. Add one below."; }
  else if (p.ok === true) { dot = "ok"; line = `Connected${p.checked ? `, checked at ${p.checked}` : ""}.`; }
  else if (p.ok === false) { dot = "bad"; line = `Not connected: ${p.error || "unknown error"}.`; }
  $("#connName").textContent = name;
  $("#connLine").textContent = line;
  $("#connDot").className = "status-dot " + dot;
}
on("provider", renderConn);

export async function save() {
  const btns = $$("[data-save]");
  btns.forEach(b => b.disabled = true);
  const aiChanged = !!($("#setGKey").value || $("#setCKey").value) || $("#setBrain").value !== (state.config.brain || "gemini");
  const cityChanged = $("#setCity").value.trim() !== (state.config.city || "");
  try {
    await api("/api/config", {
      brain: $("#setBrain").value, gemini_api_key: $("#setGKey").value, gemini_model: $("#setGModel").value,
      claude_api_key: $("#setCKey").value, claude_model: $("#setCModel").value,
      tts_voice: $("#setVoice").value, whisper_size: $("#setStt").value, mic_source: "python", mic_device: $("#setMic").value || null,
      email_address: $("#setMail").value, email_app_password: $("#setMailPw").value, calendar_ics_url: $("#setCal").value,
      cf_account_id: $("#setCfAcc").value, cf_api_token: $("#setCfTok").value,
      city: $("#setCity").value, watchlist: $("#setWatch").value, sfx: $("#setSfx").checked, fast_mode: $("#setFast").checked,
      proactive_briefing: $("#setBriefing").checked, proactive_email: $("#setMailAlerts").checked, proactive_market: $("#setMarketAlerts").checked,
    });
    ["#setGKey", "#setCKey", "#setMailPw", "#setCal", "#setCfTok"].forEach(s => $(s).value = "");
    await loadConfig();
    if (aiChanged) checkProvider(true);
    if (cityChanged) loadWeather();
    $$(".saved").forEach(s => { s.classList.remove("err"); s.textContent = "Saved"; setTimeout(() => s.textContent = "", 2500); });
    toast("Settings saved");
    return true;
  } catch (e) {
    toast("Couldn't save: " + e.message);
    $$(".saved").forEach(s => { s.classList.add("err"); s.textContent = "Not saved: " + e.message; });
    return false;
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

/* ---------- microphone test (real level + real transcript) ---------- */
let testing = false;
async function testMic() {
  if (testing) { api("/api/listen/stop", {}).catch(() => {}); return; }
  if (state.micBusy) { toast("The microphone is in use. Turn hands-free off first."); return; }
  if (!(await save())) return;
  testing = true;
  const btn = $("#testMic"), out = $("#micTestResult"), bar = $("#micMeter i");
  btn.innerHTML = icon("stop") + "<span>Stop test</span>";
  out.textContent = "Say something…";
  const poll = setInterval(async () => {
    try { const m = await api("/api/miclevel"); bar.style.width = Math.min(100, (m.level / Math.max(m.thr, 0.001)) * 30) + "%"; } catch (_) {}
  }, 100);
  try {
    const r = await fetch("/api/listen?ptt=1", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) out.textContent = "The microphone is busy. Try again in a moment.";
    else if (j.error) out.textContent = "Microphone problem: " + j.error;
    else if (j.silent) out.textContent = "Didn't hear anything. Pick another microphone or move closer.";
    else out.textContent = j.text ? `Heard: "${j.text}"` : "Heard sound but couldn't make out words.";
  } catch (_) { out.textContent = "Jarvis's server isn't reachable."; }
  clearInterval(poll); bar.style.width = "0";
  btn.innerHTML = icon("mic") + "<span>Test microphone</span>";
  testing = false;
}

/* ---------- about you (profile) ---------- */
let profile = null;
function renderProfile() {
  const box = $("#memoryList");
  const { facts, cats } = profile;
  $("#setLearn").checked = profile.learn !== false;
  const sel = $("#profileCat");
  if (!sel.options.length) sel.innerHTML = Object.entries(cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("#profileClear").hidden = !facts.length;
  if (!facts.length) {
    box.innerHTML = `<div class="empty-state"><h3>Jarvis doesn't know you yet</h3><p>Talk to it normally, add something above, or click "Get to know me".</p></div>`;
    return;
  }
  box.innerHTML = Object.entries(cats).map(([k, label]) => {
    const items = facts.filter(f => f.cat === k);
    if (!items.length) return "";
    return `<div class="profile-group"><h3>${esc(label)} <span class="secondary">${items.length}</span></h3>` +
      items.slice().reverse().map(f => `<div class="memory-row"><span>${esc(f.text)}</span>` +
        `<small class="profile-src" title="${f.src === "you" ? "You told Jarvis" : "Learned from a conversation"} on ${esc(f.t || "")}">${f.src === "you" ? "you said" : "learned"}</small>` +
        `<button class="icon-btn tooltip" data-forget="${esc(f.id)}" data-tip="Forget" aria-label="Forget: ${esc(f.text)}">${icon("trash")}</button></div>`).join("") + "</div>";
  }).join("");
  $$("[data-forget]", box).forEach(b => b.onclick = () => changeProfile({ remove: b.dataset.forget }));
}
async function changeProfile(body) {
  try { profile = body ? await api("/api/profile", body) : await api("/api/profile"); renderProfile(); }
  catch (e) { $("#memoryList").innerHTML = `<div class="error-state"><h3>Couldn't load what Jarvis knows</h3><p>${esc(e.message)}</p></div>`; }
}
const loadMemory = () => { changeProfile(); loadKnowledge(); };
async function loadKnowledge() {
  try {
    const k = await api("/api/knowledge");
    const n = k.files.length;
    $("#knowHead").textContent = n ? `${n} file${n === 1 ? "" : "s"} · ${k.chunks} searchable parts` : "The folder is empty";
    $("#knowPath").textContent = k.folder;
    $("#knowFiles").innerHTML = k.files.slice(0, 40).map(f => `<li class="${f.unreadable ? "bad" : ""}">${icon("file")}<span>${esc(f.name)}</span><small>${f.unreadable ? "couldn't read" : `${(f.size / 1024).toFixed(f.size < 10240 ? 1 : 0)} KB`}</small></li>`).join("")
      + (n > 40 ? `<li class="more">and ${n - 40} more</li>` : "");
  } catch (e) { $("#knowHead").textContent = "Couldn't check the folder"; $("#knowPath").textContent = e.message; }
}
function initProfile() {
  $("#knowRefresh").onclick = loadKnowledge;
  $("#knowOpen").onclick = async () => { try { await api("/api/knowledge/open", {}); } catch (e) { toast(e.message); } setTimeout(loadKnowledge, 4000); };
  $("#setLearn").onchange = e => changeProfile({ learn: e.target.checked });
  const add = () => {
    const t = $("#profileText").value.trim();
    if (!t) { $("#profileText").focus(); return; }
    changeProfile({ add: { cat: $("#profileCat").value, text: t } });
    $("#profileText").value = "";
  };
  $("#profileAdd").onclick = add;
  $("#profileText").onkeydown = e => { if (e.key === "Enter") add(); };
  $("#profileClear").onclick = async () => {
    const ok = await confirmDialog({ title: "Forget everything about you?", body: `Jarvis will delete all ${profile?.facts.length || 0} things it knows about you. This can't be undone.`, confirm: "Forget everything", danger: true });
    if (ok) changeProfile({ clear: true });
  };
  $("#interviewBtn").onclick = () => {
    emit("navigate", "assistant");
    emit("ask", "Get to know me. Ask me one short question at a time about my life, goals, interests, routine and how I make decisions. Start now.");
  };
}

async function turnOff() {
  const ok = await confirmDialog({ title: "Turn Jarvis off?", body: "Tasks won't remind you until you open Jarvis again from the desktop icon or Ctrl+Alt+J.", confirm: "Turn off", danger: true });
  if (!ok) return;
  stopSpeaking();
  try { await api("/api/shutdown", {}); } catch (_) {}
  document.body.innerHTML = '<main style="height:100%;display:grid;place-items:center;color:#A0A8B8;font:15px var(--font-ui)"><p>Jarvis is off. You can close this window.</p></main>';
}

/* ---------- phone access ---------- */
async function loadPhone(action, extra = {}) {
  const err = $("#phoneErr"); err.textContent = "";
  let st;
  try {
    st = action || extra.pin ? await api("/api/phone", { action, ...extra }) : await api("/api/phone");
  } catch (e) { err.textContent = e.message; return; }
  if (st.error) {
    err.innerHTML = esc(st.error) + (st.link ? `<br><a class="btn sm" style="margin-top:8px" href="${esc(st.link)}" target="_blank" rel="noopener">Open Tailscale and click Enable</a><br><span class="secondary">Then come back and click Turn on again.</span>` : "");
    st = await api("/api/phone").catch(() => null);
    if (!st) return;
  }
  const dot = $("#phoneDot"), head = $("#phoneHead"), line = $("#phoneLine");
  if (!st.tailscale) { dot.className = "status-dot warn"; head.textContent = "Tailscale not connected"; line.textContent = "Install Tailscale on this PC and sign in (step 1)."; }
  else if (!st.enabled) { dot.className = "status-dot"; head.textContent = "Phone access is off"; line.textContent = st.has_pin ? "Turn it on in step 3." : "Choose a PIN, then turn it on."; }
  else { dot.className = "status-dot ok"; head.textContent = "Phone access is on"; line.textContent = `${st.devices} phone${st.devices === 1 ? "" : "s"} logged in`; }
  $("#pinState").textContent = st.has_pin ? "A PIN is set. Saving a new one logs out every phone." : "You'll type this once on the phone.";
  const t = $("#phoneToggle");
  t.textContent = st.enabled ? "Turn off" : "Turn on";
  t.className = "btn " + (st.enabled ? "danger" : "primary");
  t.disabled = false;
  t.onclick = () => {
    t.disabled = true;
    t.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + (st.enabled ? "Turning off…" : "Turning on…") + "</span>";
    loadPhone(st.enabled ? "disable" : "enable");
  };
  $("#phoneQr").hidden = !(st.enabled && st.url);
  if (st.enabled && st.url) { $("#phoneUrl").textContent = st.url; $("#phoneQrImg").src = "/api/phone/qr?t=" + Date.now(); }
}

export function onSettingsShown() { loadConfig(); loadMemory(); loadConnectorPages(); if (!IS_REMOTE) loadPhone(); }

/* ---------- install as an app (hides the grey title bar) ---------- */
let installEvent = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; syncInstall(); });
addEventListener("appinstalled", () => { installEvent = null; syncInstall(true); });
function syncInstall(justInstalled = false) {
  const btn = $("#installBtn"), desc = $("#installDesc");
  if (!btn) return;
  const installed = justInstalled || matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)").matches;
  if (installed) {
    btn.hidden = true;
    desc.textContent = justInstalled
      ? "Installed. Close this window and press Ctrl+Alt+J: Jarvis opens as an app without the grey bar."
      : "Jarvis is running as an app. If the grey bar still shows, click the small ^ arrow at the top right of the window to hide it.";
    return;
  }
  btn.hidden = false;
  btn.onclick = async () => {
    if (installEvent) { installEvent.prompt(); const r = await installEvent.userChoice; if (r.outcome === "accepted") syncInstall(true); return; }
    desc.innerHTML = "Your browser didn't offer the install button here. Open <b>http://127.0.0.1:5005</b> in Chrome or Edge, click the <b>install icon</b> at the right end of the address bar (a screen with an arrow), then click <b>Install</b>.";
  };
}

// Customize applies right away: voice, microphone, speech model and sounds save on change
let autoTimer = 0;
function autoSave() { clearTimeout(autoTimer); autoTimer = setTimeout(() => save(), 250); }
export function onCustomizeShown() { loadConfig(); }

export function initSettings() {
  syncInstall();
  ["#setVoice", "#setStt", "#setMic", "#setSfx"].forEach(sel => { const el = $(sel); if (el) el.addEventListener("change", autoSave); });
  $("#cfTest").onclick = async () => {
    const out = $("#cfTestOut"), b = $("#cfTest");
    if ($("#setCfTok").value || $("#setCfAcc").value !== (state.config.cf_account_id || "")) { if (!(await save())) return; }
    b.disabled = true; out.className = "test-out"; out.textContent = "Checking…";
    try { const r = await api("/api/test/cloudflare", {}); out.className = "test-out " + (r.ok ? "ok" : "bad"); out.textContent = r.message; }
    catch (e) { out.className = "test-out bad"; out.textContent = e.message; }
    b.disabled = false;
  };
  initProfile();
  initConnectors();
  const tabs = $$(".settings-nav [role=tab]");
  tabs.forEach((t, i) => {
    t.onclick = () => showSettingsPage(t.dataset.page);
    t.onkeydown = e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = tabs[(i + (e.key === "ArrowDown" ? 1 : tabs.length - 1)) % tabs.length];
        n.focus(); showSettingsPage(n.dataset.page);
      }
    };
  });
  $("#setBrain").onchange = syncBrainFields;
  $$("[data-save]").forEach(b => b.onclick = save);
  $("#checkConn").onclick = () => checkProvider(true);
  // Hear the selected voice without saving it
  $("#testVoice").onclick = async () => {
    const v = $("#setVoice").value, prev = state.spoken;
    const bg = v.startsWith("bg-") ;
    const text = bg ? "Здравейте, сър. Така ще звуча, когато ви отговарям." :
      v.includes("Multilingual") ? "Good evening, sir. Добър вечер. I speak English and Bulgarian." :
      "Good evening, sir. All systems are online. This is how I'll sound when I answer you.";
    state.spoken = true;
    try {
      const id = v === "browser" ? null : (await api("/api/tts/start", { text, voice: v }))?.id;
      await speak(text, id);
    } finally { state.spoken = prev; }
  };
  $("#testMic").onclick = testMic;
  $("#turnOff").onclick = turnOff;
  $("#aboutAddress").textContent = location.origin;
  $("#phoneRefresh").onclick = () => loadPhone();
  $("#phoneLogout").onclick = () => loadPhone("logout_all").then(() => toast("All phones logged out"));
  $("#phonePinSave").onclick = async () => {
    const pin = $("#phonePin").value.trim();
    if (!/^\d{6,10}$/.test(pin)) { $("#phoneErr").textContent = "Use 6 to 10 digits for the PIN."; return; }
    await loadPhone(undefined, { pin }); $("#phonePin").value = ""; toast("PIN saved");
  };
  if (IS_REMOTE) document.documentElement.classList.add("is-remote");
  showSettingsPage("general");
  loadConfig();
}
