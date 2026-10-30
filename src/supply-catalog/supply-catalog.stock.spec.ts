import { SupplyCatalogService } from './supply-catalog.service';
import { CatalogItemType } from './schemas/supply-catalog-item.schema';
import { AssetStatus } from '../assets/schemas/asset.schema';
import {
  SupplyLineStatus,
  SupplyRequestStatus,
} from '../supply-requests/schemas/supply-request.schema';

const doc = (obj: Record<string, any>) => ({ toObject: () => ({ ...obj }) });

describe('SupplyCatalogService.findAll stock counts', () => {
  let service: SupplyCatalogService;
  let catalogModel: { find: jest.Mock };
  let assetModel: { aggregate: jest.Mock };
  let requestModel: { aggregate: jest.Mock };

  const setup = (
    items: any[],
    assetRows: any[] = [],
    requestRows: any[] = [],
  ) => {
    catalogModel = {
      find: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve(items.map(doc))),
      })),
    };
    assetModel = {
      aggregate: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve(assetRows)),
      })),
    };
    requestModel = {
      aggregate: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve(requestRows)),
      })),
    };
    service = new SupplyCatalogService(
      catalogModel as any,
      {} as any,
      assetModel as any,
      requestModel as any,
    );
  };

  it('reports reserved and free counts for an asset item from reserved assets', async () => {
    setup(
      [
        {
          _id: 'SC001',
          name: 'Laptop',
          itemType: CatalogItemType.ASSET,
          stockQty: 5,
        },
      ],
      [{ _id: 'SC001', qty: 2 }],
    );

    const [item] = await service.findAll();

    expect(item.reservedQty).toBe(2);
    expect(item.freeQty).toBe(3);
    expect(item.isConsumable).toBe(false);
  });

  it('reports reserved counts for a consumable from ready lines of open requests', async () => {
    setup(
      [
        {
          _id: 'SC002',
          name: 'Paper',
          itemType: CatalogItemType.CONSUMABLE,
          stockQty: 10,
        },
      ],
      [{ _id: 'SC002', qty: 7 }],
      [{ _id: 'SC002', qty: 4 }],
    );

    const [item] = await service.findAll();

    expect(item.reservedQty).toBe(4);
    expect(item.freeQty).toBe(6);
    expect(item.isConsumable).toBe(true);
  });

  it('returns zero reserved and full stock free when nothing is reserved', async () => {
    setup([
      {
        _id: 'SC003',
        name: 'Mouse',
        itemType: CatalogItemType.ASSET,
        stockQty: 8,
      },
    ]);

    const [item] = await service.findAll();

    expect(item.reservedQty).toBe(0);
    expect(item.freeQty).toBe(8);
  });

  it('never reports negative free stock', async () => {
    setup(
      [
        {
          _id: 'SC004',
          name: 'Paper',
          itemType: CatalogItemType.CONSUMABLE,
          stockQty: 3,
        },
      ],
      [],
      [{ _id: 'SC004', qty: 9 }],
    );

    const [item] = await service.findAll();

    expect(item.reservedQty).toBe(9);
    expect(item.freeQty).toBe(0);
  });

  it('matches reservations to the right item when several items are listed', async () => {
    setup(
      [
        {
          _id: 'SC001',
          name: 'Laptop',
          itemType: CatalogItemType.ASSET,
          stockQty: 4,
        },
        {
          _id: 'SC002',
          name: 'Paper',
          itemType: CatalogItemType.CONSUMABLE,
          stockQty: 20,
        },
      ],
      [{ _id: 'SC001', qty: 1 }],
      [{ _id: 'SC002', qty: 5 }],
    );

    const [laptop, paper] = await service.findAll();

    expect([laptop.reservedQty, laptop.freeQty]).toEqual([1, 3]);
    expect([paper.reservedQty, paper.freeQty]).toEqual([5, 15]);
  });

  it('counts only available assets reserved for a request', async () => {
    setup([]);

    await service.findAll();

    const pipeline = assetModel.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match).toMatchObject({
      status: AssetStatus.AVAILABLE,
      reservedForRequestId: { $exists: true, $ne: null },
    });
  });

  it('counts only READY lines of open requests for consumables', async () => {
    setup([]);

    await service.findAll();

    const pipeline = requestModel.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.status.$in).toEqual([
      SupplyRequestStatus.APPROVED,
      SupplyRequestStatus.ORDERED,
      SupplyRequestStatus.PARTIALLY_RECEIVED,
    ]);
    expect(pipeline[2].$match['items.lineStatus']).toBe(SupplyLineStatus.READY);
  });

  it('filters to low-stock items only when asked', async () => {
    setup([]);

    await service.findAll(true);
    expect(catalogModel.find).toHaveBeenLastCalledWith({
      $expr: { $lte: ['$stockQty', '$lowStockThreshold'] },
    });

    await service.findAll();
    expect(catalogModel.find).toHaveBeenLastCalledWith({});
  });
});
