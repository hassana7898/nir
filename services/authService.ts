import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

const PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';

const saveLocal = (key: string, value: string) => localStorage.setItem(key, value);
const removeLocalAuth = () => {
    localStorage.removeItem(PASSWORD_HASH_KEY);
    localStorage.removeItem(PASSWORD_SALT_KEY);
};

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

// Kept for compatibility with the existing password format and local migration.
const hashPassword = (password: string, salt: string): string => {
    const data = new TextEncoder().encode(password + salt);
    return bytesToHex(sha256(data));
};

const api = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    return response;
};

/** Server is now the authentication source of truth. Password hashes remain server-side. */
export const initializeAuth = async (): Promise<boolean> => {
    try {
        const response = await api('/api/auth/status');
        if (!response.ok) throw new Error(`Auth status failed: ${response.status}`);
        const data = await response.json();
        // Remove old browser-stored credentials; they must never be relied upon for remote access.
        removeLocalAuth();
        return Boolean(data.passwordSet);
    } catch (error) {
        console.error('Authentication initialization failed:', error);
        // Do not authenticate from a browser cache when the server is unavailable.
        removeLocalAuth();
        return false;
    }
};

export const isPasswordSet = (): boolean => Boolean(localStorage.getItem(PASSWORD_HASH_KEY) && localStorage.getItem(PASSWORD_SALT_KEY));

export const setPassword = async (password: string): Promise<void> => {
    if (password.length < 4) throw new Error('Password must be at least 4 characters');
    const response = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not set password');
    }
    removeLocalAuth();
};

export const clearPassword = async (): Promise<void> => {
    // Password clearing is intentionally authenticated server-side through the storage API.
    // The existing settings flow writes empty auth records through dataService, but browser-only
    // password deletion would be unsafe. Keep local state cleared after the server confirms.
    const response = await api('/api/storage/poultryData/poultryAppPasswordSalt', { method: 'PUT', body: JSON.stringify({ value: '' }) });
    if (!response.ok) throw new Error('Could not clear password');
    const response2 = await api('/api/storage/poultryData/poultryAppPasswordHash', { method: 'PUT', body: JSON.stringify({ value: '' }) });
    if (!response2.ok) throw new Error('Could not clear password');
    removeLocalAuth();
    await api('/api/auth/logout', { method: 'POST' });
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

export const login = (): void => {
    sessionStorage.setItem(SESSION_KEY, 'true');
};

export const logout = (): void => {
    sessionStorage.removeItem(SESSION_KEY);
    void api('/api/auth/logout', { method: 'POST' });
};

export const isAuthenticated = (): boolean => sessionStorage.getItem(SESSION_KEY) === 'true';

// Prevent unused compatibility helpers from being removed during future refactors.
void hashPassword;
void randomBytes;
void saveLocal;
