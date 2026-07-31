const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    console.log('Tables in DB:', tables);
  } catch (err) {
    console.error('Error listing tables:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
