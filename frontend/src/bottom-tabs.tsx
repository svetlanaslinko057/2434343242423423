import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import T from './theme';

/**
 * L0 AppShell — bottom tab bar, the single persistent surface across L0 routes.
 *
 * Shown only on L0 screens: /home, /work, /activity, /profile. On context-owned
 * screens (/client/*, /developer/*, /admin/*) each stack has its own nav, so
 * we stay out of the way.
 */

type TabDef = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  matchFirstSegment: string;
};

const TABS: TabDef[] = [
  { key: 'home',     label: 'Home',     icon: 'home-outline',       route: '/hub',      matchFirstSegment: 'hub' },
  { key: 'work',     label: 'Work',     icon: 'briefcase-outline',  route: '/work',     matchFirstSegment: 'work' },
  { key: 'activity', label: 'Activity', icon: 'flash-outline',      route: '/activity', matchFirstSegment: 'activity' },
  // Profile moved to the top-right avatar in AppHeader — no duplicate entry here.
];

// L0 BottomTabs (Home/Work/Activity) is DISABLED.
//
// Each role lives in its own cabinet (/client/*, /developer/*, /admin/*) with
// its own Tabs layout. The legacy global shell created visible duplicates
// (two tab bars, two profile entry points, two Activity tabs). One profile
// per role, one navigation surface per cabinet — that's the whole rule.
//
// Visiting a stray L0 url (/work, /activity, /hub, /profile) still works as a
// routable screen but doesn't surface the duplicate shell tabs anymore. The
// avatar in AppHeader routes users straight into their role profile.
const SHELL_ROUTES = new Set<string>([]);

export default function BottomTabs() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const first = (segments[0] || '') as string;

  if (!SHELL_ROUTES.has(first)) return null;

  return (
    <View
      testID="app-shell-bottom-tabs"
      style={[s.container, { paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      {TABS.map((t) => {
        const active =
          first === t.matchFirstSegment ||
          // /inbox shares meaning with /activity
          (t.key === 'activity' && first === 'inbox');
        const color = active ? T.primary : T.textMuted;
        return (
          <TouchableOpacity
            key={t.key}
            testID={`tab-${t.key}`}
            style={s.tab}
            onPress={() => router.replace(t.route as any)}
            activeOpacity={0.7}
          >
            <Ionicons name={t.icon} size={22} color={color} />
            <Text style={[s.label, { color }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: T.surface1,
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: T.tiny, fontWeight: '600' },
});
