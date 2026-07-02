import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { endsOn?: string }

const Email = ({ endsOn }: Props) => (
  <BrandedLayout preview="Your RestPilot AI subscription is canceled">
    <Text style={brandedH1}>Subscription canceled</Text>
    <Text style={brandedText}>
      Your subscription has been canceled. You'll keep access to premium features until{' '}
      <strong>{endsOn || 'the end of your current billing period'}</strong>.
    </Text>
    <Text style={brandedMuted}>Changed your mind? Resubscribe any time from Settings → Billing.</Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Your RestPilot AI subscription is canceled',
  displayName: 'Subscription canceled',
  previewData: { endsOn: 'Feb 1, 2026' },
} satisfies TemplateEntry
