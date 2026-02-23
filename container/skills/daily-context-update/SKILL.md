---
name: daily-context-update
description: Pull data from multiple sources (email, calendar, todoist) and store it for later retrieval.
---

### Purpose

Daily context is stored on disk in Markdown files so that you can enrich conversations with meaningful context from the user's life. These files are updated periodically from external data sources, and this skill describes how to pull that data and store it on disk.

### Storage on disk

Store and update 3 files on disk with daily context:
- `/workspace/group/daily-context/yesterday.md`
- `/workspace/group/daily-context/today.md`
- `/workspace/group/daily-context/tomorrow.md`

As you can see, the files are relative to the current day. At each run, update the files with the relevant data for that day. This means potentially pruning stale data from previous runs and replacing it with fresh data.

Make sure to include the current time as part of the stored context, so that when you retrieve it later you can reason about how recent it is.

#### Data format

Store data in a structured format to make it easier to parse and use later. Use TOML code blocks within the Markdown files for this purpose, but focus on keeping the content human-readable instead of the precise syntax.


### Data Sources

Pull data from multiple sources for each day. You might want to load certain skills in order to learn how to work with a data source.

##### Emails

`today.md`: Whatever is in my inbox that arrived on a given day, and is still in inbox. GOG CLI query: `search 'in:inbox'`
`yesterday.md`: Emails that arrived yesterday, but only the ones that are still in inbox (not archived or deleted). This captures emails that I haven't gotten to yet, rather than just everything that arrived.

The response might contain labels (e.g. `IMPORTANT`), but ignore them and use your own judgement to determine importance and categorization.

Store these fields: subject, sender name, starred status

#### Calendar

Events from both personal and work calendars for a given day.

- Store these fields: event title, time, calendar name
- Skip declined events
- It's possible that there are no more events for today. This is not a bug, make a note that the calendar was checked and no events were found.
- Use `gog calendar events` with `--from DATE` and `--to DATE` flags with dates, not positional arguments

Reminder: run for both of my Google accounts:

```
gog -a ofalvai@gmail.com calendar events --from DATE --to DATE
gog -a oliver.falvai@bitrise.io calendar events --from DATE --to DATE
```

##### Todoist

- Query scheduled tasks for today (`td today`) and tomorrow (`td upcoming`)
- Query completed tasks for today/yesterday — the skill should capture what was actually done, not just what's scheduled
- Store these fields: task, project, due date
