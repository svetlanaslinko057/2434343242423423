/**
 * Legacy redirect — /admin/control → /admin/home
 * Kept temporarily so old deep-links / saved sessions don't 404.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function AdminControlRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/home' as any);
  }, [router]);
  return null;
}
