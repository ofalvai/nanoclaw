---
name: add-gogcli
description: Set up gogcli for Google services (Gmail, Calendar, Drive, Contacts, Tasks, Docs, Sheets) in the NanoClaw container. Guides through source code setup, Google Cloud OAuth, one-time interactive auth, and service restart.
---

# Add gogcli — Google Services CLI

This skill configures `gog` (gogcli) inside the NanoClaw agent container, giving the agent access to Gmail, Calendar, Drive, Contacts, Tasks, Docs, and Sheets via Bash commands.

## Step 1: Check Existing Setup

```bash
ls -la data/gogcli/ 2>/dev/null || echo "gogcli credentials not found"
grep -q 'gogcli-builder' container/Dockerfile && echo "Dockerfile: already patched" || echo "Dockerfile: needs update"
grep -q 'gogcliDir' src/container-runner.ts && echo "container-runner: already patched" || echo "container-runner: needs update"
```

If credentials exist and both source files are already patched, skip to **Step 10: Verify**.

## Step 2: Patch container/Dockerfile

Skip if already patched.

Add a new multi-stage build step that compiles the `gog` binary from source using `golang:1.25-alpine`, then copies the resulting binary into `/usr/local/bin/gog` in the final image. The Go version must be 1.25+ (gogcli v0.11.0 requires it).

## Step 3: Patch src/container-runner.ts

Skip if already patched.

Two additions:

1. In `buildVolumeMounts()`: conditionally mount `path.join(DATA_DIR, 'gogcli')` to `/home/node/.config/gogcli` with write access (token refresh needs it). Only mount if the directory exists — absence means gogcli hasn't been set up yet.

2. In `buildContainerArgs()`: read `GOG_KEYRING_PASSWORD` from the `.env` file via `readEnvFile()` and pass it as a `-e` env var. It must be a plain env var (not a secret) because `gog` is invoked via Bash, and secrets are intentionally scoped to the Claude SDK only.

## Step 4: Install Runtime Skill

Copy the bundled runtime skill into place so the agent inside the container knows how to use `gog`:

```bash
mkdir -p container/skills/gogcli
cp .claude/skills/add-gogcli/runtime-skill.md container/skills/gogcli/SKILL.md
```

Skip if `container/skills/gogcli/SKILL.md` already exists.

## Step 5: Build

The source changes must be compiled and the container image rebuilt before the interactive auth step, since the auth session runs inside the container and needs the `gog` binary.

```bash
npm run build && ./container/build.sh
```

Wait for both to complete before continuing.

## Step 6: Google Cloud Console Setup

**USER ACTION REQUIRED**

Tell the user:

> I need you to set up Google Cloud OAuth credentials for gogcli. Here's what to do:
>
> 1. Open https://console.cloud.google.com
> 2. Create a new project (or select an existing one)
> 3. Enable the APIs you want — go to **APIs & Services → Library** and enable:
>    - Gmail API
>    - Google Calendar API
>    - Google Drive API
>    - Google Contacts API (People API)
>    - Google Tasks API
>    - Google Docs API
>    - Google Sheets API
>    (You can enable only the ones you need)
>
> 4. Create OAuth credentials:
>    - Go to **APIs & Services → Credentials**
>    - Click **+ CREATE CREDENTIALS → OAuth client ID**
>    - If prompted for consent screen: choose **External**, fill in app name (e.g. "NanoClaw"), your email, and save
>    - For Application type: select **Desktop app**
>    - Name it anything (e.g. "NanoClaw gogcli")
>    - Click **Create**
>
> 5. Download the JSON:
>    - Click **DOWNLOAD JSON** on the popup (or use the download icon in the credentials list)
>    - Save it somewhere accessible (e.g. `~/Downloads/client_secret.json`)
>
> Where did you save the file? Give me the full path.

Once the user provides the path, confirm it exists:

```bash
ls -la "<path-user-provided>"
```

## Step 7: One-Time Interactive Auth

Ask the user to choose a keyring password:

> gogcli encrypts your OAuth tokens with a password. Choose a strong password — you'll add it to `.env` so the container can decrypt the keyring at runtime.
>
> What password would you like to use for the gogcli keyring?

Store it as `KEYRING_PASSWORD`.

Create the credentials directory:

```bash
mkdir -p data/gogcli
```

Determine the container runtime:

```bash
which docker 2>/dev/null && echo "docker" || which container 2>/dev/null && echo "apple-container" || echo "unknown"
```

Run the interactive auth session from the NanoClaw project root (replace placeholders):

```bash
SECRET_DIR="$(dirname <path-user-provided>)"

docker run -it --rm \
  --entrypoint bash \
  -v "$(pwd)/data/gogcli:/home/node/.config/gogcli" \
  -v "${SECRET_DIR}:/tmp/creds:ro" \
  -e GOG_KEYRING_PASSWORD=<KEYRING_PASSWORD> \
  nanoclaw-agent
```

If using Apple Container instead of Docker:

```bash
SECRET_DIR="$(dirname <path-user-provided>)"

container run -it --rm \
  --entrypoint bash \
  -v "$(pwd)/data/gogcli:/home/node/.config/gogcli" \
  -v "${SECRET_DIR}:/tmp/creds:ro" \
  -e GOG_KEYRING_PASSWORD=<KEYRING_PASSWORD> \
  nanoclaw-agent
```

Tell the user:

> You're now inside the container. Run these commands one by one:
>
> ```bash
> # Configure gogcli to use the file-based keyring
> gog auth keyring file
>
> # Point gogcli to your OAuth client secret
> gog auth credentials /tmp/creds/<filename-of-client_secret.json>
>
> # Start the OAuth flow — --readonly requests only read scopes (recommended)
> gog auth add you@gmail.com --manual --readonly
> ```
>
> **Tip:** `--readonly` limits the OAuth grant to read-only access across all Google services. This is the safest default — the agent can read emails, calendar, Drive, etc., but cannot send, delete, or modify anything. If you later need write access (e.g. to send emails or create calendar events), re-run `gog auth add` without `--readonly`.
>
> The last command will print a URL. Open it in your browser, sign in to Google, grant access, then paste the redirect URL (or the auth code) back into the terminal.
>
> When done, type `exit` to leave the container.

Wait for the user to complete the auth flow and exit the container.

## Step 8: Add to .env

```bash
echo "" >> .env
echo "# gogcli keyring password (decrypts OAuth token storage)" >> .env
echo "GOG_KEYRING_PASSWORD=<KEYRING_PASSWORD>" >> .env
```

Verify:

```bash
grep GOG_KEYRING_PASSWORD .env
```

## Step 9: Restart Service

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

## Step 10: Verify

Tell the user:

> gogcli is set up! Test it by sending this message in your WhatsApp/Telegram channel:
>
> `@Andy what emails did I receive today?`
>
> Or:
>
> `@Andy what's on my calendar this week?`

Watch logs for any credential errors:

```bash
tail -f logs/nanoclaw.log
```

---

## Troubleshooting

### "keyring: no keyring found" or decryption error
- Verify `GOG_KEYRING_PASSWORD` in `.env` matches what was used during `gog auth keyring file`
- Check the credentials dir was mounted: `ls data/gogcli/`

### "no accounts configured" inside container
- The auth step may not have completed — redo Step 6
- Verify files exist: `ls -la data/gogcli/`

### OAuth consent screen warning ("app not verified")
- Click **Advanced → Go to [app name] (unsafe)** — expected for personal OAuth apps

### Token refresh failures
- The credentials dir is mounted read-write so gogcli can refresh tokens automatically
- If tokens expire, redo the `gog auth add` step inside an interactive container session

### Adding a second Google account

Re-run the interactive container session (Step 6) and add another account:

```bash
gog auth add second@gmail.com --manual
```

Use `--account second@gmail.com` with any `gog` command to target it.
