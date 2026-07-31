const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Connected to DB.");

  try {
    await client.query('BEGIN');

    // Создаем enum для LeadStatus
    try {
      await client.query(`CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'IN_QUALIFICATION', 'QUALIFIED', 'IN_PROGRESS', 'CONVERTED', 'LOST')`);
      console.log('Created LeadStatus ENUM.');
    } catch (e) {
      console.log('LeadStatus ENUM already exists or error:', e.message);
    }

    // Добавляем поля status и callAttempts в таблицу Lead
    try {
      await client.query(`ALTER TABLE "Lead" ADD COLUMN "status" "LeadStatus" DEFAULT 'NEW'`);
      console.log('Added status to Lead.');
    } catch(e) {
      console.log('Column status already exists or error:', e.message);
    }

    try {
      await client.query(`ALTER TABLE "Lead" ADD COLUMN "callAttempts" INTEGER DEFAULT 0`);
      console.log('Added callAttempts to Lead.');
    } catch(e) {
      console.log('Column callAttempts already exists or error:', e.message);
    }

    await client.query('COMMIT');
    console.log("Lead table updated successfully.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error:", e);
  } finally {
    await client.end();
  }
}

run();
