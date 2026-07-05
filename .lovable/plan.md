# Add verbose flag to `lk agent create`

## Change

Single-line edit in `.github/workflows/deploy-agent-worker.yml` (line 101), inside the "Create or deploy agent" step.

**Before:**
```yaml
lk agent create .
```

**After:**
```yaml
lk agent create . --verbose
```

## Scope

- No other lines touched.
- No changes to preflight checks, env vars, manifest, or subsequent steps.

## After merge

Rerun the GitHub Action and capture the full "Create agent" step logs so we can see why `lk agent create` reports `project does not match agent subdomain []`.
