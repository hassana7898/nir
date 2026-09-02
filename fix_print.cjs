const fs = require('fs');
let code = fs.readFileSync('utils/print.tsx', 'utf8');

code = code.replace(
`    const activeProductIds = new Set<string>();
    settings.feedQuotas?.forEach(q => { if(q.quotaPerChick > 0) activeProductIds.add(q.productId); });
    data.sentData.forEach((weight, id) => { if(weight > 0) activeProductIds.add(id); });

    const columns = settings.products.filter(p => {
        if (p.type !== "finishedGood") return false;
        if (!activeProductIds.has(p.id)) return false;
        if ((data.sentData.get(p.id) || 0) > 0) return true;
        if (brood.activeProductsAtCreation) return brood.activeProductsAtCreation.includes(p.id);
        return !p.isDeleted;
    });`,
`    const columns = settings.products.filter(p => {
        if (p.type !== "finishedGood") return false;
        if ((data.sentData.get(p.id) || 0) > 0) return true;
        if (brood.activeProductsAtCreation) return brood.activeProductsAtCreation.includes(p.id);
        return !p.isDeleted;
    });`
);

code = code.replace(
`                    <div>تعداد جوجه: {toPersianNumerals(brood.chickCount.toLocaleString())}</div>
                    <div>سن گله: {toPersianNumerals(data.daysOfBrood)} روز</div>
                    <div>مصرف سرانه: {toPersianNumerals(data.perCapitaConsumption)} گرم</div>
                </div>`,
`                    <div>تعداد جوجه: {toPersianNumerals(brood.chickCount.toLocaleString())}</div>
                    <div>سن گله: {toPersianNumerals(data.daysOfBrood)} روز</div>
                    <div>مصرف سرانه: {toPersianNumerals(data.perCapitaConsumption)} گرم</div>
                    {data.conversionRate && <div>ضریب تبدیل: {toPersianNumerals(data.conversionRate)}</div>}
                </div>`
);

fs.writeFileSync('utils/print.tsx', code);
