const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log("Connected to Supabase.");

    // Начинаем транзакцию для безопасности
    await client.query('BEGIN');
    console.log("Transaction started.");

    // --- 1. ТАБЛИЦА Project ---
    console.log("Altering 'Project' table columns...");
    await client.query(`
      ALTER TABLE "Project" 
      ADD COLUMN IF NOT EXISTS "code" TEXT,
      ADD COLUMN IF NOT EXISTS "nameKa" TEXT,
      ADD COLUMN IF NOT EXISTS "nameRu" TEXT,
      ADD COLUMN IF NOT EXISTS "nameEn" TEXT,
      ADD COLUMN IF NOT EXISTS "spv" TEXT,
      ADD COLUMN IF NOT EXISTS "cadastralCode" TEXT,
      ADD COLUMN IF NOT EXISTS "expectedCompletionDate" DATE;
    `);

    // Получим существующие проекты, чтобы перенести данные
    const projectsRes = await client.query('SELECT id, name FROM "Project"');
    console.log(`Migrating ${projectsRes.rows.length} projects...`);
    
    for (const row of projectsRes.rows) {
      // Генерируем slug для code
      let slug = row.name
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!slug) slug = `project-${row.id.slice(0, 8)}`;
      
      console.log(`Project: "${row.name}" -> code: "${slug}"`);
      
      await client.query(`
        UPDATE "Project"
        SET 
          "code" = $1,
          "nameKa" = $2,
          "nameRu" = $2,
          "nameEn" = $2
        WHERE "id" = $3
      `, [slug, row.name, row.id]);
    }

    // Установим NOT NULL ограничения на Project
    console.log("Enforcing NOT NULL on Project name fields and code...");
    await client.query(`
      ALTER TABLE "Project"
      ALTER COLUMN "code" SET NOT NULL,
      ALTER COLUMN "nameKa" SET NOT NULL,
      ALTER COLUMN "nameRu" SET NOT NULL,
      ALTER COLUMN "nameEn" SET NOT NULL;
    `);

    // Создадим уникальный индекс для Project
    console.log("Creating unique index idx_project_code_org...");
    await client.query(`
      DROP INDEX IF EXISTS "idx_project_code_org";
      CREATE UNIQUE INDEX "idx_project_code_org" ON "Project" ("organizationId", "code");
    `);

    // --- 2. ТАБЛИЦА Block ---
    console.log("Altering 'Block' table columns...");
    await client.query(`
      ALTER TABLE "Block"
      ADD COLUMN IF NOT EXISTS "code" TEXT,
      ADD COLUMN IF NOT EXISTS "floorCount" INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS "constructionStage" TEXT DEFAULT 'Frame',
      ADD COLUMN IF NOT EXISTS "expectedCommissioningDate" DATE;
    `);

    // Получим существующие блоки
    const blocksRes = await client.query('SELECT id, number FROM "Block"');
    console.log(`Migrating ${blocksRes.rows.length} blocks...`);
    
    for (const row of blocksRes.rows) {
      // Извлечем букву/цифру из названия (например "Блок А" -> "A")
      let blockCode = 'A';
      if (row.number.includes('Б')) blockCode = 'B';
      const match = row.number.match(/[A-ZА-Я0-9]/i);
      if (match) {
        blockCode = match[0].toUpperCase();
      }
      
      console.log(`Block: "${row.number}" -> code: "${blockCode}"`);
      
      await client.query(`
        UPDATE "Block"
        SET "code" = $1
        WHERE "id" = $2
      `, [blockCode, row.id]);
    }

    // Установим NOT NULL на Block.code
    console.log("Enforcing NOT NULL on Block.code...");
    await client.query(`
      ALTER TABLE "Block"
      ALTER COLUMN "code" SET NOT NULL;
    `);

    // Создадим уникальный индекс для Block
    console.log("Creating unique index idx_block_code_project...");
    await client.query(`
      DROP INDEX IF EXISTS "idx_block_code_project";
      CREATE UNIQUE INDEX "idx_block_code_project" ON "Block" ("projectId", "code");
    `);

    // --- 3. ТАБЛИЦА Unit ---
    console.log("Updating Unit version default values if missing...");
    await client.query(`
      UPDATE "Unit" SET "version" = 1 WHERE "version" IS NULL OR "version" = 0;
    `);

    // Фиксируем транзакцию
    await client.query('COMMIT');
    console.log("Migration executed and COMMITTED successfully.");

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Migration failed and ROLLED BACK.", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
