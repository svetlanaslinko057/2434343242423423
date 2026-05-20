/**
 * Admin tabs — pult, not cabinet.
 *
 * 5 surfaces only: Home · QA · Validation · Finance · Profile
 *
 *   Home       — system status + alerts + quick actions + Operations grid
 *   QA         — pending modules with one-tap decisions
 *   Validation — Human Validation League / opt-in pool
 *   Finance    — withdrawals + payout batches with one-tap approve
 *   Profile    — admin info + system snapshot + logout
 *
 * Mobile НЕ повторяет web. Mobile реагирует на систему.
 * Drill-down surfaces (Operations grid) live below the tab bar — see
 * docs/product-scope-freeze-amend-1.md for the May 2026 expansion.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.surface1 },
        headerTintColor: T.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: T.surface1, borderTopColor: T.border, height: 60, paddingBottom: 8 },
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="home"       options={{ title: 'Home',       tabBarIcon: ({ color, size }) => <Ionicons name="pulse"            size={size} color={color} /> }} />
      <Tabs.Screen name="qa"         options={{ title: 'QA',         tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-circle" size={size} color={color} /> }} />
      <Tabs.Screen name="validation" options={{ title: 'Validation', tabBarIcon: ({ color, size }) => <Ionicons name="people-circle"    size={size} color={color} /> }} />
      <Tabs.Screen name="finance"    options={{ title: 'Finance',    tabBarIcon: ({ color, size }) => <Ionicons name="cash"             size={size} color={color} /> }} />
      <Tabs.Screen name="profile"    options={{ title: 'Profile',    tabBarIcon: ({ color, size }) => <Ionicons name="person-circle"    size={size} color={color} /> }} />

      {/* Hidden — legacy routes kept temporarily so deep-links don't 404.
          They redirect to /admin/home via internal nav. */}
      <Tabs.Screen name="control" options={{ href: null }} />
      {/* Hidden — admin project detail (HVL bootstrap). Reached via push, not tab. */}
      <Tabs.Screen name="projects/[id]" options={{ href: null }} />

      {/* Hidden — parity expansion screens (May 2026 / scope-freeze amendment).
          Reached from the admin home "Operations" grid, NOT from the tab bar.
          See docs/product-scope-freeze-amend-1.md → Decision 1 (amended).
          Only the NEW screens are registered here — other admin files (time-logs,
          support, wallet, etc.) are auto-detected by expo-router and listing
          them explicitly triggers "Too many screens defined" warnings. */}
      <Tabs.Screen name="users"            options={{ href: null }} />
      <Tabs.Screen name="team"             options={{ href: null }} />
      <Tabs.Screen name="contracts"        options={{ href: null }} />
      <Tabs.Screen name="templates"        options={{ href: null }} />
      <Tabs.Screen name="integrations"     options={{ href: null }} />
      <Tabs.Screen name="inbox"            options={{ href: null }} />
      <Tabs.Screen name="marketplace"      options={{ href: null }} />
      <Tabs.Screen name="master"           options={{ href: null }} />
      <Tabs.Screen name="execution-console" options={{ href: null }} />
    </Tabs>
  );
}
