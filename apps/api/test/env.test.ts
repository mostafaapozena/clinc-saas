import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults and coerces the port', () => {
    const env = parseEnv({ MONGODB_URI: 'mongodb://localhost:27017', PORT: '4500' });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4500,
      LOG_LEVEL: 'info',
      MONGODB_URI: 'mongodb://localhost:27017',
    });
    expect(env.MONGODB_DB_NAME).toBeUndefined();
  });

  it('requires a MongoDB connection string', () => {
    expect(() => parseEnv({})).toThrow(/MONGODB_URI/);
  });

  it('rejects non-MongoDB URIs and invalid database names', () => {
    expect(() => parseEnv({ MONGODB_URI: 'postgres://localhost/db' })).toThrow(/MONGODB_URI/);
    expect(() =>
      parseEnv({ MONGODB_URI: 'mongodb://localhost', MONGODB_DB_NAME: 'bad name' }),
    ).toThrow(/MONGODB_DB_NAME/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ MONGODB_URI: 'mongodb://localhost', PORT: '70000' })).toThrow(/PORT/);
  });
});
