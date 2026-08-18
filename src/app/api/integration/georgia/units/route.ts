import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ================================================================
// GET /api/integration/georgia/units
// Отдаёт сайту parkboulevard.ge актуальный список помещений ЖК Park Boulevard
// со статусами, ценами и планировками — CRM здесь источник данных, сайт тянет их.
//
// Фильтруем строго по коду проекта, а не по organizationId: у одной организации
// в CRM может быть несколько ЖК (в т.ч. демо-проекты для внутренних тестов),
// и без этого фильтра сайту Грузии могли бы уйти квартиры чужого проекта.
//
// Названия ПОЛЕЙ в ответе намеренно повторяют формат ERP застройщика
// (crmasgroup.ge/rest/product/getProduct.php: ID, STATUS, TOTAL_PRICE и т.д.),
// чтобы сайт мог переиспользовать тот же код разбора ответа, что и для AS Group.
// Дополнительно (сверх формата AS Group) отдаём планировки/фото и языковые поля —
// у застройщика их просто нет, а витрине без них не показать карточку красиво.
//
// ЗНАЧЕНИЕ поля STATUS — сознательно НЕ переводим в словарь AS Group (თავისუფალი/NFS).
// У нас 11 статусов с разными нюансами (устная бронь, оплаченная бронь, договор
// подписан, продано...), а у AS Group их всего два — перевод потерял бы разницу
// между "забронировано" и "продано" и заставил бы гадать неизвестные грузинские
// термины. Отдаём статус как есть, актуальный список см. ниже — сайт сам решает,
// как каждый из них показать посетителю.
// ================================================================

const PROJECT_CODE = 'parkboulevard-ge';

// Полный список статусов, которые реально используются в CRM (см. src/app/actions/*):
//   FREE                 — свободно, можно продавать
//   SOFT_BOOKED          — устная бронь (недолгий холд без оплаты)
//   HARD_BOOKED          — жёсткая бронь
//   RESERVATION_ORAL     — устная бронь (альтернативное/устаревшее имя статуса)
//   RESERVATION_PAID     — бронь с оплатой
//   CONTRACT_SIGNED      — договор подписан, ожидается оплата
//   DOWN_PAYMENT_RECEIVED— внесён первый взнос
//   FULLY_PAID           — оплачено полностью
//   SOLD                 — продано
//   SERVICE              — служебное/техническое помещение, не для продажи
// (EXCLUDED в этот эндпоинт никогда не попадает — исключается запросом ниже)

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey');
  const expectedKey = process.env.INTEGRATION_API_KEY || 'pb-secret-token';

  if (apiKey !== expectedKey) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Invalid API Key.' }, { status: 401 });
  }

  // Необязательные фильтры — те же имена параметров, что у getProduct.php AS Group
  // (?building=1&block=A&floor=1), чтобы можно было проверить конкретный кусок каталога,
  // не выгружая всё разом. "corps" принимаем как синоним "block".
  const filterBuilding = req.nextUrl.searchParams.get('building');
  const filterBlock = req.nextUrl.searchParams.get('block') || req.nextUrl.searchParams.get('corps');
  const filterFloor = req.nextUrl.searchParams.get('floor');

  try {
    const units: any[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.number,
        u.floor,
        u.area,
        u."livingArea",
        u."balconyArea",
        u."terraceArea",
        u."yardArea",
        u.rooms,
        u.type,
        u."viewType",
        u.entrance,
        u."bathroomsCount",
        u."bedroomsCount",
        u.price,
        u."priceGel",
        u."pricePerSqm",
        u."pricePerSqmGel",
        u."retailPrice",
        u."retailPriceGel",
        u.status,
        u."availableForSale",
        u."cadastralCode",
        u."ownerDeal",
        u."ownerContact",
        u."ownerCompany",
        u."dealResponsible",
        u."externalId",
        u."updatedAt",
        u."layoutUrl",
        u."layout3dUrl",
        u."floorPlanImage",
        u."tour3dUrl",
        u.finishing,
        b.code as "blockCode",
        b."buildingNumber",
        b."expectedCommissioningDate",
        p.name as "projectName"
      FROM "Unit" u
      JOIN "Block" b ON u."blockId" = b.id
      JOIN "Project" p ON b."projectId" = p.id
      WHERE p.code = ${PROJECT_CODE} AND u.status != 'EXCLUDED'
        AND (${filterBuilding}::text IS NULL OR b."buildingNumber" = ${filterBuilding})
        AND (${filterFloor}::text IS NULL OR u.floor = ${filterFloor}::int)
      ORDER BY b.number, u.floor, u.number
    `;

    // "block"/"corps" фильтруем уже после запроса — сама буква корпуса не хранится
    // отдельной колонкой, а вычисляется из Block.code (см. ниже).
    const filteredUnits = filterBlock
      ? units.filter(u => {
          const corps = u.buildingNumber ? String(u.blockCode).replace(`${u.buildingNumber}-`, '') : u.blockCode;
          return corps?.toUpperCase() === filterBlock.toUpperCase();
        })
      : units;

    const unitIds = filteredUnits.map(u => u.id);
    const rooms: any[] = unitIds.length
      ? await prisma.$queryRaw`
          SELECT "unitId", "roomType", "nameRu", area
          FROM "UnitRoom"
          WHERE "unitId" = ANY(${unitIds})
        `
      : [];

    const roomsMap = new Map<string, any[]>();
    rooms.forEach(r => {
      if (!roomsMap.has(r.unitId)) roomsMap.set(r.unitId, []);
      roomsMap.get(r.unitId)?.push({
        roomType: r.roomType,
        nameRu: r.nameRu,
        area: Number(r.area),
      });
    });

    const result = filteredUnits.map(u => {
      const rooms = u.rooms != null ? Number(u.rooms) : null;
      // Здание закодировано в Block.code как "1-A" (building-corps) для помещений,
      // импортированных из AS Group; у старых записей с сайта (WP) — просто "A".
      const corps = u.buildingNumber
        ? String(u.blockCode).replace(`${u.buildingNumber}-`, '')
        : u.blockCode;

      return {
        // ── Формат AS Group (crmasgroup.ge) ──
        ID: u.externalId || u.id,
        NAME: u.number,
        STATUS: u.status,
        PROJECT: u.projectName || null,
        PRODUCT_TYPE: u.type || null,
        FLOOR: u.floor,
        NUMBER: u.number,
        CORPS: corps,
        ENTRANCE: u.entrance != null ? Number(u.entrance) : null,
        BUILDING: u.buildingNumber || null,
        // Дата сдачи здания — та же, что пришла от них в projEndDate при импорте
        // (лежит в Block.expectedCommissioningDate), отдаём как есть, тем же именем поля.
        projEndDate: u.expectedCommissioningDate
          ? new Date(u.expectedCommissioningDate).toLocaleDateString('en-GB') // DD/MM/YYYY, как у них
          : null,
        // Статус самого здания (не квартиры) — считаем по дате сдачи: дата в будущем ->
        // здание строится, в прошлом -> сдано. Это не строка от AS Group, а наш расчёт
        // по их же данным (BUILDING_STATUS они как отдельное поле в API не присылают).
        BUILDING_STATUS: u.expectedCommissioningDate
          ? (new Date(u.expectedCommissioningDate) > new Date() ? 'in progress' : 'completed')
          : null,
        FULL_PART: Number(u.area),
        LIVING_SPACE: u.livingArea != null ? Number(u.livingArea) : null,
        BALCONY_PART: u.balconyArea != null ? Number(u.balconyArea) : null,
        TERRACE_AREA: u.terraceArea != null ? Number(u.terraceArea) : null,
        YARDAREA: u.yardArea != null ? Number(u.yardArea) : null,
        NUMBOFROOMS: rooms != null ? String(rooms) : (u.type || null),
        NUMBOFBATHROOMS: u.bathroomsCount != null ? Number(u.bathroomsCount) : null,
        NUMOFBEDROOMS: u.bedroomsCount != null ? Number(u.bedroomsCount) : null,
        KVM_PRICE: u.pricePerSqm != null ? Number(u.pricePerSqm) : null,
        KVM_PRICE_GEL: u.pricePerSqmGel != null ? Number(u.pricePerSqmGel) : null,
        TOTAL_PRICE: Number(u.price),
        RETAIL_PRICE: u.retailPrice != null ? Number(u.retailPrice) : null,
        RETAIL_PRICE_GEL: u.retailPriceGel != null ? Number(u.retailPriceGel) : null,
        CADASTRAL_CODE: u.cadastralCode || null,
        VIEW: u.viewType || null,
        OWNER_DEAL: u.ownerDeal || null,
        OWNER_CONTACT: u.ownerContact || null,
        OWNER_COMPANY: u.ownerCompany || null,
        DEAL_RESPONSIBLE: u.dealResponsible || null,

        // ── Дополнительно сверх формата AS Group: то, чего у застройщика нет ──
        internal_id: u.id,
        updated_at: u.updatedAt,
        currency: u.priceGel != null ? 'GEL/USD' : 'USD',
        availableForSale: u.availableForSale,
        layoutUrl: u.layoutUrl || null,
        layout3dUrl: u.layout3dUrl || null,
        floorPlanImage: u.floorPlanImage || null,
        tour3dUrl: u.tour3dUrl || null,
        finishing: u.finishing || null,
        rooms_detail: roomsMap.get(u.id) || [],
      };
    });

    return NextResponse.json({
      status: 200,
      message: 'OK',
      count: result.length,
      result,
    });
  } catch (error: any) {
    console.error('[GET /api/integration/georgia/units] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error: ' + error.message },
      { status: 500 }
    );
  }
}
