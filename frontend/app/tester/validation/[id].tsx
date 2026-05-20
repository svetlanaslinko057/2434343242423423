// Legacy validation detail — redirects into new mission flow.
// We don't have a 1:1 mapping (legacy validation_id ≠ campaign_id), so we
// route to the missions home and let the validator pick.
import { Redirect } from 'expo-router';

export default function LegacyValidationDetailRedirect() {
  return <Redirect href="/tester/home" />;
}
