import {
  SupplyLineStatus,
  SupplyRequestStatus,
} from '../../supply-requests/schemas/supply-request.schema';

type LineLike = { lineStatus?: SupplyLineStatus };

export const lineStatusOf = (item: LineLike): SupplyLineStatus =>
  item.lineStatus ?? SupplyLineStatus.WAITING;

/**
 * ຄຳຂໍທີ່ຝ່າຍສາງກວດເປັນລາຍການແລ້ວ (ມີຢ່າງໜ້ອຍ 1 ລາຍການທີ່ບໍ່ແມ່ນ WAITING).
 * ໃບເກົ່າທີ່ບໍ່ມີ lineStatus = WAITING ທັງໝົດ → legacy (ຮັບທັງໃບ).
 */
export const isLineTracked = (items: LineLike[]): boolean =>
  items.some((i) => lineStatusOf(i) !== SupplyLineStatus.WAITING);

/** ຄຳນວນສະຖານະລວມຂອງຄຳຂໍຈາກສະຖານະແຕ່ລະລາຍການ */
export function deriveSupplyStatus(items: LineLike[]): SupplyRequestStatus {
  const ls = items.map(lineStatusOf);
  const has = (s: SupplyLineStatus) => ls.includes(s);
  if (ls.every((s) => s === SupplyLineStatus.REJECTED)) {
    return SupplyRequestStatus.REJECTED;
  }
  if (ls.every((s) => s === SupplyLineStatus.WAITING)) {
    return SupplyRequestStatus.REQUESTED;
  }
  if (
    !has(SupplyLineStatus.WAITING) &&
    has(SupplyLineStatus.COLLECTED) &&
    ls.every(
      (s) => s === SupplyLineStatus.COLLECTED || s === SupplyLineStatus.REJECTED,
    )
  ) {
    return SupplyRequestStatus.CLOSED;
  }
  if (has(SupplyLineStatus.COLLECTED)) return SupplyRequestStatus.PARTIALLY_RECEIVED;
  if (has(SupplyLineStatus.READY)) return SupplyRequestStatus.APPROVED;
  return SupplyRequestStatus.ORDERED;
}
