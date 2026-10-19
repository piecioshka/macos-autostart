# Contributing to macos-autostart

How to build, test and extend the project. For what it does and how to use the CLI, see the [README](README.md). The domain words used across the code and docs are defined in [CONTEXT.md](CONTEXT.md).

## Getting started

Requires Node.js >= 20.19 (see `.nvmrc`) and macOS (the tool reads macOS-only sources).

```bash
npm install
npm start            # build and run
npm test             # unit tests (the smoke test runs only on macOS)
npm run coverage     # unit tests with a coverage report
npm run lint         # ESLint
npm run typecheck    # tsc over the test project
npm run format       # Prettier over the whole repository
npm run build        # compile to dist/
```

Before calling a change done, run the same checks CI does:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

A husky `pre-commit` hook runs `lint-staged` on committed files.

## Layout

- `src/` holds every bit of logic, including `src/cli.ts`
- `src/sources/` has one module per data source, each returning a `SourceResult`; `src/sources/catalog.ts` holds every per-source fact
- `src/state.ts` decides entry state; `src/describe.ts` turns entries into text for the table and the interactive view
- `src/tui/` is the interactive view: pure `model`, `view`, `input`, `rows`, `geometry` and `actions`; `coordinator` orders background work; `system` is the one seam to the machine (real adapter `createSystem`, fake in `src/__fixtures__/fake-tui-system.ts`); terminal I/O only in `terminal` and `app`
- `src/__fixtures__/` holds anonymized dumps of system tools and `fakeContext()`, excluded from the build
- `bin/macos-autostart.js` only imports and calls
- `tmp/` takes logs and throwaway scripts, and is ignored by git

## Conventions

- ESM everywhere: `"type": "module"`, relative imports carry the `.js` extension.
- Every system call goes through the injected `Context` (`exec`, `fs`, `home`, `uid`); unit tests never touch the real system, only `src/smoke.spec.ts` does and it is skipped outside macOS.
- Never run the real interactive view or the real `sfltool` from an automated session: it needs a terminal, reads the real system and `sfltool` can show a password dialog. Use `fakeContext()` and fixtures.
- Fixtures and README examples use `/Users/example` and `com.example.*`, never real paths, account names or installed apps.
- Prettier formats every file; `npm run format:check` guards it in CI.
- Commit messages in US English, [Conventional Commits](https://www.conventionalcommits.org/).

## Adding a data source

1. Add a module under `src/sources/` that returns a `SourceResult`.
2. Record its per-source facts in `src/sources/catalog.ts`.
3. Add an anonymized fixture under `src/__fixtures__/` and cover it with a unit test through `fakeContext()`.
4. Document the source in the README table under "Where the data comes from".
