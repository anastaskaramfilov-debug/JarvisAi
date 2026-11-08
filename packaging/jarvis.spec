# PyInstaller recipe for Jarvis.exe (built by GitHub Actions, see .github/workflows/build.yml)
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = SPECPATH + "/.."
datas = [(ROOT + "/web", "web"), (ROOT + "/jarvis.ico", ".")]
for extra in ("version.txt", "repo.txt"):
    import os
    if os.path.exists(ROOT + "/" + extra):
        datas.append((ROOT + "/" + extra, "."))
binaries, hiddenimports = [], ["jarvis_server", "jarvis_connectors"]
for pkg in ("faster_whisper", "ctranslate2", "onnxruntime", "av", "webview", "pystray", "sounddevice",
            "_sounddevice_data", "edge_tts", "ddgs", "primp", "icalendar", "recurring_ical_events", "x_wr_timezone",
            "tzdata", "pypdf", "qrcode", "certifi", "tokenizers", "huggingface_hub", "clr_loader", "pythonnet"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:
        print("skip", pkg, e)
try:
    hiddenimports += collect_submodules("winrt")
except Exception as e:
    print("skip winrt", e)

a = Analysis([ROOT + "/jarvis_app.py"], pathex=[ROOT], binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             excludes=["tkinter", "matplotlib", "IPython", "pytest"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Jarvis", icon=ROOT + "/jarvis.ico",
          console=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name="Jarvis", upx=False)
