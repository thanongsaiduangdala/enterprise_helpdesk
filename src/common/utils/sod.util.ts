/**
 * ແຍກໜ້າທີ່ (segregation of duties) ເຊັ່ນ ຜູ້ອະນຸມັດ ≠ ຜູ້ຂໍ, ຜູ້ອະນຸມັດ ≠ ຜູ້ເບີກຈ່າຍ.
 *
 * ຄ່າຖືກອ່ານຈາກ OrganizationSettings.sodEnforce ແລະ ແຄດໄວ້
 * ໄລຍະສັ້ນ (TTL) ເພື່ອໃຫ້ຫຼາຍ instance ບໍ່ຄ້າງຄ່າດົນ. ເມື່ອແກ້ settings
 * ຈະ refresh ແຄດທັນທີ.
 *
 * ຖ້າອ່ານ settings ລົ້ມເຫລວ → FAIL CLOSED (ຖືວ່າບັງຄັບໃຊ້).
 *
 * ລຳດັບຄວາມສຳຄັນ: ແຄດ settings (ຖ້າຕັ້ງໄວ້ຊັດເຈນ) → env SOD_ENFORCE → default ON.
 *
 * ສຳຄັນ: OrganizationSettings.sodEnforce ຕ້ອງ "ບໍ່ຕັ້ງໄວ້" ເທິງທີ່ຈະເປັນ undefined
 * (ຫ້າມີ default ໃນ schema, Mongoose ຈະ apply default ເມື່ hydrate ເອົາ doc ຈາກ DB
 * ເຮັດໃຫ້ env fallback ເປັນສູບຫລາຍ ແລະ SOD_ENFORCE=false ໃຊ້ບໍ່ໄດ້ຜົນ).
 */

type Loader = () => Promise<boolean | undefined>;

const TTL_MS = 45_000;
let cachedValue: boolean | undefined;
let cachedAt = 0;
let loader: Loader | undefined;
let inflight: Promise<boolean> | undefined;

/** ລົງທະບຽນ loader ດຽວຕອນ boot (OrganizationSettingsService) */
export function registerSodLoader(fn: Loader) {
  loader = fn;
}

/** ເອີ້ນຫຼັງແກ້ settings — ລ້າງແຄດໃຫ້ອ່ານໃໝ່ທັນທີ */
export function invalidateSodCache() {
  cachedValue = undefined;
  cachedAt = 0;
}

/**
 * ຄ່າສຳຮັດຈາກ environment — ໃຊ້ເມື່ອ settings ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ (undefined).
 * - SOD_ENFORCE=true  → ບັງຄັບ
 * - SOD_ENFORCE=false → ປິດ
 * - ບໍ່ຕັ້ງ           → ບັງຄັບ (default ON — ບໍ່ຕ້ອງຮັກສາໄວ້ເປັນ ON ຢູ່ທຸກ environment)
 */
export function envFallback(): boolean {
  const v = (process.env.SOD_ENFORCE || '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  // ບໍ່ຕັ້ງ → default ON (ປ້ອຍໄວ້ບໍ່ຕ້ອງໃຊ້ເຄດ້ໃຫ້ປິດ ຫຼື ຕ້ອງຕັ້ງຄ່າເປັນພິເສດ)
  return true;
}

/**
 * ບັງຄັບໃຊ້ SoD ຫຼືບໍ່. ອ່ານແຄດ; ຖ້າໝົດອາຍຸ ຫຼື ຍັງບໍ່ມີ → ໂຫຼດໃໝ່.
 * ຖ້າໂຫຼດລົ້ມເຫຼວ → return true (fail closed).
 */
export async function sodEnforced(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== undefined && now - cachedAt < TTL_MS) {
    return cachedValue;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    let result: boolean;
    if (loader) {
      try {
        const fromSettings = await loader();
        result = fromSettings === undefined ? envFallback() : fromSettings;
      } catch {
        // fail closed — ບັງຄັບໃຊ້ເມື່ອອ່ານ settings ບໍ່ໄດ້
        result = true;
      }
    } else {
      result = envFallback();
    }
    cachedValue = result;
    cachedAt = Date.now();
    inflight = undefined;
    return result;
  })();

  return inflight;
}
