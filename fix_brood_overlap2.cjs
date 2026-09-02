const fs = require('fs');
let code = fs.readFileSync('components/BroodDetailsCard.tsx', 'utf8');

code = code.replace(
`            try {
                const dataService = require('../services/dataService');
                const allFarmerBroods = dataService.getBroods().filter(b => b.farmerId === farmer.id && b.id !== brood.id);`,
`            try {
                const allFarmerBroods = dataService.getBroods().filter(b => b.farmerId === farmer.id && b.id !== brood.id);`
);

fs.writeFileSync('components/BroodDetailsCard.tsx', code);
