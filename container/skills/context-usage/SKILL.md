---
name: context-usage
description: Check current context window usage as a percentage of the 200k token limit. Use when the user asks about remaining context, memory, or how much longer this conversation can continue.
---

# Context Window Usage

Reports how full the current context window is, based on token counts from the session transcript.

```bash
node -e "
const fs = require('fs'), os = require('os');
const dir = os.homedir() + '/.claude/projects/-workspace-group';
try {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  if (!files.length) { console.log('0% (no session found)'); process.exit(0); }
  const latest = files
    .map(f => ({ f, mt: fs.statSync(dir + '/' + f).mtimeMs }))
    .sort((a, b) => b.mt - a.mt)[0].f;
  const lines = fs.readFileSync(dir + '/' + latest, 'utf8').split('\n').filter(Boolean);
  let best = null, bestTs = -Infinity;
  for (const line of lines.slice(-50)) {
    try {
      const j = JSON.parse(line);
      const ts = new Date(j.timestamp).getTime();
      const usage = j.message?.usage;
      if (ts > bestTs && usage && j.message?.role === 'assistant') { bestTs = ts; best = usage; }
    } catch {}
  }
  if (!best) { console.log('No usage data'); process.exit(0); }
  const input    = best.input_tokens || 0;
  const output   = best.output_tokens || 0;
  const cacheR   = best.cache_read_input_tokens || 0;
  const cacheW   = best.cache_creation_input_tokens || 0;
  const total    = input + output + cacheR + cacheW;
  const pct      = Math.min(100, total * 100 / 200000);
  const pctLabel = pct >= 90 ? pct.toFixed(1) : Math.round(pct);
  console.log('Input:         ' + input.toLocaleString());
  console.log('Output:        ' + output.toLocaleString());
  console.log('Cache read:    ' + cacheR.toLocaleString());
  console.log('Cache write:   ' + cacheW.toLocaleString());
  console.log('Total:         ' + total.toLocaleString() + ' / 200,000 (' + pctLabel + '%)');
  if (pct >= 90) console.log('Critical: context almost full. Use /compact or start a new conversation.');
  else if (pct >= 75) console.log('Warning: context getting full. Consider /compact soon.');
} catch (e) { console.log('Error reading transcript: ' + e.message); }
"
```

Report the result to the user. If above 75%, mention that `/compact` can free up context without losing the conversation.
