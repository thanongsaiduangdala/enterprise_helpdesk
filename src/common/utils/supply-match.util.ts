/** ຈັບຄູ່ຊັບສິນກັບລາຍການໃນໃບຂໍ (ກົງ catalogItemId ກ່ອນ, ບໍ່ມີກໍປຽບທຽບຊື່/ຊະນິດ) */
export interface MatchItem {
  catalogItemId?: string;
  name?: string;
  quantity: number;
}
export interface MatchAsset {
  catalogItemId?: string;
  type?: string;
}

/**
 * ຄືນ index ຂອງລາຍການທີ່ຊັບສິນນີ້ຈັບຄູ່ກັບ (ຍັງບໍ່ເຕັມຈຳນວນ) ຫຼື -1.
 * counts = ຈຳນວນທີ່ຮັບແລ້ວຕໍ່ລາຍການ (ຖືກປັບເພີ່ມໂດຍຜູ້ເອີ້ນ)
 */
export function matchAssetToItem(
  items: MatchItem[],
  asset: MatchAsset,
  counts: number[],
): number {
  const sameCatalog = items
    .map((_, k) => k)
    .filter(
      (k) =>
        !!asset.catalogItemId && items[k].catalogItemId === asset.catalogItemId,
    );
  if (sameCatalog.length > 0) {
    return (
      sameCatalog.find((k) => counts[k] < items[k].quantity) ?? sameCatalog[0]
    );
  }
  const t = (asset.type || '').toLowerCase();
  return items.findIndex((it) => {
    const n = (it.name || '').toLowerCase();
    return !!n && !!t && (n.includes(t) || t.includes(n));
  });
}
