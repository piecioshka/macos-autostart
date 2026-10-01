# macos-autostart

@MEMORY.md

## What this is

A CLI for macOS that lists everything that starts on its own: launchd agents and daemons, Login Items and app-embedded agents from Background Task Management, cron and periodic scripts, with live state from `launchctl`. Read-only, no sudo, zero runtime dependencies. Meant for npm; the author publishes by hand, agents never run `npm publish`.

## Layout

- `CONTEXT.md` defines the domain words (entry, source, state resolution, system port, ...); use them in code and docs
- `src/` holds every bit of logic, including `src/cli.ts`
- `src/sources/` has one module per data source, each returns a `SourceResult`
- `src/sources/catalog.ts` holds every per-source fact; `src/state.ts` decides entry state; `src/describe.ts` turns entries into text for the table and the TUI
- `src/tui/` is the interactive view: pure `model`, `view`, `input`, `rows`, `geometry` and `actions`; `coordinator` orders background work (collect, runtime refresh, actions); `system` is the one seam to the machine (real adapter `createSystem`, fake in `src/__fixtures__/fake-tui-system.ts`); terminal I/O only in `terminal` and `app`
- `src/__fixtures__/` holds anonymized dumps of system tools and `fakeContext()`, excluded from the build
- `bin/macos-autostart.js` only imports and calls
- `tmp/` takes logs and throwaway scripts, and is ignored by git

## Conventions

- ESM everywhere: `"type": "module"`, relative imports carry the `.js` extension
- Every system call goes through the injected `Context` (`exec`, `fs`, `home`, `uid`); unit tests never touch the real system, only `src/smoke.spec.ts` does and it is skipped outside macOS
- Fixtures and README examples use `/Users/example` and `com.example.*`, never real paths, account names or installed apps
- Prettier formats every file, `npm run format:check` guards it in CI
- Never run the real TUI from an agent session: it needs a terminal, reads the real system and `sfltool` can show a password dialog
- Commit messages in English, Conventional Commits, no `Co-Authored-By`

## Before calling a task done

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```
