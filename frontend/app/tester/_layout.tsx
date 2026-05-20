import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';

type IconProps = { color: string; size: number };
const HomeIcon = ({ color, size }: IconProps) => <Ionicons name="eye-outline" size={size} color={color} />;
const HistoryIcon = ({ color, size }: IconProps) => <Ionicons name="time-outline" size={size} color={color} />;

/**
 * Validator cabinet — Human Validation Layer (NOT engineering QA).
 *
 * Mental model (per architecture pivot 2026-05-18):
 *   Validator = human sensor (NOT gatekeeper)
 *   Admin     = judge (final verdict)
 *   Client    = buyer of extra confidence
 *
 * Two tabs only:
 *   1. home          — Review Missions (available + my active) + credits + reputation
 *   2. history       — submitted feedback + verdicts + credits earned
 *
 * Deep-link only:
 *   mission/[id]     — open mission, submit feedback (looks_good | issue)
 *
 * No "queue", no "pass/fail" verbiage, no "performance dashboard" — this is
 * intentionally non-corporate-QA. Validator does NOT close anything.
 *
 * Legacy `validations`, `validation/[id]` routes kept under the folder but
 * hidden from tabs (href:null) — they redirect to the new mission flow.
 */
export default function ValidatorLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: T.surface1, borderTopColor: T.border, height: 60, paddingBottom: 8 },
          tabBarActiveTintColor: T.primary,
          tabBarInactiveTintColor: T.textMuted,
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen name="home"    options={{ title: 'Missions', tabBarIcon: HomeIcon }} />
        <Tabs.Screen name="history" options={{ title: 'History',  tabBarIcon: HistoryIcon }} />

        {/* Hidden routes — deep-link only or legacy */}
        <Tabs.Screen name="mission/[id]"      options={{ href: null }} />
        <Tabs.Screen name="validations"       options={{ href: null }} />
        <Tabs.Screen name="validation/[id]"   options={{ href: null }} />
      </Tabs>
    </View>
  );
}
