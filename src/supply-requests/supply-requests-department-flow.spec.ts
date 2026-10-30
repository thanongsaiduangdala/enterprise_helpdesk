import { BadRequestException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestStatus } from './schemas/supply-request.schema';
import { AssetsService } from '../assets/assets.service';
import { AssetStatus, HolderType } from '../assets/schemas/asset.schema';
import { CatalogItemType } from '../supply-catalog/schemas/supply-catalog-item.schema';
import { PermissionUser } from '../common/utils/permission.util';

function query<T>(value: T) {
  const q: any = {
    session: jest.fn(() => q),
    populate: jest.fn(() => q),
    sort: jest.fn(() => q),
    limit: jest.fn(() => q),
    exec: jest.fn(() => Promise.resolve(value)),
  };
  return q;
}

describe('SupplyRequestsService department flows', () => {
  let service: SupplyRequestsService;
  let assetsService: AssetsService;
  let requestModel: any;
  let assetModel: any;
  let catalogService: any;
  let usersService: any;
  let departmentsService: any;
  let connection: any;
  let assets: Map<string, any>;
  let requests: Map<string, any>;
  let catalog: Map<string, any>;

  const requester: PermissionUser = {
    userId: 'requester-1',
    permissions: [{ module: 'supplies', actions: ['read'] }],
  };

  const seedCatalog = (over: Record<string, any> = {}) => {
    const item = {
      _id: 'SC001',
      name: 'Laptop',
      category: 'IT',
      unit: 'unit',
      itemType: CatalogItemType.ASSET,
      trackSerial: true,
      stockQty: 2,
      isActive: true,
      ...over,
    };
    catalog.set(String(item._id), item);
    return item;
  };

  const seedDepartment = (over: Record<string, any> = {}) => {
    const department = {
      _id: 'DX001',
      name: 'IT',
      branchId: 'BR-01',
      managerIds: ['manager-1'],
      isActive: true,
      ...over,
    };
    departmentsService.findOne.mockResolvedValue(department);
    return department;
  };

  const makeAsset = (over: Record<string, any> = {}) => {
    const asset: any = {
      _id: 'AS001',
      assetTag: 'AS001',
      type: 'Laptop',
      catalogItemId: 'SC001',
      branchId: 'BR-01',
      status: AssetStatus.AVAILABLE,
      holderType: HolderType.PERSON,
      currentAssigneeId: undefined,
      departmentId: undefined,
      assignmentHistory: [],
      save: jest.fn(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function (this: any) {
        return { ...this };
      }),
      ...over,
    };
    assets.set(String(asset._id), asset);
    return asset;
  };

  const makeRequest = (over: Record<string, any> = {}) => {
    const request: any = {
      _id: 'SR001',
      requestedBy: 'requester-1',
      status: SupplyRequestStatus.APPROVED,
      items: [],
      receivedAssetIds: [],
      save: jest.fn(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function (this: any) {
        return { ...this };
      }),
      ...over,
    };
    requests.set(String(request._id), request);
    return request;
  };

  beforeEach(() => {
    assets = new Map();
    requests = new Map();
    catalog = new Map();

    catalogService = {
      findOne: jest.fn((id: string) => {
        const item = catalog.get(String(id));
        if (!item) throw new Error(`catalog item ${id} not found`);
        return item;
      }),
      findByName: jest.fn(() => null),
      adjustStock: jest.fn((id: string, delta: number) => {
        const item = catalog.get(String(id));
        item.stockQty += delta;
        return item;
      }),
      adjustStockTracked: jest.fn((id: string, delta: number) => {
        const item = catalog.get(String(id));
        const stockBefore = item.stockQty;
        item.stockQty += delta;
        return {
          stockBefore,
          stockAfter: item.stockQty,
          mismatch: 0,
        };
      }),
      createInTx: jest.fn(),
    };

    const findAssets = (filter: any) => {
      let list = [...assets.values()];
      if (filter?._id?.$in) {
        list = filter._id.$in
          .map((id: string) => assets.get(String(id)))
          .filter(Boolean);
      } else {
        if (filter?.assetTag instanceof RegExp) {
          list = list.filter((a) => filter.assetTag.test(a.assetTag));
        }
        if (filter?.departmentId) {
          list = list.filter((a) => a.departmentId === filter.departmentId);
        }
        if (filter?.status) {
          list = list.filter((a) => a.status === filter.status);
        }
        if (filter?.branchId) {
          list = list.filter((a) => a.branchId === filter.branchId);
        }
        if (filter?.currentAssigneeId) {
          list = list.filter(
            (a) =>
              String(a.currentAssigneeId) === String(filter.currentAssigneeId),
          );
        }
        if (filter?.holderType === HolderType.DEPARTMENT) {
          list = list.filter((a) => a.holderType === HolderType.DEPARTMENT);
        }
      }
      return list;
    };

    assetModel = {
      findOne: jest.fn((filter: any) => query(findAssets(filter)[0] ?? null)),
      findById: jest.fn((id: string) => query(assets.get(String(id)) ?? null)),
      find: jest.fn((filter: any) => query(findAssets(filter))),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(() =>
        query({ matchedCount: 0, modifiedCount: 0 }),
      ),
    };

    requestModel = jest.fn(function (this: any, data: any) {
      Object.assign(this, {
        status: SupplyRequestStatus.REQUESTED,
        items: [],
        receivedAssetIds: [],
        ...data,
      });
      this.save = jest.fn(() => Promise.resolve(this));
      this.toObject = () => ({ ...this });
      requests.set(String(this._id), this);
    });
    requestModel.findById = jest.fn((id: string) =>
      query(requests.get(String(id)) ?? null),
    );
    requestModel.find = jest.fn(() => query([]));

    usersService = {
      findOneRaw: jest.fn((id: string) => ({
        _id: id,
        departmentId: 'DX001',
        isActive: true,
      })),
      findByEmployeeCode: jest.fn(() => null),
    };

    departmentsService = {
      findOne: jest.fn(() => null),
      findManagedDepartmentIds: jest.fn(() => []),
      findRequestableForUser: jest.fn(() => []),
    };

    const session = {
      withTransaction: jest.fn((fn: () => Promise<any>) => fn()),
      endSession: jest.fn(() => undefined),
    };
    connection = {
      startSession: jest.fn(() => session),
    };

    assetsService = new AssetsService(
      assetModel,
      { log: jest.fn() } as any,
      { findByAsset: jest.fn(), create: jest.fn() } as any,
      catalogService,
      requestModel,
      usersService,
      {} as any,
      {} as any,
      connection,
    );

    service = new SupplyRequestsService(
      requestModel,
      catalogService,
      { log: jest.fn() } as any,
      usersService,
      departmentsService,
      assetsService,
      connection,
      {} as any,
      {} as any,
    );
  });

  it('creates a department request, approves it, receives the scanned asset and records the department as holder', async () => {
    const catalogItem = seedCatalog({ stockQty: 2 });
    seedDepartment();

    const created = await service.create(
      {
        items: [{ catalogItemId: 'SC001', name: 'Laptop', quantity: 1 }],
        departmentId: 'DX001',
        custodianId: 'custodian-1',
      },
      'requester-1',
    );
    expect(created.departmentId).toBe('DX001');
    expect(String(created.custodianId)).toBe('custodian-1');
    expect(created.status).toBe(SupplyRequestStatus.REQUESTED);

    const approved = await service.approve('SR001', 'approver-1');
    expect((approved as any).status).toBe(SupplyRequestStatus.APPROVED);

    const asset = makeAsset();
    const received = await service.receive(
      'SR001',
      { assetTags: ['AS001'] },
      requester,
    );

    expect(received.status).toBe(SupplyRequestStatus.CLOSED);
    expect(received.receivedAssetIds).toEqual(['AS001']);
    expect(asset.status).toBe(AssetStatus.ASSIGNED);
    expect(asset.holderType).toBe(HolderType.DEPARTMENT);
    expect(asset.departmentId).toBe('DX001');
    expect(asset.currentAssigneeId).toBe('custodian-1');
    expect(asset.assignmentHistory).toHaveLength(1);
    expect(asset.assignmentHistory[0]).toMatchObject({
      assigneeId: 'custodian-1',
      departmentId: 'DX001',
    });
    expect(catalogItem.stockQty).toBe(1);

    const registry = await assetsService.findAll({
      departmentId: 'DX001',
      holderType: HolderType.DEPARTMENT,
    });
    expect(registry).toEqual([asset]);
  });

  it('rejects scanning an asset from another branch and leaves it unassigned', async () => {
    seedCatalog({ stockQty: 2 });
    seedDepartment({ branchId: 'BR-01' });
    const request = makeRequest({
      items: [{ catalogItemId: 'SC001', name: 'Laptop', quantity: 1 }],
      departmentId: 'DX001',
      custodianId: 'custodian-1',
    });
    const asset = makeAsset({ branchId: 'BR-02' });

    await expect(
      service.receive('SR001', { assetTags: ['AS001'] }, requester),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(asset.status).toBe(AssetStatus.AVAILABLE);
    expect(asset.holderType).toBe(HolderType.PERSON);
    expect(asset.departmentId).toBeUndefined();
    expect(asset.assignmentHistory).toHaveLength(0);
    expect(asset.save).not.toHaveBeenCalled();
    expect(request.status).toBe(SupplyRequestStatus.APPROVED);
    expect(request.receivedAssetIds).toEqual([]);
  });

  it('rejects a department request raised by a user outside that department', async () => {
    seedDepartment({ managerIds: ['manager-1'] });
    usersService.findOneRaw.mockReturnValue({
      _id: 'outsider-1',
      departmentId: 'DX-OTHER',
      isActive: true,
    });

    await expect(
      service.create(
        {
          items: [{ catalogItemId: 'SC001', name: 'Laptop', quantity: 1 }],
          departmentId: 'DX001',
          custodianId: 'custodian-1',
        },
        'outsider-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(requestModel).not.toHaveBeenCalled();
    expect(catalogService.findOne).not.toHaveBeenCalled();
  });

  it('receives a consumable department request by decreasing stock without an asset tag', async () => {
    const catalogItem = seedCatalog({
      _id: 'SC009',
      name: 'Paper',
      itemType: CatalogItemType.CONSUMABLE,
      trackSerial: false,
      stockQty: 5,
    });
    seedDepartment();
    const request = makeRequest({
      items: [{ catalogItemId: 'SC009', name: 'Paper', quantity: 3 }],
      departmentId: 'DX001',
      custodianId: 'custodian-1',
    });

    const received = await service.receive(
      'SR001',
      { confirmConsumables: true },
      requester,
    );

    expect(received.status).toBe(SupplyRequestStatus.CLOSED);
    expect(received.receivedAssetIds).toEqual([]);
    expect(catalogItem.stockQty).toBe(2);
    expect(assets.size).toBe(0);
    expect(assetModel.findOne).not.toHaveBeenCalled();
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
  });
});
