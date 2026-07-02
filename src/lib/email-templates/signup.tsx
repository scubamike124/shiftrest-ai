import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ recipient, confirmationUrl }: SignupEmailProps) => (
  <BrandedLayout preview="Confirm your email to activate RestPilot AI" showUnsubscribe={false}>
    <Text style={brandedH1}>Verify your email</Text>
    <Text style={brandedText}>
      Welcome to RestPilot AI. Confirm <strong>{recipient}</strong> to activate your account and
      start getting personalized rest, wake, and shift intelligence.
    </Text>
    <CTAButton href={confirmationUrl}>Verify Email</CTAButton>
    <Text style={brandedMuted}>
      This link expires in 24 hours. If you didn't create an account, you can ignore this email.
    </Text>
  </BrandedLayout>
)

export default SignupEmail
