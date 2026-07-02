import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { amount?: string; date?: string; invoiceUrl?: string; planName?: string }

const Email = ({ amount, date, invoiceUrl, planName }: Props) => (
  <BrandedLayout preview={`Receipt for your ${planName || 'RestPilot AI'} payment`}>
    <Text style={brandedH1}>Payment received</Text>
    <Text style={brandedText}>Thanks — your payment was processed successfully.</Text>
    {amount ? <Text style={brandedText}>Amount: <strong>{amount}</strong></Text> : null}
    {date ? <Text style={brandedText}>Date: <strong>{date}</strong></Text> : null}
    {planName ? <Text style={brandedText}>Plan: <strong>{planName}</strong></Text> : null}
    {invoiceUrl ? (
      <Text style={brandedText}>
        Invoice: <a href={invoiceUrl} style={{ color: '#6366f1' }}>View / download PDF</a>
      </Text>
    ) : null}
    <Text style={brandedMuted}>Reply to this email if anything looks off.</Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Your RestPilot AI receipt',
  displayName: 'Payment receipt',
  previewData: { amount: '$9.99', date: 'Jan 1, 2026', planName: 'RestPilot Pro' },
} satisfies TemplateEntry
