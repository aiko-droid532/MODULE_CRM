const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Connected to DB.");

  try {
    await client.query('BEGIN');

    // Расширяем enum UnitStatus новыми значениями из ОП.pdf
    const newStatuses = [
      'SOFT_BOOKED',
      'HARD_BOOKED', 
      'CONTRACT_SIGNED',
      'DOWN_PAYMENT_RECEIVED',
      'FULLY_PAID',
      'EXCLUDED'
    ];

    for (const status of newStatuses) {
      try {
        await client.query(`ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS '${status}'`);
        console.log(`  Added status: ${status}`);
      } catch (e) {
        console.log(`  Status ${status} already exists or error: ${e.message}`);
      }
    }

    await client.query('COMMIT');
    console.log("UnitStatus enum updated successfully.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error:", e);
  } finally {
    await client.end();
  }
}

run();
