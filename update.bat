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
if errorlevel 1 (
  echo [خطا] Git روی سیستم نصب نیست.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js پیدا نشد.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo [خطا] Node.js نسخه 22 یا جدیدتر لازم است.
  pause
  exit /b 1
)

if not exist ".git\HEAD" (
  echo [خطا] این پوشه Git repository نیست.
  pause
  exit /b 1
)

if not exist "config.bat" (
  echo [خطا] config.bat پیدا نشد.
  echo تنظیمات PostgreSQL محلی موجود نیست.
  pause
  exit /b 1
)

call "config.bat"
if "%PORT%"=="" set "PORT=3000"

echo [1/5] بررسی تغییرات محلی...
for /f "delims=" %%A in ('git status --porcelain --untracked-files=all') do (
  echo.
  echo [خطا] تغییر یا فایل محلی پیدا شد: %%A
  echo.
  echo این بروزرسانی هیچ فایل محلی را حذف یا overwrite نمی‌کند.
  echo تغییرات کد را مستقیماً روی Mini PC انجام ندهید؛ تغییرات را در GitHub ثبت کنید.
  pause
  exit /b 1
)

echo.
echo [2/5] دریافت آخرین نسخه GitHub...
git fetch origin
if errorlevel 1 (
  echo [خطا] دریافت نسخه جدید از GitHub ناموفق بود.
  pause
  exit /b 1
)

git diff --quiet HEAD origin/main
if errorlevel 0 (
  echo.
  echo نسخه فعلی همین حالا آخرین نسخه GitHub است.
) else (
  echo.
  echo [3/5] اعمال بروزرسانی...
  git pull --ff-only origin main
  if errorlevel 1 (
    echo [خطا] بروزرسانی امن انجام نشد.
    echo هیچ reset یا clean خودکاری انجام نمی‌شود.
    pause
    exit /b 1
  )
)

echo.
echo [4/5] نصب وابستگی‌ها...
if exist "package-lock.json" (
  echo package-lock.json پیدا شد؛ اجرای npm ci...
  call npm ci
) else (
  echo package-lock.json وجود ندارد؛ اجرای npm install...
  call npm install
)
if errorlevel 1 (
  echo [خطا] نصب وابستگی‌ها ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [5/5] ساخت نسخه Production...
call npm run build
if errorlevel 1 (
  echo [خطا] Build ناموفق بود.
  pause
  exit /b 1
)

if not exist "dist\client\index.html" (
  echo [خطا] dist\client\index.html ساخته نشده است.
  pause
  exit /b 1
)
if not exist "dist\server.cjs" (
  echo [خطا] dist\server.cjs ساخته نشده است.
  pause
  exit /b 1
)

if not exist "logs" mkdir logs

echo.
echo ========================================
echo       بروزرسانی با موفقیت انجام شد
echo ========================================
echo.
echo config.bat دست‌نخورده باقی مانده است.
echo PostgreSQL دست‌نخورده باقی مانده است.
echo.
echo برای اعمال نسخه جدید سرور، start.bat را دوباره اجرا کنید.
echo اگر NIR در یک پنجره دیگر در حال اجراست، ابتدا همان پنجره را با Ctrl+C متوقف کنید.
echo.
pause
