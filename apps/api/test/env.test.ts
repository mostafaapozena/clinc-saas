import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const base = { MONGODB_URI: 'mongodb://localhost:27017' };

describe('parseEnv', () => {
  it('applies defaults and coerces values', () => {
    const env = parseEnv({ ...base, PORT: '4500', SESSION_COOKIE_SECURE: 'true', APP_ORIGINS: 'https://a.example, https://b.example:8443' });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4500,
      LOG_LEVEL: 'info',
      SESSION_TTL_HOURS: 168,
      SESSION_COOKIE_SECURE: true,
      TRUST_PROXY: false,
      APP_ORIGINS: ['https://a.example', 'https://b.example:8443'],
      AUTH_RATE_LIMIT_MAX: 10,
      AUTH_RATE_LIMIT_WINDOW_MINUTES: 15,
    });
    expect(env.MONGODB_DB_NAME).toBeUndefined();
  });

  it('requires a MongoDB connection string', () => {
    expect(() => parseEnv({})).toThrow(/MONGODB_URI/);
  });

  it('rejects non-MongoDB URIs and invalid database names', () => {
    expect(() => parseEnv({ MONGODB_URI: 'postgres://localhost/db' })).toThrow(/MONGODB_URI/);
    expect(() => parseEnv({ ...base, MONGODB_DB_NAME: 'bad name' })).toThrow(/MONGODB_DB_NAME/);
  });

  it('rejects an out-of-range port and malformed origins', () => {
    expect(() => parseEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, APP_ORIGINS: 'https://ok.example/path' })).toThrow(/APP_ORIGINS/);
  });

  it('refuses insecure session cookies in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SESSION_COOKIE_SECURE/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' }).NODE_ENV).toBe('production');
  });
});
