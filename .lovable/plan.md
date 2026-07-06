# Publish-reliability: what's actually going wrong, and how I'll change my behavior

## 1. Why "published" hasn't matched what's actually live

Based on this conversation's evidence (sunrise/sunset fix, Conversation-style debug panel, TTS path diagnostic — each absent from the production bundle after being reported as shipped), the failure is not a single bug. It's a combination of the following, in likely order of impact:

**a. I claimed "live" from the tool acknowledgement, not from the bundle.**
`preview_ui--publish` returns as soon as a deploy is *scheduled*. It does not wait for the build to finish, does not report build success/failure, and does not confirm the new bundle is being served. I was treating the tool's success response as proof of deployment. That's the single biggest cause of the pattern you noticed.

**b. Publish covers frontend only, and requires the dialog "Update" click for the live site.**
Per Lovable's model, edits in the editor go to the preview immediately, but the public `restpilotai.com` domain updates only when a publish is actually committed and the build succeeds. If a publish is scheduled but the build fails, or if a prior publish is still in-flight, the live bundle stays on the previous version — with no error surfaced back to me unless I go look.

**c. Custom domain + CDN caching.**
`restpilotai.com` is a custom domain fronted by a CDN. Even after a successful deploy, HTML and hashed JS bundles can be served from cache for a short window. A fetch a few seconds after publish can still return the old `index-*.js`. Without checking the bundle hash and its contents, "it's live" is a guess.

**d. Multiple rapid publishes racing.**
When I published several times in a row during the TTS diagnostic work, later builds can supersede earlier ones, and a failed intermediate build can leave the previously-successful bundle in place — again, silently from my side.

**e. Preview vs production confusion.**
The preview URL (`id-preview--….lovable.app`) and the published production URL (`restpilotai.com`) are different deployments. Verifying on preview does not verify production. I did not always distinguish these when telling you something was "live."

None of these are individually a "bug in the publish pipeline." The real defect is in my workflow: I was reporting deploy status from a signal (tool response) that never actually carried that information.

## 2. The rule I'll follow going forward

I will not tell you something is "live" or "published" unless I have directly verified it against the production bundle. Concretely, after every publish that matters:

1. Fetch `https://restpilotai.com/` HTML.
2. Extract the referenced `assets/index-*.js` (and CSS if relevant) filenames — note the hash.
3. Download those assets and grep for a unique marker from the change (a build tag string, a distinctive class name, a literal like `tts-path-diagnostic-2026-07-06-01`, etc.).
4. Only if the marker is present in the served bundle, report it as live.
5. If the marker is missing, report exactly that — "publish was scheduled but the production bundle does not yet contain <marker>" — and either wait/retry or investigate the build, rather than asking you to test.

Language I will use:
- Before verification: *"I've triggered a publish but haven't confirmed it's live yet."*
- After verification passes: *"Verified live on restpilotai.com — bundle `index-<hash>.js` contains `<marker>`."*
- After verification fails: *"Publish did not take — production bundle still does not contain `<marker>`. Not asking you to test."*

For any change that has no natural marker in the output, I'll add a small, unique string (build tag, comment-turned-string, data attribute) specifically so the served bundle can be grepped. No marker, no "live" claim.

## 3. What I'd like to do next (only with your go-ahead)

- Apply the rule above immediately, retroactively, to any pending change.
- Before resuming the Voice briefing latency work, do one clean cycle end-to-end on a trivial marker change (add a build tag, publish, verify by fetching the bundle, report back) so you can see the new workflow work once on something low-stakes.
- Then, and only then, return to the TTS path diagnostic and the underlying t4→t5 latency question.

I'm not touching the Voice briefing code until you confirm you're satisfied with this change in how I report deploy status.
