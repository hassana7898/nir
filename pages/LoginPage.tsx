
import React, { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../utils/helpers';

const LoginPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, clearPassword } = useAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (loading) return;
        setError('');
        setLoading(true);
        try {
            const success = await login(password);
            if (success) return;

            setError('رمز عبور اشتباه است');
            showToast('رمز عبور اشتباه است', 'error');
        } catch (err) {
            console.error('Login error:', err);
            setError('ارتباط با سرور یا بررسی رمز عبور ناموفق بود. لطفاً دوباره تلاش کنید.');
            showToast('خطا در بررسی رمز عبور', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleClearPassword = async () => {
        if (loading) return;
        setError('');
        setLoading(true);
        try {
            await clearPassword();
            showToast('رمز عبور بازنشانی شد', 'success');
            window.location.reload();
        } catch (err) {
            console.error('Password reset error:', err);
            setError('بازنشانی رمز عبور ناموفق بود.');
            showToast('خطا در بازنشانی رمز عبور', 'error');
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="p-8 bg-white rounded-xl shadow-md w-full max-w-sm">
                <h1 className="text-2xl font-bold text-center text-slate-700 mb-6">ورود به سامانه</h1>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-slate-600 mb-1">رمز عبور</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full p-3 border rounded-lg text-center"
                            required
                            autoFocus
                            disabled={loading}
                        />
                        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-sky-500 text-white p-3 rounded-lg hover:bg-sky-600 transition-colors disabled:bg-sky-300"
                    >
                        {loading ? 'در حال بررسی...' : 'ورود'}
                    </button>
                    <button
                        type="button"
                        onClick={handleClearPassword}
                        disabled={loading}
                        className="w-full mt-3 bg-red-500 text-white p-3 rounded-lg hover:bg-red-600 transition-colors disabled:bg-red-300"
                    >
                        حذف رمز عبور (بازیابی)
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
