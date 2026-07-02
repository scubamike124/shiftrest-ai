import type { ComponentType } from 'react'

import { template as welcome } from './welcome'
import { template as subscriptionConfirmation } from './subscription-confirmation'
import { template as paymentReceipt } from './payment-receipt'
import { template as paymentFailed } from './payment-failed'
import { template as subscriptionCanceled } from './subscription-canceled'
import { template as subscriptionExpired } from './subscription-expired'
import { template as accountDeletion } from './account-deletion'
import { template as dataExportReady } from './data-export-ready'
import { template as contactReceived } from './contact-received'
import { template as opsAlert } from './ops-alert'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  welcome,
  'subscription-confirmation': subscriptionConfirmation,
  'payment-receipt': paymentReceipt,
  'payment-failed': paymentFailed,
  'subscription-canceled': subscriptionCanceled,
  'subscription-expired': subscriptionExpired,
  'account-deletion': accountDeletion,
  'data-export-ready': dataExportReady,
  'contact-received': contactReceived,
  'ops-alert': opsAlert,
}
