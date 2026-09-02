
import { db } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

const setItemAndSync = (key: string, value: string) => {
    localStorage.setItem(key, value);
    setDoc(doc(db, 'poultryData', key), { value }).catch(e => console.error("Firebase sync error", e));
};

// Initial Sync from Firestore for Auth (blocking might not be possible, but we can do it via listener)
onSnapshot(doc(db, 'poultryData', 'poultryAppPasswordHash'), (docSnap) => {
    if (docSnap.exists() && docSnap.data().value) {
        localStorage.setItem('poultryAppPasswordHash', docSnap.data().value);
    }
});

onSnapshot(doc(db, 'poultryData', 'poultryAppPasswordSalt'), (docSnap) => {
    if (docSnap.exists() && docSnap.data().value) {
        localStorage.setItem('poultryAppPasswordSalt', docSnap.data().value);
    }
});

const PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';

const bufferToHex = (buffer: ArrayBuffer): string => {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

const hexToBuffer = (hex: string): ArrayBuffer => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
};

const hashPassword = async (password: string, salt: string): Promise<string> => {
    const data = new TextEncoder().encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
};

export const isPasswordSet = (): boolean => {
    return localStorage.getItem(PASSWORD_HASH_KEY) !== null;
};

export const setPassword = async (password: string): Promise<void> => {
    const salt = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    setItemAndSync(PASSWORD_SALT_KEY, salt);
    setItemAndSync(PASSWORD_HASH_KEY, hash);
};

export const clearPassword = async (): Promise<void> => {
    setItemAndSync(PASSWORD_SALT_KEY, '');
    setItemAndSync(PASSWORD_HASH_KEY, '');
    localStorage.removeItem(PASSWORD_SALT_KEY);
    localStorage.removeItem(PASSWORD_HASH_KEY);
};

export const verifyPassword = async (password: string): Promise<boolean> => {
    const salt = localStorage.getItem(PASSWORD_SALT_KEY);
    const storedHash = localStorage.getItem(PASSWORD_HASH_KEY);
    if (!salt || !storedHash) {
        return false;
    }
    const hash = await hashPassword(password, salt);
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
