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
  echo [مرحله 1] Node.js پیدا نشد.
  echo لطفاً Node.js نسخه LTS را نصب کنید و دوباره همین فایل را اجرا کنید.
  echo دانلود رسمی: https://nodejs.org/en/download
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo Node.js: %NODE_VERSION%

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

echo.
echo [مرحله 3] نصب کتابخانه‌های NIR...
call npm install
if errorlevel 1 (
  echo [خطا] نصب کتابخانه‌ها ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [مرحله 4] ساخت نسخه Production...
call npm run build
if errorlevel 1 (
  echo [خطا] ساخت برنامه ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [مرحله 5] بررسی اتصال PostgreSQL...
node "installer\check-db.cjs"
if errorlevel 1 (
  echo [خطا] اتصال NIR به PostgreSQL برقرار نشد.
  pause
  exit /b 1
)

echo.
echo [مرحله 6] تنظیم اجرای خودکار Windows...
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
echo آدرس روی Mini PC: http://localhost:3000
echo آدرس داخل شبکه:   http://IP-MINI-PC:3000
echo.
echo برای اجرای دستی: start.bat
echo برای پشتیبان‌گیری: backup.bat
echo.
echo اکنون NIR اجرا می‌شود...
timeout /t 2 /nobreak >nul
start.bat
