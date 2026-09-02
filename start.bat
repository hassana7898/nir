@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "config.bat" (
  echo [خطا] config.bat وجود ندارد.
  echo ابتدا installer\install.bat را اجرا کنید.
  pause
  exit /b 1
)

call "config.bat"

if not exist "dist\server.cjs" (
  echo [خطا] نسخه Production ساخته نشده است.
  echo ابتدا installer\install.bat را اجرا کنید.
  pause
  exit /b 1
)

if not exist "logs" mkdir logs

echo NIR Server starting on port %PORT%...
node -r "./storageBootstrap.cjs" "./dist/server.cjs" >> "logs\server.log" 2>&1
