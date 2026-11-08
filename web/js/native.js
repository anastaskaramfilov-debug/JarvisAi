// When Jarvis runs as his own app (Jarvis.exe), the window has no Windows title bar:
// the top bar becomes the drag area and gets its own minimise / maximise / close buttons.
import { $, $$ } from "./core.js";


const ICONS = {
  min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2"/></svg>',
  max: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  rest: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="3.6" width="6.4" height="6.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4 3.6V2.6a.6.6 0 0 1 .6-.6H9.4a.6.6 0 0 1 .6.6v4.8a.6.6 0 0 1-.6.6H8.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.2"/></svg>',
};

function setup() {
  const api = window.pywebview && window.pywebview.api;
  if (!api || document.documentElement.classList.contains("native")) return;
  document.documentElement.classList.add("native");
  const header = $(".app-header");
  ["", " .brand", " .header-spacer", " .wordmark", " .brand-mark"].forEach(sel => {
    const el = sel ? header.querySelector(sel.trim()) : header;
    if (el) el.classList.add("pywebview-drag-region");
  });
  const box = document.createElement("div");
  box.className = "win-controls";
  box.innerHTML = `<button type="button" data-w="min" aria-label="Minimise">${ICONS.min}</button>
    <button type="button" data-w="max" aria-label="Maximise">${ICONS.max}</button>
    <button type="button" data-w="close" class="win-close" aria-label="Close (Jarvis keeps running in the tray)" title="Jarvis keeps running in the tray by the clock">${ICONS.close}</button>`;
  header.appendChild(box);
  const maxBtn = box.querySelector('[data-w="max"]');
  const toggle = async () => { const m = await api.toggle_maximize(); maxBtn.innerHTML = m ? ICONS.rest : ICONS.max; maxBtn.setAttribute("aria-label", m ? "Restore" : "Maximise"); };
  box.querySelector('[data-w="min"]').onclick = () => api.minimize();
  maxBtn.onclick = toggle;
  box.querySelector('[data-w="close"]').onclick = () => api.close();
  header.addEventListener("dblclick", e => { if (e.target.classList.contains("pywebview-drag-region")) toggle(); });
  // Features that only make sense in a browser
  $$("#installGroup, #miniBtn").forEach(el => { el.hidden = true; el.classList.add("native-hide"); });
}

export function initNative() {
  if (window.pywebview && window.pywebview.api) setup();
  window.addEventListener("pywebviewready", setup);
}
