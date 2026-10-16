/**
 * ແຍກໜ້າທີ່ (segregation of duties) ເຊັ່ນ ຜູ້ອະນຸມັດ ≠ ຜູ້ຂໍ, ຜູ້ອະນຸມັດ ≠ ຜູ້ເບີກຈ່າຍ.
 * - SOD_ENFORCE=true  → ບັງຄັບສະເໝີ
 * - SOD_ENFORCE=false → ປິດ
 * - ບໍ່ຕັ້ງ           → ບັງຄັບສະເພາະ NODE_ENV=production (ເພື່ອຜູ້ພັດທະນາທີ່ມີບັນຊີດຽວທົດສອບໄດ້)
 */
export function sodEnforced(): boolean {
  const v = (process.env.SOD_ENFORCE || '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
