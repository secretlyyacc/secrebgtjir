// scripts/sync-stock.js
const stockSync = require('../server/services/stockSync.service');

async function main() {
    console.log('='.repeat(60));
    console.log('🔍 Stock Synchronization Tool');
    console.log('='.repeat(60));

    const args = process.argv.slice(2);
    
    if (args.includes('--report') || args.includes('-r')) {
        console.log('\n📊 Generating detailed stock report...\n');
        const report = await stockSync.getDetailedStockReport();
        
        if (report) {
            console.log('Stock Report:');
            console.log('-'.repeat(40));
            report.products.forEach(p => {
                const status = p.needsUpdate ? '❌ NEEDS UPDATE' : '✅ SYNCED';
                console.log(`${p.name}:`);
                console.log(`  • JSON Stock: ${p.stockInJson}`);
                console.log(`  • Actual: ${p.actualAvailable}`);
                console.log(`  • Total Accounts: ${p.totalAccounts}`);
                console.log(`  • Sold: ${p.soldAccounts}`);
                console.log(`  • Status: ${status}\n`);
            });
        }
    } else {
        console.log('\n🔄 Syncing stock...\n');
        const result = await stockSync.syncStock();
        
        if (result.success) {
            console.log('✅ Sync completed successfully!');
            if (result.updated) {
                console.log('📦 Stock was updated');
            } else {
                console.log('📦 No changes needed');
            }
        } else {
            console.log('❌ Sync failed:', result.error);
        }
    }
    
    console.log('='.repeat(60));
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = main;
