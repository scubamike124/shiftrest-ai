import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <BrandedLayout preview="Reset your RestPilot AI password" showUnsubscribe={false}>
    <Text style={brandedH1}>Reset your password</Text>
    <Text style={brandedText}>
      We received a request to reset your RestPilot AI password. Tap the button below to choose a
      new one.
    </Text>
    <CTAButton href={confirmationUrl}>Reset Password</CTAButton>
    <Text style={brandedMuted}>
      If you didn't request this, ignore this email — your password stays the same.
    </Text>
  </BrandedLayout>
)

export default RecoveryEmail
