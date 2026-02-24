---
name: add-todoist
description: Add Todoist task management to the NanoClaw agent container. Installs the todoist-cli (`td`) globally and forwards TODOIST_API_TOKEN from the host .env so the in-container agent can read and manage tasks.
---

# Add Todoist CLI

This skill installs `@doist/todoist-cli` into the NanoClaw agent container and wires up the `TODOIST_API_TOKEN` so the in-container agent can manage Todoist tasks.

## Step 1: Check Existing Setup

```bash
grep -q 'todoist-cli' container/Dockerfile && echo "Dockerfile: already patched" || echo "Dockerfile: needs update"
grep -q 'TODOIST_API_TOKEN' src/container-runner.ts && echo "container-runner: already patched" || echo "container-runner: needs update"
```

If both are already patched and `container/skills/todoist/SKILL.md` exists, skip to **Step 6: Verify**.

## Step 2: Patch container/Dockerfile

Skip if already patched.

Find the line:

```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code
```

Replace it with:

```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code @doist/todoist-cli
```

Adding to the same `RUN` command keeps the layer count low.

## Step 3: Patch src/container-runner.ts

Skip if already patched.

In `buildContainerArgs()`, after the existing `gogcli` block that reads `GOG_KEYRING_PASSWORD`, add:

```typescript
const todoistEnv = readEnvFile(['TODOIST_API_TOKEN']);
if (todoistEnv.TODOIST_API_TOKEN) {
  args.push('-e', `TODOIST_API_TOKEN=${todoistEnv.TODOIST_API_TOKEN}`);
}
```

No volume mount is needed — unlike gogcli, there are no credential files to persist between runs.

## Step 4: Install Runtime Skill

Copy the bundled runtime skill so the in-container agent knows how to use `td`:

```bash
mkdir -p container/skills/todoist
cp .claude/skills/add-todoist/runtime-skill.md container/skills/todoist/SKILL.md
```

Skip if `container/skills/todoist/SKILL.md` already exists.

## Step 5: Add to .env

Ask the user for their Todoist API token:

> I need your Todoist API token to authenticate the `td` CLI inside the container.
>
> Get it here: **todoist.com → Settings → Integrations → Developer → API token**
>
> Paste your token here.

Once the user provides the token, append it to `.env`:

```bash
echo "" >> .env
echo "# Todoist API token for td CLI in agent container" >> .env
echo "TODOIST_API_TOKEN=<token-from-user>" >> .env
```

Verify:

```bash
grep TODOIST_API_TOKEN .env
```

## Step 6: Build

```bash
npm run build && ./container/build.sh
```

Wait for both to complete before continuing.

## Step 7: Restart Service

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
# systemctl --user restart nanoclaw
```

Check it started cleanly:

```bash
sleep 2 && launchctl list | grep nanoclaw  # macOS
# Linux: systemctl --user status nanoclaw
```

## Step 8: Verify

Tell the user:

> Todoist is set up! Test it by sending this message in your WhatsApp/Telegram channel:
>
> `@Andy what tasks do I have today?`
>
> The agent will run `td today` and return your tasks.

---

## Troubleshooting

### "TODOIST_API_TOKEN not set" or auth error

- Check the token is present in `.env`: `grep TODOIST_API_TOKEN .env`
- Verify the container-runner patch is in place: `grep TODOIST_API_TOKEN src/container-runner.ts`
- Make sure the service was restarted after patching

### `td` command not found in container

- The Dockerfile patch may not have been applied, or the image wasn't rebuilt
- Run `npm run build && ./container/build.sh` again
- If the issue persists, prune the builder cache and retry (see CLAUDE.md — Container Build Cache)

### Wrong or expired API token

- Generate a new token at todoist.com → Settings → Integrations → Developer
- Update `.env` and restart the service
