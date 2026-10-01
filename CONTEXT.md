# macos-autostart

A read-only view of everything macOS starts on its own: where it is registered, what triggers it and what state it is in right now.

## Language

### What gets listed

**Entry**: One thing that starts on its own, as the tool reports it (`AutostartEntry`): a label, its source, its triggers, the program and file behind it, and its state. _Avoid_: item, job (unless it is a launchd job), service

**Source**: Where an entry is registered: a launchd directory (`user-agent`, `global-agent`, `global-daemon`, `system-agent`, `system-daemon`), BTM, cron or periodic. _Avoid_: origin, provider, type

**Source catalog**: The one table of facts per source: its kind, launchd domain, directory, whether it is Apple's own and whether a load trigger means "at boot". _Avoid_: source config, source map

**Apple source**: `system-agent` and `system-daemon`, the jobs from `/System`, hidden unless asked for. _Avoid_: system source (ambiguous with the launchd `system` domain)

**Trigger**: What makes an entry start: load, keep alive, interval, calendar, watch or a cron schedule. _Avoid_: schedule (only one kind of trigger), event

**Group**: The two views of entries by trigger: "at startup" (load, keep alive) and "periodic" (everything else). An entry with triggers of both kinds is in both. _Avoid_: category, section

### launchd and BTM

**Domain**: The launchd namespace a job lives in: `gui/<uid>` for agents, `system` for daemons. _Avoid_: scope, context

**Service target**: A domain plus a label, the address `launchctl` acts on, e.g. `gui/501/com.example.agent`. _Avoid_: service name, path

**BTM**: Background Task Management, the macOS database behind System Settings > Login Items, read with `sfltool dumpbtm`. _Avoid_: login items database, SFL

**Disallowed**: A BTM disposition meaning the user switched the item off in System Settings. For a legacy launchd job it makes the entry disabled, whatever launchd says. _Avoid_: blocked, denied

### State

**Entry state**: Whether an entry is loaded, its PID, its last exit code and whether it is disabled. _Avoid_: status

**State resolution**: Deciding an entry's state from all signals: the plist `Disabled` key, `launchctl print-disabled`, BTM disallowed and the running services of its domain. _Avoid_: state merge, applying state

**Runtime refresh**: Re-reading only what changes while services run (loaded, PID, last exit code), never BTM, so it can run every few seconds without a password dialog. _Avoid_: reload, refresh (alone)

**State class**: The one label that decides how a state is shown, colored and sorted: running, failed, loaded, not loaded, disabled or unknown. _Avoid_: status, state kind

**Collect**: One full scan of the selected sources, with state resolution, returning entries and warnings. _Avoid_: scan (for the whole run), load

### Interactive view

**System port**: The one seam between the interactive view and the machine: collect, runtime refresh and running an action (`TuiSystem`). _Avoid_: backend, service, API

**Coordinator**: Orders the background work of the interactive view so that a stale result never overwrites a newer one. _Avoid_: scheduler, loader, queue

**Action**: A change the user asks for on the selected entry: enable or disable, start or load, stop and unload, reveal in Finder, copy. _Avoid_: command (that is what an action runs)
