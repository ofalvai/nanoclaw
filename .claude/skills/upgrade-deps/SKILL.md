---
name: upgrade-deps
description: Audit and upgrade npm dependencies to their latest major versions, one at a time. Use this skill when the user asks to update, upgrade, or bump dependencies, check for outdated packages, or do dependency maintenance on a Node.js project.
---

# Dependency Upgrade

Systematically upgrades npm dependencies to their latest major versions, researching breaking changes before each upgrade and verifying the build stays clean after each step.

## Setup: npm cache workaround

On macOS, the npm cache can have root-owned files that cause EPERM errors. Work around it throughout this session by passing `--cache "$TMPDIR/npm-fresh-cache"` to all npm commands. If `npm outdated` itself fails with EPERM, run:

```bash
sudo chown -R $(id -u):$(id -g) "$HOME/.npm"
```

with `dangerouslyDisableSandbox: true`. Then retry.

## Step 1: Identify outdated packages

```bash
npm outdated --cache "$TMPDIR/npm-fresh-cache"
```

From the output, separate packages into two buckets:
- **Major version behind** (e.g. installed v9, latest v10) — needs research before upgrading
- **Minor/patch behind** — can be upgraded in a batch at the end without research

## Step 2: Research breaking changes (major versions only)

For each package with a major version gap, search for its changelog or migration guide and summarize the breaking changes before touching anything. Focus on:
- API removals or renames that would cause TypeScript errors
- Changed defaults that affect existing config
- Dropped Node.js version support (confirm we're still in range)

Some packages increment major versions for Node.js support drops only, with no API changes — those are safe to upgrade without code changes.

**`@types/node` is a special case**: its major version tracks Node.js major versions, not npm releases. Keep it aligned with the Node.js version actually in use (`node --version`), not the absolute latest `@types/node`.

## Step 3: Upgrade in logical groups

Upgrade one package (or one logical group) at a time, then verify before moving on. Natural groupings:

- `pino` + `pino-pretty` — always move together
- `eslint` + `@eslint/js` + `globals` + `typescript-eslint` — move together (tightly coupled)
- `better-sqlite3` + `@types/better-sqlite3` — move together

```bash
npm install --cache "$TMPDIR/npm-fresh-cache" <package>@latest [<package2>@latest ...]
```

For devDependencies, add `--save-dev`.

### After each upgrade, verify:

```bash
npm run typecheck && npm run build
```

If typecheck or build fails, diagnose and fix before proceeding to the next package. Do not batch upgrades across groups hoping the errors will sort themselves out.

If the project has a lint script, also run `npm run lint` after the last upgrade — lint warnings from pre-existing issues are not blockers, but new errors introduced by the upgrade are.

## Step 4: Upgrade minor/patch stragglers

Once all major version upgrades are done and verified, upgrade the remaining minor/patch-behind packages together:

```bash
npm install --cache "$TMPDIR/npm-fresh-cache" <pkg1>@latest <pkg2>@latest ...
```

Verify again with typecheck + build.

## Step 5: Final check

```bash
npm outdated --cache "$TMPDIR/npm-fresh-cache"
```

Report what was upgraded, what remains intentionally pinned or skipped (and why), and any peer dependency warnings that were noted but are not causing actual errors.

## Common situations

**Peer dep warnings after upgrade**: tools like `typescript-eslint` sometimes declare a peer dep ceiling like `typescript@"<6.0.0"` that hasn't caught up with a new major release. If typecheck passes cleanly despite the warning, the upgrade is fine — note it in the summary.

**ESLint major upgrade**: ESLint v10+ requires flat config (`eslint.config.js`). Before upgrading eslint to v10+, confirm the project is already using flat config, not `.eslintrc.*`. If it's still on the legacy format, flag this to the user rather than silently upgrading.

**No fix available in `npm audit`**: some vulnerabilities in devDependencies (vitest, eslint toolchain) have no patch — these are acceptable risks since they only run in development, not in production. Highlight them in the summary but don't block the upgrade.
