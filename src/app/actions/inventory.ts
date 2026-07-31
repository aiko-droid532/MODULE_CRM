'use server';

import { db as prisma, Prisma } from '@/lib/db';

export async function searchUnits(filters: {
  rooms?: number;
  minArea?: number;
  maxPrice?: number;
  type?: string;
  organizationId: string;
}) {
  try {
    const units: any[] = await prisma.$queryRaw`
      SELECT 
        u.*, 
        b.number as "blockNumber",
        p.name as "projectName",
        p.id as "projectId",
        EXISTS (
          SELECT 1 FROM "LeadInterest" li 
          WHERE li."unitId" = u.id AND li.status::text = 'ACTIVE'
        ) as "isBooked",
        EXISTS (
          SELECT 1 FROM "LeadInterest" li 
          WHERE li."unitId" = u.id AND li.status::text = 'DEAL'
        ) as "isSold"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE u."status"::text != 'SERVICE'
      AND u."organizationId" = ${filters.organizationId}
      ${filters.rooms ? Prisma.sql`AND u."rooms" = ${filters.rooms}` : Prisma.empty}
      ${filters.maxPrice ? Prisma.sql`AND u."price" <= ${filters.maxPrice}` : Prisma.empty}
      ${filters.type ? Prisma.sql`AND u."type"::text = ${filters.type}` : Prisma.empty}
      LIMIT 50
    `;

    return units.map(u => ({
      ...u,
      isBooked: u.status === 'FREE' ? false : (!!u.isBooked || u.status === 'RESERVATION_ORAL' || u.status === 'RESERVATION_PAID'),
      isSold: !!u.isSold || u.status === 'SOLD',
      block: {
        number: u.blockNumber,
        project: { id: u.projectId, name: u.projectName }
      }
    }));
  } catch (error) {
    console.error('Search units SQL error:', error);
    return [];
  }
}

export async function addInterest(leadId: string, unitId: string) {
  try {
    const id = crypto.randomUUID();
    // 1. Создаем интерес лида
    await prisma.$executeRaw`
      INSERT INTO "LeadInterest" ("id", "leadId", "unitId")
      VALUES (${id}, ${leadId}, ${unitId})
    `;
    // 2. Блокируем квартиру - переводим в статус RESERVATION_ORAL
    await prisma.$executeRaw`
      UPDATE "Unit" 
      SET "status" = 'RESERVATION_ORAL'::"UnitStatus" 
      WHERE "id" = ${unitId}
    `;
    return { success: true, interestId: id };
  } catch (error) {
    console.error('Add interest SQL error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
