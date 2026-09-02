@echo off
setlocal
cd /d "%~dp0.."

rem Creates a Windows Task Scheduler task so NIR starts after Windows logon.
set "TASK_NAME=NIR Local Server"
set "START_FILE=%CD%\start.bat"

schtasks /Create /TN "%TASK_NAME%" /TR "\"%START_FILE%\"" /SC ONLOGON /RL HIGHEST /F >nul 2>&1
if errorlevel 1 (
  echo [هشدار] اجرای خودکار تنظیم نشد. ممکن است نیاز به اجرای Installer با Run as administrator باشد.
) else (
  echo اجرای خودکار NIR فعال شد.
)
