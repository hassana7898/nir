const fs = require('fs');
let code = fs.readFileSync('components/BroodDetailsCard.tsx', 'utf8');

const replacement = `        let baseInvoices: Exit[] = [];
        
        // Find next brood for the same farmer to prevent overlap
        let effectiveEndTime = new Date().getTime();
        if (brood.endDate) {
            const broodEnd = new Date(brood.endDate);
            broodEnd.setHours(23, 59, 59, 999);
            effectiveEndTime = broodEnd.getTime();
        } else {
            // No end date, cap at the start of the next brood (if any)
            try {
                const dataService = require('../services/dataService');
                const allFarmerBroods = dataService.getBroods().filter(b => b.farmerId === farmer.id && b.id !== brood.id);
                const broodStartTime = new Date(brood.startDate).getTime();
                const nextBroods = allFarmerBroods.filter(b => new Date(b.startDate).getTime() > broodStartTime);
                if (nextBroods.length > 0) {
                    nextBroods.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
                    const nextBroodStart = new Date(nextBroods[0].startDate);
                    nextBroodStart.setHours(0, 0, 0, 0);
                    effectiveEndTime = nextBroodStart.getTime() - 1;
                }
            } catch(e) {}
        }

        if (brood.startInvoiceId) {
            const startInvoice = farmerExits.find(e => e.id === brood.startInvoiceId);
            if (startInvoice) {
                baseInvoices = farmerExits.filter(e => e.createdAt >= startInvoice.createdAt);
                baseInvoices = baseInvoices.filter(e => {
                    const exitDate = new Date(e.date);
                    exitDate.setHours(12, 0, 0, 0);
                    return exitDate.getTime() <= effectiveEndTime;
                });
            }
        } else {
            const broodStart = new Date(brood.startDate);
            broodStart.setHours(0, 0, 0, 0);
            const broodStartTime = broodStart.getTime();

            baseInvoices = farmerExits.filter(exit => {
                const exitDate = new Date(exit.date);
                exitDate.setHours(12, 0, 0, 0);
                const exitTime = exitDate.getTime();
                return exitTime >= broodStartTime && exitTime <= effectiveEndTime;
            });
        }`;

code = code.replace(/        let baseInvoices: Exit\[\] = \[\];[\s\S]*?return exitTime >= broodStartTime && exitTime <= broodEndTime;\s*\}\s*\}/, replacement);

fs.writeFileSync('components/BroodDetailsCard.tsx', code);
