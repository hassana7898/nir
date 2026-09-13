import {
  clearOfflineSession,
  hasOfflineSession,
  isPasswordSetOffline,
  markSetupComplete,
  refreshOfflineSessionFromLogin,
  verifyOfflinePassword,
} from './offlineAuth';

// Timeout for the login request. Must be generous: a slow first load (auth JS +
// assets) must never abort a request that the backend is about to answer with 200.
const LOGIN_TIMEOUT_MS = 15000;
const AUTH_CHECK_TIMEOUT_MS = 8000;

const withTimeout = async <T>(promiseFactory: (signal: AbortSignal) => Promise<T>, ms = AUTH_CHECK_TIMEOUT_MS): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    window.clearTimeout(timeout);
  }
};

export const getAuthHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('nir_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Machine-readable login outcome. The UI must map these to distinct messages and
 * must NEVER interpret anything other than INVALID_CREDENTIALS as a wrong password.
 */
export type LoginFailureCode =
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface LoginSuccess {
  ok: true;
  /** true when the login was accepted by the offline verifier (server unreachable). */
  offline: boolean;
}

export interface LoginFailure {
  ok: false;
  code: LoginFailureCode;
  message: string;
  status?: number;
}

export type LoginResult = LoginSuccess | LoginFailure;

export const isLoginFailure = (result: LoginResult): result is LoginFailure => !result.ok;

export const loginErrorMessage = (failure: LoginFailure): string => {
  switch (failure.code) {
    case 'INVALID_CREDENTIALS':
      return failure.message || 'نام کاربری یا رمز عبور اشتباه است.';
    case 'RATE_LIMITED':
      return 'تعداد تلاش‌های ناموفق زیاد شده است. لطفاً چند دقیقه بعد دوباره تلاش کنید.';
    case 'SERVER_ERROR':
      return 'خطای سرور. لطفاً کمی بعد دوباره تلاش کنید.';
    case 'NETWORK':
      return 'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.';
    case 'TIMEOUT':
      return 'پاسخ سرور دیر رسید. لطفاً دوباره تلاش کنید.';
    default:
      return failure.message || 'ورود ناموفق بود. دوباره تلاش کنید.';
  }
};

export const isPasswordSet = async (): Promise<boolean> => {
  try {
    const response = await withTimeout(signal => fetch('/api/auth/status', {
      credentials: 'include',
      headers: getAuthHeaders(),
      signal,
    }));
    if (!response.ok) return isPasswordSetOffline();
    const setup = Boolean((await response.json()).setup);
    if (setup) await markSetupComplete();
    return setup;
  } catch {
    return isPasswordSetOffline();
  }
};

export const setPassword = async (password: string): Promise<void> => {
  const response = await withTimeout(signal => fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    credentials: 'include',
    signal,
    body: JSON.stringify({ password })
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Setup failed');
  if (payload.token) window.localStorage.setItem('nir_token', payload.token);
  await refreshOfflineSessionFromLogin(password, payload.user);
};

/**
 * Authenticate against the server.
 *
 * Contract (this is the fix for the "successful login reported as wrong password" bug):
 *  - A 200 response with success !== false is SUCCESS. It is never converted into a
 *    failure by a timeout, an offline check, or any post-login side effect.
 *  - Only 401/403 (or an explicit `success:false`) means "wrong credentials".
 *  - 429 / 5xx / network / timeout produce their own distinct codes.
 *  - Offline verification is used ONLY when the server could not be reached at all.
 */
export const verifyPassword = async (password: string): Promise<LoginResult> => {
  let response: Response;
  try {
    response = await withTimeout(signal => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify({ password })
    }), LOGIN_TIMEOUT_MS);
  } catch (error) {
    const timedOut = Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');

    // Offline-first: accept a locally remembered password only when the request
    // never reached the server. This can no longer mask a successful server login.
    try {
      if (await verifyOfflinePassword(password)) return { ok: true, offline: true };
    } catch {
      // Offline verifier unavailable - fall through to the network error.
    }

    return timedOut
      ? { ok: false, code: 'TIMEOUT', message: 'پاسخ سرور دیر رسید. لطفاً دوباره تلاش کنید.' }
      : { ok: false, code: 'NETWORK', message: 'ارتباط با سرور برقرار نشد.' };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({} as { error?: string }));
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'INVALID_CREDENTIALS', message: payload?.error || 'نام کاربری یا رمز عبور اشتباه است.', status: response.status };
    }
    if (response.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', message: payload?.error || 'تعداد تلاش‌ها زیاد شده است.', status: response.status };
    }
    if (response.status >= 500) {
      return { ok: false, code: 'SERVER_ERROR', message: payload?.error || 'خطای سرور.', status: response.status };
    }
    return { ok: false, code: 'UNKNOWN', message: payload?.error || `خطای نامشخص (HTTP ${response.status}).`, status: response.status };
  }

  const payload = await response.json().catch(() => ({} as { success?: boolean; token?: string; user?: unknown; error?: string }));
  if (payload && payload.success === false) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: payload.error || 'نام کاربری یا رمز عبور اشتباه است.', status: 200 };
  }

  // ---- SUCCESS from this point on. Side effects are best-effort only. ----
  try {
    if (payload?.token) window.localStorage.setItem('nir_token', payload.token);
  } catch {
    // localStorage unavailable (private mode/quota) - the session cookie still works.
  }
  try {
    await refreshOfflineSessionFromLogin(password, payload?.user as { id?: string; username?: string; role?: string } | undefined);
  } catch {
    // The offline cache is an optimisation; it must never fail a valid login.
  }

  return { ok: true, offline: false };
};

export const login = (): void => {};

export const logout = async (): Promise<void> => {
  try {
    await withTimeout(signal => fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
      signal,
    }), 2500);
  } catch {
    // Local logout must still succeed when the server is unavailable.
  } finally {
    window.localStorage.removeItem('nir_token');
    await clearOfflineSession();
  }
};

export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const response = await withTimeout(signal => fetch('/api/auth/me', {
      credentials: 'include',
      headers: getAuthHeaders(),
      signal,
    }));
    if (response.ok) return true;
    if (response.status === 401 || response.status === 403) {
      window.localStorage.removeItem('nir_token');
      await clearOfflineSession();
    }
    return false;
  } catch {
    return hasOfflineSession();
  }
};
