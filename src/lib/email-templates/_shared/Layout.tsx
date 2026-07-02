import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

const BRAND = {
  name: 'RestPilot AI',
  accent: '#6366f1', // aurora indigo
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  bg: '#ffffff',
  root: 'https://restpilotai.com',
  support: 'support@restpilotai.com',
}

export function BrandedLayout({
  preview,
  children,
  showUnsubscribe = true,
  unsubscribeUrl,
}: {
  preview: string
  children: React.ReactNode
  showUnsubscribe?: boolean
  unsubscribeUrl?: string
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brand}>{BRAND.name}</Text>
            <Text style={tagline}>Rest smarter. Wake sharper.</Text>
          </Section>
          <Section style={content}>{children}</Section>
          <Hr style={divider} />
          <Section style={footer}>
            <Text style={footerText}>
              Need help?{' '}
              <Link href={`mailto:${BRAND.support}`} style={footerLink}>
                {BRAND.support}
              </Link>
            </Text>
            <Text style={footerText}>
              <Link href={`${BRAND.root}/legal/terms`} style={footerLink}>Terms</Link>
              {'  ·  '}
              <Link href={`${BRAND.root}/legal/privacy`} style={footerLink}>Privacy</Link>
              {showUnsubscribe && unsubscribeUrl ? (
                <>
                  {'  ·  '}
                  <Link href={unsubscribeUrl} style={footerLink}>Unsubscribe</Link>
                </>
              ) : null}
            </Text>
            <Text style={footerFine}>
              © {new Date().getFullYear()} {BRAND.name}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export function CTAButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ margin: '24px 0' }}
    >
      <tbody>
        <tr>
          <td style={{ borderRadius: 12, backgroundColor: BRAND.accent }}>
            <Link href={href} style={ctaLink}>
              {children}
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export const brandStyles = BRAND

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  margin: 0,
  padding: 0,
}
const container = { maxWidth: 600, margin: '0 auto', padding: '0 20px' }
const header = { padding: '28px 4px 8px' }
const brand = {
  fontSize: 22,
  fontWeight: 700 as const,
  color: BRAND.ink,
  margin: 0,
  letterSpacing: '-0.02em',
}
const tagline = { fontSize: 13, color: BRAND.muted, margin: '4px 0 0' }
const content = { padding: '8px 4px' }
const divider = { borderColor: BRAND.border, margin: '32px 0 16px' }
const footer = { padding: '0 4px 32px' }
const footerText = { fontSize: 13, color: BRAND.muted, margin: '0 0 6px', lineHeight: 1.5 }
const footerLink = { color: BRAND.muted, textDecoration: 'underline' }
const footerFine = { fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }
const ctaLink = {
  display: 'inline-block',
  padding: '14px 28px',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 600 as const,
  textDecoration: 'none',
}

export const brandedText = { fontSize: 15, color: BRAND.ink, lineHeight: 1.6, margin: '0 0 14px' }
export const brandedH1 = {
  fontSize: 24,
  fontWeight: 700 as const,
  color: BRAND.ink,
  margin: '0 0 12px',
  letterSpacing: '-0.01em',
}
export const brandedMuted = { fontSize: 13, color: BRAND.muted, margin: '18px 0 0', lineHeight: 1.5 }
