const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
  console.log('Начинаю миграцию статусов...');
  
  // 1. Обновляем NEGOTIATION -> SELECTION
  const res1 = await prisma.deal.updateMany({
    where: { status: 'NEGOTIATION' as any },
    data: { status: 'SELECTION' as any }
  });
  console.log(`Обновлено ${res1.count} сделок (Переговоры -> Подбор)`);

  // 2. Обновляем SOLD -> REGISTRATION
  const res2 = await prisma.deal.updateMany({
    where: { status: 'SOLD' as any },
    data: { status: 'REGISTRATION' as any }
  });
  console.log(`Обновлено ${res2.count} сделок (Продано -> Регистрация)`);

  console.log('Миграция завершена!');
}

migrate()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
