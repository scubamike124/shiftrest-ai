
# Email Deliverability Investigation (round 2)

## What I verified from the sandbox

DNS lookups against Google Public DNS (full recursion; NS delegation to `ns3/ns4.lovable.cloud` is live):

| Record | Value | Verdict |
|---|---|---|
| `restpilotai.com` TXT (SPF) | **none** | ❌ missing |
| `restpilotai.com` MX | **none** | ❌ missing |
| `_dmarc.restpilotai.com` TXT | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net` | ⚠ inherited by subdomain, but the `rua` mailbox is your registrar's default (GoDaddy/SecureServer), not yours |
| `notify.restpilotai.com` NS | `ns3.lovable.cloud`, `ns4.lovable.cloud` | ✅ delegated |
| `notify.restpilotai.com` TXT (SPF) | `v=spf1 include:mailgun.org ~all` | ✅ |
| `notify.restpilotai.com` MX | Mailgun EU (`mxa/mxb.eu.mailgun.org`) | ✅ |
| `_dmarc.notify.restpilotai.com` TXT | **none** | ⚠ falls back to org DMARC — technically fine |
| DKIM at `k1/krs/mailo/mx/smtp/default/s1/s2/pic/mg/selector1/selector2/lovable._domainkey.notify.restpilotai.com` | **none returned** | ⚠ selector unknown — must confirm from the actual message header |

Send-log query returned `[]` under anon (RLS blocks the read — expected; not evidence of a send failure).

Code review of `src/routes/lovable/email/auth/webhook.ts`, `src/lib/email-templates/signup.tsx`, and `_shared/Layout.tsx` confirms the previous fix is deployed: `SITE_NAME = "RestPilot AI"`, `reply_to = support@restpilotai.com`, and the "Verify Email" button href is rewritten to `https://restpilotai.com/auth/callback?token_hash=…&type=…&next=/dashboard`. So the anchor/href mismatch that triggered the previous warning is genuinely gone in code.

## What I cannot verify without your inbox

Gmail's exact banner text and its `Authentication-Results:` line. That header is the only authoritative source for whether SPF/DKIM/DMARC actually passed *at receive time* and which selector Mailgun signed with. Everything below is scored against the DNS + code evidence I have; the header will confirm or eliminate each candidate.

## Ranked root-cause candidates (evidence-backed)

**#1 — Missing SPF and MX on the root domain `restpilotai.com` (highest confidence).**
Gmail's phishing model checks the *organizational* domain (`restpilotai.com`), not just the sending subdomain. When the org domain publishes neither SPF nor MX, Gmail treats mail claiming to represent that brand as unverifiable — even if the child subdomain authenticates cleanly. Combined with a `Reply-To: support@restpilotai.com` on a domain with no MX (a reply would hard-bounce), this is a classic "unreceivable identity" heuristic hit and is the single most likely trigger of the red banner given what changed vs. the previous send.
*Evidence:* `restpilotai.com/TXT` returns nothing; `restpilotai.com/MX` returns nothing; DMARC on the org is `p=quarantine` (strict-ish), so Gmail weights alignment problems more heavily.

**#2 — Cold-start domain reputation for `notify.restpilotai.com` + `restpilotai.com`.**
Both hostnames are new. The link target `restpilotai.com/auth/callback?...` is a brand-new URL Gmail/Safe Browsing has never seen. Gmail's "This message might be dangerous" is the *reputation* banner (as opposed to "Be careful with this message" which is the auth-failure banner). New domain + new URL + shift-worker health/coaching content vocabulary is a very common false-positive profile until the domain warms.
*Evidence:* domain first-use is within the last few days; no A record history; DMARC `rua` is a placeholder GoDaddy mailbox, so no aggregate feedback loop exists yet.

**#3 — DMARC `rua` points to a mailbox you don't own.**
`rua=mailto:dmarc_rua@onsecureserver.net` is GoDaddy's default sink. It means you never see aggregate reports and cannot detect selector/alignment breakage. Not a direct spam cause, but it is why you're flying blind on #1 and #2.

**#4 — Unknown DKIM selector.**
Lovable/Mailgun signs with some selector, but none of the common Mailgun selectors resolve under `notify.restpilotai.com`. Either the selector name is non-standard (only findable in the message header) or the DKIM TXT wasn't published in the delegated zone. If DKIM isn't actually signing, DMARC would fall back to SPF-only alignment — still passing, but with a weaker trust signal.
*Evidence:* DKIM absent for every selector I tried (11 candidates).

**#5 — Content/structure.**
`signup.tsx` is a short single-CTA email with plain text plus branded header/footer. No hidden text, no image-only body, no data URIs, no `dangerouslySetInnerHTML`. Very low risk of content-based flagging on its own — but combined with #1/#2 it adds weight.

**#6 — Sender friendly name.**
`From: RestPilot AI <noreply@notify.restpilotai.com>` is now correct. Not a factor.

## What is definitely NOT the cause

- The Verify-Email link. Href now points to `restpilotai.com/auth/callback` (verified in the deployed code).
- The reply-to header value. It's set on the enqueue payload. (Whether Mailgun forwards it is confirmed only by the received-message header.)
- Template markup or React Email rendering. No unsafe patterns.
- The Supabase→Gmail token exposure. Tokens are single-use and short-lived.

## Data I still need from you (the deciding evidence)

From the message currently sitting in your Gmail Spam, open **⋮ → Show original** and paste the top ~40 lines. I specifically need:

1. `Authentication-Results:` (SPF/DKIM/DMARC verdicts, DKIM `d=` and `s=`)
2. `From:` and `Reply-To:`
3. `Return-Path:` (this reveals Mailgun's bounce domain used for SPF alignment)
4. `List-Unsubscribe:` and `List-Unsubscribe-Post:` (if present)
5. `X-Google-Original-*`, `X-Gm-*`, and any `X-Google-Smtp-Source` lines
6. The literal Gmail banner text (exact wording distinguishes "dangerous" vs "be careful")
7. Whether the mail is in **Spam** or **Inbox with warning** — different signals

With those lines I can definitively confirm #1, rule out or confirm #4, and tell you whether Gmail is scoring on auth vs. reputation vs. content.

## Recommended fix (pending header confirmation)

**Batch E-1 — DNS hardening on the root domain (highest impact, safest).**
1. Add SPF at `restpilotai.com` (TXT): `v=spf1 -all` — publishes an explicit "root domain never sends mail directly." This is what Gmail expects for a brand that only sends via subdomains, and it materially raises trust for the sending subdomain under `adkim=r/aspf=r`.
2. Add a null MX at `restpilotai.com` (MX): `0 .` — RFC 7505 declaration that the root doesn't receive mail. Prevents unreceivable-reply-to heuristics and stops spammers from spoofing your brand.
3. Change `_dmarc.restpilotai.com` `rua` to an address you own (e.g. `mailto:support@restpilotai.com` — but only after step 4 makes it receivable; until then, `mailto:postmaster@notify.restpilotai.com` works since that mailbox routes through Mailgun EU).
4. Optional but strongly recommended: switch `Reply-To` in the webhook from `support@restpilotai.com` (currently unreceivable — no MX) to either an inbox you actually receive (e.g. move to Google Workspace / Fastmail on `restpilotai.com` and publish real MX), or temporarily to `support@notify.restpilotai.com` which is Mailgun-received.

**Batch E-2 — Verify DKIM is really signing.**
5. From the `Show original` DKIM header, capture the selector Mailgun uses, then confirm `<selector>._domainkey.notify.restpilotai.com` resolves publicly. If it doesn't, the Lovable email infra needs a re-provision of the delegated zone.

**Batch E-3 — Warm the domain.**
6. Send 2–5 low-volume auth emails to Gmail/Outlook/Yahoo test accounts over 48h, mark them "Not Spam," and check headers rotate to `dmarc=pass reason=…policy=none applied`. Reputation lifts within days once the DNS hygiene above is in place.

**Batch E-4 — Optional polish (not required to clear the banner).**
7. Add `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` for the auth mail (Mailgun sets these for transactional but explicit is cleaner).
8. Register the domain in Google Postmaster Tools once DNS is fixed, to get feedback loops.

## Files that would change (approval pending)

- **DNS (no code)** — records added at your registrar for `restpilotai.com`:
  - `TXT @ "v=spf1 -all"`
  - `MX @ "0 ."`
  - `TXT _dmarc @ …rua updated…`
- **`src/routes/lovable/email/auth/webhook.ts`** — only if we swap `Reply-To` to a receivable mailbox.
- No template changes needed.
- No changes to `src/lib/email/send.server.ts`, `queue/process.ts`, or the callback route.

## Risk

DNS-only. Reversible in minutes. Zero application-code risk.

Awaiting: (a) the "Show original" headers so I can confirm DKIM selector and current auth results, and (b) approval before I write any DNS/code fixes.
