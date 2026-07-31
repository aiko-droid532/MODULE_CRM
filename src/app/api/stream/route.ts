import { NextRequest } from 'next/server';
import { eventEmitter } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      // Отправляем начальный сигнал для установки соединения
      controller.enqueue(encoder.encode('data: {"type": "connected"}\n\n'));

      // Обработчик события изменения статуса
      const handleUpdate = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      eventEmitter.on('unit_updated', handleUpdate);

      // Очистка при закрытии соединения клиентом
      req.signal.addEventListener('abort', () => {
        eventEmitter.off('unit_updated', handleUpdate);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
