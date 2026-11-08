// Jarvis service worker: makes the phone app installable. Everything is live data, so it never serves stale pages.
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html" } })));
});

// Shown when Jarvis isn't running. It reloads by itself as soon as Jarvis answers.
const OFFLINE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#05060D;color:#cfd3ef;font:15px system-ui;text-align:center;padding:24px">
<div><div style="width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0 8%,#9C8BFF 34%,#4A5BFF 70%,#2B1C8F)"></div>
<b id="t">Can't reach Jarvis</b><p id="m" style="opacity:.7;max-width:420px">Make sure your PC is on, Jarvis is running and Tailscale is connected on this phone.</p>
<button onclick="location.reload()" style="margin:8px 6px 0;padding:10px 18px;border-radius:99px;border:1px solid #3a3d66;background:#15183a;color:#fff">Try again</button></div>
<script>
var pc = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
if (pc) {
  document.getElementById("t").textContent = "Jarvis isn't running";
  document.getElementById("m").textContent = "Press Ctrl+Alt+J to start it. This page opens Jarvis by itself as soon as it's ready.";
}
setInterval(function () { fetch("/api/ping", { cache: "no-store" }).then(function (r) { if (r.ok) location.reload(); }).catch(function () {}); }, 2000);
</script></body>`;
