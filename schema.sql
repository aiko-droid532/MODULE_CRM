-- 1. Создаем типы данных (перечисления)
CREATE TYPE "UnitStatus" AS ENUM ('FREE', 'RESERVATION_ORAL', 'RESERVATION_PAID', 'SOLD', 'SERVICE');
CREATE TYPE "DealStatus" AS ENUM ('LEAD', 'VIEWING', 'NEGOTIATION', 'RESERVATION', 'CONTRACT_PREPARATION', 'SOLD', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- 2. Таблица Проектов (ЖК)
CREATE TABLE "Project" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Таблица Блоков (Корпусов)
CREATE TABLE "Block" (
    "id" TEXT PRIMARY KEY,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Таблица Объектов (Квартир)
CREATE TABLE "Unit" (
    "id" TEXT PRIMARY KEY,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "status" "UnitStatus" DEFAULT 'FREE',
    "blockId" TEXT NOT NULL REFERENCES "Block"("id") ON DELETE CASCADE,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Таблица Лидов
CREATE TABLE "Lead" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Таблица Сделок
CREATE TABLE "Deal" (
    "id" TEXT PRIMARY KEY,
    "leadId" TEXT NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
    "unitId" TEXT NOT NULL REFERENCES "Unit"("id") ON DELETE CASCADE,
    "status" "DealStatus" DEFAULT 'LEAD',
    "managerId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Таблица Бронирований
CREATE TABLE "Booking" (
    "id" TEXT PRIMARY KEY,
    "leadId" TEXT NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
    "unitId" TEXT NOT NULL REFERENCES "Unit"("id") ON DELETE CASCADE,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. График платежей
CREATE TABLE "PaymentSchedule" (
    "id" TEXT PRIMARY KEY,
    "dealId" TEXT NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP WITH TIME ZONE NOT NULL,
    "status" "PaymentStatus" DEFAULT 'PENDING',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Транзакции (фактические оплаты)
CREATE TABLE "Transaction" (
    "id" TEXT PRIMARY KEY,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "paymentScheduleId" TEXT NOT NULL REFERENCES "PaymentSchedule"("id") ON DELETE CASCADE,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создаем индексы для быстрой работы базы (по организациям)
CREATE INDEX "idx_project_org" ON "Project"("organizationId");
CREATE INDEX "idx_block_org" ON "Project"("organizationId");
CREATE INDEX "idx_unit_org" ON "Unit"("organizationId");
CREATE INDEX "idx_lead_org" ON "Lead"("organizationId");
CREATE INDEX "idx_deal_org" ON "Deal"("organizationId");
