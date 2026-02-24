---
name: todoist
description: Manage Todoist tasks via the `td` CLI — view today's tasks, inbox, projects, add/complete/update tasks.
allowed-tools: Bash(td:*)
---
# Todoist CLI (`td`)

Manage Todoist tasks using the `td` CLI. Requires `TODOIST_API_TOKEN` to be set in the environment.

## Auth Check

```bash
td auth status
```

If this fails, the `TODOIST_API_TOKEN` env var is missing or invalid — the token must be set in `.env` on the host and the service restarted.

## Output Flags

Always use `--json` or `--ndjson` for machine-readable output on list/view commands. Use `--full` to include all fields.

```bash
td today --json
td task list --json --full
```

## Viewing Tasks

```bash
# Tasks due today and overdue
td today --json

# Upcoming tasks (next 7 days by default)
td upcoming --json

# Inbox tasks
td inbox --json

# All tasks (optionally filtered)
td task list --json
td task list --json --project "Work"
td task list --json --priority p1
td task list --json --due today
td task list --json --filter "overdue"

# Task details
td task view <ref> --json
```

## Adding Tasks

Use `td task add` (not `td add`) for structured, reliable task creation:

```bash
td task add "Buy milk" --due today
td task add "Call dentist" --due "tomorrow at 10am" --priority p2
td task add "Finish report" --due Friday --project "Work"
td task add "Daily standup" --due "every day at 9am" --project "Work"
```

Key flags: `--due`, `--priority <p1-p4>`, `--project`, `--labels`, `--description`, `--duration`

> `td add` also works and accepts natural language (e.g. `"Buy milk tomorrow p1 #Shopping"`), but `td task add` with explicit flags is preferred for agents.

## Completing & Updating Tasks

```bash
# Complete a task (use task id from --json output)
td task complete id:12345678

# Complete a recurring task permanently
td task complete id:12345678 --forever

# Update a task
td task update id:12345678 --due "next Monday" --priority p1
td task update id:12345678 --content "Updated task title"
```

## Projects & Labels

```bash
td project list --json
td label list --json
```

## Other Useful Commands

```bash
# Completed tasks
td completed --json

# Productivity stats / karma
td stats

# View any Todoist entity by URL
td view <url>
```

## Tips

- Always get task IDs from `--json` output before completing or updating
- `--filter` accepts raw Todoist filter queries (e.g. `"p1 & overdue"`, `"assigned to: me"`)
- Priority: `p1` = urgent/red, `p4` = no priority (default)
