const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const units = await prisma.unit.findMany({ take: 20 });
    console.log("SAMPLE UNITS:");
    console.log(JSON.stringify(units, null, 2));

    const uniqueTypes = await prisma.$queryRaw`SELECT DISTINCT "type" FROM "Unit"`;
    console.log("UNIQUE TYPES:", uniqueTypes);

    const uniqueStatuses = await prisma.$queryRaw`SELECT DISTINCT "status" FROM "Unit"`;
    console.log("UNIQUE STATUSES:", uniqueStatuses);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
