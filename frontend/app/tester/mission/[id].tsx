// Legacy tester mission detail — redirect to client validation, preserving id.
import { useLocalSearchParams, Redirect } from 'expo-router';
export default function LegacyTesterMissionRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/client/validation/mission/${id || ''}` as any} />;
}
