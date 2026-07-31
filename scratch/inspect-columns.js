const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  console.log("Connected!");
  
  const tables = ['Lead', 'Unit', 'Deal', 'Booking', 'PaymentSchedule', 'Transaction'];
  for (const table of tables) {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = '${table}'
    `);
    console.log(`\nTable: ${table}`);
    res.rows.forEach(r => {
      console.log(`  - ${r.column_name}: ${r.data_type}`);
    });
  }
  
  await client.end();
}
run().catch(console.error);
