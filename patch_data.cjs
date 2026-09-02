const fs = require('fs');

let content = fs.readFileSync('./services/dataService.ts', 'utf8');

const importStatement = `
import { db } from './firebase';
import { doc, setDoc, onSnapshot, getDocs, collection, getDoc } from 'firebase/firestore';

// Flag to prevent loop when updating from firebase
let isSyncingFromFirebase = false;
let initializedFirebase = false;

const setItemAndSync = (key: string, value: string) => {
    localStorage.setItem(key, value);
    if (!isSyncingFromFirebase) {
        setDoc(doc(db, 'poultryData', key), { value }).catch(e => console.error("Firebase sync error", e));
    }
};

export const initializeFirebaseSync = async (onUpdate: () => void) => {
    if (initializedFirebase) return;
    initializedFirebase = true;
    
    try {
        // Initial load
        const querySnapshot = await getDocs(collection(db, 'poultryData'));
        isSyncingFromFirebase = true;
        let dataChanged = false;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data && data.value) {
                const local = localStorage.getItem(doc.id);
                if (local !== data.value) {
                    localStorage.setItem(doc.id, data.value);
                    dataChanged = true;
                }
            }
        });
        isSyncingFromFirebase = false;
        if (dataChanged) {
            onUpdate();
        }

        // Listen for changes
        onSnapshot(collection(db, 'poultryData'), (snapshot) => {
            let changed = false;
            isSyncingFromFirebase = true;
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added" || change.type === "modified") {
                    const data = change.doc.data();
                    if (data && data.value) {
                        const local = localStorage.getItem(change.doc.id);
                        if (local !== data.value) {
                            localStorage.setItem(change.doc.id, data.value);
                            changed = true;
                        }
                    }
                }
            });
            isSyncingFromFirebase = false;
            if (changed) {
                onUpdate();
            }
        });
    } catch (e) {
        console.error("Failed to initialize Firebase sync", e);
        isSyncingFromFirebase = false;
    }
};
`;

content = importStatement + content;

// Replace all localStorage.setItem with setItemAndSync
// But wait, there are a few places where we want to keep localStorage.setItem? No, all app state should sync.
// We need to exclude the ones we already replaced or carefully replace.
content = content.replace(/localStorage\.setItem/g, 'setItemAndSync');

// Fix the importData which clears localStorage and calls setItemAndSync, that is fine.
// But migrateLegacyData uses setItemAndSync.

fs.writeFileSync('./services/dataService.ts', content, 'utf8');
