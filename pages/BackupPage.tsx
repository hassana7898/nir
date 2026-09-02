import React, { useCallback, useEffect, useState } from 'react';
import { showToast } from '../utils/helpers';

type BackupItem = { name: string; createdAt: string; size: number };
type BackupStatus = { enabled: boolean; running: boolean; schedule: string; retentionDays: number; directory: string; lastBackup: { name: string; createdAt: string; size: number; reason: string } | null; lastError: string | null; backups: BackupItem[] };

const formatBytes = (bytes: number) => { if (!bytes) return '۰ بایت'; const units = ['بایت', 'KB', 'MB', 'GB']; let value = bytes, index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; } return `${value.toFixed(index ? 1 : 0)} ${units[index]}`; };
const toFaDate = (value: string) => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

const BackupPage: React.FC = () => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const loadStatus = useCallback(async () => { try { const response = await fetch('/api/backup/status'); if (!response.ok) throw new Error('خطا در دریافت وضعیت بکاپ'); setStatus(await response.json()); } catch (error: any) { showToast(error?.message || 'ارتباط با سرویس بکاپ برقرار نشد.', 'error'); } finally { setLoading(false); } }, []);
  useEffect(() => { void loadStatus(); const timer = window.setInterval(() => void loadStatus(), 30000); return () => window.clearInterval(timer); }, [loadStatus]);
  const createBackup = async () => { setRunning(true); try { const response = await fetch('/api/backup/run', { method: 'POST' }); const result = await response.json(); if (!result.ok && !result.skipped) throw new Error(result.error || 'تهیه بکاپ ناموفق بود.'); showToast(result.skipped ? 'یک بکاپ دیگر در حال اجراست.' : 'بکاپ با موفقیت ایجاد شد.'); await loadStatus(); } catch (error: any) { showToast(error?.message || 'تهیه بکاپ ناموفق بود.', 'error'); } finally { setRunning(false); } };
  if (loading && !status) return <div className="p-6 text-center">در حال دریافت وضعیت پشتیبان‌گیری...</div>;
  return <div dir="rtl" className="space-y-5 max-w-5xl mx-auto">
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-800">پشتیبان‌گیری خودکار</h1><p className="text-sm text-slate-500 mt-1">NIR هر روز به‌صورت خودکار از دیتابیس مرکزی PostgreSQL نسخه پشتیبان می‌گیرد.</p></div><button onClick={createBackup} disabled={running || status?.running} className="px-5 py-3 rounded-xl bg-slate-800 text-white disabled:opacity-50">{running || status?.running ? 'در حال تهیه بکاپ...' : 'ایجاد بکاپ همین حالا'}</button></div></div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5"><div className="text-sm text-slate-500">وضعیت</div><div className="text-lg font-bold mt-2">{status?.enabled ? '✓ فعال' : '✕ غیرفعال'}</div><div className="text-xs text-slate-500 mt-1">{status?.running ? 'در حال تهیه نسخه پشتیبان' : 'سرویس آماده است'}</div></div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5"><div className="text-sm text-slate-500">زمان‌بندی</div><div className="text-lg font-bold mt-2">هر روز ساعت {status?.schedule || '۰۲:۰۰'}</div><div className="text-xs text-slate-500 mt-1">نگهداری {status?.retentionDays || 30} روز</div></div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5"><div className="text-sm text-slate-500">آخرین بکاپ</div><div className="text-sm font-bold mt-2">{status?.lastBackup ? toFaDate(status.lastBackup.createdAt) : 'هنوز ثبت نشده'}</div>{status?.lastBackup && <div className="text-xs text-slate-500 mt-1">{formatBytes(status.lastBackup.size)}</div>}</div>
    </div>
    {status?.lastError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4">آخرین خطا: {status.lastError}</div>}
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden"><div className="p-5 border-b border-slate-200"><h2 className="font-bold text-slate-800">نسخه‌های موجود</h2><p className="text-xs text-slate-500 mt-1">بکاپ‌های قدیمی‌تر از مدت نگهداری خودکار حذف می‌شوند.</p></div><div className="divide-y divide-slate-100">{(status?.backups || []).length === 0 ? <div className="p-5 text-sm text-slate-500">هنوز بکاپی ایجاد نشده است.</div> : status!.backups.map(item => <div key={item.name} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><div className="font-semibold text-slate-700">{item.name}</div><div className="text-xs text-slate-500 mt-1">{toFaDate(item.createdAt)} · {formatBytes(item.size)}</div></div><a className="text-sm font-semibold text-sky-700 hover:underline" href={`/api/backup/download/${encodeURIComponent(item.name)}`}>دانلود</a></div>)}</div></div>
  </div>;
};
export default BackupPage;
