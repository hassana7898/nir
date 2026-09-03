# راه‌اندازی Cloud برای NIR با Supabase

این معماری Cloudflare ندارد.

## معماری نهایی

- Mini PC کارخانه + PostgreSQL محلی = Master و محل اصلی ثبت اطلاعات
- Supabase PostgreSQL = Replica ابری
- Supabase Edge Function = API امن برای دسترسی مرورگر به Replica
- GitHub Pages = نسخه استاتیک رابط NIR برای زمانی که Mini PC خاموش است
- Tailscale Funnel = فقط برای دسترسی مستقیم به NIR محلی وقتی Mini PC روشن است

در نتیجه تلفن همراه برای نسخه ابری هیچ نرم‌افزاری لازم ندارد.

## 1. ساخت پروژه Supabase

یک پروژه رایگان بسازید و Project Reference را نگه دارید.

## 2. ساخت جدول

محتوای فایل زیر را در SQL Editor پروژه اجرا کنید:

`supabase/migrations/20260903_nir_storage.sql`

این جدول فقط از طریق Edge Function استفاده می‌شود و برای anon/authenticated دسترسی مستقیم ندارد.

## 3. انتشار Edge Function

Supabase CLI را نصب و وارد حساب شوید:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy nir-api --use-api
```

آدرس API:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/nir-api
```

## 4. ساخت Secret برای همگام‌سازی

یک مقدار تصادفی طولانی بسازید؛ مثلاً با PowerShell:

```powershell
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

همان مقدار را در Secrets تابع Supabase با نام زیر قرار دهید:

```text
NIR_CLOUD_SYNC_TOKEN
```

این مقدار را در GitHub یا کد قرار ندهید.

## 5. تنظیم Mini PC کارخانه

در فایل تنظیمات محلی NIR این دو مقدار را تنظیم کنید:

```text
CLOUD_SYNC_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/nir-api
CLOUD_SYNC_TOKEN=همان_توکن_بالا
```

`CLOUD_SYNC_TOKEN` فقط روی Mini PC باقی می‌ماند.

## 6. انتقال اولین داده‌ها

NIR روی Mini PC را روشن و اجرا کنید. تغییرات موجود در PostgreSQL محلی وارد صف Cloud می‌شوند و worker هر 10 ثانیه صف را پردازش می‌کند.

ابتدا داده‌ها از Local به Cloud کپی می‌شوند؛ Cloud منبع نوشتن عادی نیست.

## 7. GitHub Pages

Repository عمومی است، بنابراین GitHub Pages با GitHub Free قابل استفاده است.

در Settings → Pages، Source را روی **GitHub Actions** بگذارید.

در Repository Settings → Secrets and variables → Actions → Variables یک Repository Variable بسازید:

```text
NIR_CLOUD_STORAGE_URL
```

مقدار:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/nir-api
```

بعد از push به `main`، workflow زیر رابط وب را build و منتشر می‌کند:

`.github/workflows/deploy-pages.yml`

آدرس معمول سایت:

```text
https://hassana7898.github.io/nir/
```

## نکته امنیتی مهم

هیچ‌وقت `SUPABASE_SECRET_KEYS`، `service_role` یا رمز PostgreSQL را داخل Vite، GitHub Pages یا هر فایل `VITE_*` قرار ندهید. Secret فقط در Edge Function یا سرور محلی استفاده می‌شود.
