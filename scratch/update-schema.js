const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log("Connected to Supabase.");

    // Start a transaction for schema updates
    await client.query('BEGIN');

    // 1. Update Lead table
    console.log("Updating Lead table...");
    await client.query(`
      ALTER TABLE "Lead" 
      ADD COLUMN IF NOT EXISTS "type" TEXT,
      ADD COLUMN IF NOT EXISTS "personalNumber" TEXT,
      ADD COLUMN IF NOT EXISTS "passportNumber" TEXT,
      ADD COLUMN IF NOT EXISTS "passportCountry" TEXT,
      ADD COLUMN IF NOT EXISTS "passportExpiresAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "nameKa" TEXT,
      ADD COLUMN IF NOT EXISTS "nameRu" TEXT,
      ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
      ADD COLUMN IF NOT EXISTS "consentToPd" BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS "optInMarketing" BOOLEAN DEFAULT FALSE;
    `);

    // 2. Update Unit table
    console.log("Updating Unit table...");
    await client.query(`
      ALTER TABLE "Unit"
      ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "cadastralCode" TEXT;
    `);

    // 3. Update Booking table
    console.log("Updating Booking table...");
    await client.query(`
      ALTER TABLE "Booking"
      ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS "depositAmount" DOUBLE PRECISION DEFAULT 0;
    `);

    // 4. Create AuditLog table
    console.log("Creating AuditLog table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        "id" TEXT PRIMARY KEY,
        "action" TEXT NOT NULL,
        "entityId" TEXT,
        "entityType" TEXT,
        "managerId" TEXT NOT NULL,
        "reason" TEXT,
        "organizationId" TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "idx_auditlog_org" ON "AuditLog"("organizationId");
    `);

    // 5. Create ExchangeRate table
    console.log("Creating ExchangeRate table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ExchangeRate" (
        "id" TEXT PRIMARY KEY,
        "currency" VARCHAR(3) NOT NULL,
        "rate" DOUBLE PRECISION NOT NULL,
        "date" DATE NOT NULL,
        "isFallback" BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "idx_exchangerate_date" ON "ExchangeRate"("date");
    `);

    await client.query('COMMIT');
    console.log("Schema update completed successfully.");
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error during schema update. Rolled back.", e);
  } finally {
    await client.end();
  }
}

run();
