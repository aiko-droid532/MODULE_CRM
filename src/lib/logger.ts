export function logAction(actionName: string, details?: any) {
  const timestamp = new Date().toLocaleTimeString('ru-RU');
  const detailsStr = details ? ` | Данные: ${JSON.stringify(details)}` : '';
  // Выводим красивый цветной лог в терминал (\x1b[32m - зеленый цвет)
  console.log(`\x1b[32m[CRM-ДЕЙСТВИЕ] [${timestamp}] ${actionName}${detailsStr}\x1b[0m`);
}
