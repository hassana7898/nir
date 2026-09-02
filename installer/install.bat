@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

title NIR - نصب سرور محلی

echo ========================================
echo       NIR - نصب سرور محلی کارخانه
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js پیدا نشد.
  echo لطفاً Node.js نسخه LTS را نصب کنید و دوباره این فایل را اجرا کنید.
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
  echo فایل تنظیمات ساخته می‌شود.
  echo.
  copy /y "installer\config.example.bat" "config.bat" >nul
  echo [مهم] فایل config.bat ساخته شد.
  echo لطفاً رمز PostgreSQL را داخل آن وارد کنید و دوباره install.bat را اجرا کنید.
  echo.
  pause
  exit /b 2
)

call "config.bat"

if "%DATABASE_URL%"=="" (
  echo [خطا] DATABASE_URL در config.bat تنظیم نشده است.
  pause
  exit /b 1
)

echo.
echo [1/4] نصب کتابخانه‌های پروژه...
call npm install
if errorlevel 1 (
  echo [خطا] npm install ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [2/4] ساخت نسخه Production...
call npm run build
if errorlevel 1 (
  echo [خطا] ساخت برنامه ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [3/4] بررسی اتصال PostgreSQL...
node "installer\check-db.cjs"
if errorlevel 1 (
  echo.
  echo [خطا] اتصال به PostgreSQL برقرار نشد.
  echo رمز، نام کاربری، نام دیتابیس و روشن بودن سرویس PostgreSQL را بررسی کنید.
  pause
  exit /b 1
)

echo.
echo [4/4] ساخت Shortcut و تنظیم اجرای خودکار...
call "installer\setup-autostart.bat"

if not exist "logs" mkdir logs

echo.
echo ========================================
echo نصب NIR با موفقیت انجام شد.
echo ========================================
echo.
echo برای اجرای دستی: start.bat
 echo آدرس روی همین کامپیوتر: http://localhost:3000
 echo آدرس داخل شبکه: http://IP-MINI-PC:3000
 echo.
echo اکنون start.bat اجرا می‌شود...
timeout /t 2 /nobreak >nul
call start.bat
