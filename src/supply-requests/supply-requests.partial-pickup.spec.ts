import { BadRequestException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';
import {
  SupplyLineStatus,
  SupplyRequestStatus,
} from './schemas/supply-request.schema';
import {
  deriveSupplyStatus,
  isLineTracked,
  lineStatusOf,
} from '../common/utils/supply-line-status.util';
import { AssetStatus } from '../assets/schemas/asset.schema';
import { CatalogItemType } from '../supply-catalog/schemas/supply-catalog-item.schema';
import { PermissionUser } from '../common/utils/permission.util';

const L = SupplyLineStatus;
const S = SupplyRequestStatus;

describe('supply line status util', () => {
  it('treats a missing lineStatus as WAITING', () => {
    expect(lineStatusOf({})).toBe(L.WAITING);
    expect(lineStatusOf({ lineStatus: L.READY })).toBe(L.READY);
  });

  it('detects line-tracked requests only when some line has left WAITING', () => {
    expect(isLineTracked([{}, {}])).toBe(false);
    expect(isLineTracked([{ lineStatus: L.WAITING }])).toBe(false);
    expect(isLineTracked([{}, { lineStatus: L.ON_ORDER }])).toBe(true);
  });

  it.each([
    [[L.WAITING, L.WAITING], S.REQUESTED],
    [[L.REJECTED, L.REJECTED], S.REJECTED],
    [[L.READY, L.ON_ORDER], S.APPROVED],
    [[L.READY, L.READY], S.APPROVED],
    [[L.ON_ORDER, L.ON_ORDER], S.ORDERED],
    [[L.ON_ORDER, L.REJECTED], S.ORDERED],
    [[L.COLLECTED, L.ON_ORDER], S.PARTIALLY_RECEIVED],
    [[L.COLLECTED, L.READY], S.PARTIALLY_RECEIVED],
    [[L.COLLECTED, L.WAITING], S.PARTIALLY_RECEIVED],
    [[L.COLLECTED, L.COLLECTED], S.CLOSED],
    [[L.COLLECTED, L.REJECTED], S.CLOSED],
  ])('derives the request status from lines %j', (lines, expected) => {
    expect(deriveSupplyStatus(lines.map((lineStatus) => ({ lineStatus })))).toBe(
      expected,
    );
  });
});

function query<T>(value: T) {
  const q: any = {
    session: jest.fn(() => q),
    populate: jest.fn(() => q),
    exec: jest.fn(() => Promise.resolve(value)),
  };
  return q;
}

describe('SupplyRequestsService.receive partial pickup', () => {
  let service: SupplyRequestsService;
  let requests: Map<string, any>;
  let catalog: Map<string, any>;
  let assets: Map<string, any>;
  let catalogService: any;
  let assetsService: any;

  const requester: PermissionUser = {
    userId: 'requester-1',
    permissions: [{ module: 'supplies', actions: ['read'] }],
  };

  const seedCatalog = (id: string, over: Record<string, any> = {}) => {
    catalog.set(id, {
      _id: id,
      name: id,
      itemType: CatalogItemType.ASSET,
      stockQty: 5,
      isActive: true,
      ...over,
    });
  };

  const seedAsset = (id: string, catalogItemId: string) => {
    const asset: any = {
      _id: id,
      assetTag: id,
      type: catalogItemId,
      catalogItemId,
      branchId: 'BR-01',
      status: AssetStatus.AVAILABLE,
    };
    assets.set(id, asset);
    return asset;
  };

  const line = (over: Record<string, any>) => ({
    name: 'Item',
    quantity: 1,
    reason: 'needed',
    ...over,
  });

  const makeRequest = (items: any[], over: Record<string, any> = {}) => {
    const request: any = {
      _id: 'SR001',
      requestedBy: 'requester-1',
      status: S.APPROVED,
      items,
      receivedAssetIds: [],
      markModified: jest.fn(),
      save: jest.fn(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function (this: any) {
        return { ...this };
      }),
      ...over,
    };
    requests.set('SR001', request);
    return request;
  };

  beforeEach(() => {
    requests = new Map();
    catalog = new Map();
    assets = new Map();

    catalogService = {
      findOne: jest.fn((id: string) => catalog.get(String(id))),
      adjustStock: jest.fn((id: string, delta: number) => {
        const item = catalog.get(String(id));
        item.stockQty += delta;
        return item;
      }),
    };

    assetsService = {
      requiresAssetTagForCatalog: jest.fn(async (id?: string) =>
        id ? catalog.get(String(id))?.itemType === CatalogItemType.ASSET : false,
      ),
      findByTagOrId: jest.fn(async (tag: string) => assets.get(tag) ?? null),
      findManyByIds: jest.fn(async () => []),
      assignInCtx: jest.fn(async (asset: any) => {
        asset.status = AssetStatus.ASSIGNED;
        return asset;
      }),
      releaseReservationsForRequest: jest.fn(async () => undefined),
      flushAudits: jest.fn(async () => undefined),
    };

    const requestModel: any = {
      findById: jest.fn((id: string) => query(requests.get(String(id)) ?? null)),
    };
    const session = {
      withTransaction: jest.fn((fn: () => Promise<any>) => fn()),
      endSession: jest.fn(() => undefined),
    };
    const connection = { startSession: jest.fn(() => session) };

    service = new SupplyRequestsService(
      requestModel,
      catalogService,
      { log: jest.fn() } as any,
      { findOneRaw: jest.fn(), findByEmployeeCode: jest.fn() } as any,
      { findOne: jest.fn(() => null) } as any,
      assetsService,
      connection as any,
      {} as any,
      {} as any,
    );
  });

  it('collects only the ready line and leaves the on-order line open', async () => {
    seedCatalog('SC-PC');
    seedCatalog('SC-TAB');
    const pc = seedAsset('AS-PC', 'SC-PC');
    const request = makeRequest([
      line({ name: 'PC', catalogItemId: 'SC-PC', lineStatus: L.READY }),
      line({ name: 'Tablet', catalogItemId: 'SC-TAB', lineStatus: L.ON_ORDER }),
    ]);

    const result: any = await service.receive(
      'SR001',
      { assetTags: ['AS-PC'] },
      requester,
    );

    expect(result.status).toBe(S.PARTIALLY_RECEIVED);
    expect(request.items[0].lineStatus).toBe(L.COLLECTED);
    expect(request.items[1].lineStatus).toBe(L.ON_ORDER);
    expect(assetsService.assignInCtx).toHaveBeenCalledTimes(1);
    expect(pc.status).toBe(AssetStatus.ASSIGNED);
  });

  it('closes the request once the last ready line is collected and the rest are rejected', async () => {
    seedCatalog('SC-PC');
    seedAsset('AS-PC', 'SC-PC');
    const request = makeRequest([
      line({ name: 'PC', catalogItemId: 'SC-PC', lineStatus: L.READY }),
      line({ name: 'Tablet', lineStatus: L.REJECTED }),
    ]);

    const result: any = await service.receive(
      'SR001',
      { assetTags: ['AS-PC'] },
      requester,
    );

    expect(result.status).toBe(S.CLOSED);
    expect(request.fulfilledAt).toBeInstanceOf(Date);
  });

  it('closes the request when an on-order line is collected after the first pickup', async () => {
    seedCatalog('SC-PC');
    seedCatalog('SC-TAB');
    seedAsset('AS-PC', 'SC-PC');
    seedAsset('AS-TAB', 'SC-TAB');
    const request = makeRequest([
      line({ name: 'PC', catalogItemId: 'SC-PC', lineStatus: L.READY }),
      line({ name: 'Tablet', catalogItemId: 'SC-TAB', lineStatus: L.ON_ORDER }),
    ]);

    await service.receive('SR001', { assetTags: ['AS-PC'] }, requester);
    expect(request.status).toBe(S.PARTIALLY_RECEIVED);

    request.items[1].lineStatus = L.READY;
    request.status = S.PARTIALLY_RECEIVED;
    const result: any = await service.receive(
      'SR001',
      { assetTags: ['AS-TAB'] },
      requester,
    );

    expect(result.status).toBe(S.CLOSED);
    expect(request.items.map((i: any) => i.lineStatus)).toEqual([
      L.COLLECTED,
      L.COLLECTED,
    ]);
  });

  it('rejects an explicit pick of a line that is not ready', async () => {
    seedCatalog('SC-PC');
    seedCatalog('SC-TAB');
    seedAsset('AS-TAB', 'SC-TAB');
    const request = makeRequest([
      line({ name: 'PC', catalogItemId: 'SC-PC', lineStatus: L.READY }),
      line({ name: 'Tablet', catalogItemId: 'SC-TAB', lineStatus: L.ON_ORDER }),
    ]);

    await expect(
      service.receive(
        'SR001',
        { assetTags: ['AS-TAB'], lineIndexes: [1] },
        requester,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(request.items[1].lineStatus).toBe(L.ON_ORDER);
    expect(assetsService.assignInCtx).not.toHaveBeenCalled();
  });

  it('refuses pickup when no line is ready', async () => {
    seedCatalog('SC-TAB');
    makeRequest([
      line({ name: 'Tablet', catalogItemId: 'SC-TAB', lineStatus: L.ON_ORDER }),
      line({ name: 'Mouse', lineStatus: L.REJECTED }),
    ]);

    await expect(
      service.receive('SR001', {}, requester),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires confirmation for a ready consumable line and deducts stock on pickup', async () => {
    seedCatalog('SC-PAPER', {
      itemType: CatalogItemType.CONSUMABLE,
      stockQty: 10,
    });
    const request = makeRequest([
      line({
        name: 'Paper',
        quantity: 4,
        catalogItemId: 'SC-PAPER',
        lineStatus: L.READY,
      }),
    ]);

    await expect(
      service.receive('SR001', {}, requester),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(catalog.get('SC-PAPER').stockQty).toBe(10);

    const result: any = await service.receive(
      'SR001',
      { confirmConsumables: true },
      requester,
    );

    expect(result.status).toBe(S.CLOSED);
    expect(request.items[0].lineStatus).toBe(L.COLLECTED);
    expect(catalog.get('SC-PAPER').stockQty).toBe(6);
  });

  it('keeps the legacy all-lines pickup for requests without line statuses', async () => {
    seedCatalog('SC-PC');
    seedAsset('AS-PC', 'SC-PC');
    const request = makeRequest([
      line({ name: 'PC', catalogItemId: 'SC-PC' }),
    ]);

    const result: any = await service.receive(
      'SR001',
      { assetTags: ['AS-PC'] },
      requester,
    );

    expect(result.status).toBe(S.CLOSED);
    expect(request.items[0].lineStatus).toBeUndefined();
  });

  it('keeps blocking legacy requests while a linked purchase has not fully arrived', async () => {
    seedCatalog('SC-PC');
    seedAsset('AS-PC', 'SC-PC');
    makeRequest([
      line({
        name: 'PC',
        catalogItemId: 'SC-PC',
        purchaseRequestId: 'PR001',
        purchaseRequestNo: 'PR-001',
        purchaseQty: 1,
        arrivedQty: 0,
      }),
    ]);

    await expect(
      service.receive('SR001', { assetTags: ['AS-PC'] }, requester),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
