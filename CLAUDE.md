# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A composite GitHub Action that provides a drop-in replacement for `actions/cache`, transparently routing
caching to SonarSource's S3 buckets via OIDC + AWS Cognito, with optional fallback to the standard GitHub
Actions cache. User-facing usage and input semantics live in `README.md` and `action.yml` — don't duplicate
them here.

## Common commands

```bash
npm install
npm test                                   # one-shot Vitest run
npm run test:watch                         # Vitest in watch mode
npx vitest run __tests__/<file>.test.ts    # single test file
npx vitest run -t "<test name>"            # single test by name

npm run build                              # build all three ncc bundles
npm run build:setup                        # credential-setup only
npm run build:guard-main                   # credential-guard main only
npm run build:guard-post                   # credential-guard post only

pre-commit run --all-files                 # markdownlint + actionlint + standard hooks
```

## CRITICAL: ncc bundles are committed

`credential-setup/dist/index.js` and `credential-guard/dist/{main,post}/index.js` are `@vercel/ncc`
bundles consumed directly by GitHub Actions at runtime. **They MUST be rebuilt and committed whenever
anything under `src/` changes.** `.gitignore` already filters out the unwanted `.d.ts` map files inside
`dist/`, but the bundle `index.js` itself is tracked. Skipping the rebuild ships stale code to users.

## Architecture

Four pieces cooperate; understanding their interplay requires reading more than one file:

- **Top-level composite action** (`action.yml`): chooses backend (`github` vs `s3`); on the S3 path it
  chains `credential-setup` → `scripts/prepare-keys.sh` → import-mode decision → `runs-on/cache` →
  optional `actions/cache/restore` GitHub-cache fallback → `credential-guard` post step.

- **`credential-setup`** (`src/credential-setup.ts` → `credential-setup/dist/index.js`,
  manifest in `credential-setup/action.yml`): exchanges the GitHub OIDC token for AWS Cognito credentials
  via `src/auth.ts`, writes them to a `0o600` file under `os.tmpdir()`, and exposes them as **step
  outputs** (not `GITHUB_ENV`). This is intentional — the cache step uses step-level `env:` sourced from
  these outputs so user-set `AWS_*` in `GITHUB_ENV` cannot override them.

- **`credential-guard`** (`src/credential-guard-main.ts` + `src/credential-guard-post.ts`,
  manifest in `credential-guard/action.yml`): the main step only stores the credentials-file path via
  `core.saveState`. The **post** step re-reads the file, exports creds to `GITHUB_ENV` and writes
  `~/.aws/credentials`/`config`, so the LIFO-ordered `runs-on/cache` post step can save back to S3.
  See `action.yml:218-222` for the LIFO ordering rationale.

- **`cleanup`** (`cleanup/action.yml` + `scripts/cleanup-cache.sh`): standalone Bash list/delete tool
  for the same S3 bucket; also authenticates through `credential-setup`. Run from the default branch
  (IAM policy requires this).

## Why the credential gymnastics

The design defends against real production failures — each has a regression-test job in
`.github/workflows/test-action.yml`. When changing anything in the credential flow, add or update
the matching job:

| Failure mode                                                     | Regression job                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| User overwrites `AWS_*` in `GITHUB_ENV` mid-job                  | `test-s3-cache-with-credential-interference`                                                      |
| Windows `~/.aws/config` parse error                              | `test-s3-cache-windows`                                                                           |
| Linux S3 save → Windows S3 restore (`enableCrossOsArchive`)      | `test-s3-cache-cross-os-save-linux` + `test-s3-cache-cross-os-restore-windows`                    |
| Two cache steps in one job corrupting `~/.aws/config`            | `test-s3-cache-multiple-invocations`                                                              |
| Pre-existing `~/.aws/*` from `configure-aws-credentials`         | `test-s3-cache-with-preset-aws-config`                                                            |
| `git clean -ffdx` from `actions/checkout` wiping workspace       | `test-s3-cache-survives-git-clean`                                                                |

## Backend & cache-key logic — the non-obvious bits

- **Backend resolution** (`action.yml:56-93`): `inputs.backend` → `CACHE_BACKEND` env → default `s3`.
  Public repos are flagged `was-github-default=true` so the GitHub-cache import fallback is enabled
  for them automatically.
- **Branch-scoped keys** (`scripts/prepare-keys.sh`): primary key is `${BRANCH}/${key}`. Fallback
  branch is honored only when it matches `main`, `master`, or `branch-*` — anything else triggers a
  warning and no fallback. PR events use `GITHUB_HEAD_REF`, pushes use `GITHUB_REF`.
- **GitHub-cache import fallback resolution** (`action.yml:135-162`): five-step priority chain ending
  in "private/internal repo → false". When active, it suppresses `fail-on-cache-miss` on the S3 step
  and enforces it later, after also trying the GitHub-cache restore.

## Pinned environment

- Node 24 runtime in all four sub-actions (`runs.using: node24`).
- `python 3.13.5` and `go 1.21.13` in `.tool-versions` — used by the test workflows via `mise`.
- AWS region hard-coded to `eu-central-1`; S3 bucket pattern `sonarsource-s3-cache-{env}-bucket`.
- Cognito pool & account IDs for `prod`/`dev` are hard-coded in `src/credential-setup.ts:7-15`.

## Style specifics

- TypeScript strict mode (`tsconfig.json`); target ES2022, CommonJS module.
- YAML and Bash use 2-space indent (matches user-global rules).
- Markdown line limit 140 (`.markdownlint.yaml`).
- `actionlint` runs in pre-commit; runner labels are declared in `.github/actionlint.yaml`
  (`sonar-xs`, `github-ubuntu-latest-s`, `github-windows-latest-s`).
- Tests use Vitest with `vi.mock` for `@actions/core` and the AWS SDK — see `__tests__/auth.test.ts`
  for the pattern. The `VITEST` env var gates the auto-run guard at the bottom of each entry point.
