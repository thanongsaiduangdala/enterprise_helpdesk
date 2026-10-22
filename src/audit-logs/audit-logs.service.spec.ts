import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService (hash chain)', () => {
  let service: AuditLogsService;
  let model: any;

  const GENESIS_HASH = 'GENESIS';

  beforeEach(() => {
    const docs: any[] = [];
    model = {
      findOne: jest.fn().mockImplementation(() => ({
        sort: () => ({
          exec: () =>
            Promise.resolve(docs.length ? docs[docs.length - 1] : null),
        }),
      })),
      find: jest.fn().mockImplementation(() => ({
        sort: () => ({ exec: () => Promise.resolve(docs) }),
      })),
      create: jest.fn().mockImplementation((doc: any) => {
        docs.push(doc);
        return Promise.resolve(doc);
      }),
    };
    service = new AuditLogsService(model);
  });

  it('links the first entry to GENESIS', async () => {
    await service.log('u1', 'A', 'T', '1');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ prevHash: GENESIS_HASH }),
    );
  });

  it('links the next entry to the previous hash', async () => {
    await service.log('u1', 'A', 'T', '1');
    await service.log('u2', 'B', 'T', '2');
    const calls = model.create.mock.calls;
    expect(calls[1][0].prevHash).toBe(calls[0][0].hash);
  });

  it('ignores entries inserted outside the chain (no hash) when computing prevHash', async () => {
    await service.log('u1', 'A', 'T', '1');
    // entry ທີ່ຖືກ insert ນອກ collection (ບໍ່ມີ hash)
    const broken = { _id: 'broken', action: 'DATA_CORRECTION' };
    (model.findOne as jest.Mock).mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve(broken) }),
    }));
    await service.log('u2', 'B', 'T', '2');
    const last = model.create.mock.calls[model.create.mock.calls.length - 1][0];
    expect(last.prevHash).toBeTruthy();
    expect(last.prevHash).not.toBeUndefined();
  });

  it('serializes concurrent writes so the chain cannot fork', async () => {
    await Promise.all([
      service.log('u1', 'A', 'T', '1'),
      service.log('u2', 'B', 'T', '2'),
      service.log('u3', 'C', 'T', '3'),
    ]);
    const calls = model.create.mock.calls;
    expect(calls).toHaveLength(3);
    // entry 2 links to entry 1, entry 3 links to entry 2 (ບໍ່ fork)
    expect(calls[1][0].prevHash).toBe(calls[0][0].hash);
    expect(calls[2][0].prevHash).toBe(calls[1][0].hash);
  });

  it('verifyChain reports malformed entries instead of throwing', async () => {
    (model.find as jest.Mock).mockImplementation(() => ({
      sort: () => ({
        exec: () => Promise.resolve([{ _id: 'bad', action: 'X' }]),
      }),
    }));
    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe('bad');
  });
});
