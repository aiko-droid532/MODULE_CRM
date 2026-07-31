const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const res = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'DealStatus'
    `);
    console.log('DealStatus enum labels:', res.rows.map(r => r.enumlabel));
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await client.end();
  }
}

run();
