const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log("Connected to Supabase.");

    const tables = ['Project', 'Block', 'Unit', 'Lead', 'Deal', 'Booking', 'PaymentSchedule', 'Transaction', 'ExchangeRate'];
    for (const table of tables) {
      try {
        const res = await client.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
        console.log(`Table "${table}" has ${res.rows[0].count} rows.`);
      } catch (err) {
        console.error(`Error querying table ${table}:`, err.message);
      }
    }
  } catch (e) {
    console.error("Connection error:", e);
  } finally {
    await client.end();
  }
}

run();
