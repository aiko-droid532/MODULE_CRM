const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    const res = await client.query('SELECT id, name, phone, type, status, "createdAt" FROM "Lead"');
    console.log('All Leads/Clients in DB:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
