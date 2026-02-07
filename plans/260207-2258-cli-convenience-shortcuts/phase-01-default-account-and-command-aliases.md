# Phase 1: Default Account and Command Aliases

## Context Links

- [plan.md](plan.md)
- [src/index.ts](/home/andre/Workspace/tgmanager/src/index.ts) -- Commander setup, option parsing
- [src/utils/validation.ts](/home/andre/Workspace/tgmanager/src/utils/validation.ts) -- `validateCommand`, `validateAccountName`
- [src/types/index.ts](/home/andre/Workspace/tgmanager/src/types/index.ts) -- `CommandOptions`
- [src/config.ts](/home/andre/Workspace/tgmanager/src/config.ts) -- config loading, account list

## Overview

- **Priority:** P3
- **Status:** pending
- **Effort:** 45min
- **Description:** Add `TGMANAGER_DEFAULT_ACCOUNT` env var fallback for `-a` flag, and create short command alias mappings.

## Key Insights

1. `-a` is currently a `requiredOption` in Commander (line 113 of index.ts). Must change to `.option()` so Commander doesn't error when omitted.
2. Account resolution order: explicit `-a` flag > `TGMANAGER_DEFAULT_ACCOUNT` env > error.
3. `validateCommand()` has a hardcoded `validCommands` array (line 95 of validation.ts). Aliases must be resolved BEFORE calling this function.
4. Config's `buildAccounts()` has a hardcoded account name list. The default account from env must still exist in this list.

## Requirements

### Functional
- FR1: If `-a` not provided, read `TGMANAGER_DEFAULT_ACCOUNT` env var. Use its value as account name.
- FR2: If neither `-a` nor env var provided, error with clear message listing available accounts and env var hint.
- FR3: Command alias map: `store` -> `upload-storage`, `get` -> `download-storage`, `ls` -> `list-storage`.
- FR4: All original command names (`upload-storage`, `download-storage`, `list-storage`) must keep working.
- FR5: Aliases must NOT appear in `validCommands` -- resolve them to canonical names before validation.

### Non-Functional
- NF1: Zero breaking changes to existing CLI invocations.
- NF2: Env var name follows existing convention (`TGMANAGER_` prefix).

## Architecture

### Default Account Resolution

```
resolveAccount(cliOption?: string): string
  1. if cliOption provided -> return cliOption
  2. if TGMANAGER_DEFAULT_ACCOUNT set -> return its value
  3. throw Error("Account required. Use -a <account> or set TGMANAGER_DEFAULT_ACCOUNT. Available: ...")
```

Place this as a utility function in `src/utils/validation.ts` or inline in `src/index.ts` before `validateAccountName()` call.

### Command Alias Map

```typescript
const COMMAND_ALIASES: Record<string, string> = {
  store: 'upload-storage',
  get: 'download-storage',
  ls: 'list-storage',
};

function resolveCommandAlias(cmd: string): string {
  return COMMAND_ALIASES[cmd] ?? cmd;
}
```

Place in `src/utils/validation.ts` alongside `validateCommand()`.

### Data Flow

```
CLI input -> Commander parses flags -> resolve account -> resolve alias -> validateCommand -> main()
```

## Related Code Files

### Modify
- `src/index.ts` (lines 112-127): Change `-a` from `requiredOption` to `option`. After `program.parse()`, resolve account.
- `src/utils/validation.ts` (lines 94-138): Add alias map, `resolveCommandAlias()`, update `validateCommand` to accept resolved command.
- `src/types/index.ts` (line 70): Change `account: string` to `account?: string` in `CommandOptions`.

### No Changes
- `src/config.ts` -- no modifications needed; env var is read before config.

## Implementation Steps

1. **Update `CommandOptions` type** (`src/types/index.ts`)
   - Change `account: string` to `account?: string` (line 70)

2. **Change `-a` from requiredOption to option** (`src/index.ts`)
   - Line 113: `.requiredOption('-a, --account <account>', ...)` -> `.option('-a, --account <account>', ...)`

3. **Add account resolution** (`src/index.ts`)
   - After `const options = program.opts<CommandOptions>()` (line 127), add:
   ```typescript
   // Resolve account: CLI flag > env var > error
   if (!options.account) {
     const defaultAccount = process.env.TGMANAGER_DEFAULT_ACCOUNT;
     if (defaultAccount) {
       options.account = defaultAccount;
     } else {
       const available = Object.keys(config.accounts).join(', ');
       console.error(`Error: Account required. Use -a <account> or set TGMANAGER_DEFAULT_ACCOUNT env var.`);
       console.error(`Available accounts: ${available}`);
       process.exit(1);
     }
   }
   ```

4. **Add command alias map** (`src/utils/validation.ts`)
   - Add `COMMAND_ALIASES` constant and `resolveCommandAlias()` function before `validateCommand`.
   - Export `resolveCommandAlias`.

5. **Wire alias resolution** (`src/index.ts`)
   - Before calling `validateCommand`, resolve alias:
   ```typescript
   if (options.command) {
     options.command = resolveCommandAlias(options.command);
   }
   ```

6. **Cast account to string** in `main()`
   - After resolution, `account` is guaranteed non-empty. Cast where destructured (line 171):
   ```typescript
   const account = options.account as string;
   ```

## Todo List

- [ ] Update `CommandOptions.account` to optional in types
- [ ] Change `-a` from `requiredOption` to `option`
- [ ] Add default account resolution logic after `program.parse()`
- [ ] Add `COMMAND_ALIASES` map and `resolveCommandAlias()` to validation.ts
- [ ] Export `resolveCommandAlias` from validation.ts
- [ ] Call `resolveCommandAlias` on `options.command` before `validateCommand`
- [ ] Verify destructured `account` usage in `main()` still type-safe
- [ ] Run `npx tsc --noEmit` to verify no type errors

## Success Criteria

1. `node dist/index.js -a myaccount -c upload-storage ...` still works (backward compat).
2. `TGMANAGER_DEFAULT_ACCOUNT=myaccount node dist/index.js -c upload-storage ...` works (env default).
3. `node dist/index.js -a myaccount -c store ...` works (alias).
4. `node dist/index.js` with no `-a` and no env var prints helpful error with account list.
5. `npx tsc --noEmit` passes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `-a` no longer required breaks scripts | Low | Medium | Only changes Commander parsing; `-a` still accepted |
| Alias collision with future commands | Low | Low | Aliases are common Unix shorthand; unlikely to conflict |

## Security Considerations

- `TGMANAGER_DEFAULT_ACCOUNT` is a non-sensitive env var (account name, not credentials).
- Account name still validated against `config.accounts` via `validateAccountName()`.
- No new input surfaces; aliases map to existing commands.

## Next Steps

Proceed to Phase 2 (positional arguments), which builds on the alias map established here.
