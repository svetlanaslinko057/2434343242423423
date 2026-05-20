import api from './api';

// Frontend metrics logger — fire-and-forget, never blocks UI.
// Backend endpoint: POST /api/metrics/event — accepts {event, props}.

export type MetricEvent =
  | 'demo_click'
  | 'wizard_started'
  | 'wizard_completed'
  | 'workspace_opened'
  | 'first_action'        // user clicked primary CTA for the first time
  | 'action_confirmed'    // user confirmed modal
  | 'tour_completed';

export async function track(event: MetricEvent, props: Record<string, any> = {}): Promise<void> {
  try {
    await api.post('/metrics/event', { event, props });
  } catch {
    // silent — metrics must never break UI
  }
}
