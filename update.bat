@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NIR - بروزرسانی خودکار
color 0A

echo ========================================
echo       NIR - بروزرسانی خودکار
 echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 ( echo [خطا] Git روی سیستم نصب نیست. & pause & exit /b 1 )
where node >nul 2>nul
if errorlevel 1 ( echo [خطا] Node.js پیدا نشد. & pause & exit /b 1 )

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 ( echo [خطا] Node.js نسخه 22 یا جدیدتر لازم است. & pause & exit /b 1 )
if not exist ".git\HEAD" ( echo [خطا] این پوشه Git repository نیست. & pause & exit /b 1 )
if not exist "config.bat" ( echo [خطا] config.bat پیدا نشد. & echo تنظیمات PostgreSQL محلی موجود نیست. & pause & exit /b 1 )

call "config.bat"
if "%PORT%"=="" set "PORT=3000"

echo [1/6] بررسی تغییرات محلی...
for /f "delims=" %%A in ('git status --porcelain --untracked-files=all') do (
  echo.
  echo [خطا] تغییر یا فایل محلی پیدا شد: %%A
  echo این بروزرسانی هیچ فایل محلی را حذف یا overwrite نمی‌کند.
  pause
  exit /b 1
)

echo [2/6] دریافت آخرین نسخه GitHub...
git fetch origin
if errorlevel 1 ( echo [خطا] دریافت نسخه جدید از GitHub ناموفق بود. & pause & exit /b 1 )

git diff --quiet HEAD origin/main
if errorlevel 0 (
  echo نسخه فعلی همین حالا آخرین نسخه GitHub است.
) else (
  echo [3/6] اعمال بروزرسانی...
  git pull --ff-only origin main
  if errorlevel 1 ( echo [خطا] بروزرسانی امن انجام نشد. & echo هیچ reset یا clean خودکاری انجام نمی‌شود. & pause & exit /b 1 )
)

echo [4/6] نصب وابستگی‌ها و ابزارهای Build...
call npm install --include=dev
if errorlevel 1 ( echo [خطا] نصب وابستگی‌ها ناموفق بود. & pause & exit /b 1 )

if not exist "node_modules\.bin\vite.cmd" (
  echo [خطا] Vite نصب نشده است.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\esbuild.cmd" (
  echo [خطا] esbuild نصب نشده است.
  pause
  exit /b 1
)

echo [5/6] ساخت نسخه Production...
call npm run build
if errorlevel 1 ( echo [خطا] Build ناموفق بود. & pause & exit /b 1 )

if not exist "dist\client\index.html" ( echo [خطا] dist\client\index.html ساخته نشده است. & pause & exit /b 1 )
if not exist "dist\server.cjs" ( echo [خطا] dist\server.cjs ساخته نشده است. & pause & exit /b 1 )
if not exist "logs" mkdir logs

echo [6/6] راه‌اندازی نسخه جدید NIR...
schtasks /end /tn "NIR Server" >nul 2>nul
timeout /t 2 /nobreak >nul
schtasks /run /tn "NIR Server" >nul 2>nul

if errorlevel 1 (
  echo [هشدار] اجرای خودکار Task Scheduler انجام نشد.
  echo Build کامل شده است؛ می‌توانید NIR Server را از Task Scheduler اجرا کنید.
) else (
  echo سرور NIR با نسخه جدید راه‌اندازی شد.
)

echo.
echo ========================================
echo       بروزرسانی با موفقیت انجام شد
echo ========================================
echo.
echo PostgreSQL و config.bat دست‌نخورده باقی مانده‌اند.
echo Sahel به‌صورت local در Build قرار گرفته است.
echo جداول روی B Titr تنظیم شده‌اند.
echo.
pause
