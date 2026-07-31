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

    // 1. Get first Lead
    const leadsRes = await client.query('SELECT id, name, "organizationId" FROM "Lead" LIMIT 1');
    if (leadsRes.rows.length === 0) {
      console.log('❌ No Leads found in database!');
      return;
    }
    const lead = leadsRes.rows[0];
    console.log('Found Lead:', lead);

    // 2. Get first Unit
    const unitsRes = await client.query('SELECT id, number, status FROM "Unit" LIMIT 1');
    if (unitsRes.rows.length === 0) {
      console.log('❌ No Units found in database!');
      return;
    }
    const unit = unitsRes.rows[0];
    console.log('Found Unit:', unit);

    // 3. Try step 1 check
    console.log('\nTesting active bookings check query...');
    const checkRes = await client.query(
      `SELECT b.id, l.name as "leadName"
       FROM "Booking" b
       JOIN "Lead" l ON b."leadId" = l.id
       WHERE b."unitId" = $1 AND b.status = 'ACTIVE'
       LIMIT 1`,
      [unit.id]
    );
    console.log('Check result:', checkRes.rows);

    // 4. Try step 3 insert (with updatedAt)
    console.log('\nTesting booking insert...');
    const bookingId = 'test-booking-uuid-' + Date.now();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await client.query(
      `INSERT INTO "Booking" ("id", "leadId", "unitId", "expiresAt", "type", "status", "organizationId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, NOW(), NOW())`,
      [bookingId, lead.id, unit.id, expiresAt, 'SOFT', lead.organizationId]
    );
    console.log('✅ Inserted booking successfully!');

    // 5. Try step 4 deal checks & upserts
    console.log('\nTesting deal checks...');
    const dealCheck = await client.query(
      `SELECT id FROM "Deal" 
       WHERE "leadId" = $1 AND "unitId" = $2 AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')
       LIMIT 1`,
      [lead.id, unit.id]
    );
    console.log('Deals found:', dealCheck.rows);

    if (dealCheck.rows.length > 0) {
      const dealId = dealCheck.rows[0].id;
      console.log('Testing Deal status update...');
      await client.query(
        `UPDATE "Deal" 
         SET "status" = $1::"DealStatus", "updatedAt" = NOW()
         WHERE id = $2`,
        ['PRE_RESERVATION', dealId]
      );
      console.log('✅ Deal updated successfully!');
    } else {
      console.log('Testing Deal insert...');
      const dealId = 'test-deal-uuid-' + Date.now();
      await client.query(
        `INSERT INTO "Deal" ("id", "leadId", "unitId", "organizationId", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::"DealStatus", NOW(), NOW())`,
        [dealId, lead.id, unit.id, lead.organizationId, 'PRE_RESERVATION']
      );
      console.log('✅ Deal inserted successfully!');
    }

    // 6. Try step 5 unit update (with thinkingFlag)
    console.log('\nTesting Unit status update...');
    await client.query(
      `UPDATE "Unit" 
       SET status = $1::"UnitStatus", "thinkingFlag" = false, "updatedAt" = NOW()
       WHERE id = $2`,
      ['SOFT_BOOKED', unit.id]
    );
    console.log('✅ Unit updated successfully!');

    // 7. Test booking status update (with updatedAt)
    console.log('\nTesting Booking update status...');
    await client.query(
      `UPDATE "Booking" SET status = 'EXPIRED', "updatedAt" = NOW() WHERE id = $1`,
      [bookingId]
    );
    console.log('✅ Booking updated to EXPIRED successfully!');

    // 8. Rollback/Cleanup test records so we don't mess up actual DB
    console.log('\nCleaning up test records...');
    await client.query('DELETE FROM "Booking" WHERE id = $1', [bookingId]);
    console.log('✅ Cleaned up booking.');

  } catch (err) {
    console.error('❌ SQL Query Error details:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
