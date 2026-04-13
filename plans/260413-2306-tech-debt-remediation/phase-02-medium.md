# Phase 2 — Medium Debt

**Status:** completed (pending commit) | **Effort:** 3–5 days | **Depends on:** Phase 1 green

## Items covered: 4, 6, 7, 8

## Steps

1. **Docs consolidation (item 8)**
   - Create `./docs/`
   - `AUTH_KEY_DUPLICATED_FIX.md` + `SHARP_FIX_README.md` → `docs/troubleshooting.md`
   - `CHANGELOG_AUTH_FIX.md` → `docs/project-changelog.md`
   - `STANDALONE.md` → `docs/standalone.md`
   - Keep `README.md`, `CLAUDE.md`, `AGENTS.md` at root; update README link to STANDALONE.md → `docs/standalone.md`
2. **Drop dist-cjs (item 4)**
   - Grep `dist-cjs` across repo and package.json scripts
   - Confirm `pkg` / `esbuild` emits CJS internally
   - Delete `tsconfig.cjs.json`; remove `build:cjs` script; drop `dist-cjs` from gitignore (still ignored via `dist-*`)
3. **Patch/minor dep upgrades (item 7)**
   - `sharp ^0.33 → ^0.34`, `vitest ^4.0 → ^4.1`, `@types/node`, `dotenv`, `commander`, `cli-progress`, `winston`, `telegram` — stay patch/minor
   - Skip: `eslint@9` (flat config), `typescript@6`
4. **CI workflow (item 6)**
   - `.github/workflows/ci.yml`: Bun setup, lint, typecheck, test, build:ts on push/PR
   - Ubuntu-latest matrix only initially

## Todo

- [x] Consolidate root `.md` files into `./docs/`
- [x] Update README cross-links
- [x] Drop dist-cjs build
- [x] Upgrade minor deps; run build+test
- [x] Add CI workflow

## Success Criteria

- Single source of truth docs under `./docs/`
- Build emits only `dist/` (+ pkg binaries)
- CI green on PR
