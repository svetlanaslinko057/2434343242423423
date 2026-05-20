/**
 * Device fingerprint — a stable, opaque ID we put in localStorage on first
 * visit. We send it on /auth/login and /auth/2fa/verify so the backend can
 * remember "I've already 2FA'd this device, don't ask again for 30 days".
 *
 * This is NOT a security boundary — a determined attacker who controls the
 * browser can read it. It's purely UX (skip the 2nd factor on a known
 * device, exactly like Gmail's "Don't ask again on this computer").
 *
 * Backend stores bcrypt(fingerprint) per (user_id, fingerprint) pair, so the
 * same fingerprint across multiple users is independently revocable.
 */
const KEY = 'atlas_device_fingerprint';

export function getDeviceFingerprint() {
  try {
    let fp = localStorage.getItem(KEY);
    if (!fp || fp.length < 16) {
      fp = `web_${crypto.randomUUID()}_${Date.now().toString(36)}`;
      localStorage.setItem(KEY, fp);
    }
    return fp;
  } catch {
    // Private mode / SSR — fall back to a session-scoped random ID.
    return `web_ephemeral_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

export function getDeviceLabel() {
  try {
    const ua = navigator.userAgent || '';
    // Cheap human-readable label: "Chrome on macOS" style.
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' :
      /Firefox\//.test(ua) ? 'Firefox' :
      'Browser';
    const os =
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad/.test(ua) ? 'iOS' :
      'device';
    return `${browser} on ${os}`;
  } catch {
    return 'Browser';
  }
}
