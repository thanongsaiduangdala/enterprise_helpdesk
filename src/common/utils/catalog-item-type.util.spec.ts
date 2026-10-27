import {
  catalogCanCreateAsset,
  catalogRequiresAssetTag,
  catalogTrackingMode,
} from './catalog-item-type.util';

describe('Supply Catalog itemType tracking rules', () => {
  it('allows asset creation only for an explicitly typed ASSET catalog item', () => {
    expect(catalogCanCreateAsset('ASSET')).toBe(true);
    expect(catalogCanCreateAsset('CONSUMABLE', true)).toBe(false);
    expect(catalogCanCreateAsset(undefined)).toBe(false);
    expect(catalogCanCreateAsset(undefined, true)).toBe(true);
  });

  it('treats ASSET as tag-tracked even when no Asset records exist yet', () => {
    expect(catalogRequiresAssetTag('ASSET', false)).toBe(true);
    expect(catalogTrackingMode('ASSET', true, false)).toBe('SERIAL');
    expect(catalogTrackingMode('ASSET', false, false)).toBe('TAG');
  });

  it('treats CONSUMABLE as count-tracked even if legacy Asset records are linked', () => {
    expect(catalogRequiresAssetTag('CONSUMABLE', true)).toBe(false);
    expect(catalogTrackingMode('CONSUMABLE', true, true)).toBe('COUNT');
  });

  it('uses linked Asset records only as a compatibility fallback for legacy entries', () => {
    expect(catalogRequiresAssetTag(undefined, true)).toBe(true);
    expect(catalogTrackingMode(undefined, true, true)).toBe('SERIAL');
    expect(catalogRequiresAssetTag(undefined, false)).toBe(false);
    expect(catalogTrackingMode(undefined, true, false)).toBe('COUNT');
  });
});
