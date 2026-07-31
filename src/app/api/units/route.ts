import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const organizationId = searchParams.get('organizationId') || 'default';

    const units: any[] = await prisma.$queryRaw`
      SELECT 
        u.id, 
        u.number, 
        u.floor, 
        u.area, 
        u.price, 
        u.status, 
        u.rooms, 
        u.type, 
        u."livingArea", 
        u."viewType", 
        u."layoutUrl",
        u."layout3dUrl",
        b.number as "blockName",
        p.name as "projectName"
      FROM "Unit" u
      LEFT JOIN "Block" b ON u."blockId" = b.id
      LEFT JOIN "Project" p ON b."projectId" = p.id
      WHERE u."organizationId" = ${organizationId} AND u.status != 'EXCLUDED'
    `;

    return NextResponse.json(units);
  } catch (error: any) {
    console.error('Failed to fetch units for API:', error);
    return NextResponse.json({ error: 'Server error: ' + error.message }, { status: 500 });
  }
}
