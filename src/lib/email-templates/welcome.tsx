import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { name?: string }

const Email = ({ name }: Props) => (
  <BrandedLayout preview="Welcome to RestPilot AI — let's get you resting smarter">
    <Text style={brandedH1}>{name ? `Welcome, ${name}` : 'Welcome to RestPilot AI'}</Text>
    <Text style={brandedText}>
      Your account is active. Open your dashboard to get your first personalized brief — the app
      learns your sleep, shift, and recovery patterns and gets sharper with every day.
    </Text>
    <CTAButton href="https://restpilotai.com/dashboard">Open Dashboard</CTAButton>
    <Text style={brandedMuted}>Tip: install RestPilot AI on your Home Screen for one-tap access.</Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Welcome to RestPilot AI',
  displayName: 'Welcome',
  previewData: { name: 'Alex' },
} satisfies TemplateEntry
