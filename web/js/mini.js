// Mini mode: a small Jarvis window that stays on top of other apps and games (Document Picture-in-Picture).
import { $, state, on, emit } from "./core.js";
import { icon } from "./icons.js";
import { ask, talk, setCaption } from "./assistant.js";
import { stopSpeaking } from "./voice.js";

const LABEL = { idle: "Ready", processing: "Thinking", speaking: "Speaking", listening: "Listening", error: "Problem" };
let pip = null, home = null;

export const miniSupported = () => "documentPictureInPicture" in window;

export async function toggleMini() {
  if (pip) { pip.close(); return; }
  try {
    pip = await documentPictureInPicture.requestWindow({ width: 300, height: 380 });
  } catch (_) { pip = null; return; }
  const d = pip.document;
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(n => d.head.appendChild(n.cloneNode(true)));
  d.documentElement.dataset.theme = document.documentElement.dataset.theme || "dark";
  d.title = "Jarvis";
  d.body.className = "mini-body";
  d.body.innerHTML = `
    <main class="mini">
      <div class="mini-orb"></div>
      <span class="state-chip mini-state" role="status" aria-live="polite"></span>
      <p class="context-line" id="miniCaption"></p>
      <form class="mini-ask" autocomplete="off">
        <input class="input" placeholder="Ask Jarvis…" aria-label="Ask Jarvis">
        <button class="icon-btn mini-mic" type="button" aria-label="Talk (Ctrl+Space)">${icon("mic")}</button>
      </form>
      <button class="mini-back" type="button">${icon("arrow-up")}<span>Back to full Jarvis</span></button>
    </main>`;
  // The real orb moves into the mini window (and back when it closes), so it keeps reacting to everything.
  const orb = $("#orb");
  home = { parent: orb.parentNode, next: orb.nextSibling };
  d.querySelector(".mini-orb").appendChild(orb);
  emit("orb-moved");
  window.__miniCaption = d.querySelector("#miniCaption");
  setCaption("");
  const chip = d.querySelector(".mini-state");
  const sync = () => { if (!pip || pip.closed) return; chip.dataset.state = state.assistant; chip.textContent = LABEL[state.assistant] || "Ready"; };
  sync();
  if (!window.__miniSync) { window.__miniSync = true; on("assistant", () => window.__miniSyncFn && window.__miniSyncFn()); }
  window.__miniSyncFn = sync;
  const input = d.querySelector("input");
  d.querySelector("form").onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ""; ask(t); } };
  d.querySelector(".mini-mic").onclick = () => talk();
  d.querySelector(".mini-back").onclick = () => { window.focus(); pip.close(); };
  d.addEventListener("keydown", e => {
    if (e.ctrlKey && e.code === "Space") { e.preventDefault(); talk(); }
    if (e.key === "Escape" && state.speaking) stopSpeaking();
  });
  pip.addEventListener("pagehide", () => {
    home.parent.insertBefore(orb, home.next);
    emit("orb-moved");
    window.__miniCaption = null;
    window.__miniSyncFn = null;
    pip = null;
    setCaption("");
    $("#miniBtn")?.setAttribute("aria-pressed", "false");
  });
  $("#miniBtn")?.setAttribute("aria-pressed", "true");
}
