@echo off
rem ============================================================
rem NIR local server configuration
rem این فایل را به config.bat کپی کنید و فقط مقادیر را تغییر دهید.
rem ============================================================

rem PostgreSQL local database
set "DATABASE_URL=postgresql://nir_app:CHANGE_ME@localhost:5432/nir"
set "DATABASE_SSL=false"
set "PORT=3000"
set "NODE_ENV=production"

rem اختیاری: برای قابلیت هوش مصنوعی Gemini
rem اگر نمی‌خواهید استفاده کنید، خالی بگذارید.
set "GEMINI_API_KEY="
set "GEMINI_MODEL=gemini-2.5-flash"

rem Cloudflare emergency replica - فعلاً خالی بگذارید.
rem بعداً با هم فعال می‌کنیم.
set "CLOUD_SYNC_URL="
set "CLOUD_SYNC_TOKEN="
