const fs = require('fs');
let code = fs.readFileSync('components/BroodDetailsCard.tsx', 'utf8');

code = code.replace(
`    const getProductPhaseInfo = (currentProductId: string, productQuota: number, sentAmount: number) => {
        const getPhaseDuration = (prodId: string) => settings.productPhaseDurations?.[prodId] || 10;
        const finishedGoods = settings.products.filter(p => p.type === 'finishedGood');`,
`    const getProductPhaseInfo = (currentProductId: string, productQuota: number, sentAmount: number) => {
        const getPhaseDuration = (prodId: string) => settings.productPhaseDurations?.[prodId] || 10;
        const finishedGoods = settings.products.filter(p => {
            if (p.type !== 'finishedGood') return false;
            if (brood.activeProductsAtCreation) {
                return brood.activeProductsAtCreation.includes(p.id);
            }
            return !p.isDeleted;
        });`
);

fs.writeFileSync('components/BroodDetailsCard.tsx', code);
