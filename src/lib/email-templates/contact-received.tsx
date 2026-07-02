import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { BrandedLayout, brandedH1, brandedText, brandedMuted } from './_shared/Layout'

interface Props { name?: string; message?: string }

const Email = ({ name, message }: Props) => (
  <BrandedLayout preview="We got your message — we'll be in touch">
    <Text style={brandedH1}>{name ? `Thanks, ${name}` : 'Thanks for reaching out'}</Text>
    <Text style={brandedText}>
      We received your message and will get back to you shortly (usually within one business day).
    </Text>
    {message ? (
      <Text
        style={{
          background: '#f8fafc',
          borderLeft: '3px solid #6366f1',
          padding: '12px 14px',
          borderRadius: 8,
          fontSize: 14,
          color: '#334155',
          margin: '16px 0',
          whiteSpace: 'pre-wrap' as const,
        }}
      >
        {message}
      </Text>
    ) : null}
    <Text style={brandedMuted}>Reply to this email to add anything you forgot.</Text>
  </BrandedLayout>
)

export const template = {
  component: Email,
  subject: "We got your message — RestPilot AI",
  displayName: 'Contact form confirmation',
} satisfies TemplateEntry
