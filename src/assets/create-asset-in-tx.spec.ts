import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { AssetsService } from './assets.service';
import { Asset, AssetStatus } from './schemas/asset.schema';
import { SupplyRequest } from '../supply-requests/schemas/supply-request.schema';
import { Counter } from '../roles/schemas/counter.schema';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MaintenanceHistoryService } from '../maintenance-history/maintenance-history.service';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { UsersService } from '../users/users.service';

/**
 * Regression tests for `createAssignedAssetInTx` — the asset-creation path used
 * when a goods receipt stores equipment in stock. Covers the "add to inventory"
 * fix: the status produced must reflect the store-in-stock / assignee intent,
 * and catalog stock must only be incremented when the asset actually ends up
 * AVAILABLE.
 */
describe('AssetsService.createAssignedAssetInTx status resolution', () => {
  let service: AssetsService;
  let createdDocs: any[];
  let catalogService: { adjustStockTracked: jest.Mock };

  const ctx = { session: undefined, audits: [] } as any;

  beforeEach(async () => {
    createdDocs = [];

    function AssetModelMock(this: any, payload: any) {
      createdDocs.push(payload);
      return {
        ...payload,
        save: jest.fn().mockResolvedValue({
          ...payload,
          toObject: () => ({ ...payload }),
        }),
        toObject: () => ({ ...payload }),
      };
    }
    // generateId() -> findOne({_id: /^AS\d{3}$/}).sort().session().exec()
    AssetModelMock.findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    });
    AssetModelMock.find = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    });

    // Counter model: nextSequence()/bumpCounterTo() call findOneAndUpdate().exec()
    const counterModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ seq: 1 }),
      }),
    };

    catalogService = { adjustStockTracked: jest.fn().mockResolvedValue(true) };

    const connection = {
      startSession: jest.fn().mockResolvedValue({
        withTransaction: jest.fn(async (fn: () => Promise<any>) => fn()),
        endSession: jest.fn().mockResolvedValue(undefined),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        { provide: getModelToken(Asset.name), useValue: AssetModelMock },
        {
          provide: getModelToken(SupplyRequest.name),
          useValue: { find: jest.fn() },
        },
        { provide: getModelToken(Counter.name), useValue: counterModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: MaintenanceHistoryService,
          useValue: { findByAsset: jest.fn() },
        },
        { provide: SupplyCatalogService, useValue: catalogService },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    service = module.get(AssetsService);
  });

  const base = {
    type: 'Laptop',
    catalogItemId: 'SC001',
    branchId: 'BX001',
  };

  it('no assignee, no status → AVAILABLE and stock +1', async () => {
    await service.createAssignedAssetInTx({ ...base }, ctx, 'actor');
    expect(createdDocs[0].status).toBe(AssetStatus.AVAILABLE);
    expect(createdDocs[0].currentAssigneeId).toBeUndefined();
    expect(catalogService.adjustStockTracked).toHaveBeenCalledWith(
      'SC001',
      1,
      undefined,
    );
  });

  it('assignee, no status → ASSIGNED with history and NO stock change', async () => {
    await service.createAssignedAssetInTx(
      { ...base, assigneeId: 'user-9' },
      ctx,
      'actor',
    );
    expect(createdDocs[0].status).toBe(AssetStatus.ASSIGNED);
    expect(createdDocs[0].currentAssigneeId).toBe('user-9');
    expect(createdDocs[0].assignmentHistory).toHaveLength(1);
    expect(catalogService.adjustStockTracked).not.toHaveBeenCalled();
  });

  it('explicit AVAILABLE status with NO assignee (store-in-stock path) → AVAILABLE and stock +1', async () => {
    await service.createAssignedAssetInTx(
      { ...base, status: AssetStatus.AVAILABLE },
      ctx,
      'actor',
    );
    expect(createdDocs[0].status).toBe(AssetStatus.AVAILABLE);
    expect(createdDocs[0].currentAssigneeId).toBeUndefined();
    expect(createdDocs[0].assignmentHistory).toHaveLength(0);
    expect(catalogService.adjustStockTracked).toHaveBeenCalledWith(
      'SC001',
      1,
      undefined,
    );
  });

  it('contradictory "AVAILABLE + assignee" resolves to ASSIGNED (no stock change)', async () => {
    await service.createAssignedAssetInTx(
      { ...base, assigneeId: 'stale-user', status: AssetStatus.AVAILABLE },
      ctx,
      'actor',
    );
    expect(createdDocs[0].status).toBe(AssetStatus.ASSIGNED);
    expect(createdDocs[0].currentAssigneeId).toBe('stale-user');
    expect(catalogService.adjustStockTracked).not.toHaveBeenCalled();
  });

  it('explicit UNDER_REPAIR status, no assignee → no stock change', async () => {
    await service.createAssignedAssetInTx(
      { ...base, status: AssetStatus.UNDER_REPAIR },
      ctx,
      'actor',
    );
    expect(createdDocs[0].status).toBe(AssetStatus.UNDER_REPAIR);
    expect(catalogService.adjustStockTracked).not.toHaveBeenCalled();
  });

  it('explicit RETIRED status, no assignee → no stock change', async () => {
    await service.createAssignedAssetInTx(
      { ...base, status: AssetStatus.RETIRED },
      ctx,
      'actor',
    );
    expect(createdDocs[0].status).toBe(AssetStatus.RETIRED);
    expect(catalogService.adjustStockTracked).not.toHaveBeenCalled();
  });
});
