@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo        NIR - GitHub Update Tool
echo ========================================
echo.

echo [1/5] Checking Git repository...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: This file must be placed inside the NIR project folder.
  pause
  exit /b 1
)

echo [2/5] Downloading latest version from GitHub...
git fetch origin main
if errorlevel 1 (
  echo ERROR: Could not contact GitHub.
  pause
  exit /b 1
)

git diff --quiet
if errorlevel 1 (
  echo.
  echo WARNING: Local tracked changes were detected.
  echo They will NOT be deleted automatically.
  echo Please review them before updating.
  pause
  exit /b 1
)

echo [3/5] Updating project to main...
git pull --ff-only origin main
if errorlevel 1 (
  echo ERROR: Git update failed. No files were changed by this script.
  pause
  exit /b 1
)

echo [4/5] Installing/updating dependencies...
npm install
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

echo [5/5] Building NIR...
npm run build
if errorlevel 1 (
  echo ERROR: NIR build failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo        NIR UPDATE COMPLETED
 echo ========================================
echo.
echo Existing .env and PostgreSQL data were not modified by this script.
echo.
echo If NIR is currently running in another window/service, restart it normally.
echo Production command: npm start
 echo.
pause
