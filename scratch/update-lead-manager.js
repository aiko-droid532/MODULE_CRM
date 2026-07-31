const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    try {
      await client.query(`ALTER TABLE "Lead" ADD COLUMN "managerId" TEXT`);
      console.log('Added managerId to Lead.');
    } catch(e) {
      console.log('Column managerId already exists or error:', e.message);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error:", e);
  } finally {
    await client.end();
  }
}

run();
