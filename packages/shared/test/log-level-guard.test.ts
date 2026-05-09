import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertLogLevelSafe } from '../src/observability/log-level-guard';

describe('assertLogLevelSafe', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
  });
  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    process.env.LOG_LEVEL = origLogLevel;
  });

  it('no-op when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'debug';
    expect(() => assertLogLevelSafe()).not.toThrow();
  });

  it('no-op when NODE_ENV=production and LOG_LEVEL is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertLogLevelSafe()).not.toThrow();
  });

  it('no-op when NODE_ENV=production and LOG_LEVEL=info', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'info';
    expect(() => assertLogLevelSafe()).not.toThrow();
  });

  it('no-op when NODE_ENV=production and LOG_LEVEL=warn / error', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';
    expect(() => assertLogLevelSafe()).not.toThrow();
    process.env.LOG_LEVEL = 'error';
    expect(() => assertLogLevelSafe()).not.toThrow();
  });

  it.each(['debug', 'trace', 'silly', 'DEBUG', '  Debug  '])(
    'throws on disallowed log level %s in production',
    (lvl) => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = lvl;
      expect(() => assertLogLevelSafe()).toThrow(/not permitted in production/);
    },
  );
});
