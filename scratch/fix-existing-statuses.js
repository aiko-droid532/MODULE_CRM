const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- Migrating Existing Database Statuses to Match TS ---');
    
    // Fetch all deals with their payment counts
    const res = await client.query(`
      SELECT 
        d.id as deal_id,
        d."unitId" as unit_id,
        d.status as deal_status,
        (SELECT COUNT(*) FROM "PaymentSchedule" WHERE "dealId" = d.id) as total_payments,
        (SELECT COUNT(*) FROM "PaymentSchedule" WHERE "dealId" = d.id AND status = 'PAID') as paid_payments
      FROM "Deal" d
    `);

    for (const row of res.rows) {
      const { deal_id, unit_id, deal_status, total_payments, paid_payments } = row;
      if (total_payments === 0) continue;

      if (paid_payments === total_payments) {
        console.log(`Deal ${deal_id} is FULLY PAID (${paid_payments}/${total_payments}). Updating to SUCCESS and SOLD...`);
        await client.query(`
          UPDATE "Deal" SET status = 'SUCCESS'::"DealStatus", "updatedAt" = NOW() WHERE id = $1
        `, [deal_id]);
        if (unit_id) {
          await client.query(`
            UPDATE "Unit" SET status = 'SOLD'::"UnitStatus", "updatedAt" = NOW() WHERE id = $1
          `, [unit_id]);
        }
      } else if (paid_payments > 0) {
        console.log(`Deal ${deal_id} has PARTIAL PAYMENTS (${paid_payments}/${total_payments}). Updating to PAYMENT_CONFIRMED and DOWN_PAYMENT_RECEIVED...`);
        await client.query(`
          UPDATE "Deal" SET status = 'PAYMENT_CONFIRMED'::"DealStatus", "updatedAt" = NOW() WHERE id = $1
        `, [deal_id]);
        if (unit_id) {
          await client.query(`
            UPDATE "Unit" SET status = 'DOWN_PAYMENT_RECEIVED'::"UnitStatus", "updatedAt" = NOW() WHERE id = $1
          `, [unit_id]);
        }
      }
    }
    console.log('--- Database Migration Complete ---');
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
