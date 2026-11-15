# Lockfile on main: bun.lock only

_Nov 15 2026_

## Decision

`main` uses **bun** and **`bun.lock`**. The stale `package-lock.json` has been removed.

## Why

- **Lovable builds and maintains main with bun.** Every dependency change Lovable made to `main` (Jul 3 → Aug 16 2026, by `gpt-engineer-app[bot]`) updated `bun.lock` and `package.json` together. `bunfig.toml` holds Lovable's supply-chain setting (`minimumReleaseAge`).
- **`package-lock.json` was dead.** It was last changed on Jun 1 2026 and Lovable never updated it after that. It described a different dependency tree from the one Lovable builds (for example `@tanstack/react-start` 1.169.5 and `vite` 7.3.8 in the npm file, against 1.167.50 and 7.3.2 in `bun.lock`). As a result, `npm ci` failed on main with `ERESOLVE` and invalid lock entries.
- **Keeping both files in step is not reliable.** I tried generating an npm lockfile from bun's installed tree. It did not reproduce bun's resolution: 31 versions differed (the rollup native binaries), the nesting was different, and 1,306 of 1,359 entries had no integrity hash. Even with a perfect copy, the next dependency change Lovable makes would update `bun.lock` and leave `package-lock.json` behind again. One lockfile that Lovable keeps current is the reliable choice.
- **No resolved version changed.** `bun.lock` is untouched, so Lovable's next build installs exactly what it installs today.

## Standard commands (fresh clone)

```sh
bun install --frozen-lockfile   # fails if package.json and bun.lock disagree
bun run typecheck               # tsc --noEmit
bun run test                    # node --test tests/*.test.mjs (Node 22.13+)
bun run build                   # vite build (Cloudflare worker output in .output/)
```

Do not run `npm install` on main. It would resolve a fresh, different tree and create a new `package-lock.json`. If you use npm by mistake, delete that file and don't commit it.

## CI

`.github/workflows/main-checks.yml` runs the four commands above on every push and PR to `main`. It is read-only (`contents: read`). It never deploys, pushes or comments, and main has no branch protection, so it cannot block Lovable's pushes or Publish.

## Railway branch

`codex/restpilot-railway-migration` uses npm and its own `package-lock.json` (its workflows run `npm ci`). That branch is not `main`. If it is ever merged into main, choose one manager at that point and remove the other lockfile.
