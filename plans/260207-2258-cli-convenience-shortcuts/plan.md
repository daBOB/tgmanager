---
title: "CLI Convenience Shortcuts"
description: "Add default account env var, command aliases, and positional args for storage commands"
status: pending
priority: P3
effort: 2h
branch: main
tags: [cli, ux, convenience, backward-compat]
created: 2026-02-07
---

# CLI Convenience Shortcuts

## Goal

Reduce verbosity of common tgmanager CLI commands while keeping full backward compatibility.

**Before:**
```bash
node dist/index.js -a myaccount -c upload-storage -f ./data.db --virtual-path /db/data.db
node dist/index.js -a myaccount -c download-storage --virtual-path /db/data.db
node dist/index.js -a myaccount -c list-storage --virtual-path /db/
```

**After:**
```bash
export TGMANAGER_DEFAULT_ACCOUNT=myaccount
node dist/index.js store ./data.db /db/data.db
node dist/index.js get /db/data.db
node dist/index.js ls /db/
```

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Default account + command aliases | pending | [phase-01](phase-01-default-account-and-command-aliases.md) |
| 2 | Positional arguments for storage commands | pending | [phase-02](phase-02-positional-arguments.md) |
| 3 | Build and verify | pending | [phase-03](phase-03-build-and-verify.md) |

**Execution order:** Sequential (phases 1 and 2 both touch `src/index.ts`).

## Key Design Decision

Current CLI uses a flat option model (`-c <command>`) instead of Commander.js subcommands. Rather than refactoring to subcommands (high risk), we detect positional args from `program.args` after Commander parses known flags. A command alias map resolves shorthand names before validation.

## Files Modified

- `src/index.ts` -- Commander setup, arg resolution, command dispatch
- `src/utils/validation.ts` -- accept aliases in `validateCommand`, default account logic
- `src/types/index.ts` -- make `account` optional in `CommandOptions`

## Dependencies

None. Self-contained CLI changes.
