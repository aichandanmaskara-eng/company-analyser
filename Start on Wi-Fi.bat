@echo off
title Company Analyser Online
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo.
  echo  Python is not installed. Install it free from https://www.python.org/downloads/
  echo  ^(tick "Add Python to PATH"^), then double-click this file again.
  pause
  exit /b 1
)

%PY% run_local.py
pause
