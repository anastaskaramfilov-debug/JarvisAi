// Interactive price chart (SVG): area line, previous-close line, axes, and a crosshair with the price under the cursor.
import { esc } from "./core.js";

const fmt = (v, cur) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(Math.abs(v) < 1 ? 4 : 2)) + (cur ? "" : "");
const tfmt = (ms, intraday, span) => {
  const d = new Date(ms);
  if (intraday && span < 2 * 864e5) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  if (span < 120 * 864e5) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
};

export function renderChart(box, c) {
  const pts = c.points || [];
  box.innerHTML = "";
  if (pts.length < 2) { box.innerHTML = `<p class="w-note">Not enough data for a chart.</p>`; return; }
  const up = (c.change ?? (c.close - pts[0][1])) >= 0;
  const col = up ? "var(--up)" : "var(--down)";
  const head = document.createElement("div");
  head.className = "ch-head";
  head.innerHTML = `
    <div class="ch-title"><b>${esc(c.ticker)}</b><span>${esc(c.name || "")}</span></div>
    <div class="ch-price num"><span class="ch-close">${fmt(c.close)}</span><small>${esc(c.currency || "")}</small>
      ${c.change != null ? `<span class="ch-chg ${up ? "up" : "down"}">${c.change >= 0 ? "+" : ""}${fmt(c.change)} (${c.change_percent >= 0 ? "+" : ""}${c.change_percent}%)</span>` : ""}</div>
    <div class="ch-meta num"><span>${esc(c.period)}</span><span>Open <b>${fmt(c.open)}</b></span><span>High <b>${fmt(c.high)}</b></span><span>Low <b>${fmt(c.low)}</b></span>${c.reference != null ? `<span>${c.reference_is === "previous close" ? "Prev close" : "Start"} <b>${fmt(c.reference)}</b></span>` : ""}</div>`;
  box.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "ch-plot";
  box.appendChild(wrap);
  const foot = document.createElement("p");
  foot.className = "ch-foot";
  foot.textContent = `Yahoo Finance · may be delayed up to 15 minutes${c.intraday ? " · New York time" : ""}`;
  box.appendChild(foot);

  const draw = () => {
    const W = Math.max(280, wrap.clientWidth), H = Math.max(160, wrap.clientHeight);
    const pad = { l: 8, r: 62, t: 12, b: 26 };
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[4]);
    let lo = Math.min(...pts.map(p => p[3]), c.reference ?? Infinity), hi = Math.max(...pts.map(p => p[2]), c.reference ?? -Infinity);
    const m = (hi - lo) * 0.08 || 1; lo -= m; hi += m;
    const n = pts.length, X = i => pad.l + (i / (n - 1)) * (W - pad.l - pad.r), Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const line = ys.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const area = `${line}L${X(n - 1).toFixed(1)},${H - pad.b}L${X(0).toFixed(1)},${H - pad.b}Z`;
    const ticks = 5, yt = [...Array(ticks)].map((_, i) => lo + (hi - lo) * (i + 0.5) / ticks);
    const span = xs[n - 1] - xs[0], xt = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (n - 1)));
    const gid = "g" + Math.random().toString(36).slice(2, 7);
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.ticker)} price chart, ${esc(c.period)}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${yt.map(v => `<line class="ch-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ch-axis" x="${W - pad.r + 8}" y="${Y(v) + 4}">${fmt(v)}</text>`).join("")}
      ${xt.map(i => `<text class="ch-axis" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" x="${X(i)}" y="${H - 6}">${tfmt(xs[i], c.intraday, span)}</text>`).join("")}
      ${c.reference != null ? `<line class="ch-ref" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(c.reference)}" y2="${Y(c.reference)}"/>` : ""}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="ch-line"/>
      <g class="ch-cross" visibility="hidden"><line class="ch-vline" y1="${pad.t}" y2="${H - pad.b}"/><circle r="4.5" fill="${col}" stroke="var(--option-bg)" stroke-width="2"/></g>
      <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" class="ch-hit"/>
    </svg><div class="ch-tip num" hidden></div>`;
    const svg = wrap.querySelector("svg"), cross = svg.querySelector(".ch-cross"), tip = wrap.querySelector(".ch-tip");
    const move = e => {
      const r = svg.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round((x - pad.l) / (W - pad.l - pad.r) * (n - 1))));
      const p = pts[i];
      cross.setAttribute("visibility", "visible");
      cross.querySelector("line").setAttribute("x1", X(i)); cross.querySelector("line").setAttribute("x2", X(i));
      cross.querySelector("circle").setAttribute("cx", X(i)); cross.querySelector("circle").setAttribute("cy", Y(p[4]));
      tip.hidden = false;
      tip.innerHTML = `<b>${fmt(p[4])}</b><span>${new Date(p[0]).toLocaleString([], c.intraday ? { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" } : { day: "numeric", month: "short", year: "numeric" })}</span><small>O ${fmt(p[1])} · H ${fmt(p[2])} · L ${fmt(p[3])}</small>`;
      const tx = Math.min(W - pad.r - tip.offsetWidth - 6, Math.max(pad.l, X(i) + 12));
      tip.style.left = tx + "px"; tip.style.top = Math.max(4, Y(p[4]) - 70) + "px";
    };
    const leave = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
    svg.querySelector(".ch-hit").addEventListener("pointermove", move);
    svg.querySelector(".ch-hit").addEventListener("pointerleave", leave);
    svg.querySelector(".ch-hit").addEventListener("touchmove", move, { passive: true });
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  box._ro?.disconnect(); box._ro = ro;
}

// tiny version for History thumbnails
export function chartThumb(c) {
  const ys = (c.points || []).map(p => p[4]);
  if (ys.length < 2) return "";
  const lo = Math.min(...ys), hi = Math.max(...ys), W = 120, H = 60;
  const d = ys.map((v, i) => `${i ? "L" : "M"}${(i / (ys.length - 1) * W).toFixed(1)},${(H - 4 - (v - lo) / ((hi - lo) || 1) * (H - 8)).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= (c.reference ?? ys[0]);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="2"/></svg><span class="ct-label">${esc(c.ticker)}</span>`;
}
