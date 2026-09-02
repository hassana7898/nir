@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "config.bat" (
  echo [خطا] config.bat پیدا نشد.
  pause
  exit /b 1
)
call "config.bat"

if not exist "backups" mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"

set "OUT=backups\nir_%STAMP%.sql"

where pg_dump >nul 2>nul
if errorlevel 1 (
  echo [خطا] pg_dump پیدا نشد. PostgreSQL را بررسی کنید.
  pause
  exit /b 1
)

pg_dump "%DATABASE_URL%" --format=custom --file="%OUT%"
if errorlevel 1 (
  echo [خطا] تهیه نسخه پشتیبان ناموفق بود.
  pause
  exit /b 1
)

echo پشتیبان با موفقیت ساخته شد:
echo %OUT%
pause
