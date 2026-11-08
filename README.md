# J.A.R.V.I.S.

A personal AI assistant for Windows: voice, reminders, email, music, markets, PC control, connectors (Spotify,
Google Calendar & Drive, Discord, Notion, any MCP app) and skills.

## Install
Download **Jarvis-Setup-x.y.z.exe** from [Releases](../../releases/latest) and run it.
It installs for your Windows account only (no admin needed). Open Jarvis from the Start menu or with **Ctrl+Alt+J**.
Jarvis checks this repo for new releases and updates himself.

Your settings, keys and memory are stored in `%APPDATA%\Jarvis` on your PC, never in this repository.
Keys are encrypted with Windows' own protection (DPAPI).

## Build
Push a tag like `v2.2.0`: GitHub Actions builds `Jarvis.exe` with PyInstaller, wraps it in an Inno Setup installer
and publishes it as a release (see `.github/workflows/build.yml`).

Run from source: `Start Jarvis.bat` once (creates a Python environment), then `Jarvis.vbs`.
