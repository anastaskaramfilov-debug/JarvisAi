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


class Api:
    """Called from the page's own window buttons (minimise, maximise, close)."""
    def __init__(self):
        self.window = None
        self.maxed = False
        self.no_tray = False

    def minimize(self):
        self.window.minimize()

    def toggle_maximize(self):
        if self.maxed:
            self.window.restore()
        else:
            self.window.maximize()
        self.maxed = not self.maxed
        return self.maxed

    def close(self):
        self.window.destroy() if self.no_tray else self.window.hide()   # normally stays in the tray

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
    import jarvis_server as S

    threading.Thread(target=S.main, daemon=True).start()
    for _ in range(120):
        if server_up():
            break
        time.sleep(0.5)

    import webview
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True   # buttons in the top bar stay clickable
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.settings["ALLOW_DOWNLOADS"] = True
    api = Api()
    window = webview.create_window(
        "Jarvis", URL, js_api=api, width=1500, height=920, min_size=(960, 640), frameless=True, easy_drag=False,
        hidden=background, background_color="#F4F3F0", text_select=True)
    api.window = window
    quitting = {"now": False}

    def on_closing():
        if quitting["now"] or tray is None:    # no tray icon to come back from: closing quits
            return True
        window.hide()                          # keep running in the tray
        return False
    window.events.closing += on_closing
    window.events.maximized += lambda: setattr(api, "maxed", True)
    window.events.restored += lambda: setattr(api, "maxed", False)

    def show():
        window.show()
        window.restore()
        window.on_top = True
        window.on_top = False
    S.APP_HOOKS["show"] = show

    def quit_app():
        quitting["now"] = True
        try:
            tray.stop()
        except Exception:
            pass
        window.destroy()
        os._exit(0)
    S.APP_HOOKS["quit"] = quit_app

    tray = None
    try:
        import pystray
        from PIL import Image
        img = Image.open(S.RES / "jarvis.ico")
        tray = pystray.Icon("Jarvis", img, "Jarvis", menu=pystray.Menu(
            pystray.MenuItem("Open Jarvis", lambda *_: show(), default=True),
            pystray.MenuItem("Quit Jarvis", lambda *_: quit_app())))
        tray.run_detached()
    except Exception as e:
        tray = None
        api.no_tray = True
        S.log_error(f"Tray icon unavailable: {e}")

    storage = S.DATA / "webview"
    storage.mkdir(parents=True, exist_ok=True)
    webview.start(gui="edgechromium", private_mode=False, storage_path=str(storage), icon=str(S.RES / "jarvis.ico"))
    os._exit(0)


if __name__ == "__main__":
    main()
