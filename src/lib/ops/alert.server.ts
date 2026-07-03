// Owner-alert helper. Sends a branded ops-alert email to OWNER_ALERT_EMAIL
// with in-memory 10-minute deduplication so a burst of identical errors
// generates one page, not a thousand.

import { sendTransactionalEmailServer } from '@/lib/email/send.server'

type Severity = 'critical' | 'error' | 'warning'

interface NotifyOwnerParams {
  severity?: Severity
  service: string
  message: string
  meta?: Record<string, unknown>
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const seen = new Map<string, number>()

function shouldSend(key: string): boolean {
  const now = Date.now()
  const last = seen.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return false
  seen.set(key, now)
  // Trim map
  if (seen.size > 500) {
    for (const [k, t] of seen) {
      if (now - t > DEDUPE_WINDOW_MS) seen.delete(k)
    }
  }
  return true
}

export async function notifyOwner({
  severity = 'error',
  service,
  message,
  meta,
}: NotifyOwnerParams): Promise<void> {
  // Always persist alerts to ops_alert, even when email is skipped/deduped —
  // the admin dashboard and rate-based escalation need every event.
  const key = `${severity}:${service}:${message}`
  const willEmail = Boolean(process.env.OWNER_ALERT_EMAIL) && shouldSend(key)

  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    await supabaseAdmin.from('ops_alert').insert({
      severity,
      service,
      message,
      meta: (meta ?? {}) as never,
      emailed: willEmail,
    })
  } catch (e) {
    console.error('[ops-alert] Failed to persist alert to ops_alert', e)
  }

  const owner = process.env.OWNER_ALERT_EMAIL
  if (!owner) {
    console.warn('[ops-alert] OWNER_ALERT_EMAIL not set; skipping email', { service, message })
    return
  }

  if (!willEmail) return

  try {
    await sendTransactionalEmailServer({
      templateName: 'ops-alert',
      // template has fixed `to`, but pass recipient as fallback
      recipientEmail: owner,
      idempotencyKey: `ops-${severity}-${service}-${Math.floor(Date.now() / 60000)}`,
      templateData: {
        severity,
        service,
        message,
        meta,
        at: new Date().toISOString(),
      },
    })
  } catch (e) {
    console.error('[ops-alert] Failed to enqueue owner alert', e)
  }
}

/**
 * Fire-and-forget wrapper for notifyOwner. Never blocks the caller and
 * never throws — safe to call from any fallback/error path.
 */
export function notifyOwnerAsync(params: NotifyOwnerParams): void {
  void notifyOwner(params).catch((e) => {
    console.error('[ops-alert] notifyOwnerAsync failed', e)
  })
}
