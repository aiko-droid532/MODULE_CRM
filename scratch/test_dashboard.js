const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const organizationId = 'default';
  try {
    console.log('1. Querying lead count with raw SQL...');
    const leadsCountResult = await prisma.$queryRaw`
      SELECT COUNT(*)::int as "count" FROM "Lead" WHERE "organizationId" = ${organizationId}
    `;
    console.log('Leads count:', leadsCountResult[0]?.count || 0);

    console.log('2. Querying deal count with raw SQL...');
    const dealsCountResult = await prisma.$queryRaw`
      SELECT COUNT(*)::int as "count" FROM "Deal" 
      WHERE "organizationId" = ${organizationId} AND "status"::text != 'FAILED'
    `;
    console.log('Deals count:', dealsCountResult[0]?.count || 0);

    console.log('3. Querying deals with details with raw SQL JOIN...');
    const rawDeals = await prisma.$queryRaw`
      SELECT 
        d.id as "dealId",
        d.status as "dealStatus",
        d."organizationId" as "dealOrgId",
        d."managerId" as "dealManagerId",
        d."paymentType" as "dealPaymentType",
        d."downPayment" as "dealDownPayment",
        d."totalAmount" as "dealTotalAmount",
        d."createdAt" as "dealCreatedAt",
        d."updatedAt" as "dealUpdatedAt",
        l.id as "leadId",
        l.name as "leadName",
        l.phone as "leadPhone",
        l.email as "leadEmail",
        l.iin as "leadIin",
        u.id as "unitId",
        u.number as "unitNumber",
        u.floor as "unitFloor",
        u.rooms as "unitRooms",
        u.type as "unitType",
        u.area as "unitArea",
        u.price as "unitPrice",
        b.number as "blockNumber",
        p.name as "projectName"
      FROM "Deal" d
      LEFT JOIN "Lead" l ON d."leadId" = l.id
      LEFT JOIN "Unit" u ON d."unitId" = u.id
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE d."organizationId" = ${organizationId}
      ORDER BY d."updatedAt" DESC
    `;
    console.log('Deals fetched with details. Count:', rawDeals.length);

    console.log('4. Querying payment schedule revenue with raw SQL...');
    const revenueResult = await prisma.$queryRaw`
      SELECT COALESCE(SUM("amount"), 0)::float as "total"
      FROM "PaymentSchedule"
      WHERE "organizationId" = ${organizationId} AND "status"::text = 'PAID'
    `;
    console.log('Revenue sum:', revenueResult[0]?.total || 0);

    console.log('TEST COMPLETED SUCCESSFULLY WITHOUT ANY PROBLEMS!');
  } catch (err) {
    console.error('DATABASE ERROR DETECTED:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
