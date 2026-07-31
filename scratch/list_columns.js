require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'statement_cache_size=0'
    }
  }
});

async function main() {
  try {
    const dealColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Deal'
    `);
    console.log('Columns in Deal:', dealColumns);

    const interestColumns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'LeadInterest'
    `);
    console.log('Columns in LeadInterest:', interestColumns);
  } catch (err) {
    console.error('Error listing columns:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
