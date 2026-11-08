// Application shell: navigation between views and start-up.
import { $, $$, on, emit, state } from "./core.js";
import { hydrateIcons } from "./icons.js";
import { initAssistant, openPanel, closePanel, togglePanel } from "./assistant.js";
import { initContext } from "./context.js";
import { initViews, onViewShown } from "./views.js";
import { initSettings, onSettingsShown, onCustomizeShown, showSettingsPage } from "./settings.js";
import { initTheme, syncThemeFromConfig } from "./theme.js";
import { toggleMini, miniSupported } from "./mini.js";
import { IS_REMOTE } from "./voice.js";
import { initAlive } from "./alive.js";
import { initWidgets, initUpdateCheck } from "./widgets.js";
import { initFun } from "./fun.js";
import { initNative } from "./native.js";

const TITLES = { assistant: "Assistant", tasks: "Tasks", inbox: "Inbox", markets: "Market Watch", customize: "Customize", settings: "Settings" };

function navigate(name) {
  if (name === "conversation") {           // the History button shows/hides the conversation panel
    const onHome = $("#view-assistant").classList.contains("active");
    if (!onHome) { navigate("assistant"); openPanel(); } else togglePanel();
    return;
  }
  if (!TITLES[name]) name = "assistant";
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  $("#appBody").dataset.view = name;
  $$(".nav-item[data-view]").forEach(b => {
    if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.title = name === "assistant" ? "Jarvis" : `${TITLES[name]} · Jarvis`;
  closePanel();
  if (name === "settings") onSettingsShown();
  if (name === "customize") onCustomizeShown();
  onViewShown(name);
  try { history.replaceState(null, "", name === "assistant" ? "/" : "#" + name); } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
  hydrateIcons();
  initNative();
  initTheme();
  on("config", syncThemeFromConfig);
  $$(".nav-item[data-view]").forEach(b => b.onclick = () => navigate(b.dataset.view));
  $("#settingsBtn").onclick = () => navigate("settings");
  if (miniSupported() && !IS_REMOTE) { $("#miniBtn").hidden = false; $("#miniBtn").onclick = toggleMini; }
  $("#providerBtn").onclick = () => { navigate("settings"); showSettingsPage("ai"); };
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-goto-settings]");
    if (g) { navigate("settings"); showSettingsPage(g.dataset.gotoSettings); }
    const v = e.target.closest("[data-goto]");
    if (v) navigate(v.dataset.goto);
  });
  on("navigate", navigate);
  on("open-settings", page => { navigate("settings"); showSettingsPage(page); });
  on("thread-count", n => { const c = $("#navCountConv"); if (c) { c.textContent = n > 99 ? "99+" : n; c.hidden = !n; } });

  initAlive();
  initContext();
  initWidgets();
  initUpdateCheck();
  initAssistant();
  initViews();
  initSettings();
  initFun();
  navigate((location.hash || "").slice(1) || "assistant");
  try { if (Notification.permission === "default") Notification.requestPermission(); } catch (_) {}
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
});
