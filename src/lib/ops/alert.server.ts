// Owner-alert helper. Sends a branded ops-alert email to OWNER_ALERT_EMAIL
// with in-memory 10-minute deduplication so a burst of identical errors
// generates one page, not a thousand. Also enforces a per-service hourly
// email cap so a flood of DIFFERENT messages from one service can't spam
// the inbox — all alerts still persist to ops_alert for the audit trail.

import { sendTransactionalEmailServer } from '@/lib/email/send.server'

// Internal severity taxonomy (matches ops_alert CHECK constraint).
type InternalSeverity = 'critical' | 'error' | 'warning' | 'info'
// Public taxonomy exposed to callers — accepts both internal names and the
// user-facing Critical / High / Medium labels.
type PublicSeverity = InternalSeverity | 'high' | 'medium' | 'low'

interface NotifyOwnerParams {
  severity?: PublicSeverity
  service: string
  message: string
  meta?: Record<string, unknown>
}

function normalizeSeverity(sev: PublicSeverity | undefined): InternalSeverity {
  switch (sev) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'error'
    case 'medium':
    case 'warning':
      return 'warning'
    case 'low':
    case 'info':
      return 'info'
    case 'error':
    default:
      return 'error'
  }
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const HOURLY_CAP_WINDOW_MS = 60 * 60 * 1000
const HOURLY_CAP_PER_SERVICE = 20

const seen = new Map<string, number>()
// service -> array of email send timestamps within the hourly window
const serviceCap = new Map<string, number[]>()

function shouldSend(key: string): boolean {
  const now = Date.now()
  const last = seen.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return false
  seen.set(key, now)
  if (seen.size > 500) {
    for (const [k, t] of seen) {
      if (now - t > DEDUPE_WINDOW_MS) seen.delete(k)
    }
  }
  return true
}

/** Returns true when the service is under the hourly email cap. */
function underHourlyCap(service: string): boolean {
  const now = Date.now()
  const arr = serviceCap.get(service) ?? []
  const recent = arr.filter((t) => now - t < HOURLY_CAP_WINDOW_MS)
  if (recent.length >= HOURLY_CAP_PER_SERVICE) {
    serviceCap.set(service, recent)
    return false
  }
  recent.push(now)
  serviceCap.set(service, recent)
  return true
}

export async function notifyOwner({
  severity,
  service,
  message,
  meta,
}: NotifyOwnerParams): Promise<void> {
  const internal = normalizeSeverity(severity)

  const key = `${internal}:${service}:${message}`
  const dedupePass = shouldSend(key)
  const capPass = dedupePass && underHourlyCap(service)
  const willEmail = Boolean(process.env.OWNER_ALERT_EMAIL) && capPass

  // Always persist alerts to ops_alert, even when email is skipped/deduped —
  // the admin dashboard and rate-based escalation need every event.
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    await supabaseAdmin.from('ops_alert').insert({
      severity: internal,
      service,
      message,
      meta: {
        ...(meta ?? {}),
        emailSkippedReason: willEmail
          ? undefined
          : !dedupePass
            ? 'deduped_10min'
            : !capPass
              ? 'hourly_cap_reached'
              : !process.env.OWNER_ALERT_EMAIL
                ? 'owner_email_unset'
                : undefined,
      } as never,
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

  if (!willEmail) {
    if (dedupePass && !capPass) {
      console.warn(
        `[ops-alert] hourly cap reached for service=${service}; alert persisted, email suppressed`,
      )
    }
    return
  }

  try {
    await sendTransactionalEmailServer({
      templateName: 'ops-alert',
      recipientEmail: owner,
      idempotencyKey: `ops-${internal}-${service}-${Math.floor(Date.now() / 60000)}`,
      templateData: {
        severity: internal,
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
