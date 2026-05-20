// Legacy tester surface — Human Validation Layer is now a capability on the
// client account (per v2 architecture, May 18 2026). Anyone landing here gets
// redirected to /client/validation which handles opt-in vs missions modes.
import { Redirect } from 'expo-router';
export default function LegacyTesterHomeRedirect() {
  return <Redirect href="/client/validation" />;
}
