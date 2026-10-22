import {
  envFallback,
  invalidateSodCache,
  registerSodLoader,
  sodEnforced,
} from './sod.util';

/**
 * ທົດສອບລຳດັບຄວາມສຳຄັນຂອງ SoD:
 * settings (ຖ້າຕັ້ງ) → env SOD_ENFORCE → NODE_ENV=production
 * ຄ່າ "ບໍ່ໄດ້ຕັ້ງ" ຕ້ອງເປັນ undefined ເພື່ອໃຫ້ env fallback ເຮັດວຽກໄດ້
 */
describe('sod.util', () => {
  const envKeys = ['SOD_ENFORCE', 'NODE_ENV'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
    invalidateSodCache();
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    invalidateSodCache();
  });

  it('falls back to env SOD_ENFORCE when settings are not configured', async () => {
    process.env.SOD_ENFORCE = 'false';
    registerSodLoader(() => Promise.resolve(undefined));
    invalidateSodCache();
    expect(await sodEnforced()).toBe(false);
  });

  it('enforces when env SOD_ENFORCE=true and settings are not configured', async () => {
    process.env.SOD_ENFORCE = 'true';
    registerSodLoader(() => Promise.resolve(undefined));
    invalidateSodCache();
    expect(await sodEnforced()).toBe(true);
  });

  it('uses the configured settings value over the env', async () => {
    process.env.SOD_ENFORCE = 'true';
    registerSodLoader(() => Promise.resolve(false));
    invalidateSodCache();
    expect(await sodEnforced()).toBe(false);
  });

  it('fails closed when the settings loader throws', async () => {
    registerSodLoader(() => Promise.reject(new Error('db down')));
    invalidateSodCache();
    expect(await sodEnforced()).toBe(true);
  });

  it('defaults to enforcing only in production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SOD_ENFORCE;
    expect(envFallback()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(envFallback()).toBe(true);
  });
});
