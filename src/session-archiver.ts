/**
 * Archives a Claude SDK session transcript to the group's conversations/ folder.
 * Mirrors the pre-compact hook logic in the agent-runner, but runs on the host
 * so it can be triggered by the clear command without needing a live container.
 */
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// The SDK encodes the container's cwd (/workspace/group) into the projects
// directory name by replacing slashes with dashes and dropping the leading slash.
const PROJECTS_DIR_NAME = '-workspace-group';

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionEntry {
  sessionId: string;
  summary: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text =
          typeof entry.message.content === 'string'
            ? entry.message.content
            : entry.message.content
                .map((c: { text?: string }) => c.text || '')
                .join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const text = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return messages;
}

function getSessionSummary(
  sessionId: string,
  projectsDir: string,
): string | null {
  const indexPath = path.join(projectsDir, 'sessions-index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const index: SessionsIndex = JSON.parse(
      fs.readFileSync(indexPath, 'utf-8'),
    );
    return (
      index.entries.find((e) => e.sessionId === sessionId)?.summary ?? null
    );
  } catch {
    return null;
  }
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function formatMarkdown(
  messages: ParsedMessage[],
  title: string | null,
): string {
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lines: string[] = [
    `# ${title || 'Conversation'}`,
    '',
    `Archived: ${dateStr}`,
    '',
    '---',
    '',
  ];

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : ASSISTANT_NAME;
    const content =
      msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...'
        : msg.content;
    lines.push(`**${sender}**: ${content}`, '');
  }

  return lines.join('\n');
}

/**
 * Archive the transcript for a session to the group's conversations/ folder.
 * Silently skips if the transcript doesn't exist (e.g. session never ran).
 */
export function archiveSession(groupFolder: string, sessionId: string): void {
  const projectsDir = path.join(
    DATA_DIR,
    'sessions',
    groupFolder,
    '.claude',
    'projects',
    PROJECTS_DIR_NAME,
  );
  const transcriptPath = path.join(projectsDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(transcriptPath)) {
    logger.debug(
      { groupFolder, sessionId },
      'No transcript found, skipping archive',
    );
    return;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const messages = parseTranscript(content);
    if (messages.length === 0) {
      logger.debug(
        { groupFolder, sessionId },
        'Empty transcript, skipping archive',
      );
      return;
    }

    const summary = getSessionSummary(sessionId, projectsDir);
    const filename = summary
      ? `${new Date().toISOString().split('T')[0]}-${sanitizeFilename(summary)}.md`
      : `${new Date().toISOString().split('T')[0]}-conversation-${sessionId.slice(0, 8)}.md`;

    const conversationsDir = path.join(
      GROUPS_DIR,
      groupFolder,
      'conversations',
    );
    fs.mkdirSync(conversationsDir, { recursive: true });

    const outPath = path.join(conversationsDir, filename);
    fs.writeFileSync(outPath, formatMarkdown(messages, summary));
    logger.info(
      { groupFolder, sessionId, outPath },
      'Session archived before clear',
    );
  } catch (err) {
    // Non-fatal — archive failure shouldn't block the clear
    logger.warn(
      { groupFolder, sessionId, err },
      'Failed to archive session transcript',
    );
  }
}
