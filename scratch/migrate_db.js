const { Pool } = require('pg');
require('dotenv').config({ path: 'c:/Users/Сулпак/Documents/MODULE/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  console.log('Connecting to database...');
  const client = await pool.connect();
  try {
    console.log('Successfully connected!');

    // 1. Alter Booking table to add updatedAt
    console.log('Altering Booking table...');
    try {
      await client.query(`
        ALTER TABLE "Booking" 
        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('✅ Added updatedAt to Booking');
    } catch (e) {
      console.error('Failed to alter Booking:', e.message);
    }

    // 2. Alter Unit table to add thinkingFlag
    console.log('Altering Unit table...');
    try {
      await client.query(`
        ALTER TABLE "Unit" 
        ADD COLUMN IF NOT EXISTS "thinkingFlag" BOOLEAN DEFAULT false
      `);
      console.log('✅ Added thinkingFlag to Unit');
    } catch (e) {
      console.error('Failed to alter Unit:', e.message);
    }

    // 3. Alter Unit table to add isVip
    try {
      await client.query(`
        ALTER TABLE "Unit" 
        ADD COLUMN IF NOT EXISTS "isVip" BOOLEAN DEFAULT false
      `);
      console.log('✅ Added isVip to Unit');
    } catch (e) {
      console.error('Failed to alter Unit (isVip):', e.message);
    }

    // 4. Alter Unit table to add priceUsdPerSqm
    try {
      await client.query(`
        ALTER TABLE "Unit" 
        ADD COLUMN IF NOT EXISTS "priceUsdPerSqm" DOUBLE PRECISION
      `);
      console.log('✅ Added priceUsdPerSqm to Unit');
    } catch (e) {
      console.error('Failed to alter Unit (priceUsdPerSqm):', e.message);
    }

    // 5. Alter Unit table to add priceGel
    try {
      await client.query(`
        ALTER TABLE "Unit" 
        ADD COLUMN IF NOT EXISTS "priceGel" DOUBLE PRECISION
      `);
      console.log('✅ Added priceGel to Unit');
    } catch (e) {
      console.error('Failed to alter Unit (priceGel):', e.message);
    }

  } catch (err) {
    console.error('❌ SQL Migration Error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
