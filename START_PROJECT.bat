@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Prescripto - Full Stack Launcher
echo ==================================================
echo       PRESCRIPTO AI - FULL STACK STARTER
echo ==================================================
echo.
where node >nul 2>nul || (echo ERROR: Install Node.js LTS from https://nodejs.org/ & pause & exit /b 1)
where npm >nul 2>nul || (echo ERROR: npm was not found. Reinstall Node.js LTS. & pause & exit /b 1)
where python >nul 2>nul || (echo ERROR: Install Python 3.10+ and enable Add Python to PATH. & pause & exit /b 1)
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
if not exist "server\node_modules" (
  echo Installing backend packages...
  pushd server
  call npm install
  if errorlevel 1 (popd & goto fail)
  popd
)
if not exist "client\node_modules" (
  echo Installing frontend packages...
  pushd client
  call npm install
  if errorlevel 1 (popd & goto fail)
  popd
)
if not exist "ai-service\venv\Scripts\python.exe" (
  echo Creating Python OCR environment...
  python -m venv ai-service\venv
  if errorlevel 1 goto fail
)
echo Installing/checking OCR packages...
call ai-service\venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
if errorlevel 1 goto fail
echo.
echo Starting API, OCR service and React website in separate windows...
start "Prescripto API - 5000" /D "%~dp0server" cmd /k "npm run dev"
start "Prescripto OCR - 8000" /D "%~dp0ai-service" cmd /k "venv\Scripts\python.exe app.py"
start "Prescripto React - 5173" /D "%~dp0client" cmd /k "npm run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
echo.
echo Website: http://localhost:5173
echo API health: http://localhost:5000/api/health
echo Keep all three server windows open. MongoDB must be running/configured.
pause
exit /b 0
:fail
echo.
echo Setup failed. Read the error above. Check internet, Node.js, Python and MongoDB settings.
pause
exit /b 1
