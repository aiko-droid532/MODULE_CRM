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
    console.log('--- Restoring Original Statuses ---');

    // 1. Deal 6bc8aed8-2e75-483b-99ad-667d1c4979b4 -> RESERVATION, Unit be244efc-d123-4fb2-b5aa-22355c6cc998 -> RESERVATION_PAID
    await client.query(`
      UPDATE "Deal" SET status = 'RESERVATION'::"DealStatus" WHERE id = '6bc8aed8-2e75-483b-99ad-667d1c4979b4'
    `);
    await client.query(`
      UPDATE "Unit" SET status = 'RESERVATION_PAID'::"UnitStatus" WHERE id = 'be244efc-d123-4fb2-b5aa-22355c6cc998'
    `);

    // 2. Deal a030775e-8a8c-45bd-a7c5-c656aeae161f -> CONTRACT_PREPARATION, Unit 7c782cc2-9f33-4570-b655-a47f4fae2d57 -> RESERVATION_PAID
    await client.query(`
      UPDATE "Deal" SET status = 'CONTRACT_PREPARATION'::"DealStatus" WHERE id = 'a030775e-8a8c-45bd-a7c5-c656aeae161f'
    `);
    await client.query(`
      UPDATE "Unit" SET status = 'RESERVATION_PAID'::"UnitStatus" WHERE id = '7c782cc2-9f33-4570-b655-a47f4fae2d57'
    `);

    // 3. Deal test-deal-uuid-1781517899041 -> CONSULTATION, Unit e311283e-47e0-4a78-831b-a8bff0a81862 -> FREE
    await client.query(`
      UPDATE "Deal" SET status = 'CONSULTATION'::"DealStatus" WHERE id = 'test-deal-uuid-1781517899041'
    `);
    await client.query(`
      UPDATE "Unit" SET status = 'FREE'::"UnitStatus" WHERE id = 'e311283e-47e0-4a78-831b-a8bff0a81862'
    `);

    console.log('--- Restore Complete ---');
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
