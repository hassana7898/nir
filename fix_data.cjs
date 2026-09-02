const fs = require('fs');

let content = fs.readFileSync('./services/dataService.ts', 'utf8');

// Fix the infinite recursion
content = content.replace(
    'const setItemAndSync = (key: string, value: string) => {\n    setItemAndSync(key, value);',
    'const setItemAndSync = (key: string, value: string) => {\n    localStorage.setItem(key, value);'
);

// We also need to check initializeFirebaseSync where it calls setItemAndSync(doc.id, data.value) and change it back to localStorage
content = content.replace(
    /setItemAndSync\(doc\.id, data\.value\);/g,
    'localStorage.setItem(doc.id, data.value);'
);

content = content.replace(
    /setItemAndSync\(change\.doc\.id, data\.value\);/g,
    'localStorage.setItem(change.doc.id, data.value);'
);

fs.writeFileSync('./services/dataService.ts', content, 'utf8');
