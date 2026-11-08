// Settings > Connectors and Settings > Skills.
import { $, $$, api, esc, toast, confirmDialog } from "./core.js";
import { icon } from "./icons.js";
import { IS_REMOTE } from "./voice.js";

let redirect = "http://127.0.0.1:5005/oauth/callback";
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const copyBtn = text => `<button class="btn sm ghost" type="button" data-copy="${esc(text)}">${icon("check")}<span>Copy</span></button>`;

// What each built-in app needs, in plain steps
const SETUP = {
  spotify: {
    blurb: "Play songs, albums and your playlists, skip, pause, change volume, and ask what's playing.",
    steps: () => `<ol class="steps">
      <li>Open the ${ext("https://developer.spotify.com/dashboard", "Spotify developer dashboard")}, log in with your Spotify account and click <strong>Create app</strong>.</li>
      <li>Name it <strong>Jarvis</strong>, type anything as the description, and add this <strong>Redirect URI</strong>: <code>${esc(redirect)}</code> ${copyBtn(redirect)}</li>
      <li>Tick <strong>Web API</strong>, accept the terms and click <strong>Save</strong>.</li>
      <li>Open the app's <strong>Settings</strong>, copy the <strong>Client ID</strong>, paste it below and click <strong>Connect</strong>.</li></ol>
      <p class="secondary conn-note">Spotify only lets apps press play and skip for Premium accounts. On a free account Jarvis opens the song in Spotify and you press play.</p>`,
    fields: [["client_id", "Client ID", "text", "32 letters and numbers"]],
  },
  google: {
    blurb: "Read and add Google Calendar events directly (no Save click), and find and read files in Google Drive.",
    steps: () => `<ol class="steps">
      <li>Open ${ext("https://console.cloud.google.com/projectcreate", "Google Cloud")} and create a project called <strong>Jarvis</strong> (free, no card needed).</li>
      <li>Turn on the ${ext("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", "Google Calendar API")} and the ${ext("https://console.cloud.google.com/apis/library/drive.googleapis.com", "Google Drive API")}: click <strong>Enable</strong> on each.</li>
      <li>Open ${ext("https://console.cloud.google.com/auth/overview", "Google Auth Platform")}, click <strong>Get started</strong>: app name Jarvis, your email, audience <strong>External</strong>, then Create.</li>
      <li>In <strong>Audience</strong> click <strong>Publish app</strong> (otherwise Google signs Jarvis out every 7 days).</li>
      <li>In <strong>Clients</strong> click <strong>Create client</strong>, choose <strong>Desktop app</strong>, name it Jarvis and click Create. Copy the <strong>Client ID</strong> and <strong>Client secret</strong> below and click <strong>Connect</strong>.</li>
      <li>Google will say it hasn't verified the app: click <strong>Advanced</strong> → <strong>Go to Jarvis</strong>. It's your own app, so that's expected.</li></ol>`,
    fields: [["client_id", "Client ID", "text", "…apps.googleusercontent.com"], ["client_secret", "Client secret", "password", "GOCSPX-…"]],
  },
  discord: {
    blurb: "Read what's new in your servers' channels and post messages (you confirm each post).",
    steps: () => `<ol class="steps">
      <li>Open the ${ext("https://discord.com/developers/applications", "Discord developer portal")} and click <strong>New Application</strong>, name it Jarvis.</li>
      <li>On the <strong>Bot</strong> page click <strong>Reset Token</strong> and copy it. Further down, turn on <strong>Message Content Intent</strong> and click Save.</li>
      <li>Paste the token below and click <strong>Connect</strong>, then use the invite link Jarvis shows to add the bot to your server.</li></ol>
      <p class="secondary conn-note">Discord doesn't let apps read your personal DMs: Jarvis works in the servers you add the bot to.</p>`,
    fields: [["bot_token", "Bot token", "password", "Paste the bot token"]],
  },
  notion: {
    blurb: "Search, read and write your Notion pages and databases. No keys needed: click Connect and allow access.",
    steps: () => "",
    fields: [],
  },
};
const LOGO = { spotify: "#1DB954", google: "#4285F4", discord: "#5865F2", notion: "#111" };

function statusLine(c) {
  if (c.connected) return `<span class="status-dot ok"></span>Connected${c.account ? " · " + esc(c.account) : ""}${c.tool_count ? ` · ${c.tool_count} tools` : ""}`;
  if (c.error) return `<span class="status-dot bad"></span>${esc(c.error)}`;
  return `<span class="status-dot"></span>Not connected`;
}

function card(c) {
  const s = SETUP[c.id] && c.preset ? SETUP[c.id] : null;
  const letter = esc((c.name || "?")[0].toUpperCase());
  const fields = (s?.fields || []).map(([k, label, type, ph]) => {
    const saved = (k === "client_id" && c.client_id) ? c.client_id : "";
    const has = (k === "client_secret" && c.has_secret) || (k === "bot_token" && c.has_token);
    return `<div class="field"><label>${label}</label><input class="input" data-field="${k}" type="${type}" value="${esc(saved)}" placeholder="${has ? "Saved. Paste a new one to replace it." : esc(ph)}" autocomplete="off" spellcheck="false"></div>`;
  }).join("");
  const custom = !c.preset;
  const isMcp = c.kind === "mcp_http" || c.kind === "mcp_stdio";
  const btns = c.connected
    ? `<button class="btn sm" data-act="test" type="button">${icon("check")}<span>Test</span></button>
       <button class="btn sm ghost danger" data-act="${custom ? "remove" : "disconnect"}" type="button">${custom ? "Remove" : "Disconnect"}</button>`
    : `<button class="btn sm primary" data-act="connect" type="button">${icon("link")}<span>${c.error && /sign in|Signed out/i.test(c.error) ? "Sign in again" : "Connect"}</span></button>
       ${custom ? `<button class="btn sm ghost danger" data-act="remove" type="button">Remove</button>` : ""}`;
  const where = custom ? `<small class="conn-where">${esc(c.url || [c.command, ...(c.args || [])].join(" "))}</small>` : "";
  return `<div class="conn-card${c.connected ? " on" : ""}" data-id="${esc(c.id)}">
    <div class="conn-top">
      <span class="conn-logo" style="--c:${LOGO[c.id] || "var(--accent)"}">${letter}</span>
      <span class="grow"><strong>${esc(c.name)}</strong><small>${statusLine(c)}</small>${where}</span>
      <span class="row-btns">${btns}</span>
    </div>
    ${s?.blurb ? `<p class="secondary conn-blurb">${s.blurb}</p>` : ""}
    ${!c.connected && s && (s.steps() || fields) ? `<details class="conn-setup"><summary>How to set it up</summary>${s.steps()}${fields ? `<div class="field-row">${fields}</div>` : ""}</details>` : ""}
    ${c.connected && isMcp ? `<div class="setting-row conn-opt"><label class="desc"><strong>Ask before changes</strong><span>Jarvis shows an Allow button before anything that creates, edits or deletes in ${esc(c.name)}. Reading never asks.</span></label><label class="switch"><input type="checkbox" data-opt="ask_writes" ${c.ask_writes !== false ? "checked" : ""}><span class="sr-only">Ask before changes</span></label></div>
      <details class="conn-tools"><summary>What it can do (${c.tool_count})</summary><p class="secondary">${c.tools.map(esc).join(" · ")}</p></details>` : ""}
    <div class="test-out" data-out role="status"></div>
  </div>`;
}

async function loadConnectors() {
  const box = $("#connCards");
  let r;
  try { r = await api("/api/connectors"); } catch (e) { box.innerHTML = `<div class="error-state"><h3>Couldn't load connectors</h3><p>${esc(e.message)}</p></div>`; return; }
  redirect = r.redirect_uri || redirect;
  const order = ["spotify", "google", "discord", "notion"];
  const list = r.connectors.slice().sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  box.innerHTML = list.map(card).join("");
  $$(".conn-card", box).forEach(el => wire(el, list.find(c => c.id === el.dataset.id)));
  $$("[data-copy]", box).forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); });
}

function say(el, text, ok) { const o = $("[data-out]", el); o.className = "test-out " + (ok === undefined ? "" : ok ? "ok" : "bad"); o.innerHTML = text; }

// Opens the app's sign-in page and waits until Jarvis says it's connected
async function signIn(el, c, url) {
  const w = window.open(url, "_blank", "width=560,height=760");
  say(el, `Sign in in the window that opened${w ? "" : ` (or ${ext(esc(url), "open it here")})`}, then come back.`);
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await api("/api/connectors").catch(() => null);
    const now = r?.connectors.find(x => x.id === c.id);
    if (now?.connected) { toast(`${c.name} connected`); loadConnectors(); return; }
    if (now?.error && i > 1) { say(el, esc(now.error), false); return; }
  }
}

function wire(el, c) {
  $$("[data-act]", el).forEach(b => b.onclick = async () => {
    const act = b.dataset.act;
    if (IS_REMOTE) { toast("Connect apps on the PC"); return; }
    b.disabled = true;
    try {
      if (act === "connect") {
        const fields = {};
        $$("[data-field]", el).forEach(i => { if (i.value.trim()) fields[i.dataset.field] = i.value.trim(); });
        if (Object.keys(fields).length) await api(`/api/connectors/${c.id}/setup`, fields);
        say(el, "Connecting…");
        const r = await api(`/api/connectors/${c.id}/connect`, {});
        if (r.error) { say(el, esc(r.error), false); return; }
        if (r.auth_url) { signIn(el, c, r.auth_url); return; }
        await loadConnectors();
        const el2 = $(`.conn-card[data-id="${c.id}"]`);
        if (r.invite_url) say(el2, `Connected. Now ${ext(esc(r.invite_url), "invite the bot to your server")} and pick your server.`, true);
        else toast(`${c.name} connected`);
      } else if (act === "test") {
        say(el, "Checking…");
        const r = await api(`/api/connectors/${c.id}/test`, {});
        if (r.error) say(el, esc(r.error), false);
        else say(el, esc(r.message) + (r.invite_url ? ` ${ext(esc(r.invite_url), "Invite link")}` : ""), true);
      } else if (act === "disconnect" || act === "remove") {
        const ok = await confirmDialog({ title: `${act === "remove" ? "Remove" : "Disconnect"} ${c.name}?`, body: "Jarvis will forget its sign-in on this PC. You can connect it again any time.", confirm: act === "remove" ? "Remove" : "Disconnect", danger: true });
        if (!ok) return;
        await api(act === "remove" ? `/api/connectors/${c.id}` : `/api/connectors/${c.id}/disconnect`, act === "remove" ? undefined : {}, act === "remove" ? "DELETE" : undefined);
        loadConnectors();
      }
    } catch (e) { say(el, esc(e.message), false); }
    finally { b.disabled = false; }
  });
  $$("[data-opt]", el).forEach(i => i.onchange = () => api(`/api/connectors/${c.id}/setup`, { [i.dataset.opt]: i.checked }).catch(e => toast(e.message)));
}

async function addCustom() {
  const out = $("#mcpAddOut"), b = $("#mcpAddBtn");
  const where = $("#mcpWhere").value.trim();
  if (!where) { $("#mcpWhere").focus(); return; }
  const isUrl = /^https?:\/\//i.test(where);
  b.disabled = true; out.className = "test-out"; out.textContent = "Connecting…";
  try {
    const r = await api("/api/connectors/add", { name: $("#mcpName").value.trim() || hostName(where), url: isUrl ? where : "", command: isUrl ? "" : where, token: $("#mcpToken").value, keywords: $("#mcpWords").value });
    if (r.error && !r.id) { out.className = "test-out bad"; out.textContent = r.error; return; }
    ["#mcpName", "#mcpWhere", "#mcpToken", "#mcpWords"].forEach(s => $(s).value = "");
    out.textContent = "";
    await loadConnectors();
    const el = $(`.conn-card[data-id="${r.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (r.auth_url) signIn(el, { id: r.id, name: r.id }, r.auth_url);
    else if (r.error) say(el, esc(r.error), false);
    else say(el, `Connected: ${r.tools} tools.`, true);
  } catch (e) { out.className = "test-out bad"; out.textContent = e.message; }
  finally { b.disabled = false; }
}
const hostName = u => { try { return new URL(u).hostname.replace(/^(www|mcp|api)\./, "").split(".")[0]; } catch (_) { return u.split(/[\\/ ]/).pop().slice(0, 20); } };

/* ---------- skills ---------- */
let skills = [], editing = null;
async function loadSkills() {
  let r;
  try { r = await api("/api/skills"); } catch (e) { $("#skillHead").textContent = "Couldn't load skills"; $("#skillPath").textContent = e.message; return; }
  skills = r.skills;
  $("#skillHead").textContent = skills.length ? `${skills.length} skill${skills.length === 1 ? "" : "s"}` : "No skills yet";
  $("#skillPath").textContent = r.folder;
  $("#skillList").innerHTML = skills.length ? skills.map((s, i) => `<div class="skill-row">
      <span class="grow"><strong>${esc(s.name)}</strong><small>${esc(s.description || "No description")}</small></span>
      <span class="row-btns"><button class="btn sm" data-sk-edit="${i}" type="button">Edit</button><button class="icon-btn tooltip" data-sk-del="${i}" data-tip="Delete" aria-label="Delete ${esc(s.name)}" type="button">${icon("trash")}</button></span>
    </div>`).join("")
    : `<p class="secondary">Try saying: "When I say study mode, open my Notion study page and play lo-fi on Spotify."</p>`;
  $$("[data-sk-edit]").forEach(b => b.onclick = () => openEditor(skills[+b.dataset.skEdit]));
  $$("[data-sk-del]").forEach(b => b.onclick = async () => {
    const s = skills[+b.dataset.skDel];
    if (!(await confirmDialog({ title: `Delete "${s.name}"?`, body: "Jarvis will forget this routine.", confirm: "Delete", danger: true }))) return;
    await api(`/api/skills/${encodeURIComponent(s.name)}`, undefined, "DELETE").catch(e => toast(e.message));
    loadSkills();
  });
}
function openEditor(s) {
  editing = s || null;
  $("#skillEditor").hidden = false;
  $("#skillEdTitle").textContent = s ? `Edit "${s.name}"` : "New skill";
  $("#skName").value = s?.name || ""; $("#skDesc").value = s?.description || ""; $("#skSteps").value = s?.instructions || "";
  $("#skOut").textContent = "";
  $("#skName").focus();
}
async function saveSkill() {
  const name = $("#skName").value.trim(), steps = $("#skSteps").value.trim();
  if (!name || !steps) { $("#skOut").className = "test-out bad"; $("#skOut").textContent = "Give it a name and the steps."; return; }
  try {
    await api("/api/skills", { name, description: $("#skDesc").value.trim(), instructions: steps, old_name: editing?.name || "" });
    $("#skillEditor").hidden = true; toast("Skill saved"); loadSkills();
  } catch (e) { $("#skOut").className = "test-out bad"; $("#skOut").textContent = e.message; }
}

export function loadConnectorPages() { loadConnectors(); loadSkills(); }

export function initConnectors() {
  $("#mcpAddBtn").onclick = addCustom;
  $("#skillNew").onclick = () => openEditor(null);
  $("#skSave").onclick = saveSkill;
  $("#skCancel").onclick = () => { $("#skillEditor").hidden = true; };
  $("#skillOpen").onclick = async () => { try { await api("/api/skills/open", {}); } catch (e) { toast(e.message); } setTimeout(loadSkills, 4000); };
  addEventListener("message", e => { if (e.origin === location.origin && e.data && "jarvisConnector" in e.data) loadConnectors(); });
  addEventListener("focus", () => { if ($("#set-skills")?.classList.contains("active") && $("#skillEditor").hidden) loadSkills(); });
}
