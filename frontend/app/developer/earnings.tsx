/**
 * Earnings tab → consolidated into /developer/wallet.
 *
 * Historical context: this file used to be a minimal earnings-pipeline view
 * that overlapped with /developer/wallet (which has the full withdrawal flow
 * and richer earnings breakdown). Per UI consolidation pass 2026-05-15,
 * the tab now redirects to the canonical wallet screen so there is exactly
 * one place where developers see their money.
 *
 * The tab itself stays in the developer tab bar (Earnings icon) because the
 * mental model "open Earnings tab to see my money" is correct — we just
 * land them on the comprehensive view instead of the partial one.
 */
import { Redirect } from 'expo-router';

export default function DevEarnings() {
  return <Redirect href="/developer/wallet" />;
}
