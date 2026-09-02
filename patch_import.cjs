const fs = require('fs');

let content = fs.readFileSync('./services/dataService.ts', 'utf8');

content = content.replace(
    /export const importData = \(jsonData: string\): void => \{[\s\S]*?\}\n\};/,
    `export const importData = async (jsonData: string): Promise<void> => {
    const allData = JSON.parse(jsonData);
    localStorage.clear();
    const promises = [];
    for (const key in allData) {
        const val = allData[key];
        const stringValue = typeof val === 'string' ? val : JSON.stringify(val);
        localStorage.setItem(key, stringValue);
        if (!isSyncingFromFirebase) {
             promises.push(setDoc(doc(db, 'poultryData', key), { value: stringValue }).catch(e => console.error("Firebase sync error", e)));
        }
    }
    await Promise.all(promises);
};`
);

fs.writeFileSync('./services/dataService.ts', content, 'utf8');

let settings = fs.readFileSync('./pages/SettingsPage.tsx', 'utf8');
settings = settings.replace(
    /dataService\.importData\(jsonData\);\n\s*Swal\.fire/g,
    `await dataService.importData(jsonData);
                        Swal.fire`
);

settings = settings.replace(
    /if \(result\.isConfirmed\) \{\n\s*dataService\.importData/g,
    `if (result.isConfirmed) {
                        await dataService.importData`
);

settings = settings.replace(
    /confirmButtonText: 'بله، جایگزین کن!',\n\s*cancelButtonText: 'انصراف'\n\s*\}\)\.then\(\(result\) => \{/g,
    `confirmButtonText: 'بله، جایگزین کن!',
                    cancelButtonText: 'انصراف'
                }).then(async (result) => {`
);

fs.writeFileSync('./pages/SettingsPage.tsx', settings, 'utf8');
