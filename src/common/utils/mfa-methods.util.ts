export type MfaMethod = 'email' | 'pin' | 'totp';
export const ALL_MFA_METHODS: MfaMethod[] = ['email', 'pin', 'totp'];

// ວິທີ MFA ທີ່ເປີດໃຊ້ຢູ່ຂອງຜູ້ໃຊ້. ຮອງຮັບຂໍ້ມູນເກົ່າ (ມີແຕ່ mfa.method ຕົວດຽວ ບໍ່ມີ mfa.methods)
export function getEnabledMethods(mfa: any): MfaMethod[] {
  if (!mfa) return [];
  const list: string[] = Array.isArray(mfa.methods) ? mfa.methods : [];
  const source =
    list.length > 0 ? list : mfa.enabled && mfa.method ? [mfa.method] : [];
  return ALL_MFA_METHODS.filter((m) => source.includes(m));
}

// ກົດການຢືນຢັນກ່ອນເພີ່ມ / ປ່ຽນ / ປິດ ວິທີ `target`:
//  - ຕ້ອງຢືນຢັນດ້ວຍວິທີອື່ນທີ່ເປີດໃຊ້ຢູ່ (ບໍ່ແມ່ນ target ເອງ)
//  - ຖ້າ target ເປັນວິທີດຽວທີ່ເປີດຢູ່ → ຢືນຢັນດ້ວຍ target ເອງ
//  - ຖ້າຍັງບໍ່ມີວິທີໃດເປີດຢູ່ເລີຍ → ບໍ່ຕ້ອງຢືນຢັນ (array ຫວ່າງ)
export function verifiersFor(
  enabled: MfaMethod[],
  target: MfaMethod,
): MfaMethod[] {
  const others = enabled.filter((m) => m !== target);
  if (others.length > 0) return others;
  return enabled.includes(target) ? [target] : [];
}
