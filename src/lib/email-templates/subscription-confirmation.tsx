import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { planName?: string; amount?: string; renewsOn?: string }

const Email = ({ planName = 'RestPilot AI', amount, renewsOn }: Props) => (
  <BrandedLayout preview={`Your ${planName} subscription is active`}>
    <Text style={brandedH1}>You're on {planName}</Text>
    <Text style={brandedText}>
      Thanks for subscribing. Your subscription is active and all premium features are unlocked.
    </Text>
    {amount ? <Text style={brandedText}>Amount: <strong>{amount}</strong></Text> : null}
    {renewsOn ? <Text style={brandedText}>Renews on: <strong>{renewsOn}</strong></Text> : null}
    <CTAButton href="https://restpilotai.com/dashboard">Open Dashboard</CTAButton>
    <Text style={brandedMuted}>You can manage or cancel any time from Settings → Billing.</Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: (d) => `Welcome to ${d.planName || 'RestPilot AI'}`,
  displayName: 'Subscription confirmation',
  previewData: { planName: 'RestPilot Pro', amount: '$9.99', renewsOn: 'Jan 1, 2027' },
} satisfies TemplateEntry
