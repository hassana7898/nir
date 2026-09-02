@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title NIR - نصب یک‌کلیکی سرور محلی

echo ========================================
echo       NIR - نصب سرور محلی کارخانه
echo ========================================
echo.
echo این برنامه را فقط روی Mini PC کارخانه اجرا کنید.
echo IP و پورت دوربین‌ها را تغییر نمی‌دهد.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js پیدا نشد.
  echo لطفاً Node.js نسخه 22 یا جدیدتر را نصب کنید و دوباره همین فایل را اجرا کنید.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo Node.js: %NODE_VERSION%

if %NODE_MAJOR% LSS 22 (
  echo [خطا] نسخه Node.js این سیستم کمتر از 22 است.
  echo نسخه LTS جدید Node.js را نصب کنید.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [خطا] npm پیدا نشد. نصب Node.js را بررسی کنید.
  pause
  exit /b 1
)

if not exist "config.bat" (
  echo.
  echo [مرحله 2] راه‌اندازی PostgreSQL...
  call "installer\setup-postgresql.bat"
  if errorlevel 1 exit /b 1
) else (
  echo [مرحله 2] config.bat موجود است؛ از تنظیمات فعلی استفاده می‌شود.
)

call "config.bat"
if "%DATABASE_URL%"=="" (
  echo [خطا] DATABASE_URL تنظیم نشده است.
  pause
  exit /b 1
)

if "%PORT%"=="" set "PORT=3000"

echo.
echo [مرحله 3] بررسی پورت برنامه...
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [خطا] پورت %PORT% در حال استفاده است.
  echo هیچ IP یا پورتی از دوربین‌ها تغییر داده نمی‌شود.
  echo ابتدا مشخص کنید چه برنامه‌ای از این پورت استفاده می‌کند.
  echo.
  netstat -ano | findstr /r /c:":%PORT% .*LISTENING"
  pause
  exit /b 1
)

echo پورت %PORT% آزاد است.

echo.
echo [مرحله 4] نصب دقیق کتابخانه‌های پروژه...
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 (
  echo [خطا] نصب کتابخانه‌ها ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [مرحله 5] ساخت نسخه Production...
call npm run build
if errorlevel 1 (
  echo [خطا] ساخت برنامه ناموفق بود.
  pause
  exit /b 1
)

if not exist "dist\client\index.html" (
  echo [خطا] فایل Production ساخته نشده است.
  pause
  exit /b 1
)
if not exist "dist\server.cjs" (
  echo [خطا] سرور Production ساخته نشده است.
  pause
  exit /b 1
)

echo.
echo [مرحله 6] بررسی اتصال PostgreSQL...
node "installer\check-db.cjs"
if errorlevel 1 (
  echo [خطا] اتصال NIR به PostgreSQL برقرار نشد.
  pause
  exit /b 1
)

echo.
echo [مرحله 7] تنظیم اجرای خودکار Windows...
call "installer\setup-autostart.bat"
if errorlevel 1 (
  echo [هشدار] اجرای خودکار تنظیم نشد، اما خود NIR نصب شده است.
)

if not exist "logs" mkdir logs

echo.
echo ========================================
echo       نصب NIR با موفقیت تمام شد
echo ========================================
echo.
echo آدرس روی Mini PC: http://localhost:%PORT%
echo آدرس داخل شبکه:   http://IP-MINI-PC:%PORT%
echo.
echo برای اجرای دستی: start.bat
echo برای پشتیبان‌گیری: backup.bat
echo.
echo اکنون NIR اجرا می‌شود...
timeout /t 2 /nobreak >nul
call start.bat
