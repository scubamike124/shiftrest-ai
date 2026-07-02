import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText } from './_shared/Layout'

interface Props {
  daysRemaining?: number
  trialEndDate?: string
}

const Email = ({ daysRemaining, trialEndDate }: Props) => {
  const daysText =
    typeof daysRemaining === 'number'
      ? daysRemaining <= 0
        ? 'today'
        : daysRemaining === 1
          ? 'tomorrow'
          : `in ${daysRemaining} days`
      : 'soon'

  return (
    <BrandedLayout preview={`Your RestPilot AI trial ends ${daysText}`}>
      <Text style={brandedH1}>Your trial ends {daysText}</Text>
      <Text style={brandedText}>
        Heads up — your free trial of RestPilot AI Premium ends
        {trialEndDate ? ` on ${trialEndDate}` : ` ${daysText}`}. To keep your AI coach,
        Smart Wake window, and full Recovery Playbooks, add or confirm your payment method
        before then.
      </Text>
      <Text style={brandedText}>
        Nothing to do if you're happy on Free — you'll automatically drop to the free tier
        with your data intact.
      </Text>
      <CTAButton href="https://restpilotai.com/pricing">Manage subscription</CTAButton>
    </BrandedLayout>
  )
}

export const template = {
  component: Email,
  subject: 'Your RestPilot AI trial is ending soon',
  displayName: 'Trial ending soon',
  previewData: { daysRemaining: 2, trialEndDate: 'Jul 5, 2026' },
} satisfies TemplateEntry
