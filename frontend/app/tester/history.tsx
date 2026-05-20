// Legacy tester surface — redirect to client validation history.
import { Redirect } from 'expo-router';
export default function LegacyTesterHistoryRedirect() {
  return <Redirect href="/client/validation/history" />;
}
