import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../env.js', () => ({
  readEnvFile: () => ({}),
}));

import { WebhookChannel } from './webhook.js';
import { logger } from '../logger.js';

const TEST_PORT = 13200;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const REGISTERED_GROUPS = {
  'tg:111': { name: 'Main', folder: 'main', trigger: '@Claw', added_at: '' },
  'tg:222': {
    name: 'Family',
    folder: 'family',
    trigger: '@Claw',
    added_at: '',
  },
};

let channel: WebhookChannel | null = null;

afterEach(async () => {
  if (channel?.isConnected()) await channel.disconnect();
  channel = null;
  vi.clearAllMocks();
});

function makeOpts(overrides?: {
  registeredGroups?: () => Record<string, any>;
}) {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups:
      overrides?.registeredGroups ?? vi.fn(() => REGISTERED_GROUPS),
  };
}

function makeChannel(overrides?: {
  token?: string | null;
  rateLimitPerMinute?: number;
  allowedGroups?: string[];
  opts?: ReturnType<typeof makeOpts>;
}): WebhookChannel {
  return new WebhookChannel(
    TEST_PORT,
    '127.0.0.1',
    overrides?.token ?? null,
    overrides?.rateLimitPerMinute ?? 100,
    overrides?.allowedGroups ?? ['main', 'family'],
    overrides?.opts ?? makeOpts(),
  );
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function get(path: string) {
  return fetch(`${BASE_URL}${path}`);
}

// --- Connection lifecycle ---

describe('connection lifecycle', () => {
  it('starts disconnected', () => {
    channel = makeChannel();
    expect(channel.isConnected()).toBe(false);
  });

  it('is connected after connect()', async () => {
    channel = makeChannel();
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
  });

  it('is disconnected after disconnect()', async () => {
    channel = makeChannel();
    await channel.connect();
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('logs allowed groups on connect', async () => {
    channel = makeChannel({ allowedGroups: ['main', 'family'] });
    await channel.connect();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ allowedGroups: ['main', 'family'] }),
      expect.any(String),
    );
  });
});

// --- Health check ---

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

// --- Message ingestion ---

describe('POST /webhook', () => {
  it('returns 202 with an id for a valid message', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await post('/webhook', {
      message: 'hello',
      sender: 'ci',
      group: 'main',
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^wh-/);
  });

  it('routes to the correct group JID', async () => {
    const opts = makeOpts();
    channel = makeChannel({ opts });
    await channel.connect();

    await post('/webhook', {
      message: 'ping',
      sender: 'monitor',
      group: 'family',
    });

    expect(opts.onMessage).toHaveBeenCalledWith(
      'tg:222',
      expect.objectContaining({
        chat_jid: 'tg:222',
        content: 'ping',
        sender_name: 'monitor',
      }),
    );
  });

  it('calls onChatMetadata with the target JID', async () => {
    const opts = makeOpts();
    channel = makeChannel({ opts });
    await channel.connect();

    await post('/webhook', { message: 'hello', group: 'main' });

    expect(opts.onChatMetadata).toHaveBeenCalledWith(
      'tg:111',
      expect.any(String),
      'Webhook',
      'webhook',
      false,
    );
  });

  it('defaults sender_name to "webhook" when sender field absent', async () => {
    const opts = makeOpts();
    channel = makeChannel({ opts });
    await channel.connect();

    await post('/webhook', { message: 'hello', group: 'main' });

    expect(opts.onMessage).toHaveBeenCalledWith(
      'tg:111',
      expect.objectContaining({ sender_name: 'webhook' }),
    );
  });

  it('returns 400 when message field is missing', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await post('/webhook', { group: 'main' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/message/);
  });

  it('returns 400 when group field is missing', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await post('/webhook', { message: 'hello' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/group/);
  });

  it('returns 403 when group is not in the allowlist', async () => {
    channel = makeChannel({ allowedGroups: ['main'] });
    await channel.connect();
    const res = await post('/webhook', { message: 'hello', group: 'family' });
    expect(res.status).toBe(403);
  });

  it('returns 422 when group is allowed but not registered', async () => {
    const opts = makeOpts({ registeredGroups: () => ({}) }); // empty — no groups registered
    channel = makeChannel({ opts });
    await channel.connect();
    const res = await post('/webhook', { message: 'hello', group: 'main' });
    expect(res.status).toBe(422);
  });

  it('returns 400 for invalid JSON', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown paths', async () => {
    channel = makeChannel();
    await channel.connect();
    const res = await post('/unknown', {});
    expect(res.status).toBe(404);
  });
});

// --- Token auth ---

describe('token auth', () => {
  it('accepts request with correct bearer token', async () => {
    channel = makeChannel({ token: 'secret123' });
    await channel.connect();
    const res = await post(
      '/webhook',
      { message: 'hello', group: 'main' },
      { Authorization: 'Bearer secret123' },
    );
    expect(res.status).toBe(202);
  });

  it('rejects request with wrong token', async () => {
    channel = makeChannel({ token: 'secret123' });
    await channel.connect();
    const res = await post(
      '/webhook',
      { message: 'hello', group: 'main' },
      { Authorization: 'Bearer wrongtoken' },
    );
    expect(res.status).toBe(401);
  });

  it('rejects request with missing Authorization header', async () => {
    channel = makeChannel({ token: 'secret123' });
    await channel.connect();
    const res = await post('/webhook', { message: 'hello', group: 'main' });
    expect(res.status).toBe(401);
  });

  it('rejects request with non-Bearer scheme', async () => {
    channel = makeChannel({ token: 'secret123' });
    await channel.connect();
    const res = await post(
      '/webhook',
      { message: 'hello', group: 'main' },
      { Authorization: 'Basic secret123' },
    );
    expect(res.status).toBe(401);
  });

  it('accepts requests without Authorization header when no token configured', async () => {
    channel = makeChannel({ token: null });
    await channel.connect();
    const res = await post('/webhook', { message: 'hello', group: 'main' });
    expect(res.status).toBe(202);
  });
});

// --- Rate limiting ---

describe('rate limiting', () => {
  it('returns 429 after exceeding the limit', async () => {
    channel = makeChannel({ rateLimitPerMinute: 2 });
    await channel.connect();

    await post('/webhook', { message: 'one', group: 'main' });
    await post('/webhook', { message: 'two', group: 'main' });
    const res = await post('/webhook', { message: 'three', group: 'main' });

    expect(res.status).toBe(429);
  });

  it('logs a warning when rate limit is exceeded', async () => {
    channel = makeChannel({ rateLimitPerMinute: 1 });
    await channel.connect();

    await post('/webhook', { message: 'ok', group: 'main' });
    await post('/webhook', { message: 'over', group: 'main' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: expect.any(Number) }),
      'Webhook rate limit exceeded',
    );
  });

  it('accepts requests up to the limit', async () => {
    channel = makeChannel({ rateLimitPerMinute: 3 });
    await channel.connect();

    const results = [];
    for (const msg of ['one', 'two', 'three']) {
      results.push(await post('/webhook', { message: msg, group: 'main' }));
    }
    expect(results.every((r) => r.status === 202)).toBe(true);
  });
});

// --- Relay notification ---

describe('relay notification', () => {
  it('relays incoming message to the target group channel', async () => {
    const opts = makeOpts();
    channel = makeChannel({ opts });
    await channel.connect();

    const sibling = {
      name: 'telegram',
      ownsJid: (jid: string) => jid.startsWith('tg:'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn(() => true),
    };
    channel.setSiblingChannels([sibling as any]);

    await post('/webhook', {
      message: 'disk at 90%',
      sender: 'monitor',
      group: 'main',
    });

    expect(sibling.sendMessage).toHaveBeenCalledWith(
      'tg:111',
      'Message from: monitor\ndisk at 90%',
    );
  });

  it('logs a warning when no sibling owns the target JID', async () => {
    channel = makeChannel();
    await channel.connect();
    channel.setSiblingChannels([]);

    await post('/webhook', { message: 'hello', group: 'main' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ targetJid: 'tg:111' }),
      'Webhook: no channel owns target JID for relay',
    );
  });
});

// --- ownsJid ---

describe('ownsJid', () => {
  it('never owns any JID (delivery handled by target channel)', () => {
    channel = makeChannel();
    expect(channel.ownsJid('tg:111')).toBe(false);
    expect(channel.ownsJid('webhook:default')).toBe(false);
    expect(channel.ownsJid('12345@g.us')).toBe(false);
  });
});

// --- channel properties ---

describe('channel properties', () => {
  it('has name "webhook"', () => {
    channel = makeChannel();
    expect(channel.name).toBe('webhook');
  });
});
