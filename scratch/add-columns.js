const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to Lead table...');
    await client.query(`
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "interestedProjectId" TEXT;
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "propertyType" TEXT;
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "budgetMin" DOUBLE PRECISION;
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "budgetMax" DOUBLE PRECISION;
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
      ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sourceInfo" TEXT;
    `);
    console.log('Successfully added columns!');
  } catch (err) {
    console.error('Error adding columns:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
