const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables in DB:', tablesRes.rows.map(r => r.table_name));

    for (const row of tablesRes.rows) {
      const colRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${row.table_name}'
      `);
      console.log(`Columns in ${row.table_name}:`, colRes.rows.map(c => `${c.column_name} (${c.data_type}, nullable: ${c.is_nullable})`));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
