import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <BrandedLayout preview="Your RestPilot AI sign-in link" showUnsubscribe={false}>
    <Text style={brandedH1}>Sign in to RestPilot AI</Text>
    <Text style={brandedText}>Tap below to sign in. This link expires shortly.</Text>
    <CTAButton href={confirmationUrl}>Sign In</CTAButton>
    <Text style={brandedMuted}>
      If you didn't request this link, ignore this email.
    </Text>
  </BrandedLayout>
)

export default MagicLinkEmail
