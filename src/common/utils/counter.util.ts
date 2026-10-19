import { ClientSession, Model } from 'mongoose';

interface CounterShape {
  _id: string;
  seq: number;
}

/**
 * ຈັດລຳດັບແບບ monotonic ດ້ວຍ collection ນັບເລກ (atomic $inc + upsert).
 * ເໝາະກັບການສ້າງ ID ທີ່ຕ້ອງບໍ່ໃຊ້ເລກທີ່ຖືກປົດໄປແລ້ວຄືນ.
 */
export async function nextSequence(
  counterModel: Model<any>,
  key: string,
  session?: ClientSession,
): Promise<number> {
  const doc = (await counterModel
    .findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, session },
    )
    .exec()) as CounterShape | null;
  return doc ? doc.seq : 0;
}

/**
 * ຍົກ counter ໃຫ້ບໍ່ຕ່ຳກວ່າ `seq` (ໃຊ້ seed ຈາກຂໍ້ມູນເກົ່າ ກ່ອນອອກເລກໃໝ່).
 */
export async function bumpCounterTo(
  counterModel: Model<any>,
  key: string,
  seq: number,
  session?: ClientSession,
): Promise<void> {
  if (seq <= 0) return;
  await counterModel
    .updateOne({ _id: key }, { $max: { seq } }, { upsert: true, session })
    .exec();
}
