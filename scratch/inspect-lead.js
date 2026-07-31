const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client(process.env.DATABASE_URL);
  await c.connect();
  
  // Check Lead table columns
  const res = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns 
    WHERE table_name = 'Lead' 
    ORDER BY ordinal_position
  `);
  console.log('=== Lead table columns ===');
  console.log(JSON.stringify(res.rows, null, 2));

  // Check if enum types exist for clientType
  const enums = await c.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE '%lient%' OR t.typname LIKE '%ead%'
    ORDER BY t.typname, e.enumsortorder
  `);
  console.log('\n=== Relevant enums ===');
  console.log(JSON.stringify(enums.rows, null, 2));

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
