"use server";

import { db as prisma } from "@/lib/db";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";

// Заголовки колонок из реального файла заказчика (см. "Products" в их выгрузке
// product_report_*.xlsx) — совпадают буквально, включая регистр и пробелы.
// "#" (порядковый номер строки в их отчёте) и "PTD" (позиция квартиры на этаже,
// 1..N) у нас в базе не хранятся — нет соответствующего поля, это просьба
// заказчика: принимать файл с этими колонками как есть, но не записывать их.
//
// Убираем случайные пробелы по краям названий колонок (у вендора, например,
// "Contract # " — с пробелом на конце) — иначе fallback-цепочки ниже не сработают.
function normalizeRowKeys(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    out[key.trim()] = row[key];
  }
  return out;
}

// "Yes"/"No" (и русские варианты) → boolean
function parseYesNo(raw: any): boolean | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (["yes", "да", "true", "1"].includes(s)) return true;
  if (["no", "нет", "false", "0"].includes(s)) return false;
  return null;
}

// У вендора статус и тип помещения объединены с числом комнат в одну колонку
// ("Rooms"): "Commercial", "1 Rooms Studio", "2 Rooms Studio" и т.п. Разбираем
// на наши раздельные поля type/rooms.
function parseRoomsAndType(raw: any): { type: string; rooms: number } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { type: "Apartment", rooms: 1 };
  const match = s.match(/^(\d+)/);
  if (match) return { type: "Apartment", rooms: parseInt(match[1], 10) };
  // Нечисловое описание (Commercial, Parking, Storage...) — считаем типом,
  // количество комнат для таких помещений не применимо.
  return { type: s, rooms: 0 };
}

// Статус помещения у вендора (Available/Reserved/Sold/NFS и рус. варианты) →
// наш UnitStatus. "NFS" (не в продаже) у нас не отдельный статус, а флаг
// availableForSale — та же самая колонка "Available for sale" в их файле это
// и покрывает, поэтому NFS не маппим в отдельный статус.
function mapVendorStatus(raw: any): string {
  const s = raw == null ? "" : String(raw).trim().toLowerCase();
  if (["reserved", "резерв", "забронировано", "reservation"].includes(s)) return "RESERVATION_PAID";
  if (["sold", "продано", "sold out"].includes(s)) return "SOLD";
  // available / for sale / nfs / пусто / неизвестное значение — по умолчанию свободна
  return "FREE";
}

// "15.06.2026" → "2026-06-15" (тот же формат строки, что уже используется для
// deliveryDate в остальном коде — units.ts принимает его как обычную строку,
// не Date-объект). Возвращает null, если формат не распознан (не блокируем импорт).
function parseDDMMYYYY(raw: any): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    const y = raw.getFullYear();
    const mo = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export async function importUnitsFromExcel(
  formData: FormData,
  organizationId: string,
  initiatorId: string,
  projectId?: string,
) {
  const allErrors: string[] = [];

  try {
    const file = formData.get("file") as File;
    if (!file) {
      return { success: false, error: "Файл не выбран" };
    }

    console.log(" Файл получен:", file.name, file.size, "bytes");

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet) as any[];
    const rows = rawRows.map(normalizeRowKeys);

    console.log(" Найдено строк в Excel:", rows.length);
    console.log(" Заголовки колонок:", Object.keys(rows[0] || {}));

    if (rows.length === 0) {
      return { success: false, error: "Файл пуст" };
    }

    // ЖК теперь выбирается менеджером в модалке импорта (в файле заказчика нет
    // колонки с названием ЖК — только "Building/Block", это корпус). Если
    // projectId не передан — старое поведение для обратной совместимости со
    // старым шаблоном (колонка projectName/ЖК, авто-создание проекта по имени).
    let resolvedProjectId = projectId || "";
    const projects = new Map<string, string>();

    let imported = 0;
    let updated = 0;

    const blocks = new Map();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      console.log(`\n--- Обработка строки ${rowNum} ---`);

      try {
        const projectName =
          row["projectName"] ||
          row["ЖК"] ||
          row["Проект"] ||
          row["project"] ||
          row["Project"];
        const blockNumber =
          row["Building/Block"] ||
          row["blockNumber"] ||
          row["Корпус"] ||
          row["Блок"] ||
          row["block"] ||
          row["Block"];
        const number =
          row["№ Flat"] ||
          row["number"] ||
          row["Номер"] ||
          row["№"] ||
          row["unit"] ||
          row["Unit"];
        const area = parseFloat(
          row["Area (sq meters)"] || row["area"] || row["Площадь"] || row["sqm"] || 0,
        );
        const price = parseFloat(
          row["Full Price ($)"] || row["price"] || row["Цена"] || row["amount"] || 0,
        );
        const floor = parseInt(row["Floor"] || row["floor"] || row["Этаж"] || 1);

        // "Rooms" у вендора — совмещённый тип+комнаты ("Commercial", "2 Rooms Studio").
        // Старый шаблон присылает их раздельно (rooms/type) — используем его, если
        // вендорской колонки "Rooms" нет.
        let type: string;
        let rooms: number;
        if (row["Rooms"] != null && row["Rooms"] !== "") {
          const parsed = parseRoomsAndType(row["Rooms"]);
          type = parsed.type;
          rooms = parsed.rooms;
        } else {
          type = row["type"] || "Apartment";
          rooms = parseInt(row["rooms"] || row["Комнат"] || row["room"] || 1);
        }

        const livingArea = parseFloat(row["Living Area (sq meters)"] || row["livingArea"] || 0) || null;
        const balconyArea = parseFloat(row["Balcony (sq meters)"] || row["balconyArea"] || 0) || null;
        const contractNumber = row["Contract #"] || row["contractNumber"] || null;
        const deliveryYear = row["Year"] != null && row["Year"] !== "" ? parseInt(row["Year"]) : (row["deliveryYear"] || null);
        const deliveryMonth = row["Month"] != null && row["Month"] !== "" ? parseInt(row["Month"]) : (row["deliveryMonth"] || null);
        const deliveryDate = parseDDMMYYYY(row["Date"] || row["deliveryDate"]);
        const registeredInPublicRegistry = parseYesNo(row["Registration in the Public Registry"] ?? row["registeredInPublicRegistry"]);
        const availableForSale = parseYesNo(row["Available for sale"] ?? row["availableForSale"]);
        const pricePerSqmVAT = parseFloat(row["Price Incl. VAT (Sq meters/$)"] || row["pricePerSqmVAT"] || 0) || null;
        const vendorStatus = mapVendorStatus(row["Status"] ?? row["status"]);
        const viewType = row["viewType"] || row["Вид"] || null;

        console.log(
          ` Корпус="${blockNumber}", №${number}, ${area}м², $${price}`,
        );

        if (!resolvedProjectId && !projectName) {
          allErrors.push(`Строка ${rowNum}: Не выбран ЖК для импорта`);
          continue;
        }
        if (!blockNumber) {
          allErrors.push(`Строка ${rowNum}: Отсутствует номер корпуса`);
          continue;
        }
        if (!number) {
          allErrors.push(`Строка ${rowNum}: Отсутствует номер квартиры`);
          continue;
        }
        if (!area || isNaN(area) || area <= 0) {
          allErrors.push(`Строка ${rowNum}: Некорректная площадь (${area})`);
          continue;
        }
        if (!price || isNaN(price) || price <= 0) {
          allErrors.push(`Строка ${rowNum}: Некорректная цена (${price})`);
          continue;
        }

        // 1. ЖК — если передан заранее выбранный projectId, используем его для всех строк.
        // Иначе (старый шаблон) — находим/создаём по названию из колонки, как раньше.
        let effectiveProjectId = resolvedProjectId;
        if (!effectiveProjectId) {
          effectiveProjectId = projects.get(projectName) || "";
          if (!effectiveProjectId) {
            const existingProject = await prisma.$queryRaw<any>`
 SELECT id FROM "Project"
 WHERE name = ${projectName} AND "organizationId" = ${organizationId}
 LIMIT 1
 `;

            if (existingProject.length > 0) {
              effectiveProjectId = existingProject[0].id;
            } else {
              const projectCode = projectName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "_")
                .substring(0, 50);
              const address = row.address || row["address"] || row["Адрес"] || "";

              const newProject = await prisma.$queryRaw<any>`
 INSERT INTO "Project" (
 id, name, code, address,
 "nameKa", "nameRu", "nameEn",
 "organizationId", "createdAt", "updatedAt"
 )
 VALUES (
 ${crypto.randomUUID()},
 ${projectName},
 ${projectCode},
 ${address},
 ${projectName},
 ${projectName},
 ${projectName},
 ${organizationId},
 NOW(),
 NOW()
 )
 RETURNING id
 `;
              effectiveProjectId = newProject[0].id;
            }
            projects.set(projectName, effectiveProjectId);
          }
        }

        // 2. Находим или создаем Block (с обязательным полем code)
        const blockKey = `${effectiveProjectId}_${blockNumber}`;
        let blockId = blocks.get(blockKey);
        if (!blockId) {
          const existingBlock = await prisma.$queryRaw<any>`
 SELECT id FROM "Block"
 WHERE number = ${blockNumber} AND "projectId" = ${effectiveProjectId}
 LIMIT 1
 `;

          if (existingBlock.length > 0) {
            blockId = existingBlock[0].id;
            console.log(` Блок найден: ${blockId}`);
          } else {
            console.log(` Создаем блок "${blockNumber}"...`);
            // Генерируем code для блока
            const blockCode = blockKey
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "_")
              .substring(0, 50);

            const newBlock = await prisma.$queryRaw<any>`
 INSERT INTO "Block" (
 id, number, code, "projectId", "organizationId",
 "floorCount", "constructionStage", "createdAt", "updatedAt"
 )
 VALUES (
 ${crypto.randomUUID()},
 ${blockNumber},
 ${blockCode},
 ${effectiveProjectId},
 ${organizationId},
 10,
 'Frame',
 NOW(),
 NOW()
 )
 RETURNING id
 `;
            blockId = newBlock[0].id;
            console.log(` Блок создан: ${blockId}`);
          }
          blocks.set(blockKey, blockId);
        }

        // 3. Проверяем, существует ли уже квартира
        const existingUnit = await prisma.$queryRaw<any>`
 SELECT id, price FROM "Unit"
 WHERE number = ${number.toString()} AND "blockId" = ${blockId}
 LIMIT 1
 `;

        if (existingUnit.length > 0) {
          console.log(` Обновляем квартиру №${number}`);
          const oldPrice = existingUnit[0].price;

          // status сюда намеренно не входит: раз квартира уже у нас в CRM, её статус
          // (в брони/продана и т.д.) ведёт наша система через сделки, а не повторный
          // импорт каталога — иначе свежий файл со старым "Available" мог бы молча
          // сбросить активную бронь/продажу без снятия самой сделки.
          await prisma.$executeRaw`
 UPDATE "Unit"
 SET
 area = ${area},
 floor = ${floor},
 rooms = ${rooms},
 price = ${price},
 type = ${type},
 "viewType" = ${viewType},
 "livingArea" = ${livingArea},
 "balconyArea" = ${balconyArea},
 "contractNumber" = ${contractNumber},
 "deliveryYear" = ${deliveryYear},
 "deliveryMonth" = ${deliveryMonth},
 "deliveryDate" = ${deliveryDate},
 "registeredInPublicRegistry" = COALESCE(${registeredInPublicRegistry}, "registeredInPublicRegistry"),
 "availableForSale" = COALESCE(${availableForSale}, "availableForSale"),
 "pricePerSqmVAT" = ${pricePerSqmVAT},
 "updatedAt" = NOW(),
 version = version + 1
 WHERE id = ${existingUnit[0].id}
 `;

          if (oldPrice !== price) {
            await prisma.$executeRaw`
 INSERT INTO "PriceHistory" (id, "unitId", "oldPrice", "newPrice", currency, "initiatorId", reason, "organizationId", "createdAt")
 VALUES (${crypto.randomUUID()}, ${existingUnit[0].id}, ${oldPrice}, ${price}, 'USD', ${initiatorId}, 'Импорт из Excel', ${organizationId}, NOW())
 `;
          }
          updated++;
          console.log(` Квартира обновлена`);
        } else {
          console.log(` Создаем квартиру №${number}`);
          await prisma.$executeRaw`
 INSERT INTO "Unit" (
 id, number, floor, area, rooms, price, status, type, "viewType",
 "livingArea", "balconyArea", "contractNumber", "deliveryYear", "deliveryMonth", "deliveryDate",
 "registeredInPublicRegistry", "availableForSale", "pricePerSqmVAT",
 "blockId", "organizationId", "createdAt", "updatedAt", version
 )
 VALUES (
 ${crypto.randomUUID()}, ${number.toString()}, ${floor}, ${area},
 ${rooms}, ${price}, ${vendorStatus}::"UnitStatus", ${type}, ${viewType},
 ${livingArea}, ${balconyArea}, ${contractNumber}, ${deliveryYear}, ${deliveryMonth}, ${deliveryDate},
 ${registeredInPublicRegistry ?? true}, ${availableForSale ?? true}, ${pricePerSqmVAT},
 ${blockId}, ${organizationId}, NOW(), NOW(), 1
 )
 `;
          imported++;
          console.log(` Квартира создана`);
        }
      } catch (rowError) {
        console.error(` Ошибка в строке ${rowNum}:`, rowError);
        allErrors.push(
          `Строка ${rowNum}: ${rowError instanceof Error ? rowError.message : "Неизвестная ошибка"}`,
        );
      }
    }

    revalidatePath("/shakhmatka");

    console.log(
      `\n ИТОГИ: Добавлено=${imported}, Обновлено=${updated}, Ошибок=${allErrors.length}`,
    );

    return {
      success: true,
      imported,
      updated,
      total: rows.length,
      errors: allErrors.length > 0 ? allErrors : undefined,
    };
  } catch (error) {
    console.error(" КРИТИЧЕСКАЯ ОШИБКА ИМПОРТА:", error);
    return {
      success: false,
      error:
        "Ошибка при импорте файла: " +
        (error instanceof Error ? error.message : "Неизвестная ошибка"),
    };
  }
}

// Шаблон под реальный формат выгрузки заказчика (лист "Products"). "#" и "PTD"
// приняты в шаблоне по просьбе заказчика (они есть в их файлах), но в базу не
// записываются — у нас нет для них соответствующих полей.
export async function getImportTemplate() {
  return [
    {
      "#": 1,
      "Building/Block": "6A",
      Floor: 1,
      "№ Flat": "1",
      PTD: 1,
      Status: "Available",
      Rooms: "1 Rooms Studio",
      "Area (sq meters)": 45.5,
      "Living Area (sq meters)": 42.1,
      "Balcony (sq meters)": 3.4,
      "Contract #": "",
      Year: 2028,
      Month: 1,
      Date: "15.06.2026",
      "Registration in the Public Registry": "No",
      "Available for sale": "Yes",
      "Price Incl. VAT (Sq meters/$)": 1180,
      "Full Price ($)": 180000,
    },
    {
      "#": 2,
      "Building/Block": "6A",
      Floor: 1,
      "№ Flat": "2",
      PTD: 2,
      Status: "Available",
      Rooms: "Commercial",
      "Area (sq meters)": 65.2,
      "Living Area (sq meters)": 65.2,
      "Balcony (sq meters)": 0,
      "Contract #": "",
      Year: 2028,
      Month: 1,
      Date: "15.06.2026",
      "Registration in the Public Registry": "No",
      "Available for sale": "Yes",
      "Price Incl. VAT (Sq meters/$)": 1000,
      "Full Price ($)": 250000,
    },
  ];
}
