// Dark / light / match-Windows theme. The choice is kept in this browser and in Jarvis's settings.
import { $, $$, api, state } from "./core.js";
import { icon } from "./icons.js";

const media = matchMedia("(prefers-color-scheme: light)");
let pref = "light";

const resolve = p => (p === "auto" ? (media.matches ? "light" : "dark") : p);

export function applyTheme(p, { animate = true, save = true } = {}) {
  pref = ["dark", "light", "auto"].includes(p) ? p : "light";
  const root = document.documentElement;
  const next = resolve(pref);
  if (animate && root.dataset.theme !== next) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 420);
  }
  root.dataset.theme = next;
  // the window's own buttons (installed app) take this colour, so they blend in
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#0A0C1C" : "#F4F3F0");
  try { localStorage.setItem("jarvis.theme", pref); } catch (_) {}
  const b = $("#themeBtn");
  if (b) {
    b.innerHTML = icon(next === "dark" ? "sun" : "moon");
    b.setAttribute("aria-label", next === "dark" ? "Switch to light mode" : "Switch to dark mode");
    b.dataset.tip = next === "dark" ? "Light mode" : "Dark mode";
  }
  $$("[data-theme-choice]").forEach(x => x.setAttribute("aria-checked", String(x.dataset.themeChoice === pref)));
  if (save) api("/api/config", { theme: pref }).catch(() => {});
}

export function initTheme() {
  // White glass became the default look: switch to it once, after that your own choice is kept.
  let first = false;
  try {
    first = !localStorage.getItem("jarvis.theme.v2");
    pref = first ? "light" : (localStorage.getItem("jarvis.theme") || "light");
    localStorage.setItem("jarvis.theme.v2", "1");
  } catch (_) {}
  applyTheme(pref, { animate: false, save: first });
  migrated = first;
  $("#themeBtn").onclick = () => applyTheme(resolve(pref) === "dark" ? "light" : "dark");
  $$("[data-theme-choice]").forEach(x => x.onclick = () => applyTheme(x.dataset.themeChoice));
  media.addEventListener("change", () => { if (pref === "auto") applyTheme("auto", { save: false }); });
}

// Settings saved on the PC win over this browser (e.g. after reinstalling)
let migrated = false;
export function syncThemeFromConfig(c) {
  if (migrated) { migrated = false; return; }      // the one-time switch to white wins over the old saved choice
  if (c && c.theme && ["dark", "light", "auto"].includes(c.theme) && c.theme !== pref) applyTheme(c.theme, { save: false });
}
