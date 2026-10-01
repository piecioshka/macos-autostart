# Memory

Facts about THIS repository: architecture, traps, decisions that the code and git history do not already state. Facts about the user, or preferences that span projects, belong in the shared memory file instead.

## Rules

- One fact per bullet, format: `- [YYYY-MM-DD] [category] fact`
- Categories: `project`, `reference`, `preference`
- Check for an existing entry before adding one, update instead of duplicating
- Delete a fact once it stops being true
- Newest entries first

## Facts

- [2026-09-29] [project] ESLint `no-control-regex` forbids the ESC character in regex literals, so in `src/tui/` ESC is a string constant (`ESC` in `terminal.ts` and `input.ts`) and the input patterns in `input.ts` match only what follows ESC, with the ESC check done on the string beforehand. Keep it that way when adding key or mouse sequences. `model` and `view` stay pure; only `terminal` and `app` write to the terminal.
- [2026-09-29] [reference] `sfltool dumpbtm` can show a macOS authorization dialog ("sfltool wants to make changes. Enter your password to allow this.") on every call, observed on a recent macOS. That is why its successful output is cached in `$XDG_CACHE_HOME/macos-autostart` or `~/.cache/macos-autostart` (`src/cache.ts`, TTL `CACHE_TTL_HOURS`, default 24 h), why the call gets its own 5 minute timeout (`SFLTOOL_TIMEOUT_MS` in `src/sources/btm.ts`; the global 30 s killed it while the dialog was still open, so nothing got cached) and why no test may run the real `sfltool`: unit tests use `fakeContext()`, and `src/smoke.spec.ts` answers `sfltool` with a failed result and uses its own cache directory under `tmp/`. Never run the real CLI to verify a change; the husky pre-commit hook runs `npm test`, so a smoke test that reached `sfltool` would pop the dialog on every commit.
- [2026-09-29] [reference] BTM type `daemon (0x10)` (apps registering a daemon with `SMAppService.daemon`, plist inside the app bundle) is inferred from the bit layout of the other types (legacy daemon is `0x10010` = legacy `0x10000` | daemon `0x10`), not seen in real `sfltool dumpbtm` output yet. If such items show up with another type name, only `APP_SERVICE_TYPES` in `src/sources/btm.ts` needs to change.
- [2026-09-29] [reference] `sfltool dumpbtm` (macOS 13+) runs without `sudo` (it may still show its own password dialog, see the entry above), writes to stdout and is undocumented (`man sfltool` is from 2012). Sections `Records for UID <n>`, items `#N:` with `Key: value` lines. Type `app` with `enabled` and without `Embedded Item Identifiers` is a classic "Open at Login" item (it matches the System Events login item list 1:1); `app` entries that are disabled or have embedded items are groups or leftovers. `disallowed` in `Disposition` means the user switched the item off in System Settings > Login Items.
- [2026-09-29] [reference] `launchctl print system`, block `services = {`: columns are PID (0 = not running), last exit status (`-` and `(pe)` = none, negative = signal) and label. The same output also has a `disabled services` block, so match the `services` block by exact prefix `\tservices = {`.
- [2026-09-29] [reference] `plutil -convert json -o - <file>` fails with "no such file" on dangling symlinks in `/System/Library/Launch*` and with "don't have permission" on some third-party `/Library/LaunchDaemons` plists. The first is skipped silently, the second becomes a warning. Running `plutil` 16 at a time is much faster than one after another; the limit of 16 is global, so launchd directories are scanned one after another.
- [2026-09-29] [reference] `/etc/periodic` and `/etc/crontab` may be absent on recent macOS; the sources treat a missing path as zero entries.
