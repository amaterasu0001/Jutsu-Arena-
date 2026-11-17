@echo off
setlocal
title Naruto Jutsu Arena
cd /d "%~dp0"

echo.
echo   NARUTO JUTSU ARENA
echo   ------------------
echo.

if not exist "backend\.venv\Scripts\python.exe" goto setup
if not exist "frontend\node_modules" goto setup
goto launch

:setup
echo   First run: installing dependencies (this takes a few minutes)...
where python >nul 2>nul
if errorlevel 1 (
  echo   Python 3.10+ was not found on PATH. Install it from https://www.python.org and try again.
  pause
  exit /b 1
)
python scripts\setup_project.py
if errorlevel 1 (
  echo   Setup failed. See the messages above.
  pause
  exit /b 1
)

:launch
rem A second copy of a server cannot bind its port, and a second Vite would
rem also rebuild the shared dependency cache under the running one. So each
rem server is started only when its port is free.
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if errorlevel 1 (
  echo   Starting backend  on http://127.0.0.1:8000
  start "Jutsu Arena - backend" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
) else (
  echo   Backend already running on port 8000 - not starting another copy.
)

netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if errorlevel 1 (
  echo   Starting frontend on http://localhost:5173
  start "Jutsu Arena - frontend" /D "%~dp0frontend" cmd /k "npm run dev"
) else (
  echo   Frontend already running on port 5173 - not starting another copy.
)

echo.
echo   Opening the browser in a few seconds...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173

echo   Both servers run in their own windows. Close those windows to stop them.
echo.
endlocal
