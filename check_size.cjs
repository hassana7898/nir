const fs = require('fs');

const raw = fs.readFileSync('firebase-applet-config.json', 'utf8'); // Wait, the backup JSON is NOT a file in the workspace!
