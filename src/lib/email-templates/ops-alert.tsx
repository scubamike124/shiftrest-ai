import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, brandedH1, brandedText } from './_shared/Layout'

interface Props {
  severity?: 'critical' | 'error' | 'warning'
  service?: string
  message?: string
  meta?: Record<string, unknown>
  at?: string
}

const colors: Record<string, string> = {
  critical: '#dc2626',
  error: '#ea580c',
  warning: '#ca8a04',
}

const Email = ({ severity = 'error', service = 'unknown', message = '', meta, at }: Props) => (
  <BrandedLayout preview={`[${severity.toUpperCase()}] ${service}`} showUnsubscribe={false}>
    <Text style={{ ...brandedH1, color: colors[severity] || '#dc2626' }}>
      [{severity.toUpperCase()}] {service}
    </Text>
    <Text style={brandedText}>{message}</Text>
    {at ? <Text style={brandedText}>At: <strong>{at}</strong></Text> : null}
    {meta ? (
      <Text
        style={{
          fontFamily: 'Menlo, monospace',
          fontSize: 12,
          background: '#0f172a',
          color: '#e2e8f0',
          padding: '12px 14px',
          borderRadius: 8,
          whiteSpace: 'pre-wrap' as const,
          margin: '12px 0',
        }}
      >
        {JSON.stringify(meta, null, 2)}
      </Text>
    ) : null}
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: (d) =>
    `[RestPilot AI ${(d.severity || 'error').toString().toUpperCase()}] ${d.service || 'alert'}`,
  displayName: 'Operations alert',
  to: process.env.OWNER_ALERT_EMAIL,
} satisfies TemplateEntry
