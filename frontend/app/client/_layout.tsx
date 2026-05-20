import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import NotificationPoller from '../../src/notification-poller';
import T from '../../src/theme';

/**
 * Client tabs — canonical 5-tab architecture.
 *
 *   Home · Projects · Activity · Billing · Profile
 *
 * The Human Validation Layer (HVL) does NOT live in the tab bar. After a
 * client opts into the program, an entry-point icon appears in AppHeader
 * (next to alerts/chat), and the validation surface stays available as a
 * deep-link from the Profile → Community card. This keeps the 5-tab grid
 * intact and avoids the 6-icon overflow on small viewports.
 *
 * Hidden routes (`href: null`) stay reachable through deep links — see
 * `referrals`, `contract`, `payment-plan`, `validation/*`, etc.
 */
export default function ClientLayout() {
  return (
    <View style={{ flex: 1 }}>
      <NotificationPoller />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: T.surface1,
            borderTopColor: T.border,
            height: 60,
            paddingBottom: 8,
          },
          tabBarActiveTintColor: T.info,
          tabBarInactiveTintColor: T.textMuted,
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="projects/index"
          options={{
            title: 'Projects',
            tabBarIcon: ({ color, size }) => <Ionicons name="folder-open" size={size} color={color} />,
          }}
        />
        <Tabs.Screen name="projects/[id]" options={{ href: null }} />
        <Tabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            tabBarIcon: ({ color, size }) => <Ionicons name="flash" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="billing"
          options={{
            title: 'Billing',
            tabBarIcon: ({ color, size }) => <Ionicons name="card" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
          }}
        />

        {/* Hidden from tab bar — kept as routable screens. */}
        <Tabs.Screen name="control" options={{ href: null }} />
        <Tabs.Screen name="support" options={{ href: null }} />
        <Tabs.Screen name="more" options={{ href: null }} />
        <Tabs.Screen name="billing/plans" options={{ href: null }} />
        <Tabs.Screen name="modules/catalog" options={{ href: null }} />
        <Tabs.Screen name="referrals" options={{ href: null }} />
        <Tabs.Screen name="contract/[id]" options={{ href: null }} />
        <Tabs.Screen name="payment-plan/[id]" options={{ href: null }} />
        <Tabs.Screen name="deliverable/[id]" options={{ href: null }} />
        <Tabs.Screen name="versions/[project_id]" options={{ href: null }} />

        {/* HVL — accessed via AppHeader sparkles icon + Profile community
            card. Routes registered but kept out of the tab bar. */}
        <Tabs.Screen name="validation/index" options={{ href: null }} />
        <Tabs.Screen name="validation/history" options={{ href: null }} />
        <Tabs.Screen name="validation/mission/[id]" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
