import { Stack } from 'expo-router';
import T from '../../src/theme';

/**
 * /lead/* stack — intentionally minimal.
 *
 * The lead workspace is a read-only bridge between visitor and client.
 * No tabs, no role navigation, just a single linear flow:
 *   estimate-result → /lead/workspace?id=... → sign in → /workspace/:id
 */
export default function LeadLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: T.bg },
        animation: 'fade',
      }}
    />
  );
}
