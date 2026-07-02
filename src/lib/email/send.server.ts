// Server-side transactional email sender.
// Enqueues an email via the internal /lovable/email/transactional/send route
// using the service-role bearer so unauthenticated internal triggers
// (Stripe webhooks, ops alerts, cron) can send app emails.

import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'RestPilot AI'
const SENDER_DOMAIN = 'notify.restpilotai.com'
const FROM_DOMAIN = 'notify.restpilotai.com'

export interface SendServerParams {
  templateName: keyof typeof TEMPLATES | string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, unknown>
}

/**
 * Enqueue a transactional email from server code (webhooks / cron / server fns).
 * Renders the React Email template and pushes it onto the pgmq queue directly
 * via the service-role Supabase client — bypasses the /send route's JWT check.
 */
export async function sendTransactionalEmailServer({
  templateName,
  recipientEmail,
  idempotencyKey,
  templateData = {},
}: SendServerParams): Promise<
  { success: true; messageId: string } | { success: false; reason: string }
> {
  const template = TEMPLATES[templateName as string]
  if (!template) return { success: false, reason: `unknown_template:${templateName}` }

  const effectiveRecipient = template.to || recipientEmail
  if (!effectiveRecipient) return { success: false, reason: 'no_recipient' }

  const [{ createClient }, React, { render }, { supabaseAdmin }] = await Promise.all([
    import('@supabase/supabase-js'),
    import('react'),
    import('react-email'),
    import('@/integrations/supabase/client.server'),
  ])
  void createClient

  const messageId = crypto.randomUUID()
  const normalized = effectiveRecipient.toLowerCase()

  // Suppression check
  const { data: suppressed } = await supabaseAdmin
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()

  if (suppressed) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName as string,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    return { success: false, reason: 'email_suppressed' }
  }

  // Unsubscribe token (reuse or create)
  let unsubscribeToken: string | undefined
  const { data: existingToken } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalized)
    .maybeSingle()

  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const newToken = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .upsert({ token: newToken, email: normalized }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: stored } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalized)
      .maybeSingle()
    unsubscribeToken = stored?.token || newToken
  }

  // Render
  const element = React.createElement(template.component as any, templateData as any)
  const html = await render(element)
  const text = await render(element, { plainText: true })

  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData as Record<string, unknown>)
      : template.subject

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName as string,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })

  const { error } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <no-reply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey || messageId,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (error) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName as string,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'enqueue_failed',
    })
    return { success: false, reason: 'enqueue_failed' }
  }

  return { success: true, messageId }
}
