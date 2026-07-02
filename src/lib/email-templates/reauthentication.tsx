import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandedLayout, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <BrandedLayout preview="Your RestPilot AI verification code" showUnsubscribe={false}>
    <Text style={brandedH1}>Verification code</Text>
    <Text style={brandedText}>Enter this code in RestPilot AI to confirm your identity:</Text>
    <Text
      style={{
        fontFamily: 'Menlo, monospace',
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: '0.35em',
        color: '#0f172a',
        margin: '20px 0',
      }}
    >
      {token}
    </Text>
    <Text style={brandedMuted}>
      This code expires shortly. If you didn't request this, ignore this email.
    </Text>
  </BrandedLayout>
)

export default ReauthenticationEmail
