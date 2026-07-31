"use server";

import { db as prisma } from "@/lib/db";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";

export async function importUnitsFromExcel(
  formData: FormData,
  organizationId: string,
  initiatorId: string,
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
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    console.log(" Найдено строк в Excel:", rows.length);
    console.log(" Заголовки колонок:", Object.keys(rows[0] || {}));

    if (rows.length === 0) {
      return { success: false, error: "Файл пуст" };
    }

    let imported = 0;
    let updated = 0;

    const projects = new Map();
    const blocks = new Map();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      console.log(`\n--- Обработка строки ${rowNum} ---`);

      try {
        const projectName =
          row.projectName ||
          row["projectName"] ||
          row["ЖК"] ||
          row["Проект"] ||
          row["project"] ||
          row["Project"];
        const blockNumber =
          row.blockNumber ||
          row["blockNumber"] ||
          row["Корпус"] ||
          row["Блок"] ||
          row["block"] ||
          row["Block"];
        const number =
          row.number ||
          row["number"] ||
          row["Номер"] ||
          row["№"] ||
          row["unit"] ||
          row["Unit"];
        const area = parseFloat(
          row.area || row["area"] || row["Площадь"] || row["sqm"] || 0,
        );
        const price = parseFloat(
          row.price || row["price"] || row["Цена"] || row["amount"] || 0,
        );
        const rooms = parseInt(
          row.rooms || row["rooms"] || row["Комнат"] || row["room"] || 1,
        );
        const floor = parseInt(row.floor || row["floor"] || row["Этаж"] || 1);

        console.log(
          ` Проект="${projectName}", Корпус="${blockNumber}", №${number}, ${area}м², $${price}`,
        );

        if (!projectName) {
          allErrors.push(`Строка ${rowNum}: Отсутствует название проекта`);
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

        // 1. Находим или создаем Project
        let projectId = projects.get(projectName);
        if (!projectId) {
          const existingProject = await prisma.$queryRaw<any>`
 SELECT id FROM "Project" 
 WHERE name = ${projectName} AND "organizationId" = ${organizationId}
 LIMIT 1
 `;

          if (existingProject.length > 0) {
            projectId = existingProject[0].id;
            console.log(` Проект найден: ${projectId}`);
          } else {
            console.log(` Создаем проект "${projectName}"...`);
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
            projectId = newProject[0].id;
            console.log(` Проект создан: ${projectId}`);
          }
          projects.set(projectName, projectId);
        }

        // 2. Находим или создаем Block (с обязательным полем code)
        const blockKey = `${projectName}_${blockNumber}`;
        let blockId = blocks.get(blockKey);
        if (!blockId) {
          const existingBlock = await prisma.$queryRaw<any>`
 SELECT id FROM "Block" 
 WHERE number = ${blockNumber} AND "projectId" = ${projectId}
 LIMIT 1
 `;

          if (existingBlock.length > 0) {
            blockId = existingBlock[0].id;
            console.log(` Блок найден: ${blockId}`);
          } else {
            console.log(` Создаем блок "${blockNumber}"...`);
            // Генерируем code для блока
            const blockCode = `${projectName}_${blockNumber}`
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
 ${projectId}, 
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

        const type = row.type || row["type"] || "Apartment";
        const viewType = row.viewType || row["viewType"] || row["Вид"] || null;

        if (existingUnit.length > 0) {
          console.log(` Обновляем квартиру №${number}`);
          const oldPrice = existingUnit[0].price;

          await prisma.$executeRaw`
 UPDATE "Unit" 
 SET 
 area = ${area},
 floor = ${floor},
 rooms = ${rooms},
 price = ${price},
 type = ${type},
 "viewType" = ${viewType},
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
 "blockId", "organizationId", "createdAt", "updatedAt", version
 )
 VALUES (
 ${crypto.randomUUID()}, ${number.toString()}, ${floor}, ${area}, 
 ${rooms}, ${price}, 'FREE', ${type}, ${viewType},
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

export async function getImportTemplate() {
  return [
    {
      projectName: 'ЖК "Астана Тауэр"',
      blockNumber: "А",
      floor: 1,
      number: "101",
      area: 45.5,
      rooms: 1,
      price: 180000,
      type: "Apartment",
      viewType: "На город",
      address: "пр. Мангилик Ел, 25",
    },
    {
      projectName: 'ЖК "Астана Тауэр"',
      blockNumber: "А",
      floor: 1,
      number: "102",
      area: 65.2,
      rooms: 2,
      price: 250000,
      type: "Apartment",
      viewType: "Во двор",
      address: "пр. Мангилик Ел, 25",
    },
  ];
}
