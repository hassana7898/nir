import { db } from './firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

const PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';

const saveLocal = (key: string, value: string) => {
    localStorage.setItem(key, value);
};

const saveServer = async (key: string, value: string): Promise<void> => {
    await setDoc(doc(db, 'poultryData', key), { value });
};

const bytesToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * SHA-256 must also work when NIR is opened over plain HTTP on a LAN IP.
 * Web Crypto's SubtleCrypto is restricted to secure contexts on many browsers,
 * so use the audited, browser-compatible noble-hashes implementation instead.
 * The algorithm remains SHA-256(password + salt), preserving existing passwords.
 */
const hashPassword = (password: string, salt: string): string => {
    const data = new TextEncoder().encode(password + salt);
    return bytesToHex(sha256(data));
};

/**
 * Loads authentication data from the central PostgreSQL-backed storage.
 * localStorage is only a cache; PostgreSQL is the source of truth.
 */
export const initializeAuth = async (): Promise<boolean> => {
    const localHash = localStorage.getItem(PASSWORD_HASH_KEY);
    const localSalt = localStorage.getItem(PASSWORD_SALT_KEY);

    try {
        const [hashDoc, saltDoc] = await Promise.all([
            getDoc(doc(db, 'poultryData', PASSWORD_HASH_KEY)),
            getDoc(doc(db, 'poultryData', PASSWORD_SALT_KEY)),
        ]);

        const serverHash = hashDoc.exists() ? hashDoc.data()?.value : '';
        const serverSalt = saltDoc.exists() ? saltDoc.data()?.value : '';

        if (serverHash && serverSalt) {
            saveLocal(PASSWORD_HASH_KEY, serverHash);
            saveLocal(PASSWORD_SALT_KEY, serverSalt);
            return true;
        }

        // Backward compatibility: if the central store is empty but this browser
        // already has credentials, migrate them to the central store once.
        if (localHash && localSalt) {
            await Promise.all([
                saveServer(PASSWORD_HASH_KEY, localHash),
                saveServer(PASSWORD_SALT_KEY, localSalt),
            ]);
            return true;
        }

        localStorage.removeItem(PASSWORD_HASH_KEY);
        localStorage.removeItem(PASSWORD_SALT_KEY);
        return false;
    } catch (error) {
        // If the server is temporarily unavailable, keep a valid local cache.
        console.error('Authentication initialization failed:', error);
        return Boolean(localHash && localSalt);
    }
};

export const isPasswordSet = (): boolean => {
    return Boolean(
        localStorage.getItem(PASSWORD_HASH_KEY) &&
        localStorage.getItem(PASSWORD_SALT_KEY)
    );
};

export const setPassword = async (password: string): Promise<void> => {
    const salt = bytesToHex(randomBytes(16));
    const hash = hashPassword(password, salt);

    // The server must succeed before the new password is considered configured.
    await Promise.all([
        saveServer(PASSWORD_SALT_KEY, salt),
        saveServer(PASSWORD_HASH_KEY, hash),
    ]);

    saveLocal(PASSWORD_SALT_KEY, salt);
    saveLocal(PASSWORD_HASH_KEY, hash);
};

export const clearPassword = async (): Promise<void> => {
    await Promise.all([
        saveServer(PASSWORD_SALT_KEY, ''),
        saveServer(PASSWORD_HASH_KEY, ''),
    ]);
    localStorage.removeItem(PASSWORD_SALT_KEY);
    localStorage.removeItem(PASSWORD_HASH_KEY);
};

export const verifyPassword = async (password: string): Promise<boolean> => {
    let salt = localStorage.getItem(PASSWORD_SALT_KEY);
    let storedHash = localStorage.getItem(PASSWORD_HASH_KEY);

    if (!salt || !storedHash) {
        const initialized = await initializeAuth();
        if (!initialized) return false;
        salt = localStorage.getItem(PASSWORD_SALT_KEY);
        storedHash = localStorage.getItem(PASSWORD_HASH_KEY);
    }

    if (!salt || !storedHash) return false;

    const hash = hashPassword(password, salt);
    return hash === storedHash;
};

export const login = (): void => {
    sessionStorage.setItem(SESSION_KEY, 'true');
};

export const logout = (): void => {
    sessionStorage.removeItem(SESSION_KEY);
};

export const isAuthenticated = (): boolean => {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
};
