import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useFeedback } from './feedback';
import api from './api';

/**
 * NotificationPoller — глобальный слой «моментальной реакции».
 *
 * Event Bridge (backend/module_motion.py) складывает push-события в
 * коллекцию `notifications` при переходах модулей:
 *   - review_required  (клиент должен апрувить)
 *   - review_ready     (dev знает: теперь очередь клиента)
 *   - module_done      (обе стороны узнают о завершении)
 *
 * Мы поллим /notifications/my?unread=true каждые 6 секунд и показываем
 * новые события через существующий useFeedback() toast-стек. Сразу после
 * показа помечаем их read — чтобы не повторять.
 *
 * Компонент без UI: вставляется один раз в layout и молча работает.
 * WS не нужен — polling на 6 с достаточно плотен для «ощущения живого».
 */
const POLL_MS = 6_000;

const ICON_FOR_TYPE: Record<string, string> = {
  review_required: 'alert-circle-outline',
  review_ready: 'hourglass-outline',
  module_done: 'checkmark-circle-outline',
};

const TOAST_TYPE: Record<string, 'info' | 'success' | 'warning'> = {
  review_required: 'warning',
  review_ready: 'info',
  module_done: 'success',
};

export default function NotificationPoller() {
  const { user } = useAuth();
  const { show } = useFeedback();
  const seen = useRef<Set<string>>(new Set());
  const running = useRef(false);

  useEffect(() => {
    if (!user) return;

    let stopped = false;

    const tick = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const r = await api.get('/notifications/my?unread=true&limit=10');
        const items: any[] = Array.isArray(r.data?.notifications) ? r.data.notifications : [];
        if (items.length === 0) return;

        const freshIds: string[] = [];
        for (const n of items) {
          const id = n.notification_id;
          if (!id || seen.current.has(id)) continue;
          seen.current.add(id);
          freshIds.push(id);
          show({
            type: TOAST_TYPE[n.type] || 'info',
            title: n.title || 'Notification',
            subtitle: n.subtitle || undefined,
            icon: (ICON_FOR_TYPE[n.type] || 'notifications-outline') as any,
          });
        }

        if (freshIds.length > 0) {
          // Fire-and-forget: backend всё равно смотрит на read=false.
          api.post('/notifications/mark-read', { notification_ids: freshIds, all: false }).catch(() => {});
        }
      } catch {
        /* транспортная ошибка — попробуем на следующем тике */
      } finally {
        running.current = false;
      }
    };

    // Первый тик с задержкой, чтобы не флэшить toast прямо на входе.
    const initial = setTimeout(tick, 2000);
    const iv = setInterval(() => { if (!stopped) tick(); }, POLL_MS);
    return () => { stopped = true; clearTimeout(initial); clearInterval(iv); };
  }, [user, show]);

  return null;
}
