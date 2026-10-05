@echo off
rem One-click launcher: Adventure v2 with VELA v4.2 pre-selected
rem Starts the local server (if not already running) and opens the app
rem with ?model=vela so the VELA option is pre-checked in the model dialog.
setlocal
cd /d "%~dp0"
if not defined PORT set "PORT=4173"
set "URL=http://127.0.0.1:%PORT%/?model=vela"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 22 or newer first.
  pause
  exit /b 1
)

if not exist "public\models\vela-v4.2\model.bin.gz" (
  echo [!] VELA model file missing: public\models\vela-v4.2\model.bin.gz
  echo     Download model.bin.gz from the GitHub Releases page of this project.
  echo     Do NOT unzip it. Keep it at that exact path.
  echo     The page will still open - VELA will be pre-selected, but you can
  echo     pick X36 G3 in the dialog until the model file is in place.
  echo.
  pause
)

rem If the server already answers on this port, reuse it.
curl -s -o NUL "http://127.0.0.1:%PORT%/"
if not errorlevel 1 goto open

echo Starting Adventure server on port %PORT% ...
start "Adventure server" cmd /k node scripts/serve.mjs

rem Wait up to 15 seconds for the server to accept requests.
set /a tries=0
:wait
ping -n 2 127.0.0.1 >nul
curl -s -o NUL "http://127.0.0.1:%PORT%/"
if not errorlevel 1 goto open
set /a tries+=1
if %tries% lss 15 goto wait
echo The server did not respond within 15 seconds.
echo Open this address manually once it is ready: %URL%
pause
exit /b 1

:open
start "" "%URL%"
endlocal
