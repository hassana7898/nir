const PASSWORD_SET_KEY = 'poultryAppPasswordConfigured';
const LEGACY_PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const LEGACY_PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';
const CLOUD_API_BASE = (import.meta as any).env?.VITE_CLOUD_STORAGE_URL?.replace(/\/$/, '') || '';

const clearLegacyBrowserCredentials = () => {
    localStorage.removeItem(LEGACY_PASSWORD_HASH_KEY);
    localStorage.removeItem(LEGACY_PASSWORD_SALT_KEY);
};

const request = async (base: string, path: string, options: RequestInit = {}): Promise<Response> => fetch(`${base}${path}`, {
    ...options,
    credentials: base ? 'include' : 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
});

const api = async (path: string, options: RequestInit = {}): Promise<Response> => {
    try {
        const localResponse = await request('', path, options);
        if (localResponse.ok || !CLOUD_API_BASE) return localResponse;
        // Authentication endpoints must be available even when the Mini PC is off.
        if (localResponse.status < 500 && localResponse.status !== 401) return localResponse;
    } catch {}
    if (!CLOUD_API_BASE) throw new Error('Authentication server unavailable');
    return request(CLOUD_API_BASE, path, options);
};

/** Server is the authentication source of truth; no password or password hash is stored in the browser. */
export const initializeAuth = async (): Promise<boolean> => {
    clearLegacyBrowserCredentials();
    try {
        const response = await api('/api/auth/status');
        if (!response.ok) throw new Error(`Auth status failed: ${response.status}`);
        const data = await response.json();
        const configured = Boolean(data.passwordSet);
        if (configured) localStorage.setItem(PASSWORD_SET_KEY, 'true');
        else localStorage.removeItem(PASSWORD_SET_KEY);
        return configured;
    } catch (error) {
        console.error('Authentication initialization failed:', error);
        return localStorage.getItem(PASSWORD_SET_KEY) === 'true';
    }
};

export const isPasswordSet = (): boolean => localStorage.getItem(PASSWORD_SET_KEY) === 'true';

export const setPassword = async (password: string): Promise<void> => {
    if (password.length < 4) throw new Error('Password must be at least 4 characters');
    const response = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not set password');
    }
    localStorage.setItem(PASSWORD_SET_KEY, 'true');
    clearLegacyBrowserCredentials();
};

export const clearPassword = async (): Promise<void> => {
    const response = await api('/api/auth/clear-password', { method: 'POST' });
    if (!response.ok) throw new Error('Could not clear password');
    localStorage.removeItem(PASSWORD_SET_KEY);
    clearLegacyBrowserCredentials();
    sessionStorage.removeItem(SESSION_KEY);
};

export const verifyPassword = async (password: string): Promise<boolean> => {
    try {
        const response = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
        if (!response.ok) return false;
        const data = await response.json();
        return Boolean(data.ok);
    } catch (error) {
        console.error('Login failed:', error);
        return false;
    }
};

export const login = (): void => sessionStorage.setItem(SESSION_KEY, 'true');

export const logout = (): void => {
    sessionStorage.removeItem(SESSION_KEY);
    void api('/api/auth/logout', { method: 'POST' }).catch(() => {});
};

export const isAuthenticated = (): boolean => sessionStorage.getItem(SESSION_KEY) === 'true';
