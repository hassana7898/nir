# راه‌اندازی Cloudflare Tunnel برای دسترسی اینترنتی NIR

NIR در این معماری **Local-First** باقی می‌ماند:

- Mini PC + PostgreSQL = منبع اصلی و Master
- NIR روی Mini PC = سرویس اصلی، فعلی روی `192.168.0.49:3000`
- Cloudflare Tunnel = مسیر امن اینترنت به NIR، بدون Port Forwarding
- Cloudflare Worker + D1 = فقط Replica اضطراری خواندنی برای Snapshotهای سینک‌شده
- PostgreSQL = هرگز نباید روی اینترنت منتشر شود
- احراز هویت روزمره = همان رمز عبور ساده خود NIR؛ Cloudflare Access/MFA برای این مرحله لازم نیست

## 1. امنیتی که داخل NIR فعال است

APIهای داده، استخراج Gemini و پشتیبان‌گیری دیگر بدون ورود قابل استفاده نیستند. ورود NIR یک Session Cookie از نوع `HttpOnly` ایجاد می‌کند و Session به هش رمز فعلی سرور وابسته است؛ با تغییر/حذف رمز، Session قبلی نیز اعتبارش را از دست می‌دهد.

مرورگر دیگر نباید برای احراز هویت به password hash متکی باشد. رمز عبور فقط برای ورود به endpoint احراز هویت ارسال می‌شود و نتیجه، یک Session Cookie است.

## 2. ساخت Tunnel

برای Production از **Remotely-managed Tunnel** استفاده کنید. Cloudflare برای اکثر کاربردها همین مدل را توصیه می‌کند.

در داشبورد Cloudflare:

1. وارد **Networking → Tunnels** شوید.
2. **Create Tunnel** را بزنید.
3. یک نام مثل `nir-factory` انتخاب کنید.
4. سیستم‌عامل Windows و معماری مناسب Mini PC را انتخاب کنید.
5. دستور نصب `cloudflared` که Cloudflare نمایش می‌دهد را کپی کنید.

Cloudflare Tunnel اتصال خروجی ایجاد می‌کند؛ بنابراین برای دسترسی اینترنتی NIR نیازی به باز کردن پورت ورودی روی مودم یا فایروال ندارید.

## 3. انتشار NIR

در همان Tunnel یک **Published application** بسازید:

- Hostname: مثلاً `nir.example.com`
- Service URL: `http://192.168.0.49:3000`

اگر `cloudflared` روی همان Mini PC اجرا می‌شود، می‌توانید به‌جای IP از `http://localhost:3000` استفاده کنید.

در انتهای ingress باید catch-all با HTTP 404 وجود داشته باشد؛ اگر از تنظیمات Dashboard استفاده می‌کنید، Cloudflare آن را مدیریت می‌کند.

## 4. نصب cloudflared روی Mini PC

CMD را با **Run as administrator** باز کنید و دستور نصب مخصوص Tunnel را که Cloudflare Dashboard داده اجرا کنید. برای Tunnel مدیریت‌شده، Cloudflare فعلاً نصب سرویس Windows با Token را پشتیبانی می‌کند.

بعد از نصب، سرویس `cloudflared` باید همراه Windows اجرا شود. این مهم است چون NIR هم سرویس خودکار `NIR Server` را دارد.

## 5. فایروال و مودم

برای Tunnel نباید Port Forward برای `3000` ایجاد شود.

این‌ها را انجام ندهید:

- `3000 → 192.168.0.49:3000` روی مودم ❌
- `5432 → 192.168.0.49:5432` روی مودم ❌
- باز کردن PostgreSQL برای اینترنت ❌

NIR همچنان از داخل کارخانه با `http://192.168.0.49:3000` کار می‌کند و Tunnel از داخل Mini PC به Cloudflare وصل می‌شود.

اگر شبکه خروجی محدود باشد، Mini PC باید بتواند به Cloudflare روی پورت `7844` ارتباط خروجی داشته باشد.

## 6. تنظیم Secret مربوط به Session NIR

NIR از `NIR_SESSION_SECRET` برای امضای Session استفاده می‌کند. اگر این متغیر را در `config.bat` تنظیم نکنید، برنامه یک مقدار پایدار مشتق‌شده از `DATABASE_URL` را به‌عنوان fallback استفاده می‌کند تا نصب فعلی از کار نیفتد.

برای Production بهتر است یک Secret مستقل و تصادفی داخل `config.bat` محلی قرار دهید:

```env
NIR_SESSION_SECRET=یک_رشته_تصادفی_طولانی
NIR_SESSION_TTL_MS=43200000
```

`config.bat` در GitHub ذخیره نشود و مقدار Secret نیز هیچ‌وقت داخل کد یا `VITE_*` قرار نگیرد.

## 7. تست نهایی

بعد از نصب Tunnel و اتصال دامنه:

### داخل کارخانه

```text
http://192.168.0.49:3000
```

### خارج از کارخانه با اینترنت موبایل

```text
https://nir.example.com
```

باید صفحه ورود معمول NIR نمایش داده شود. همان رمز قبلی را وارد کنید.

پس از ورود، APIهای داده و پشتیبان‌گیری فقط با Session معتبر قابل استفاده هستند.

## 8. اگر Mini PC خاموش باشد

Tunnel هم خاموش می‌شود و آدرس اصلی NIR در دسترس نخواهد بود. در این مرحله Cloudflare D1 همچنان می‌تواند آخرین Snapshot سینک‌شده را برای حالت اضطراری نگه دارد؛ این Replica عمداً Master دوم نیست.

## 9. معماری نهایی

```text
                  اینترنت موبایل
                       │
                       ▼
              https://nir.example.com
                       │
                       ▼
               ☁️ Cloudflare
                       │
                Cloudflare Tunnel
                       │
                       ▼
              🖥️ Mini PC کارخانه
              192.168.0.49:3000
                       │
                       ▼
                 NIR / Express
                       │
                       ▼
                PostgreSQL Master

                ─────────────────

             PostgreSQL → D1 Replica
                  (اضطراری/خواندنی)
```

این طراحی باعث می‌شود دسترسی اینترنتی اضافه شود، بدون اینکه PostgreSQL یا پورت 3000 مستقیماً در اینترنت قابل دسترسی باشند.
