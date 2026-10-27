import { AssetsService } from './assets.service';
import { CatalogItemType } from '../supply-catalog/schemas/supply-catalog-item.schema';

describe('AssetsService.requiresAssetTagForCatalog', () => {
  let service: AssetsService;
  let catalogService: { findOne: jest.Mock };
  let assetModel: { exists: jest.Mock };
  let assetExistsQuery: { session: jest.Mock; exec: jest.Mock };

  beforeEach(() => {
    assetExistsQuery = {
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };
    assetModel = { exists: jest.fn().mockReturnValue(assetExistsQuery) };
    catalogService = { findOne: jest.fn() };
    service = new AssetsService(
      assetModel as any,
      {} as any,
      {} as any,
      catalogService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('treats an explicitly typed ASSET as tag-tracked even before any asset record exists', async () => {
    catalogService.findOne.mockResolvedValue({
      _id: 'CAT-LAPTOP',
      itemType: CatalogItemType.ASSET,
    });

    await expect(
      service.requiresAssetTagForCatalog('CAT-LAPTOP'),
    ).resolves.toBe(true);
    expect(assetModel.exists).not.toHaveBeenCalled();
  });

  it('treats an explicitly typed CONSUMABLE as count-tracked even if old asset records are linked', async () => {
    catalogService.findOne.mockResolvedValue({
      _id: 'CAT-PAPER',
      itemType: CatalogItemType.CONSUMABLE,
    });

    await expect(
      service.requiresAssetTagForCatalog('CAT-PAPER'),
    ).resolves.toBe(false);
    expect(assetModel.exists).not.toHaveBeenCalled();
  });

  it('falls back to asset records only for legacy catalog entries without itemType', async () => {
    catalogService.findOne.mockResolvedValue({ _id: 'CAT-LEGACY' });
    assetExistsQuery.exec.mockResolvedValue({ _id: 'AS-LEGACY' });

    await expect(
      service.requiresAssetTagForCatalog('CAT-LEGACY'),
    ).resolves.toBe(true);
    expect(assetModel.exists).toHaveBeenCalledWith({
      catalogItemId: 'CAT-LEGACY',
      status: { $ne: 'RETIRED' },
    });
  });

  it('does not query catalog or assets when no catalog id is provided', async () => {
    await expect(service.requiresAssetTagForCatalog(undefined)).resolves.toBe(
      false,
    );
    expect(catalogService.findOne).not.toHaveBeenCalled();
    expect(assetModel.exists).not.toHaveBeenCalled();
  });
});
