import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <BrandedLayout preview="Confirm your new RestPilot AI email address" showUnsubscribe={false}>
    <Text style={brandedH1}>Confirm your new email</Text>
    <Text style={brandedText}>
      You requested to change your RestPilot AI email from <strong>{oldEmail}</strong> to{' '}
      <strong>{newEmail}</strong>.
    </Text>
    <CTAButton href={confirmationUrl}>Confirm Change</CTAButton>
    <Text style={brandedMuted}>
      If you didn't request this change, secure your account immediately.
    </Text>
  </BrandedLayout>
)

export default EmailChangeEmail
