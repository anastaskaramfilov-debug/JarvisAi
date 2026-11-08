@echo off
title J.A.R.V.I.S. server
cd /d "%~dp0"
rem Stop any Jarvis that is already running, so the new one can start
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5005 ^| findstr LISTENING') do taskkill /F /PID %%p 1>NUL 2>NUL
if not exist venv\Scripts\python.exe (
  echo Creating Python environment...
  py -m venv venv
)
venv\Scripts\python -m pip install -q -r requirements.txt
venv\Scripts\python jarvis_server.py
pause
