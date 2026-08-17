import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Справочник статусов для интеграции с сайтом Грузии
const STATUS_MAP: Record<string, string> = {
  FREE: 'available',
  RESERVATION_ORAL: 'reserved',
  RESERVATION_PAID: 'reserved',
  SOFT_BOOKED: 'reserved',
  HARD_BOOKED: 'reserved',
  SOLD: 'sold',
  SERVICE: 'reserved'
};

export async function GET(req: NextRequest) {
  // Проверка API-ключа
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
  const expectedKey = process.env.INTEGRATION_API_KEY || 'pb-secret-token';

  if (apiKey !== expectedKey) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Invalid API Key.' }, { status: 401 });
  }

  const orgId = req.headers.get('x-organization-id')
    || req.nextUrl.searchParams.get('organizationId')
    || process.env.DEFAULT_ORGANIZATION_ID
    || '741be209-ad6f-4483-92ee-298a36899bcf';

  // Получаем фильтры из URL (если переданы)
  const filterBuilding = req.nextUrl.searchParams.get('building');
  const filterBlock = req.nextUrl.searchParams.get('block') || req.nextUrl.searchParams.get('corps');
  const filterFloor = req.nextUrl.searchParams.get('floor');

  try {
    // Получаем квартиры из базы данных
    const units: any[] = await prisma.$queryRaw`
      SELECT 
        u.id, 
        u.number, 
        u.floor, 
        u.area, 
        u.rooms, 
        u.price, 
        u.status::text as status,
        u."livingArea",
        u."balconyArea",
        u."cadastralCode",
        u.entrance,
        u."pricePerSqmVAT",
        u."externalId",
        b.number as "blockName",
        b."constructionStage" as "blockStage",
        p.name as "projectName"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE u."organizationId" = ${orgId}
      ORDER BY u.floor, u.number
    `;

    // Фильтруем результаты на уровне Javascript
    let filteredUnits = units;

    if (filterBlock) {
      filteredUnits = filteredUnits.filter(u => 
        u.blockName && u.blockName.toLowerCase() === filterBlock.toLowerCase()
      );
    }

    if (filterFloor) {
      filteredUnits = filteredUnits.filter(u => 
        u.floor === Number(filterFloor)
      );
    }

    // Преобразуем каждую квартиру в формат API разработчиков Грузии
    const result = filteredUnits.map(u => {
      const totalArea = Number(u.area || 0);
      const totalPrice = Number(u.price || 0);
      const kvmPrice = u.pricePerSqmVAT 
        ? Number(u.pricePerSqmVAT) 
        : (totalArea > 0 ? Math.round(totalPrice / totalArea) : 0);

      // Маппим статус на английский (available, sold, reserved)
      const mappedStatus = STATUS_MAP[u.status] || u.status;

      // Статус здания: in progress или completed
      const buildingStatus = u.blockStage === 'Commissioned' ? 'completed' : 'in progress';

      return {
        ID: u.externalId || u.id, // Если есть внешний ID, отдаем его, иначе внутренний UUID
        NAME: u.number,
        STATUS: mappedStatus,
        PROJECT: u.projectName,
        PRODUCT_TYPE: "",
        FLOOR: String(u.floor),
        NUMBER: u.number,
        CORPS: u.blockName || "",
        ENTRANCE: u.entrance ? String(u.entrance) : "", // Если в нашей БД заполнено — отдаем, иначе пусто
        BUILDING: "1",
        BUILDING_STATUS: buildingStatus, // Статус здания: in progress или completed
        FULL_PART: totalArea.toFixed(2),
        LIVING_SPACE: u.livingArea ? Number(u.livingArea).toFixed(2) : "",
        BALCONY_PART: u.balconyArea ? Number(u.balconyArea).toFixed(2) : "",
        TERRACE_AREA: "",
        YARDAREA: "",
        NUMBOFROOMS: String(u.rooms || 0),
        NUMBOFBATHROOMS: "",
        NUMOFBEDROOMS: "",
        KVM_PRICE: String(kvmPrice),
        KVM_PRICE_GEL: "",
        TOTAL_PRICE: totalPrice.toFixed(2),
        RETAIL_PRICE: "",
        RETAIL_PRICE_GEL: "",
        projEndDate: "01/08/2030", // дефолт по ТЗ
        CADASTRAL_CODE: u.cadastralCode || "",
        VIEW: "",
        OWNER_DEAL: "",
        OWNER_CONTACT: "",
        OWNER_COMPANY: "",
        DEAL_RESPONSIBLE: ""
      };
    });

    return NextResponse.json({
      status: 200,
      message: "OK",
      result: result
    });

  } catch (error: any) {
    console.error('[GET /api/integration/georgia/products] Error:', error);
    return NextResponse.json(
      { status: 500, message: "ERROR", error: error.message },
      { status: 500 }
    );
  }
}
