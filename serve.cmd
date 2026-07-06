@echo off
REM ============================================================
REM  Intro DS AI - Study Deck launcher
REM  Runs the app over http://localhost so browser "file:// is a
REM  unique origin" errors (SVG icons, cross-origin AI calls) vanish.
REM  Double-click this file. Close the window to stop the server.
REM ============================================================
cd /d "%~dp0"
set PORT=8000
echo Starting Study Deck at http://localhost:%PORT% ...
start "" http://localhost:%PORT%/index.html
python -m http.server %PORT% 2>nul || py -m http.server %PORT% 2>nul || npx --yes http-server -p %PORT% .
