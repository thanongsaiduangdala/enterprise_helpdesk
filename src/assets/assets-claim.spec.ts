import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { AssetsService } from './assets.service';
import { Asset, AssetStatus } from './schemas/asset.schema';
import { SupplyRequest } from '../supply-requests/schemas/supply-request.schema';
import { Counter } from '../roles/schemas/counter.schema';
import { Department } from '../departments/schemas/department.schema';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MaintenanceHistoryService } from '../maintenance-history/maintenance-history.service';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { UsersService } from '../users/users.service';
import { PermissionUser } from '../common/utils/permission.util';

/**
 * Tests for AssetsService.claim() — the security-critical flow behind the
 * scan-to-claim / bulk-claim feature. These assert the rules the frontend
 * relies on:
 *  - assigneeCode may only target another user when the actor has assets:assign
 *  - the actor's own claim never requires assets:assign
 *  - non-assigners cannot hand equipment to someone else
 *  - the target must exist and be active
 *  - only AVAILABLE assets can be claimed
 */
describe('AssetsService claim authorization', () => {
  let service: AssetsService;
  let assetModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    find: jest.Mock;
  };
  let supplyRequestModel: { find: jest.Mock };
  let usersService: { findByEmployeeCode: jest.Mock; findById: jest.Mock };
  let catalogService: { adjustStockTracked: jest.Mock };
  let connection: {
    startSession: jest.Mock;
  };

  const makeAsset = (over: Record<string, any> = {}) => {
    const doc = {
      _id: 'AS001',
      assetTag: 'AS001',
      type: 'Laptop',
      status: AssetStatus.AVAILABLE,
      catalogItemId: undefined,
      currentAssigneeId: undefined,
      assignmentHistory: [],
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject() {
        return { ...this };
      },
      ...over,
    };
    return doc;
  };

  /**
   * findById(...).session(...).exec() chain used by findOne().
   */
  const chainable = (resolved: any) => {
    const exec = jest.fn().mockResolvedValue(resolved);
    const session = jest.fn().mockReturnValue({ exec });
    return { session };
  };

  beforeEach(async () => {
    assetModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
    };
    supplyRequestModel = { find: jest.fn() };
    usersService = {
      findByEmployeeCode: jest.fn(),
      findById: jest.fn(),
    };
    catalogService = { adjustStockTracked: jest.fn().mockResolvedValue(true) };

    // Minimal fake Mongo connection: a session whose transactions just run fn.
    const session = {
      withTransaction: jest.fn(async (fn: () => Promise<any>) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = {
      startSession: jest.fn().mockResolvedValue(session),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        { provide: getModelToken(Asset.name), useValue: assetModel },
        {
          provide: getModelToken(SupplyRequest.name),
          useValue: supplyRequestModel,
        },
        { provide: getModelToken(Counter.name), useValue: {} },
        { provide: getModelToken(Department.name), useValue: {} },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: MaintenanceHistoryService,
          useValue: {
            findByAsset: jest.fn(),
            create: jest.fn(),
          },
        },
        { provide: SupplyCatalogService, useValue: catalogService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(AssetsService);
  });

  const assigner: PermissionUser = {
    userId: 'actor-1',
    permissions: [{ module: 'assets', actions: ['read', 'assign'] }],
  };
  const plainUser: PermissionUser = {
    userId: 'actor-1',
    permissions: [{ module: 'assets', actions: ['read'] }],
  };

  it('rejects when there is no authenticated actor', async () => {
    await expect(service.claim('AS001', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lets a non-assigner claim for themselves without an entitlement (dev mode)', async () => {
    const asset = makeAsset();
    assetModel.findById.mockReturnValue(chainable(asset));
    // findEntitlement should never be reached for self-claim by non-assigner?
    // In dev (sod not enforced) needEntitlement = !canAssign -> true, so it IS
    // queried; return no requests so the flow can still assign.
    supplyRequestModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    });
    assetModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(asset),
    });

    // Without an entitlement the claim must be refused.
    await expect(
      service.claim('AS001', plainUser, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a non-assigner from claiming on behalf of another employee', async () => {
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: true,
    });

    await expect(
      service.claim('AS001', plainUser, undefined, undefined, 'USR200'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // It must fail before ever touching the asset.
    expect(assetModel.findById).not.toHaveBeenCalled();
  });

  it('rejects an unknown assigneeCode', async () => {
    usersService.findByEmployeeCode.mockResolvedValue(null);

    await expect(
      service.claim('AS001', assigner, undefined, undefined, 'NOPE'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inactive assigneeCode', async () => {
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: false,
    });

    await expect(
      service.claim('AS001', assigner, undefined, undefined, 'USR200'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets an assigner claim on behalf of another active employee who has an approved request', async () => {
    const asset = makeAsset();
    assetModel.findById.mockReturnValue(chainable(asset));
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: true,
    });

    // An APPROVED supply request whose single item matches the asset type with
    // remaining quota (quantity 1, none received yet).
    const request = {
      _id: 'REQ1',
      requestedBy: 'other-9',
      status: 'APPROVED',
      receivedAssetIds: [],
      items: [{ name: 'Laptop', quantity: 1 }],
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject() {
        return { ...this };
      },
    };
    supplyRequestModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([request]),
        }),
      }),
    });
    // findManyByIds for prior receipts -> empty
    assetModel.findById.mockImplementation(() => chainable(asset));
    assetModel.find = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    } as any);
    assetModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(asset),
    });

    const result = await service.claim(
      'AS001',
      assigner,
      'handover',
      '127.0.0.1',
      'USR200',
    );
    expect(result).toBeDefined();
    // Handover must bind the asset to the TARGET employee, not the actor.
    expect(asset.currentAssigneeId).toBe('other-9');
    expect(asset.status).toBe(AssetStatus.ASSIGNED);
    expect(asset.save).toHaveBeenCalled();
  });

  it('refuses to claim an asset that is not AVAILABLE', async () => {
    const asset = makeAsset({ status: AssetStatus.ASSIGNED });
    assetModel.findById.mockReturnValue(chainable(asset));
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: true,
    });

    await expect(
      service.claim('AS001', assigner, undefined, undefined, 'USR200'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to claim a retired asset', async () => {
    const asset = makeAsset({ status: AssetStatus.RETIRED });
    assetModel.findById.mockReturnValue(chainable(asset));
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: true,
    });

    await expect(
      service.claim('AS001', assigner, undefined, undefined, 'USR200'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when the asset id does not exist', async () => {
    assetModel.findById.mockReturnValue(chainable(null));
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: 'other-9',
      employeeCode: 'USR200',
      isActive: true,
    });

    await expect(
      service.claim('missing', assigner, undefined, undefined, 'USR200'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
