import fs from 'fs';
import path from 'path';

import { Bot } from 'grammy';
import telegramifyMarkdown from 'telegramify-markdown';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface SkillCommandInfo {
  /** Directory name and frontmatter name, e.g. "perplexity-research" */
  name: string;
  /** Truncated to Telegram's 256-char limit */
  description: string;
  /** Telegram-safe command name (hyphens replaced with underscores) */
  commandName: string;
}

const SKILLS_DIR = path.resolve(process.cwd(), 'container', 'skills');
const CMD_DESC_MAX = 256;

function loadSkillCommands(skillsDir: string): SkillCommandInfo[] {
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(skillsDir)
      .filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory());
  } catch {
    return [];
  }

  const skills: SkillCommandInfo[] = [];
  for (const dir of dirs) {
    const skillPath = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(skillPath, 'utf-8');
    } catch {
      continue;
    }

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (!nameMatch || !descMatch) continue;

    const name = nameMatch[1].trim();
    const rawDesc = descMatch[1].trim();
    const description =
      rawDesc.length > CMD_DESC_MAX
        ? rawDesc.slice(0, CMD_DESC_MAX - 1) + '…'
        : rawDesc;
    const commandName = name.replace(/-/g, '_');

    skills.push({ name, description, commandName });
  }
  return skills;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;
  private skillCommands: SkillCommandInfo[] = [];

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  private async syncCommandsForChat(
    numericChatId: number,
    allowedSkills?: string[],
  ): Promise<void> {
    if (!this.bot) return;

    const skills = allowedSkills
      ? this.skillCommands.filter((s) => allowedSkills.includes(s.name))
      : this.skillCommands;

    const commands = [
      { command: 'help', description: 'Show available commands and skills' },
      {
        command: 'clear',
        description: 'Clear conversation context and start fresh',
      },
      ...skills.map((s) => ({
        command: s.commandName,
        description: s.description,
      })),
    ];

    try {
      await this.bot.api.setMyCommands(commands, {
        scope: { type: 'chat', chat_id: numericChatId },
      });
      logger.info(
        { numericChatId, commandCount: commands.length },
        'Synced Telegram commands for chat',
      );
    } catch (err) {
      logger.warn(
        { numericChatId, err },
        'Failed to sync Telegram commands for chat',
      );
    }
  }

  async syncAllGroupCommands(): Promise<void> {
    if (!this.bot) return;

    const groups = this.opts.registeredGroups();
    for (const [jid, group] of Object.entries(groups)) {
      if (!jid.startsWith('tg:')) continue;
      const numericId = parseInt(jid.replace(/^tg:/, ''), 10);
      if (isNaN(numericId)) continue;
      await this.syncCommandsForChat(numericId, group.containerConfig?.skills);
    }
  }

  async connect(): Promise<void> {
    this.skillCommands = loadSkillCommands(SKILLS_DIR);
    logger.info(
      { count: this.skillCommands.length },
      'Loaded Telegram skill commands',
    );

    this.bot = new Bot(this.botToken);

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.on('message:text', async (ctx) => {
      let content = ctx.message.text;
      const chatJid = `tg:${ctx.chat.id}`;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      if (content.startsWith('/')) {
        const match = content.match(/^\/(\w+)(?:@\w+)?(?:\s([\s\S]*))?$/);
        if (!match) return;

        const cmdName = match[1].toLowerCase();
        const cmdArgs = match[2]?.trim() || '';

        // Already handled by bot.command() above — avoid double processing
        if (cmdName === 'chatid' || cmdName === 'ping') return;

        if (cmdName === 'help') {
          const group = this.opts.registeredGroups()[chatJid];
          const allowedSkills = group?.containerConfig?.skills;
          const visibleSkills = allowedSkills
            ? this.skillCommands.filter((s) => allowedSkills.includes(s.name))
            : this.skillCommands;

          const lines: string[] = [];
          if (visibleSkills.length > 0) {
            lines.push('*Skills:*');
            for (const s of visibleSkills) {
              lines.push(`/${s.commandName} — ${s.description}`);
            }
            lines.push('');
          }
          lines.push('*Built-in:*');
          lines.push('/clear — Clear conversation context and start fresh');
          lines.push('/chatid — Show this chat\u2019s registration ID');
          lines.push('/ping — Check if bot is online');

          await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
          return;
        }

        if (cmdName === 'clear') {
          // Let the existing clear detection in processGroupMessages handle it
          content = '/clear';
        } else {
          const skill = this.skillCommands.find(
            (s) => s.commandName === cmdName,
          );
          if (!skill) return;
          // Prepend trigger so TRIGGER_PATTERN matches and the agent sees the skill name.
          // Use cmdName (underscore form) — the agent receives the raw command text.
          content = `@${ASSISTANT_NAME} /${cmdName}${cmdArgs ? ' ' + cmdArgs : ''}`;
        }
      } else {
        // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
        // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
        // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
        const botUsername = ctx.me?.username?.toLowerCase();
        if (botUsername) {
          const entities = ctx.message.entities || [];
          const isBotMentioned = entities.some((entity) => {
            if (entity.type === 'mention') {
              const mentionText = content
                .substring(entity.offset, entity.offset + entity.length)
                .toLowerCase();
              return mentionText === `@${botUsername}`;
            }
            return false;
          });
          if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Store chat metadata for discovery
      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders so the agent knows something was sent
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[Photo]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, '[Voice message]'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — resolves once the bot is connected and startup command
    // sync completes, so callers can be confident commands are registered.
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: async (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          await this.syncAllGroupCommands();
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');

      // Telegram has a 4096 character limit per message — split if needed
      const formatted = telegramifyMarkdown(text, 'escape');

      // Telegram has a 4096 character limit per message — split if needed
      const MAX_LENGTH = 4096;
      if (formatted.length <= MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, formatted, {
          parse_mode: 'MarkdownV2',
        });
      } else {
        for (let i = 0; i < formatted.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(
            numericId,
            formatted.slice(i, i + MAX_LENGTH),
            { parse_mode: 'MarkdownV2' },
          );
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}

registerChannel('telegram', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN']);
  const token =
    process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Telegram: TELEGRAM_BOT_TOKEN not set');
    return null;
  }
  return new TelegramChannel(token, opts);
});
