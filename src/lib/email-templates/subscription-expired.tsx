import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText } from './_shared/Layout'

const Email = () => (
  <BrandedLayout preview="Your RestPilot AI premium access has ended">
    <Text style={brandedH1}>Your premium access ended</Text>
    <Text style={brandedText}>
      Your subscription period has ended and premium features are no longer available. Your
      account and data are preserved — resubscribe any time to unlock everything again.
    </Text>
    <CTAButton href="https://restpilotai.com/pricing">Resubscribe</CTAButton>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Your RestPilot AI premium access has ended',
  displayName: 'Subscription expired',
} satisfies TemplateEntry
