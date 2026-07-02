import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

const Email = () => (
  <BrandedLayout preview="Your RestPilot AI account has been deleted" showUnsubscribe={false}>
    <Text style={brandedH1}>Account deleted</Text>
    <Text style={brandedText}>
      Your RestPilot AI account and all associated data have been permanently deleted. This action
      cannot be undone.
    </Text>
    <Text style={brandedMuted}>
      If you didn't request this deletion, contact support@restpilotai.com immediately.
    </Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Your RestPilot AI account has been deleted',
  displayName: 'Account deletion confirmation',
} satisfies TemplateEntry
