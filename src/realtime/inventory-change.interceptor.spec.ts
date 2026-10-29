import { lastValueFrom, of, throwError } from 'rxjs';
import { InventoryChangeInterceptor } from './inventory-change.interceptor';

const ctx = (method: string, url: string, type = 'http') =>
  ({
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url }) }),
  }) as any;

describe('InventoryChangeInterceptor', () => {
  let gateway: { emitChanged: jest.Mock };
  let interceptor: InventoryChangeInterceptor;

  beforeEach(() => {
    gateway = { emitChanged: jest.fn() };
    interceptor = new InventoryChangeInterceptor(gateway as any);
  });

  it.each([
    ['POST', '/api/supply-requests', 'supply-requests'],
    ['PATCH', '/api/supply-requests/SR001/approve', 'supply-requests'],
    ['PATCH', '/api/assets/AST1/status?x=1', 'assets'],
    ['POST', '/api/goods-receipt', 'goods-receipt'],
    ['PATCH', '/api/purchase-requests/PR1/approve', 'purchase-requests'],
    ['DELETE', '/api/supply-catalog/SC001', 'supply-catalog'],
  ])('emits after a successful %s %s', async (method, url, resource) => {
    const out = await lastValueFrom(
      interceptor.intercept(ctx(method, url), { handle: () => of('ok') }),
    );
    expect(out).toBe('ok');
    expect(gateway.emitChanged).toHaveBeenCalledWith(resource);
  });

  it('does not emit for GET requests', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx('GET', '/api/assets'), {
        handle: () => of([]),
      }),
    );
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('does not emit for unrelated resources', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx('POST', '/api/tickets'), {
        handle: () => of('ok'),
      }),
    );
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('does not emit when the handler fails', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx('POST', '/api/assets'), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('ignores non-http contexts', async () => {
    await lastValueFrom(
      interceptor.intercept(ctx('POST', '/api/assets', 'ws'), {
        handle: () => of('ok'),
      }),
    );
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('never breaks the request if the emit itself throws', async () => {
    gateway.emitChanged.mockImplementation(() => {
      throw new Error('socket down');
    });
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx('POST', '/api/assets'), {
          handle: () => of('ok'),
        }),
      ),
    ).resolves.toBe('ok');
  });
});
