// Legacy validation queue — redirects to new mission flow.
// Kept as a thin redirect so any bookmarks / deep-links still resolve.
import { useEffect } from 'react';
import { Redirect } from 'expo-router';

export default function LegacyValidationsRedirect() {
  useEffect(() => {}, []);
  return <Redirect href="/tester/home" />;
}
