@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
title NIR - راه‌اندازی PostgreSQL

echo ========================================
echo     NIR - راه‌اندازی خودکار PostgreSQL
echo ========================================
echo.

set "PSQL="
for /f "delims=" %%P in ('where psql 2^>nul') do if not defined PSQL set "PSQL=%%P"
if not defined PSQL (
  for /d %%D in ("C:\Program Files\PostgreSQL\*") do if exist "%%~fD\bin\psql.exe" set "PSQL=%%~fD\bin\psql.exe"
)
if not defined PSQL (
  echo [خطا] psql پیدا نشد.
  echo PostgreSQL را نصب کنید و سپس دوباره install.bat را اجرا کنید.
  pause
  exit /b 1
)

echo PostgreSQL پیدا شد: %PSQL%
echo.
set "PGADMIN_PASSWORD="
set /p "PGADMIN_PASSWORD=رمز کاربر postgres را وارد کنید: "
echo.
if "%PGADMIN_PASSWORD%"=="" (
  echo [خطا] رمز وارد نشده است.
  pause
  exit /b 1
)

set "NIR_DB_USER=nir_app"
set "NIR_DB_NAME=nir"
set "NIR_DB_PASSWORD="
for /f "delims=" %%R in ('powershell -NoProfile -Command "$b=New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).Replace('+','').Replace('/','').Replace('=','')"') do set "NIR_DB_PASSWORD=%%R"
if not defined NIR_DB_PASSWORD set "NIR_DB_PASSWORD=NirLocal_2026_ChangeThis"

set "PGPASSWORD=%PGADMIN_PASSWORD%"
"%PSQL%" -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nir_app') THEN CREATE ROLE nir_app LOGIN PASSWORD '%NIR_DB_PASSWORD%'; ELSE ALTER ROLE nir_app WITH LOGIN PASSWORD '%NIR_DB_PASSWORD%'; END IF; END $$;" >nul
if errorlevel 1 (
  echo [خطا] ورود به PostgreSQL یا ساخت کاربر انجام نشد.
  set "PGPASSWORD="
  pause
  exit /b 1
)

"%PSQL%" -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname='nir'" | findstr /r /c:"1" >nul
if errorlevel 1 (
  "%PSQL%" -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE nir OWNER nir_app;" >nul
  if errorlevel 1 (
    echo [خطا] ساخت دیتابیس nir انجام نشد.
    set "PGPASSWORD="
    pause
    exit /b 1
  )
) else (
  "%PSQL%" -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE nir OWNER TO nir_app;" >nul
)
set "PGPASSWORD="

>config.bat echo @echo off
>>config.bat echo set "DATABASE_URL=postgresql://nir_app:%NIR_DB_PASSWORD%@localhost:5432/nir"
>>config.bat echo set "DATABASE_SSL=false"
>>config.bat echo set "PORT=3000"
>>config.bat echo set "NODE_ENV=production"
>>config.bat echo set "GEMINI_API_KEY="
>>config.bat echo set "GEMINI_MODEL=gemini-2.5-flash"
>>config.bat echo set "CLOUD_SYNC_URL="
>>config.bat echo set "CLOUD_SYNC_TOKEN="

set "PGADMIN_PASSWORD="
echo.
echo PostgreSQL با موفقیت برای NIR آماده شد.
echo تنظیمات اتصال به صورت محلی در config.bat ذخیره شد.
echo.
exit /b 0
