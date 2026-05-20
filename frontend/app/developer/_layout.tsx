import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import NotificationPoller from '../../src/notification-poller';
import T from '../../src/theme';

// Hoisted tab icon renderers — React Navigation re-invokes tabBarIcon on
// every render. Defining these inline (`tabBarIcon: ({color, size}) =>
// <Ionicons .../>`) creates a new component identity each render → React
// destroys/recreates the icon subtree (the `react/no-unstable-nested-
// components` warning that surfaced in iter6). Pulling them up here gives
// each tab a stable component identity.
type IconArgs = { color: string; size: number };
const HomeIcon     = ({ color, size }: IconArgs) => <Ionicons name="home"          size={size} color={color} />;
const MarketIcon   = ({ color, size }: IconArgs) => <Ionicons name="storefront"    size={size} color={color} />;
const WorkIcon     = ({ color, size }: IconArgs) => <Ionicons name="code-working"  size={size} color={color} />;
const EarningsIcon = ({ color, size }: IconArgs) => <Ionicons name="wallet"        size={size} color={color} />;
const ProfileIcon  = ({ color, size }: IconArgs) => <Ionicons name="person-circle" size={size} color={color} />;

export default function DeveloperLayout() {
  return (
    <View style={{ flex: 1 }}>
      {/* Event Bridge: реагируем на push-ивенты модульных переходов. */}
      <NotificationPoller />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: T.surface1, borderTopColor: T.border, height: 60, paddingBottom: 8 },
          tabBarActiveTintColor: T.primary,
          tabBarInactiveTintColor: T.textMuted,
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen name="home"     options={{ title: 'Home',     tabBarIcon: HomeIcon }} />
        <Tabs.Screen name="market"   options={{ title: 'Market',   tabBarIcon: MarketIcon }} />
        <Tabs.Screen name="work"     options={{ title: 'Work',     tabBarIcon: WorkIcon }} />
        <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: EarningsIcon }} />
        <Tabs.Screen name="profile"  options={{ title: 'Profile',  tabBarIcon: ProfileIcon }} />

        {/* Hidden routable screens — accessible only by deep-link from
            other screens, never shown as bottom tabs. */}
        <Tabs.Screen name="wallet"       options={{ href: null }} />
        <Tabs.Screen name="acceptance"   options={{ href: null }} />
        <Tabs.Screen name="time-logs"    options={{ href: null }} />
        {/* Developer Intelligence — linked from Profile (leaderboard, growth) and Work (feedback) */}
        <Tabs.Screen name="leaderboard"  options={{ href: null }} />
        <Tabs.Screen name="growth"       options={{ href: null }} />
        <Tabs.Screen name="feedback"     options={{ href: null }} />
        {/* Validation Program — opt-in entry. Hidden tab, reached from profile / wallet upsell. */}
        <Tabs.Screen name="validation/index"  options={{ href: null }} />
        {/* Module detail — opened from home/work module cards */}
        <Tabs.Screen name="module/[id]"  options={{ href: null }} />
        {/* Support inbox — opened from Profile → Support row */}
        <Tabs.Screen name="support"        options={{ href: null }} />
        <Tabs.Screen name="support/[id]"   options={{ href: null }} />
        {/* Notifications — opened from bell on Home */}
        <Tabs.Screen name="notifications"  options={{ href: null }} />
      </Tabs>
    </View>
  );
}
