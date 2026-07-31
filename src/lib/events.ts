import { EventEmitter } from 'events';

// Глобальный синглтон EventEmitter для работы в development (Next.js hot reload) и production
const globalForEvents = global as unknown as { eventEmitter: EventEmitter };

export const eventEmitter = globalForEvents.eventEmitter || new EventEmitter();

if (process.env.NODE_ENV !== 'production') {
  globalForEvents.eventEmitter = eventEmitter;
}

// Увеличим лимит слушателей, так как каждый клиент SSE создает своего слушателя
eventEmitter.setMaxListeners(100);
