const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log("Connected to Supabase.");

    const projects = await client.query('SELECT * FROM "Project"');
    console.log("Projects:", JSON.stringify(projects.rows, null, 2));

    const blocks = await client.query('SELECT * FROM "Block"');
    console.log("Blocks:", JSON.stringify(blocks.rows, null, 2));

    const units = await client.query('SELECT * FROM "Unit" LIMIT 5');
    console.log("Sample Units (5):", JSON.stringify(units.rows, null, 2));

    const leads = await client.query('SELECT * FROM "Lead" LIMIT 5');
    console.log("Sample Leads (5):", JSON.stringify(leads.rows, null, 2));
  } catch (e) {
    console.error("Connection error:", e);
  } finally {
    await client.end();
  }
}

run();
