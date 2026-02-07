# Phase 2: Positional Arguments for Storage Commands

## Context Links

- [plan.md](plan.md)
- [phase-01](phase-01-default-account-and-command-aliases.md)
- [src/index.ts](/home/andre/Workspace/tgmanager/src/index.ts) -- Commander setup, command dispatch
- [src/utils/validation.ts](/home/andre/Workspace/tgmanager/src/utils/validation.ts) -- validation + alias map from Phase 1
- Commander.js docs: `program.args` contains unrecognized positional args after `.parse()`

## Overview

- **Priority:** P3
- **Status:** pending (blocked by Phase 1)
- **Effort:** 45min
- **Description:** Allow `store <file> <virtual-path>`, `get <virtual-path>`, `ls [virtual-path]` as positional args instead of requiring `-c`, `-f`, `--virtual-path` flags.

## Key Insights

1. Commander.js stores unrecognized positional args in `program.args` after `.parse()`.
2. Current flow: `-c` flag sets `options.command`. If `-c` not provided and positional args exist, first positional arg could be a command name/alias.
3. Must NOT break flag-based usage. Resolution priority: explicit `-c` flag > first positional arg > error.
4. `store` needs 2 positional args (file, virtual-path). `get` needs 1 (virtual-path). `ls` needs 0-1 (optional virtual-path prefix).
5. `program.allowUnknownOption()` is NOT needed; Commander already collects extra args in `program.args`.

## Requirements

### Functional
- FR1: `store <file> <virtual-path> [flags]` -- first positional = file path, second = virtual path.
- FR2: `get <virtual-path> [flags]` -- first positional (after command) = virtual path.
- FR3: `ls [virtual-path] [flags]` -- optional first positional = virtual path prefix.
- FR4: Explicit flags override positional args (e.g., `store ./file /vp --virtual-path /override` uses `/override`).
- FR5: Mixed usage works: `node dist/index.js store ./file /vp -a myaccount --delete-source`.
- FR6: Error clearly if positional arg count is wrong (e.g., `store` with no file).

### Non-Functional
- NF1: All existing flag-based invocations unchanged.
- NF2: `program.args` parsing is simple, no Commander subcommand refactor.

## Architecture

### Positional Arg Resolution

After `program.parse()` and account resolution (Phase 1), process `program.args`:

```typescript
const positionalArgs = program.args; // unrecognized args after Commander parsing

if (!options.command && positionalArgs.length > 0) {
  const firstArg = positionalArgs[0];
  const allCommands = [...validCommands, ...Object.keys(COMMAND_ALIASES)];
  if (allCommands.includes(firstArg)) {
    options.command = resolveCommandAlias(firstArg);
    const cmdArgs = positionalArgs.slice(1); // remaining args after command name
    applyPositionalArgs(options, options.command, cmdArgs);
  }
}
```

### `applyPositionalArgs` Function

```typescript
function applyPositionalArgs(options: CommandOptions, command: string, args: string[]): void {
  switch (command) {
    case 'upload-storage':
      // store <file> <virtual-path>
      if (args.length < 2) {
        console.error('Usage: store <file> <virtual-path> [options]');
        process.exit(1);
      }
      if (!options.filePath) options.filePath = args[0];
      if (!options.virtualPath) options.virtualPath = args[1];
      break;
    case 'download-storage':
      // get <virtual-path>
      if (args.length < 1) {
        console.error('Usage: get <virtual-path> [options]');
        process.exit(1);
      }
      if (!options.virtualPath) options.virtualPath = args[0];
      break;
    case 'list-storage':
      // ls [virtual-path]
      if (args.length >= 1 && !options.virtualPath) {
        options.virtualPath = args[0];
      }
      break;
  }
}
```

### Data Flow

```
CLI input
  -> Commander parses known flags, remaining go to program.args
  -> Phase 1: resolve account, resolve alias on -c
  -> Phase 2: if no -c, check program.args[0] as command name
  -> apply positional args to options (only if flag not already set)
  -> validateCommand()
  -> main()
```

## Related Code Files

### Modify
- `src/index.ts` (lines 125-174): After `program.parse()`, add positional arg resolution logic between Phase 1's account resolution and `validateCommand()` call.

### Create
- Nothing new. All logic fits in `src/index.ts`. `applyPositionalArgs` is a small local function (< 30 lines).

## Implementation Steps

1. **Enable `allowExcessArguments`** (`src/index.ts`)
   - After `program` definition, add `program.allowExcessArguments(true)` so Commander doesn't error on extra positional args.

2. **Add valid commands list constant** (`src/utils/validation.ts`)
   - Extract `validCommands` array from inside `validateCommand()` to a module-level export: `export const VALID_COMMANDS = [...]`.
   - Update `validateCommand()` to reference it.

3. **Add `applyPositionalArgs` function** (`src/index.ts`)
   - Place above `main()`. Takes `options`, `command` (canonical), and `args` (remaining positional).
   - See Architecture section for logic.

4. **Add positional arg resolution block** (`src/index.ts`)
   - After account resolution (Phase 1 code), before `validateCommand()` call:
   ```typescript
   const positionalArgs = program.args;
   if (!options.command && positionalArgs.length > 0) {
     const firstArg = positionalArgs[0];
     const resolved = resolveCommandAlias(firstArg);
     if (VALID_COMMANDS.includes(resolved)) {
       options.command = resolved;
       applyPositionalArgs(options, resolved, positionalArgs.slice(1));
     }
   } else if (options.command && !options.filePath && !options.virtualPath && positionalArgs.length > 0) {
     // Command from -c flag, but positional args provided for file/virtualPath
     applyPositionalArgs(options, resolveCommandAlias(options.command), positionalArgs);
   }
   ```

5. **Handle edge case: `-c` flag + positional args**
   - If user does `-c store ./file /vp`, the alias is resolved by Phase 1 but positional args should still apply. The second branch in step 4 handles this.

6. **Update Commander `allowExcessArguments`**
   - Default Commander behavior may warn on excess args. Add `program.allowExcessArguments(true)` after program definition.

## Todo List

- [ ] Add `program.allowExcessArguments(true)` to Commander setup
- [ ] Extract `VALID_COMMANDS` as exported constant from validation.ts
- [ ] Implement `applyPositionalArgs()` in index.ts
- [ ] Add positional resolution block after account resolution, before validation
- [ ] Handle `-c` flag + positional args combo
- [ ] Test: `store ./file /vp` with env account
- [ ] Test: `get /vp --output-path ./out`
- [ ] Test: `ls` with no args
- [ ] Test: `ls /prefix/`
- [ ] Test: existing flag-based commands still work
- [ ] Run `npx tsc --noEmit`

## Success Criteria

1. `node dist/index.js store ./data.db /db/data.db` works (with env account set).
2. `node dist/index.js get /db/data.db` works.
3. `node dist/index.js ls` works (lists all).
4. `node dist/index.js ls /db/` works (filtered).
5. `node dist/index.js -c upload-storage -f ./data.db --virtual-path /db/data.db` still works.
6. `node dist/index.js store ./data.db /db/data.db --storage-channel -100123 --delete-source` works (mixed positional + flags).
7. `node dist/index.js store` with no file arg prints usage error.
8. `npx tsc --noEmit` passes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Positional arg confused with flag value | Low | Medium | Commander parses flags first; `program.args` only has leftovers |
| File path looks like a command name | Very Low | Low | We check against known command list; file paths usually have `/` or `.` |
| `allowExcessArguments` hides real errors | Low | Low | We validate arg count in `applyPositionalArgs` |

## Security Considerations

- Positional args go through same `validatePath`, `validateCommand`, `sanitizeInput` as flag-based args.
- No new input surfaces -- same data, different syntax.
- File paths from positional args still resolved via `resolve()` in existing upload handling.

## Next Steps

Proceed to Phase 3 (build and verify). All functional changes complete after this phase.
