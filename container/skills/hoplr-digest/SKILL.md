---
name: hoplr-digest
description: Read and summarize Hoplr neighborhood emails, filtering for user's preferences.
---
# Hoplr Digest

Read and summarize Hoplr neighborhood emails, filtering for the user's preferences.

## Purpose

Hoplr sends digest emails with a mix of:
- **General messages** - community announcements, local news, civic information
- **Listings/giveaways** - free items, marketplace
- **Help requests** - looking for items, services
- **Lost & found** - animals, objects

This skill extracts only the important **citizen-relevant messages** (general announcements, civic info, neighborhood news) while filtering out marketplace noise.

## What Gets Filtered

**INCLUDED (not exhaustive):**
- Stolpersteine (memorial stones)
- New businesses (huisarts/GP, shops)
- VvE/homeowners association topics
- Municipality/government announcements
- Safety/security issues (thefts, warnings)
- Infrastructure/construction notices
- Neighborhood events (not marketplace)
- Wildlife/nature observations (falcons, etc.)

**EXCLUDED (not relevant):**
- Giveaways and free items
- Marketplace listings (furniture, clothes, etc.)
- Help requests ("gezocht", "looking for")
- Lost pets or objects
- Items for sale

## Workflow

### 1. Search for Hoplr emails

```bash
# Get date from N days ago
date -d '7 days ago' '+%Y/%m/%d'

# Search Gmail for Hoplr emails
gog -a ofalvai@gmail.com gmail search 'from:hoplr newer_than:7d' --json
```

This returns thread IDs and subjects.

### 2. Fetch email content

For each email with "messages" in the subject (not just "listings"):

```bash
gog -a ofalvai@gmail.com gmail get <thread-id>
```

The output is HTML-heavy. The structure is:
- Header section
- **"X general messages"** section ← THIS IS WHAT WE WANT
- "X giveaways or listings" section ← Skip this

### 3. Extract relevant content

Look for the HTML section with "general message" or specific keywords. The important messages appear early in the email HTML, structured as:

```html
<tr>
    <td>
        <a href="...">
            <span><b>Stolpersteine Weimarstraat</b></span>
        </a>
    </td>
</tr>
<tr>
    <td>
        <div class="post-body">
            <strong>Marko</strong>
            <div><p>Ter info, uit de wijkkrant de Konkreet</p></div>
        </div>
    </td>
</tr>
```

### 4. Extract message details

For each relevant message, capture:
- **Title** (in `<b>` tags)
- **Author** (in `<strong>` tags)
- **Content** (in `<div class="post-body">`)

### 6. Present results

Format as:
- Date of email
- Message title
- Author name
- Content excerpt
- Categorization (security, civic, new business, etc.)

Language: English, even though the original content is in Dutch. Sprinkle a few Dutch terms for language learning fun.

## Tips

- The email HTML is very large (200-300KB). Use `head` and `tail` to navigate sections
- "General messages" appear BEFORE "giveaways or listings" in the HTML
- Use `head -c 20000 | tail -c 10000` to extract specific byte ranges
- Look for the pattern: `<span>X general message</span>` to find the relevant section
- The first few messages after this header are the citizen-relevant ones
