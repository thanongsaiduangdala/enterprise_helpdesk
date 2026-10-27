/**
 * Canonical Supply Catalog tracking rules shared by receipt and request flows.
 * `legacyHasAssets` is consulted only when itemType is absent on old records.
 */
export type CatalogTrackingMode = 'SERIAL' | 'TAG' | 'COUNT';

export function catalogRequiresAssetTag(
  itemType: unknown,
  legacyHasAssets = false,
): boolean {
  if (itemType === 'ASSET') return true;
  if (itemType === 'CONSUMABLE') return false;
  return legacyHasAssets;
}

export function catalogTrackingMode(
  itemType: unknown,
  trackSerial: boolean | undefined,
  legacyHasAssets = false,
): CatalogTrackingMode {
  if (itemType === 'CONSUMABLE') return 'COUNT';
  if (itemType === 'ASSET') return trackSerial === false ? 'TAG' : 'SERIAL';
  return legacyHasAssets ? 'SERIAL' : 'COUNT';
}
export function catalogCanCreateAsset(
  itemType: unknown,
  legacyHasAssets = false,
): boolean {
  if (itemType === 'ASSET') return true;
  if (itemType === 'CONSUMABLE') return false;
  // Keep old, already-established asset catalogs working until they are migrated.
  return legacyHasAssets;
}

