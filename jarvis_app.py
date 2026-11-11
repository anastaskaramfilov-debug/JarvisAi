"""Jarvis desktop app (Jarvis.exe).

Starts Jarvis's server and shows him in his own window, with a tray icon by the clock.
Closing the window keeps Jarvis running in the tray (reminders and announcements keep working);
"Quit Jarvis" in the tray menu stops him. Starting Jarvis.exe again (or Ctrl+Alt+J) brings the window back.

Flags: --background  start in the tray without opening the window (used when Windows starts)
       --after-restart  wait for the previous Jarvis to close first (used by updates and Restart)
"""
import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

PORT = 5005
URL = f"http://127.0.0.1:{PORT}"


def _get(path, timeout=1.0):
    try:
        with urllib.request.urlopen(URL + path, timeout=timeout) as r:
            return r.status, r.read()
    except Exception:
        return 0, b""


def _post(path, timeout=2.0):
    try:
        req = urllib.request.Request(URL + path, data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except Exception:
        return 0


def server_up():
    return _get("/api/ping", 0.8)[0] == 200


STATE = {"window": None, "maxed": False, "no_tray": False}


class Api:
    """Called from the page's own window buttons (minimise, maximise, close).

    Holds no attributes on purpose: pywebview walks every public attribute of this object to expose it to the
    page, and walking into the window object loops forever (the window then stops responding)."""

    def minimize(self):
        STATE["window"].minimize()

    def toggle_maximize(self):
        w = STATE["window"]
        if STATE["maxed"]:
            w.restore()
        else:
            w.maximize()
        STATE["maxed"] = not STATE["maxed"]
        return STATE["maxed"]

    def close(self):
        w = STATE["window"]
        w.destroy() if STATE["no_tray"] else w.hide()      # normally stays in the tray

    def is_app(self):
        return True


def main():
    args = sys.argv[1:]
    background = "--background" in args

    if "--after-restart" in args:              # let the old Jarvis finish closing
        for _ in range(50):
            if not server_up():
                break
            time.sleep(0.5)
        time.sleep(0.7)

    if server_up():
        status, body = _get("/api/version")
        try:
            info = json.loads(body or b"{}")
        except Exception:
            info = {}
        if info.get("app"):                    # Jarvis.exe is already running: just show its window
            if not background:
                _post("/api/app/show")
            return
        _post("/api/shutdown")                 # the old Jarvis (from the launcher script): hand over
        for _ in range(30):
            if not server_up():
                break
            time.sleep(0.5)

    os.environ["JARVIS_NO_BROWSER"] = "1"
    # Jarvis speaks on his own (announcements, briefings): let audio play without a click first
    os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required")
    t0 = time.time()

    # The window opens straight away with a "starting" screen; the server starts behind it
    import webview
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True   # buttons in the top bar stay clickable
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.settings["ALLOW_DOWNLOADS"] = True
    api = Api()
    window = webview.create_window(
        "Jarvis", html=SPLASH, js_api=api, width=1500, height=920, min_size=(960, 640), frameless=True,
        easy_drag=False, hidden=background, background_color="#0E0D14", text_select=True)
    STATE["window"] = window
    quitting = {"now": False}
    tray_ref = {"icon": None}

    def on_closing():
        if quitting["now"] or tray_ref["icon"] is None:   # no tray icon to come back from: closing quits
            return True
        window.hide()                                     # keep running in the tray
        return False
    window.events.closing += on_closing
    window.events.maximized += lambda: STATE.update(maxed=True)
    window.events.restored += lambda: STATE.update(maxed=False)

    def show():
        window.show()
        window.restore()
        window.on_top = True
        window.on_top = False

    def quit_app():
        quitting["now"] = True
        try:
            tray_ref["icon"].stop()
        except Exception:
            pass
        window.destroy()
        os._exit(0)

    def boot():
        try:
            import jarvis_server as S
        except Exception as e:
            window.evaluate_js(f"document.getElementById('msg').textContent = {json.dumps('Jarvis could not start: ' + str(e))}")
            return
        S.APP_HOOKS["show"] = show
        S.APP_HOOKS["quit"] = quit_app
        threading.Thread(target=S.main, daemon=True).start()
        for _ in range(240):
            if server_up():
                break
            time.sleep(0.25)
        S.log_error(f"Startup: server ready after {time.time() - t0:.1f}s")
        window.load_url(URL)
        try:
            import pystray
            from PIL import Image
            img = Image.open(S.RES / "jarvis.ico")
            tray = pystray.Icon("Jarvis", img, "Jarvis", menu=pystray.Menu(
                pystray.MenuItem("Open Jarvis", lambda *_: show(), default=True),
                pystray.MenuItem("Quit Jarvis", lambda *_: quit_app())))
            tray.run_detached()
            tray_ref["icon"] = tray
        except Exception as e:
            STATE["no_tray"] = True
            S.log_error(f"Tray icon unavailable: {e}")

    data = Path(os.environ.get("JARVIS_DATA") or Path(os.environ.get("APPDATA", str(Path.home()))) / "Jarvis")
    storage = data / "webview"
    storage.mkdir(parents=True, exist_ok=True)
    res = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    webview.start(boot, gui="edgechromium", private_mode=False, storage_path=str(storage), icon=str(res / "jarvis.ico"))
    os._exit(0)


# Shown for the second or two while the server starts (no server needed for this page)
SPLASH = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0E0D14;color:#C9C6E0;font:15px 'Segoe UI',system-ui,sans-serif;
  display:grid;place-items:center;overflow:hidden;user-select:none;cursor:default}
.o{width:120px;height:120px;border-radius:50%;margin:0 auto 26px;
  background:radial-gradient(circle at 38% 35%,#B9AEFF,#6E5BFF 45%,#2A1F7A 75%);
  box-shadow:0 0 60px #6E5BFF88,0 0 140px #6E5BFF33;animation:p 1.6s ease-in-out infinite}
@keyframes p{50%{transform:scale(1.07);box-shadow:0 0 80px #6E5BFFaa,0 0 180px #6E5BFF44}}
p{margin:0;text-align:center;letter-spacing:.04em}
</style></head><body class="pywebview-drag-region"><div><div class="o"></div><p id="msg">Starting Jarvis…</p></div></body></html>"""

if __name__ == "__main__":
    main()
