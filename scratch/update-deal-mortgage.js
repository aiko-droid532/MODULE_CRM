const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    try {
      await client.query(`ALTER TABLE "Deal" ADD COLUMN "mortgageBank" TEXT`);
      console.log('Added mortgageBank to Deal.');
    } catch(e) {
      console.log('Column mortgageBank already exists or error:', e.message);
    }

    try {
      await client.query(`ALTER TABLE "Deal" ADD COLUMN "mortgageStatus" TEXT`);
      console.log('Added mortgageStatus to Deal.');
    } catch(e) {
      console.log('Column mortgageStatus already exists or error:', e.message);
    }

    try {
      await client.query(`ALTER TABLE "Deal" ADD COLUMN "mortgageComment" TEXT`);
      console.log('Added mortgageComment to Deal.');
    } catch(e) {
      console.log('Column mortgageComment already exists or error:', e.message);
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
