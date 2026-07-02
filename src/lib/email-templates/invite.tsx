import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <BrandedLayout preview="You've been invited to RestPilot AI" showUnsubscribe={false}>
    <Text style={brandedH1}>You're invited</Text>
    <Text style={brandedText}>
      You've been invited to join RestPilot AI. Accept the invitation to create your account.
    </Text>
    <CTAButton href={confirmationUrl}>Accept Invitation</CTAButton>
    <Text style={brandedMuted}>
      If you weren't expecting this, you can safely ignore this email.
    </Text>
  </BrandedLayout>
)

export default InviteEmail
