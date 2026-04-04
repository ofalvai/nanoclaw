import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

// Bind to loopback only — external traffic must be explicitly opted into via WEBHOOK_HOST
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_RATE_LIMIT = 60; // requests per minute
const MAX_BODY_SIZE = 1_000_000; // 1MB

// Sliding window rate limiter — counts all requests in the last windowMs regardless of source.
// For a local-only server this is equivalent to per-caller limiting since all callers share one IP.
class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(maxRequests: number, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  allow(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) return false;
    this.timestamps.push(now);
    return true;
  }

  get windowCount(): number {
    const now = Date.now();
    return this.timestamps.filter((t) => now - t < this.windowMs).length;
  }
}

export class WebhookChannel implements Channel {
  name = 'webhook';

  private server: http.Server | null = null;
  private readonly port: number;
  private readonly host: string;
  // null = no auth required. Set WEBHOOK_TOKEN in .env to enforce bearer token validation.
  private readonly token: string | null;
  private readonly rateLimiter: RateLimiter;
  // Folder names of groups that may be targeted via the "group" payload field.
  // Requests targeting unlisted groups are rejected with 403.
  private readonly allowedGroups: string[];
  private readonly opts: {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, RegisteredGroup>;
    registerGroup?: (jid: string, group: RegisteredGroup) => void;
  };
  private siblingChannels: Channel[] = [];

  constructor(
    port: number,
    host: string,
    token: string | null,
    rateLimitPerMinute: number,
    allowedGroups: string[],
    opts: {
      onMessage: OnInboundMessage;
      onChatMetadata: OnChatMetadata;
      registeredGroups: () => Record<string, RegisteredGroup>;
      registerGroup?: (jid: string, group: RegisteredGroup) => void;
    },
  ) {
    this.port = port;
    this.host = host;
    this.token = token;
    this.rateLimiter = new RateLimiter(rateLimitPerMinute);
    this.allowedGroups = allowedGroups;
    this.opts = opts;
  }

  /** Called by index.ts after all channels connect, needed for relay notifications. */
  setSiblingChannels(channels: Channel[]): void {
    this.siblingChannels = channels;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        const authNote = this.token
          ? ' (token auth enabled)'
          : ' (no token auth)';
        logger.info(
          {
            host: this.host,
            port: this.port,
            allowedGroups: this.allowedGroups,
          },
          `Webhook server listening${authNote}`,
        );
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      this.handleInbound(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private handleInbound(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const start = Date.now();

    if (!this.rateLimiter.allow()) {
      logger.warn(
        { count: this.rateLimiter.windowCount },
        'Webhook rate limit exceeded',
      );
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    // Token validation — only enforced when WEBHOOK_TOKEN is configured.
    if (this.token !== null) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${this.token}`) {
        logger.warn('Webhook: unauthorized request (invalid or missing token)');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(body);
      } catch {
        logger.warn('Webhook: request body is not valid JSON');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const message = typeof data.message === 'string' ? data.message : null;
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: message' }));
        return;
      }

      const groupFolder = typeof data.group === 'string' ? data.group : null;
      if (!groupFolder) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: group' }));
        return;
      }

      if (!this.allowedGroups.includes(groupFolder)) {
        logger.warn(
          { group: groupFolder },
          'Webhook: request targeting disallowed group',
        );
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Group not allowed' }));
        return;
      }

      const registeredGroups = this.opts.registeredGroups();
      const targetJid = Object.entries(registeredGroups).find(
        ([, g]) => g.folder === groupFolder,
      )?.[0];

      if (!targetJid) {
        // Group is in the allowlist but not yet registered in NanoClaw (e.g. channel not connected)
        logger.warn(
          { group: groupFolder },
          'Webhook: target group not registered',
        );
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Group not registered' }));
        return;
      }

      const senderName =
        typeof data.sender === 'string' && data.sender
          ? data.sender
          : 'webhook';
      const timestamp = new Date().toISOString();
      const msgId = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      this.opts.onChatMetadata(
        targetJid,
        timestamp,
        'Webhook',
        'webhook',
        false,
      );
      this.opts.onMessage(targetJid, {
        id: msgId,
        chat_jid: targetJid,
        sender: 'webhook',
        sender_name: senderName,
        content: message,
        timestamp,
        is_from_me: false,
      });

      this.relayIncoming(targetJid, senderName, message);

      logger.info(
        {
          id: msgId,
          group: groupFolder,
          sender: senderName,
          message,
          ms: Date.now() - start,
        },
        'Webhook message accepted',
      );
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: msgId }));
    });
  }

  private relayIncoming(
    targetJid: string,
    sender: string,
    message: string,
  ): void {
    const target = this.siblingChannels.find((ch) => ch.ownsJid(targetJid));
    if (!target) {
      logger.warn(
        { targetJid },
        'Webhook: no channel owns target JID for relay',
      );
      return;
    }
    target
      .sendMessage(targetJid, `Message from: ${sender}\n${message}`)
      .catch((err) =>
        logger.error({ err }, 'Webhook: failed to relay incoming message'),
      );
  }

  // Webhook never owns outbound delivery — agent responses go through the target group's channel.
  async sendMessage(_jid: string, _text: string): Promise<void> {
    logger.warn('Webhook channel sendMessage called unexpectedly');
  }

  isConnected(): boolean {
    return this.server !== null && this.server.listening;
  }

  ownsJid(_jid: string): boolean {
    return false;
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
      logger.info('Webhook server stopped');
    }
  }
}

registerChannel('webhook', (opts: ChannelOpts) => {
  const env = readEnvFile([
    'WEBHOOK_PORT',
    'WEBHOOK_HOST',
    'WEBHOOK_TOKEN',
    'WEBHOOK_RATE_LIMIT_PER_MINUTE',
    'WEBHOOK_ALLOWED_GROUPS',
  ]);

  const portStr = process.env.WEBHOOK_PORT || env.WEBHOOK_PORT;
  if (!portStr) return null;

  const allowedGroups = (
    process.env.WEBHOOK_ALLOWED_GROUPS ||
    env.WEBHOOK_ALLOWED_GROUPS ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedGroups.length === 0) {
    logger.warn('Webhook: WEBHOOK_ALLOWED_GROUPS not set — skipping');
    return null;
  }

  const port = parseInt(portStr, 10);
  const host = process.env.WEBHOOK_HOST || env.WEBHOOK_HOST || DEFAULT_HOST;
  const token = process.env.WEBHOOK_TOKEN || env.WEBHOOK_TOKEN || null;
  const rateLimitPerMinute = parseInt(
    process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE ||
      env.WEBHOOK_RATE_LIMIT_PER_MINUTE ||
      String(DEFAULT_RATE_LIMIT),
    10,
  );

  return new WebhookChannel(
    port,
    host,
    token,
    rateLimitPerMinute,
    allowedGroups,
    opts,
  );
});
