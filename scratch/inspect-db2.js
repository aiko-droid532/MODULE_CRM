const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function inspect() {
  try {
    const tables = ['Deal', 'LeadInterest', 'ChangeLog', 'PaymentSchedule'];
    for (const t of tables) {
      console.log(`--- Inspecting ${t} table ---`);
      const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [t]);
      console.table(res.rows);
    }
  } catch (err) {
    console.error('Error during inspection:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

inspect();
