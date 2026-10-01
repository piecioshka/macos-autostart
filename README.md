# macos-autostart

<!-- prettier-ignore-start -->

![cli-available](https://badgen.net/static/cli/available/?icon=terminal)
[![node version](https://img.shields.io/node/v/macos-autostart.svg)](https://www.npmjs.com/package/macos-autostart)
[![npm version](https://badge.fury.io/js/macos-autostart.svg)](https://badge.fury.io/js/macos-autostart)
[![downloads count](https://img.shields.io/npm/dt/macos-autostart.svg)](https://www.npmjs.com/package/macos-autostart)
[![size](https://packagephobia.com/badge?p=macos-autostart)](https://packagephobia.com/result?p=macos-autostart)
[![license](https://img.shields.io/npm/l/macos-autostart.svg)](https://piecioshka.mit-license.org)
[![github-ci](https://github.com/piecioshka/macos-autostart/actions/workflows/ci.yml/badge.svg)](https://github.com/piecioshka/macos-autostart/actions/workflows/ci.yml)
![typescript](https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg)

<!-- prettier-ignore-end -->

🔨 List everything that starts automatically on macOS: launch agents, launch daemons, login items and cron jobs, with their live state.

> Give a ⭐️ if this project helped you!

## Motivation

macOS starts software from half a dozen places: plist files in five launchd folders under `~/Library`, `/Library` and `/System/Library`, login items registered by apps, agents and daemons hidden inside app bundles, cron and periodic scripts. System Settings shows only part of it and without details. `macos-autostart` puts all of it in one list and tells you what runs at boot or login, what runs on a schedule, and whether it is actually running.

## Features ✨

- 📋 One list of launchd agents and daemons, login items, agents and daemons embedded in apps, cron jobs and periodic scripts
- ⏰ Split into _at startup_ (boot, login, keep alive) and _periodic_ (interval, calendar, watched paths, cron)
- 🚦 Live state from `launchctl`: running with PID, last exit code or signal, not loaded, disabled
- 🍏 Apple's own agents and daemons hidden by default, one flag away (`--system`)
- 🤖 JSON output for scripts (`--json`)
- 🕹️ Interactive view in a terminal: tabs, filter, sort, mouse, and `launchctl` actions on the selected job
- 🔓 Changes nothing on its own: apart from its cache file it touches the system only when you confirm a `launchctl` action in the interactive view; runs as your normal user
- 💾 `sfltool dumpbtm` output cached for 24 hours, so macOS asks for your password once a day instead of on every run
- 📦 Zero runtime dependencies

## Installation

```bash
npx macos-autostart
```

or

```bash
npm install -g macos-autostart
```

## CLI

```
Usage: macos-autostart [options]

List everything that starts automatically on macOS.

Options:
  -i, --interactive  open the interactive view (default in a terminal)
  --table            print the table even in a terminal
  --json             print JSON instead of a table
  --system           include Apple's own agents and daemons from /System
  --source <name>    show only one source: user-agent, global-agent, global-daemon, system-agent, system-daemon, btm, cron, periodic, launchd
  --no-cache         run sfltool dumpbtm again instead of using its cached output
  -h, --help         show this help
  -v, --version      show the version
```

`--source launchd` is a shortcut for all five launchd directories at once.

In a terminal the interactive view opens by default (see below). Add `--table` to print the table instead. When the output is piped or redirected you get the table too, and `--json` always prints JSON. `--interactive` fails when stdin or stdout is not a terminal, and it cannot be combined with `--table` or `--json`.

Example (sample data):

```
macos-autostart v0.1.0
Copyright (c) 2026 Piotr Kowalski <piecioshka@gmail.com> https://piecioshka.pl/

At startup (4)
  Label                     Source         When                 State              Program
  com.example.sync          user-agent     at login             running (PID 812)  ~/bin/example-sync --watch
  com.example.helperd       global-daemon  at boot, keep alive  running (PID 391)  /Library/PrivilegedHelperTools/com.e…
  com.example.launcher      btm            at login             -                  /Applications/Example Launcher.app
  com.example.suite.daemon  btm            at boot              -                  /Applications/Example Suite.app/Cont…

Periodic (4)
  Label                Source        When               State              Program
  com.example.cleanup  user-agent    watch ~/Downloads  not loaded         /usr/local/bin/example-cleanup
  com.example.indexer  global-agent  daily 03:00        killed (signal 9)  /usr/local/bin/example-indexer
  com.example.updater  global-agent  every 1 h          exited 1           /Library/Application Support/Example/updater
  backup.sh            cron          0 3 * * *          -                  /usr/local/bin/backup.sh
```

The table fits the terminal width: long labels, triggers and commands are cut with `…` (use `--json` for the full text).

Warnings (for example a plist you are not allowed to read) go to stderr, or to the `warnings` field with `--json`.

Run it as your normal user, without `sudo`: as root the tool cannot see your login session (the `gui/<uid>` domain of `launchctl`), so your own agents would show up as `not loaded`.

### The State column

| State | Meaning |
| --- | --- |
| `running (PID N)` | the job is running right now as process N |
| `loaded` | launchd knows the job, it is not running and its last run ended well (or it has not run yet) |
| `exited N` | the job is not running and its last run ended with exit code N |
| `killed (signal N)` | the job is not running and its last run was killed by signal N (for example 9 = `SIGKILL`) |
| `not loaded` | the plist exists, but launchd has not loaded the job |
| `disabled` | switched off (`launchctl disable` or System Settings > General > Login Items & Extensions) |
| `-` | unknown: not a launchd job the tool can look up, for example login items and embedded items from BTM, and cron jobs |

## Interactive view 🖥️

Run `macos-autostart` in a terminal, or `macos-autostart -i` to ask for it explicitly. It opens a full-screen view of the same list; `--system`, `--source` and `--no-cache` work as before (`--no-cache` applies to the first load). `--table` and `--json` skip the view.

Layout, top to bottom:

- a header bar: the `macos-autostart` badge and the two numbered tabs, _1. At startup_ and _2. Periodic_ (the active one highlighted)
- the Mode line: the current mode with its main keys (for example `Navigation (Press / to search)`), then the last message and the warning count
- the search line: `>` followed by the filter, or a dimmed `Search Label, Program, File...` while it is empty
- the column headers (Label, Source, State, When, Program), with an arrow on the sorted column; on a narrow list Program (below 84 columns) and then When (below 70) are left out, so every cell keeps its full value or ends with `…`
- the list, with the selected row highlighted across its whole width
- a separator and a footer with the number of entries (`Total`), the keys and the version (`Enter: Detail` only when there is no side panel)

From 117 columns wide (so the list keeps at least 70) a side panel on the right shows the selected entry: its label, then the Source, Triggers (all of them, from both tabs), State, Program, File and available Actions sections. When they do not fit the height, the blank lines go first, then each field takes one `Title:  value` line; Actions always stays visible. On a narrower terminal `Enter` opens the same details as a full-screen page. The smallest supported size is 60x10, below that the view only asks for a bigger terminal and only `q` and `Ctrl+C` work.

Example (sample data, 96x14). The active tab and the selected row, here the first one, are highlighted in color. With `NO_COLOR` the active tab is drawn in bold inverse video, the other tab plainly, and the selected row in inverse video. Long values are cut with `…` and the footer is cut at the terminal width; the full list of keys is in the table below.

```
 macos-autostart   1. At startup   2. Periodic

 Mode: Navigation (Press / to search)

 > Search Label, Program, File...

 Label ↑                   Source         State                 When           Program
 com.example.helperd       global-daemon  running (PID 391)     at boot, kee…  /Library/Privile…
 com.example.launcher      btm            -                     at login       /Applications/Ex…
 com.example.suite.daemon  btm            -                     at boot        /Applications/Ex…
 com.example.sync          user-agent     running (PID 812)     at login       ~/bin/example-sy…

────────────────────────────────────────────────────────────────────────────────────────────────
 Total: 4 | Enter: Detail | /: Search | S: Sort | s: Apple | r: Refresh | w: Warnings | e: Dis
```

### Keys

| Key | Action |
| --- | --- |
| `↑` `↓`, `j` `k` | move the selection |
| `PgUp` `PgDn` | move by one page |
| `Home` `End`, `g` `G` | first / last entry |
| `←` `→`, `Tab` `Shift+Tab`, `1` `2` | switch tab |
| `Enter` | show details (on a narrow terminal) |
| `/` | filter by label, program or file (`Enter` keeps it, `Esc` clears it) |
| `S` | cycle the sort column: Label, Source, State |
| `s` | show or hide Apple's own agents and daemons |
| `r` | reload the list (`sfltool` output comes from its cache while that is fresh) |
| `w` | show the warnings and the full last message |
| `e` `u` `x` `o` `c` | actions on the selected entry, see below |
| `Esc`, `Enter`, `q` | close details or warnings |
| `q`, `Ctrl+C` | quit |

The mouse works too: click a tab, click the Label, Source or State header to sort by it (click again to reverse), click a row to select it, use the wheel to scroll.

### Actions

| Key | Command | What it does |
| --- | --- | --- |
| `e` | `launchctl disable <target>` or `launchctl enable <target>` | switch the job off until enabled again, or back on (it starts at the next login, boot or load) |
| `u` | `launchctl kickstart <target>` or `launchctl bootstrap <domain> <plist>` | start a loaded job now, or load an unloaded one from its plist (it then starts as the plist says); needs an enabled job |
| `x` | `launchctl bootout <target>` | stop and unload a loaded job until the next login or boot (`u` loads it again) |
| `o` | `open -R <file>` | show the plist or file in Finder |
| `c` | `pbcopy` | copy the file path (or the program when there is no file) |

`e`, `u` and `x` work only on launchd jobs and always ask `[y] yes [n] no` first, showing the exact command. `<target>` is `gui/<uid>/<label>` for agents and `system/<label>` for daemons. `o` and `c` need no confirmation. After `e`, `u` or `x` the list is reloaded.

Daemons need root. The view never runs `sudo` itself: when `launchctl` fails, the Mode line shows the error, and the same command with `sudo` in front is copied to the clipboard, ready to paste into a terminal (if the clipboard is unavailable, the message says to run it in a terminal).

The state of launchd jobs (running, PID, last exit code) is refreshed every 5 seconds from `launchctl` only; `sfltool` is never run in the background. With `NO_COLOR` set to any non-empty value the view uses no colors.

Pasted text is ignored rather than read as key presses (the view turns on bracketed paste); only `Ctrl+C` still gets through during a paste. `SIGINT`, `SIGTERM` and `SIGHUP` close the view and restore the terminal.

## Where the data comes from 🔍

| Source | Where | What it is |
| --- | --- | --- |
| `user-agent` | `~/Library/LaunchAgents` | agents of the current user, run in the login session |
| `global-agent` | `/Library/LaunchAgents` | agents installed by apps for every user |
| `global-daemon` | `/Library/LaunchDaemons` | daemons installed by apps, run as root at boot, without a user session |
| `system-agent` | `/System/Library/LaunchAgents` | Apple's agents (only with `--system`) |
| `system-daemon` | `/System/Library/LaunchDaemons` | Apple's daemons (only with `--system`) |
| `btm` | `sfltool dumpbtm` | login items, and agents and daemons embedded in app bundles |
| `cron` | `crontab -l`, `/etc/crontab` | cron jobs |
| `periodic` | `/etc/periodic/{daily,weekly,monthly}` | periodic maintenance scripts (absent on recent macOS) |

### What is `sfltool`?

`sfltool` is a command that ships with macOS (`/usr/bin/sfltool`). It was made for "shared file lists" such as recent documents and login items. Since macOS 13 Ventura it has a `dumpbtm` subcommand that prints the Background Task Management database: the same list you see in System Settings > General > Login Items & Extensions. This is the only place that knows about agents and daemons embedded in app bundles (registered with `SMAppService`; their plist lives inside the app, not in any `Library` folder) and about items you switched off in System Settings.

`dumpbtm` is undocumented (`man sfltool` still describes the 2012 version), so its output may change with a macOS update. When `macos-autostart` cannot read it, it prints a warning and shows everything else.

On recent macOS versions `sfltool dumpbtm` asks for an administrator password ("sfltool wants to make changes") every time it runs. To keep that dialog rare, `macos-autostart` saves its output for 24 hours in `~/.cache/macos-autostart` (or `$XDG_CACHE_HOME/macos-autostart`), in a file only you can read. Only successful output is saved, so a failed or cancelled run is tried again next time.

- `--no-cache` (or `NO_CACHE=true`) runs `sfltool dumpbtm` again and saves the fresh result, for example right after you installed or removed an app
- `CACHE_TTL_HOURS=6` changes how long the saved output is used; `CACHE_TTL_HOURS=0` keeps it until you refresh it with `--no-cache`

The launchd sources (`user-agent`, `global-agent`, `global-daemon`, `system-agent`, `system-daemon` and `launchd`) still need `sfltool dumpbtm` (from the cache or a fresh run): it is the only place that says which launchd jobs you switched off in System Settings (the `disabled` state). `cron` and `periodic` never run it.

`sfltool dumpbtm` gets up to 5 minutes to wait for your answer to the password dialog; every other command is stopped after 30 seconds.

If the cache directory was ever created by root (for example by a run with `sudo`), delete `~/.cache/macos-autostart`: otherwise the cache cannot be saved, you get a `[cache]` warning and macOS asks for the password on every run.

### launchd in one minute

A launch **agent** runs on behalf of a logged-in user; a launch **daemon** runs as root from boot, before anyone logs in. Each one is a plist file, and these keys decide when it starts:

| Key                              | Shown as                  |
| -------------------------------- | ------------------------- |
| `RunAtLoad`                      | at login / at boot        |
| `KeepAlive`                      | keep alive                |
| `StartInterval`                  | every N s / min / h / d   |
| `StartCalendarInterval`          | daily 08:00, Mon 03:15, … |
| `WatchPaths`, `QueueDirectories` | watch &lt;path&gt;        |
| `StartOnMount`                   | watch on volume mount     |

Jobs without any of these keys start only on demand (when another process talks to them) and are not listed.

## Development 🛠️

```bash
npm install
npm start            # build and run
npm test             # unit tests (the smoke test runs only on macOS)
npm run coverage     # unit tests with a coverage report
npm run lint         # ESLint
npm run format       # Prettier over the whole repository
```

## 🤝 Contributing

Contributions, issues and feature requests are welcome!<br /> Feel free to check [issues page](https://github.com/piecioshka/macos-autostart/issues/).

## License

[The MIT License](https://piecioshka.mit-license.org) @ 2026
