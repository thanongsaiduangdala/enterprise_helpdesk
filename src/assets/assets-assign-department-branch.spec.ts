import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetStatus, HolderType } from './schemas/asset.schema';

function makeAvailableAsset(branchId: string) {
  const asset: any = {
    _id: 'AS001',
    assetTag: 'AS001',
    branchId,
    status: AssetStatus.AVAILABLE,
    holderType: HolderType.PERSON,
    assignmentHistory: [],
    save: jest.fn().mockImplementation(async () => asset),
    toObject: jest.fn().mockImplementation(() => ({
      _id: asset._id,
      assetTag: asset.assetTag,
      branchId: asset.branchId,
      status: asset.status,
      holderType: asset.holderType,
      departmentId: asset.departmentId,
      currentAssigneeId: asset.currentAssigneeId,
      assignmentHistory: [...asset.assignmentHistory],
    })),
  };
  return asset;
}

describe('AssetsService department assignment branch validation', () => {
  let service: AssetsService;

  beforeEach(() => {
    service = new AssetsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('rejects assigning an asset to a department in another branch without mutating it', async () => {
    const asset = makeAvailableAsset('BR-01');
    const ctx: any = { session: undefined, audits: [] };

    await expect(
      service.assignInCtx(
        asset,
        'custodian-1',
        'Supply request receipt',
        'manager-1',
        undefined,
        ctx,
        { departmentId: 'DEPT-02', branchId: 'BR-02' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(asset.save).not.toHaveBeenCalled();
    expect(asset.status).toBe(AssetStatus.AVAILABLE);
    expect(asset.departmentId).toBeUndefined();
    expect(asset.assignmentHistory).toHaveLength(0);
  });

  it('allows assigning an asset when its branch matches the department branch', async () => {
    const asset = makeAvailableAsset('BR-01');
    const ctx: any = { session: undefined, audits: [] };

    await service.assignInCtx(
      asset,
      'custodian-1',
      'Supply request receipt',
      'manager-1',
      undefined,
      ctx,
      { departmentId: 'DEPT-01', branchId: 'BR-01' },
    );

    expect(asset.save).toHaveBeenCalledTimes(1);
    expect(asset.status).toBe(AssetStatus.ASSIGNED);
    expect(asset.holderType).toBe(HolderType.DEPARTMENT);
    expect(asset.departmentId).toBe('DEPT-01');
  });
});
