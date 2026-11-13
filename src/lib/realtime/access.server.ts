import type { StripeEnv } from '@/lib/stripe.server';

/** Entitlement environment is deployment configuration, never a browser choice. */
export function realtimeEnvironment(requested?: unknown): StripeEnv {
  const configured = process.env.PAYMENTS_ENVIRONMENT;
  const token = process.env.VITE_PAYMENTS_CLIENT_TOKEN;
  const tokenEnv = token?.startsWith('pk_live_') ? 'live' : token?.startsWith('pk_test_') ? 'sandbox' : undefined;
  if (configured !== undefined && configured !== 'live' && configured !== 'sandbox') {
    throw new Error('Voice payment environment is not configured');
  }
  if (configured && tokenEnv && configured !== tokenEnv) throw new Error('Voice payment environment conflicts with this build');
  const env = configured || tokenEnv;
  if (!env) throw new Error('Voice payment environment is not configured');
  if (requested !== undefined && requested !== env) throw new Error('Invalid voice payment environment');
  return env;
}

type Entitlement = {status: string; current_period_end: string | null};
export function voiceEntitlement(rows: Entitlement[], now = Date.now()): 'paid' | 'trial' {
  const validPeriod = (r: Entitlement) => r.current_period_end !== null && Number.isFinite(Date.parse(r.current_period_end)) && Date.parse(r.current_period_end) > now;
  if (rows.some(r => r.status === 'lifetime' || ((r.status === 'active' || r.status === 'canceled') && validPeriod(r)))) return 'paid';
  if (rows.some(r => r.status === 'trialing' && validPeriod(r))) return 'trial';
  throw new Error('An active subscription or trial is required for voice');
}
