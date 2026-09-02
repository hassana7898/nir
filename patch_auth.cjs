const fs = require('fs');

let content = fs.readFileSync('./services/authService.ts', 'utf8');

const importStatement = `
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
`;

content = importStatement + content;

content = content.replace(/localStorage\.setItem\(PASSWORD_SALT_KEY/g, 'setItemAndSync(PASSWORD_SALT_KEY');
content = content.replace(/localStorage\.setItem\(PASSWORD_HASH_KEY/g, 'setItemAndSync(PASSWORD_HASH_KEY');

fs.writeFileSync('./services/authService.ts', content, 'utf8');
