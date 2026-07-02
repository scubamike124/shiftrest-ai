import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { amount?: string; retryOn?: string }

const Email = ({ amount, retryOn }: Props) => (
  <BrandedLayout preview="Action needed — your RestPilot AI payment didn't go through">
    <Text style={brandedH1}>Payment failed</Text>
    <Text style={brandedText}>
      We couldn't process your latest RestPilot AI payment{amount ? ` of ${amount}` : ''}. Your
      access continues for a short grace period while we retry.
    </Text>
    {retryOn ? <Text style={brandedText}>Next automatic retry: <strong>{retryOn}</strong></Text> : null}
    <CTAButton href="https://restpilotai.com/dashboard">Update Payment Method</CTAButton>
    <Text style={brandedMuted}>
      To avoid losing access, please update your card as soon as possible.
    </Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Action needed: your RestPilot AI payment failed',
  displayName: 'Payment failed',
  previewData: { amount: '$9.99', retryOn: 'in 3 days' },
} satisfies TemplateEntry
