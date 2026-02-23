---
name: gogcli
description: Access Google services via the `gog` CLI — Gmail, Calendar, Drive, Docs, Sheets, Contacts, and Tasks.
allowed-tools: Bash(gog:*)
---
# gogcli — Google Services CLI

Access Gmail, Calendar, Drive, Docs, Sheets, Contacts, and Tasks via the `gog` CLI.

## Auth Check

```bash
gog auth list
```

If no accounts are listed, gogcli has not been set up yet. Ask the user to run `/add-gogcli` from their NanoClaw channel to initialize.

## General Flags

- `--json` — structured JSON output (always prefer this for programmatic use)
- `--account user@gmail.com` — select account when multiple are configured
- `--readonly` — used at `gog auth add` time to limit OAuth grant to read-only scopes
- `--help` — list subcommands and flags for any command

## Read-Only vs Write Access

If the user set up gogcli with `--readonly`, write operations (send email, create calendar event, upload to Drive, etc.) will fail with a permission/scope error. To check:

```bash
gog auth list  # shows the account and its scope level
```

If write access is needed, the user must re-run the auth setup inside an interactive container session:

```bash
gog auth add you@gmail.com --manual  # without --readonly
```

## Gmail

```bash
# Search emails (supports Gmail query syntax)
gog gmail search 'newer_than:7d' --json
gog gmail search 'from:boss@example.com is:unread' --json
gog gmail search 'subject:"meeting" after:2024/01/01' --json

# Get a specific email by ID
gog gmail get <message-id> --json

# Send email
gog gmail send --to recipient@example.com --subject "Hello" --body "Message body"

# Reply to a thread
gog gmail reply <message-id> --body "Reply text"

# List labels
gog gmail labels --json
```

## Calendar

```bash
# List upcoming events (defaults to next 7 days)
gog calendar list-events --json

# List events in a date range
gog calendar list-events --start 2024-01-01 --end 2024-01-31 --json

# Add an event
gog calendar add-event --title "Team Standup" --start "2024-01-15T10:00:00" --end "2024-01-15T10:30:00"

# List calendars
gog calendar list --json
```

## Drive

```bash
# List files
gog drive list --json

# Search files
gog drive search "quarterly report" --json

# Download a file
gog drive download <file-id> --output ./local-file.pdf

# Upload a file
gog drive upload ./local-file.pdf --name "Uploaded File"
```

## Contacts

```bash
# Search contacts
gog contacts search "John" --json

# List all contacts
gog contacts list --json
```

## Tasks

```bash
# List task lists
gog tasks lists --json

# List tasks in a list
gog tasks list --json
gog tasks list --tasklist <list-id> --json

# Add a task
gog tasks add --title "Buy groceries" --due 2024-01-20

# Complete a task
gog tasks complete <task-id>
```

## Docs & Sheets

```bash
# Read a document
gog docs get <doc-id> --json

# Read a spreadsheet
gog sheets get <spreadsheet-id> --json

# Get a specific sheet/range
gog sheets get <spreadsheet-id> --range "Sheet1!A1:D10" --json
```

## Tips

- Always use `--json` for structured output — parse with `jq` for specific fields
- Gmail query syntax: `is:unread`, `from:`, `to:`, `subject:`, `newer_than:Nd`, `has:attachment`
- Multi-account setup: use `--account user@gmail.com` to target a specific account
- For large result sets, check if the command supports `--limit` or pagination flags via `--help`
