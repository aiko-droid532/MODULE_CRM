const path = require('path');
// Load environment variables
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- Checking Units with Deals and Payments ---');
    
    // Query units, their deals and payments
    const res = await client.query(`
      SELECT 
        u.id as unit_id,
        u.number as unit_number,
        u.status as unit_status,
        d.id as deal_id,
        d.status as deal_status,
        (SELECT COUNT(*) FROM "PaymentSchedule" WHERE "dealId" = d.id) as total_payments,
        (SELECT COUNT(*) FROM "PaymentSchedule" WHERE "dealId" = d.id AND status = 'PAID') as paid_payments
      FROM "Unit" u
      LEFT JOIN "Deal" d ON u.id = d."unitId"
      ORDER BY u.number ASC
    `);

    res.rows.forEach(row => {
      console.log(`Unit №${row.unit_number} (ID: ${row.unit_id})`);
      console.log(`  Unit Status: ${row.unit_status}`);
      if (row.deal_id) {
        console.log(`  Deal ID: ${row.deal_id}`);
        console.log(`  Deal Status: ${row.deal_status}`);
        console.log(`  Payments: ${row.paid_payments} paid / ${row.total_payments} total`);
      } else {
        console.log(`  No Deal`);
      }
    });

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
