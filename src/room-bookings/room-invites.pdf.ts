import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import * as fs from 'fs';
import type { MeetingSummary } from './meeting-summary.util';

// pdfkit ມາພ້ອມຟອນ Helvetica ເທົ່ານັ້ນ — ບໍ່ຮອງຮັບ ພາສາລາວ. ຖ້າຕ້ອງການໃຫ້ຊື່ພາສາລາວສະແດງໃນ PDF ໃຫ້ຕັ້ງ
// PDF_FONT_PATH=/path/to/NotoSansLao-Regular.ttf (ຫຼືຟອນ Unicode ອື່ນທີ່ມີ glyph ລາວ) ໃນ .env
const FONT_PATH = process.env.PDF_FONT_PATH;
const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Vientiane';

function newDoc(margin = 50) {
  const doc = new PDFDocument({ margin, size: 'A4' });
  let fontName = 'Helvetica';
  if (FONT_PATH && fs.existsSync(FONT_PATH)) {
    doc.registerFont('body', FONT_PATH);
    fontName = 'body';
  }
  doc.font(fontName);
  return { doc, fontName };
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function fmtDateTime(d?: Date | string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export interface QrPageInput {
  mode: string; // 'PUBLIC' | 'PRIVATE'
  url: string;
  bookingTitle: string;
  roomName: string;
  startAt: Date;
  endAt: Date;
  guestName?: string;
  guestAccountId?: string;
}

// ສ້າງ PDF ທີ່ມີ QR ໜຶ່ງໜ້າຕໍ່ໜຶ່ງ QR (ພິມຕິດປະຕູ ຫຼື ແຈກໃຫ້ແຂກແຕ່ລະຄົນ)
export async function buildQrPdf(pages: QrPageInput[]): Promise<Buffer> {
  const { doc } = newDoc();
  const pageW = doc.page.width;
  const contentW = pageW - 100;

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (i > 0) doc.addPage();

    const isPublic = p.mode === 'PUBLIC';
    doc
      .fillColor('#111827')
      .fontSize(26)
      .text(p.guestName ? 'Guest Pass' : 'Room Check-in', 50, 60, {
        width: contentW,
        align: 'center',
      });

    doc.moveDown(0.4);
    doc
      .fontSize(11)
      .fillColor(isPublic ? '#047857' : '#b45309')
      .text(
        isPublic
          ? 'PUBLIC — open to everyone'
          : 'PRIVATE — invited guests only',
        { width: contentW, align: 'center' },
      );

    doc.moveDown(1);
    doc
      .fillColor('#111827')
      .fontSize(18)
      .text(p.bookingTitle, { width: contentW, align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .fillColor('#374151')
      .text(`Room: ${p.roomName}`, { width: contentW, align: 'center' });
    doc.text(`${fmtDateTime(p.startAt)}  →  ${fmtDateTime(p.endAt)}`, {
      width: contentW,
      align: 'center',
    });

    if (p.guestName) {
      doc.moveDown(1);
      doc
        .fontSize(20)
        .fillColor('#111827')
        .text(p.guestName, { width: contentW, align: 'center' });
      if (p.guestAccountId) {
        doc.moveDown(0.2);
        doc
          .fontSize(12)
          .fillColor('#374151')
          .text(`Account ID: ${p.guestAccountId}`, {
            width: contentW,
            align: 'center',
          });
      }
    }

    const qrBuf = await QRCode.toBuffer(p.url, {
      type: 'png',
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    const qrSize = 300;
    const qrY = Math.max(doc.y + 25, 300);
    doc.image(qrBuf, (pageW - qrSize) / 2, qrY, {
      width: qrSize,
      height: qrSize,
    });

    doc
      .fillColor('#111827')
      .fontSize(14)
      .text('Scan with your phone camera to check in', 50, qrY + qrSize + 15, {
        width: contentW,
        align: 'center',
      });
    doc.moveDown(0.5);
    const note = isPublic
      ? 'Log in with your account, or enter your name. Anyone can join this meeting.'
      : p.guestAccountId
        ? 'This pass is tied to the account above. Log in with that account to check in.'
        : p.guestName
          ? 'This pass is personal. Do not share it — it is tied to the name above.'
          : 'Log in with your account, or enter your name and the email or phone number you were invited with. Only people on the guest list are admitted.';
    doc
      .fontSize(9)
      .fillColor('#6b7280')
      .text(note, { width: contentW, align: 'center' });
    doc.moveDown(0.8);
    doc
      .fontSize(7)
      .fillColor('#9ca3af')
      .text(p.url, { width: contentW, align: 'center' });
  }

  return collect(doc);
}

export interface AttendanceRow {
  name: string;
  accountId: string;
  contact: string;
  status: string;
  time: string;
  arrival: string;
  note: string;
}

export interface AttendanceReportInput {
  bookingId: string;
  bookingTitle: string;
  roomName: string;
  summary: MeetingSummary;
  rows: AttendanceRow[];
}

const STATUS_COLOR: Record<string, string> = {
  JOINED: '#047857',
  NOT_JOINED: '#6b7280',
  DENIED: '#b91c1c',
};

const STATUS_LABEL: Record<string, string> = {
  JOINED: 'Came',
  NOT_JOINED: 'Did not come',
  DENIED: 'Denied',
};

// ລາຍງານສະຫຼຸບການປະຊຸມ (PDF) — ສະຫຼຸບ → timeline → ຕາຕະລາງລາຍຊື່ຄົນມາ/ບໍ່ມາ
export async function buildAttendancePdf(
  r: AttendanceReportInput,
): Promise<Buffer> {
  const { doc } = newDoc(40);
  const left = 40;
  const fullW = 515;
  const bottom = doc.page.height - 50;

  const ensureSpace = (h: number) => {
    if (doc.y + h > bottom) {
      doc.addPage();
      doc.y = 40;
    }
  };

  doc.fillColor('#111827').fontSize(18).text('Meeting Summary Report', left, 40);
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#374151').text(`${r.bookingTitle}`);
  doc
    .fontSize(9)
    .fillColor('#9ca3af')
    .text(`${r.roomName}  |  ${r.bookingId}  |  Generated ${fmtDateTime(new Date())}`);
  doc.moveDown(0.8);

  // ----- ສ່ວນສະຫຼຸບ (label : value) -----
  const labelW = 150;
  for (const section of r.summary.sections) {
    ensureSpace(40);
    doc.fontSize(11).fillColor('#b45309').text(section.title.toUpperCase(), left, doc.y);
    doc
      .moveTo(left, doc.y + 1)
      .lineTo(left + fullW, doc.y + 1)
      .strokeColor('#e5e7eb')
      .stroke();
    doc.y += 6;
    for (const item of section.items) {
      doc.fontSize(9.5);
      const h = Math.max(
        doc.heightOfString(item.label, { width: labelW - 8 }),
        doc.heightOfString(item.value, { width: fullW - labelW }),
        12,
      );
      ensureSpace(h + 4);
      const y = doc.y;
      doc.fillColor('#6b7280').text(item.label, left, y, { width: labelW - 8 });
      doc.fillColor('#111827').text(item.value, left + labelW, y, { width: fullW - labelW });
      doc.y = y + h + 3;
    }
    doc.moveDown(0.6);
  }

  // ----- timeline -----
  if (r.summary.timeline.length) {
    ensureSpace(50);
    doc.fontSize(11).fillColor('#b45309').text('TIMELINE', left, doc.y);
    doc
      .moveTo(left, doc.y + 1)
      .lineTo(left + fullW, doc.y + 1)
      .strokeColor('#e5e7eb')
      .stroke();
    doc.y += 6;
    for (const t of r.summary.timeline) {
      doc.fontSize(9);
      const h = Math.max(
        doc.heightOfString(t.event, { width: 150 }),
        doc.heightOfString(t.detail, { width: fullW - 280 }),
        12,
      );
      ensureSpace(h + 4);
      const y = doc.y;
      doc.fillColor('#6b7280').text(t.at, left, y, { width: 115 });
      doc.fillColor('#111827').text(t.event, left + 120, y, { width: 150 });
      doc.fillColor('#374151').text(t.detail, left + 275, y, { width: fullW - 275 });
      doc.y = y + h + 3;
    }
    doc.moveDown(0.6);
  }

  // ----- ຕາຕະລາງຜູ້ເຂົ້າຮ່ວມ -----
  const cols = [
    { key: 'name', label: 'Name', w: 115 },
    { key: 'accountId', label: 'Account ID', w: 60 },
    { key: 'contact', label: 'Contact', w: 105 },
    { key: 'status', label: 'Status', w: 60 },
    { key: 'time', label: 'Arrived', w: 80 },
    { key: 'arrival', label: 'vs start', w: 55 },
    { key: 'note', label: 'Note', w: 40 },
  ] as const;

  const drawHeader = () => {
    const y = doc.y;
    let x = left;
    doc.fontSize(9).fillColor('#111827');
    for (const c of cols) {
      doc.text(c.label, x, y, { width: c.w - 6 });
      x += c.w;
    }
    doc
      .moveTo(left, y + 14)
      .lineTo(left + fullW, y + 14)
      .strokeColor('#d1d5db')
      .stroke();
    doc.y = y + 20;
  };

  ensureSpace(70);
  doc.fontSize(11).fillColor('#b45309').text('ATTENDEES', left, doc.y);
  doc.y += 8;
  drawHeader();

  if (!r.rows.length) {
    doc.fontSize(10).fillColor('#6b7280').text('No records yet.', left, doc.y);
  }

  for (const row of r.rows) {
    doc.fontSize(9);
    const cell = (key: string) =>
      key === 'status'
        ? STATUS_LABEL[row.status] ?? row.status
        : String((row as any)[key] ?? '');
    const heights = cols.map((c) =>
      doc.heightOfString(cell(c.key), { width: c.w - 6 }),
    );
    const h = Math.max(...heights, 12);
    if (doc.y + h > bottom) {
      doc.addPage();
      doc.y = 40;
      drawHeader();
    }
    const y = doc.y;
    let x = left;
    for (const c of cols) {
      doc
        .fillColor(
          c.key === 'status'
            ? STATUS_COLOR[row.status] || '#111827'
            : '#111827',
        )
        .text(cell(c.key), x, y, { width: c.w - 6 });
      x += c.w;
    }
    doc.y = y + h + 5;
  }

  return collect(doc);
}
