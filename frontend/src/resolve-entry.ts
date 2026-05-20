/**
 * Единственная точка принятия решения "куда идёт юзер после авторизации".
 *
 * Правило:
 *   0 states          → /gateway  (новый юзер, сам выбирает I'm client / I'm dev)
 *   1 state           → родной кабинет этой роли
 *   ≥2 states         → /gateway  (мульти-ролевой выбор активного контекста)
 *
 * НИГДЕ БОЛЬШЕ не решаем куда редиректить после логина. Все точки входа
 * (auth, index, project-booting, app-header) импортируют resolveUserEntry
 * и доверяют ему.
 *
 * /home (smart hub) ИСКЛЮЧЁН из авто-редиректов сознательно — он слабее,
 * чем /client/home и /developer/home, и не должен перехватывать трафик.
 */
export type MeLike = {
  states?: string[] | null;
  active_context?: string | null;
} | null | undefined;

export function resolveUserEntry(me: MeLike): string {
  const states = Array.isArray(me?.states) ? (me!.states as string[]) : [];

  if (states.length === 0) {
    return '/gateway';
  }

  if (states.length === 1) {
    if (states.includes('admin')) return '/admin/home';
    if (states.includes('developer')) return '/developer/home';
    if (states.includes('client')) return '/client/home';
    if (states.includes('tester')) return '/tester/home';
  }

  // ≥2 ролей — если активный контекст уже выбран, идём в его кабинет,
  // иначе отдаём выбор пользователю через /gateway.
  const active = me?.active_context;
  if (active === 'admin') return '/admin/home';
  if (active === 'developer') return '/developer/home';
  if (active === 'client') return '/client/home';
  if (active === 'tester') return '/tester/home';

  return '/gateway';
}
