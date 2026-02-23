---
name: nanoclaw-news
description: Generate an activity report for the NanoClaw GitHub repository covering the last 24 hours.
---

## Purpose
Generate an activity report for the [NanoClaw GitHub repository](https://github.com/qwibitai/nanoclaw) covering the last 24 hours, including commits, issues, and pull requests.

## How to Use

`$GH_TOKEN` is available in your environment, so prefix any `gh` CLI calls with that to avoid auth issues.

When the user asks for a repository activity report, follow these steps:

### 1. Fetch Recent Commits

Use the `gh` CLI to fetch recent commits from the repo.

### 2. Fetch Recent Issues

Use the `gh` CLI to fetch recent issues from the repo.

### 3. Fetch Recent Pull Requests

Use the `gh` CLI to fetch recent pull requests from the repo that were opened or updated in the last 24 hours.

## Report Contents

When mentioning issues/PRs, wrap the issue/PR number in a hyperlink.

Things the user is NOT interested in (not exhaustive, use judgment):

- Messaging channels other than Telegram
- Windows-specific changes or issues

## Tips

- Execute the fetch commands in parallel to save time
- Group related issues/PRs by theme in the "Relevant" section
- Include context about what the changes mean (stability, features, bugs, etc.)
