/**
 * Expo Push — client-side entry point.
 *
 * Two public functions:
 *   • `registerForPush()`  — ask for permission and return the Expo push
 *                             token (or null if we can't get one).
 *   • `syncPushTokenWithServer()` — call once after login/afterAuth.
 *                                    Registers the token against the
 *                                    current session so the backend
 *                                    starts pushing to this device.
 *
 * Design notes
 * ------------
 * • Silent on Expo Go / simulator / web — no permissions dialog, no spam.
 *   `Device.isDevice` gates the permission prompt; web is covered by the
 *   `Platform.OS === 'web'` early-return.
 * • We ignore the `projectId` argument by default — Expo infers it from
 *   `app.json` `extra.eas.projectId`. If EAS isn't configured yet,
 *   `getExpoPushTokenAsync` returns a generic `ExponentPushToken[...]`
 *   which is exactly what the backend accepts.
 * • Notification handler is set eagerly (side-effect on module import)
 *   so an incoming push surfaces the banner even if the app is open.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import api from './api';

// Foreground display behaviour — without this a push received while the
// app is open silently drops into the notification center.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    // Legacy fields kept so older SDKs don't warn; new fields above
    // are what SDK 53+ reads.
    shouldShowAlert: true,
  }) as any,
});

export async function registerForPush(): Promise<string | null> {
  // Web has its own WebPush flow — we don't target it here.
  if (Platform.OS === 'web') return null;
  // Simulators and the bare Expo Go app on newer SDKs can't receive
  // remote push. Bail cleanly instead of nagging the user for permission
  // we can't use.
  if (!Device.isDevice) return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    // Android channel — required for foreground sound + importance.
    // Hex literal (not theme token) so this module has zero theme deps.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 120, 80, 120],
        lightColor: '#3DDC97',
      });
    }

    // Expo SDK 49+: projectId is required for the managed push token
    // path; in dev (Expo Go / simulator it's often missing). We pass
    // whatever's in Constants and accept a null return when absent.
    const projectId =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      undefined;

    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenRes?.data ?? null;
  } catch {
    // Never throw out of this module — auth flow must complete even if
    // push registration breaks for an unexpected reason.
    return null;
  }
}

/**
 * Register-and-sync. Call once after successful login/register/google.
 * The backend will upsert by token, so calling it on every login is safe
 * and actually desirable (keeps `user_id` fresh if the device switched
 * accounts).
 */
export async function syncPushTokenWithServer(): Promise<void> {
  const token = await registerForPush();
  if (!token) return;
  try {
    await api.post('/devices/register', {
      token,
      platform: Platform.OS,
    });
  } catch {
    // Non-fatal — dropping this silently matches the overall "push must
    // never break auth" principle. The user can still use the app; we
    // simply won't push to this device until the next login.
  }
}
