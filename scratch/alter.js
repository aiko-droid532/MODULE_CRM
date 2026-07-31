const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
async function run() {
  try {
    await pool.query('ALTER TABLE "ChangeLog" ALTER COLUMN "leadId" DROP NOT NULL;');
    console.log('Successfully dropped NOT NULL constraint on leadId');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
