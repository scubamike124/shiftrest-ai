import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, CTAButton, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { downloadUrl?: string; expiresOn?: string }

const Email = ({ downloadUrl, expiresOn }: Props) => (
  <BrandedLayout preview="Your RestPilot AI data export is ready" showUnsubscribe={false}>
    <Text style={brandedH1}>Your data export is ready</Text>
    <Text style={brandedText}>
      We prepared a copy of your RestPilot AI data as requested.
    </Text>
    {downloadUrl ? <CTAButton href={downloadUrl}>Download Export</CTAButton> : null}
    {expiresOn ? (
      <Text style={brandedMuted}>This download link expires on {expiresOn}.</Text>
    ) : null}
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: 'Your RestPilot AI data export is ready',
  displayName: 'Data export ready',
} satisfies TemplateEntry
