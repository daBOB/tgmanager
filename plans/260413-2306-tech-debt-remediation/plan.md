# Tech Debt Remediation

**Source:** [tech-debt-260413-2241-codebase-audit.md](../reports/tech-debt-260413-2241-codebase-audit.md) | **Started:** 2026-04-13 23:06 | **Mode:** auto

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | [Quick wins](phase-01-quick-wins.md) | **completed** | ~1 day |
| 2 | [Medium debt](phase-02-medium.md) | **completed** | 3–5 days |
| 3 | [Long-term (deferred post-release)](phase-03-deferred.md) | deferred | 5–8 days |

## Phase 1 Scope (executing now)

- Delete legacy root `.js` files (items 1, 10)
- Consolidate to Bun lockfile; delete npm+pnpm locks (item 3)
- Untrack `sessions/`, `locks/`, `dist-pkg/`; confirm gitignored (items 9, 11)
- Widen vitest coverage to `src/**` (item 12)
- Dockerfile → `node:22` LTS (item 13)

## Phase 2 Scope (executing after Phase 1 green)

- Consolidate root `.md` sprawl into `./docs/` (item 8)
- Drop `dist-cjs/` build (item 4)
- Patch/minor dep upgrades (item 7)
- Add CI workflow (item 6)

## Phase 3 (out of scope — deferred)

- Modularize 5 files >200 LOC (item 5)
- Expand test coverage to 70% (item 2)

## Validation Decisions (from audit report)

- **PM:** Bun — keep `bun.lockb`
- **sessions/ leak:** private only — no rotation needed
- **Deps:** patch/minor only — defer ESLint 9, TS 6
- **dist-cjs:** drop; pkg emits CJS via esbuild

## Success Criteria

- `bun install` clean; `bun run build:ts` green; `bun test` green
- No tracked artifacts under `sessions/`, `locks/`, `dist-pkg/`
- Root tree: no legacy `.js`; single lockfile
- CI runs on PR; all docs under `./docs/` except README/CLAUDE.md/AGENTS.md
