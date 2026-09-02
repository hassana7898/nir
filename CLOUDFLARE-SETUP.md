# راه‌اندازی حالت اضطراری Cloudflare برای NIR

این معماری به‌صورت **Local-First** طراحی شده است:

- Mini PC + PostgreSQL = منبع اصلی و Master
- Cloudflare Worker + D1 = Replica اضطراری برای خواندن آخرین داده‌ها
- Cloudflare Static Assets = کپی مستقل رابط کاربری، CSS، JS، تصاویر و فونت‌های Build شده
- GitHub = فقط محل سورس‌کد و توسعه؛ اجرای روزمره به GitHub وابسته نیست
- Chabokan/Firebase = در معماری جدید استفاده نمی‌شوند

## 1. ساخت D1

```bash
npx wrangler login
npx wrangler d1 create nir-storage
```

شناسه D1 که Wrangler برمی‌گرداند را داخل `wrangler.jsonc` در `database_id` قرار دهید.

## 2. ایجاد جدول

```bash
npx wrangler d1 execute nir-storage --remote --file=cloudflare/schema.sql
```

## 3. ساخت Secret برای Sync

```bash
npx wrangler secret put SYNC_TOKEN
```

یک مقدار تصادفی و طولانی وارد کنید. همین مقدار باید فقط روی Mini PC در متغیر `CLOUD_SYNC_TOKEN` قرار بگیرد.

## 4. تنظیم آدرس Cloud روی Mini PC

در محیط اجرای Node.js روی Mini PC:

```env
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/nir
DATABASE_SSL=false
CLOUD_SYNC_URL=https://YOUR-CLOUDFLARE-DOMAIN.example
CLOUD_SYNC_TOKEN=THE_SAME_SECRET_VALUE
```

هر بار که PostgreSQL یک سند را تغییر دهد، Mini PC آن را بدون متوقف کردن تراکنش محلی به Cloudflare نیز Mirror می‌کند.

## 5. Build و Deploy رابط اضطراری

```bash
npm install
npm run cloudflare:build
npx wrangler deploy
```

Cloudflare فایل‌های داخل `dist/client` را به‌عنوان Static Assets منتشر می‌کند و `/api/storage/*` را به Worker می‌فرستد.

## 6. حالت‌های عملیاتی

### حالت عادی

`موبایل/PC -> Mini PC -> PostgreSQL`

و هم‌زمان:

`PostgreSQL -> Cloudflare D1`

### خاموش شدن Mini PC

`موبایل -> Cloudflare -> D1`

کاربر آخرین Snapshot همگام‌شده را می‌بیند.

### قطع Cloudflare

`PC/موبایل داخل کارخانه -> Mini PC -> PostgreSQL`

سیستم محلی مستقل می‌ماند.

### قطع اینترنت کارخانه

دسترسی بیرونی ممکن نیست، اما شبکه داخلی و Mini PC همچنان کار می‌کنند.

## نکته مهم

در حالت اضطراری Cloudflare، D1 فعلاً **Read Replica** است و از داخل برنامه Master دوم ساخته نمی‌شود. بنابراین هنگام برگشت Mini PC، داده‌ها دچار دو Master و Conflict ناخواسته نمی‌شوند.

اگر بعداً نیاز باشد در زمان خاموشی Mini PC نیز از موبایل «ثبت/ویرایش» انجام شود، باید مرحله دوم معماری یعنی Offline Write Queue و Conflict Resolution اضافه شود؛ این قابلیت عمداً در این مرحله فعال نشده تا یکپارچگی داده‌های کارخانه حفظ شود.
