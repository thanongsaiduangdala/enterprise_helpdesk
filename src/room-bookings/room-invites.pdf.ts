import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import * as fs from 'fs';

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
  note: string;
}

export interface AttendanceReportInput {
  bookingId: string;
  bookingTitle: string;
  roomName: string;
  mode: string;
  startAt: Date;
  endAt: Date;
  invited: number;
  joined: number;
  notJoined: number;
  denied: number;
  rows: AttendanceRow[];
}

const STATUS_COLOR: Record<string, string> = {
  JOINED: '#047857',
  NOT_JOINED: '#6b7280',
  DENIED: '#b91c1c',
};

export async function buildAttendancePdf(
  r: AttendanceReportInput,
): Promise<Buffer> {
  const { doc } = newDoc(40);
  const left = 40;
  const cols = [
    { key: 'name', label: 'Name', w: 120 },
    { key: 'accountId', label: 'Account ID', w: 65 },
    { key: 'contact', label: 'Contact', w: 120 },
    { key: 'status', label: 'Status', w: 65 },
    { key: 'time', label: 'Time', w: 85 },
    { key: 'note', label: 'Note', w: 60 },
  ] as const;
  const bottom = doc.page.height - 50;

  doc
    .fillColor('#111827')
    .fontSize(17)
    .text('Meeting Attendance Report', left, 40);
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#374151');
  doc.text(`${r.bookingTitle}  (${r.bookingId})`);
  doc.text(`Room: ${r.roomName}   |   Mode: ${r.mode}`);
  doc.text(`${fmtDateTime(r.startAt)}  →  ${fmtDateTime(r.endAt)}`);
  doc.moveDown(0.5);
  const summary =
    r.mode === 'PRIVATE'
      ? `Invited: ${r.invited}   Joined: ${r.joined}   Not joined: ${r.notJoined}   Denied attempts: ${r.denied}`
      : `Joined: ${r.joined}   Denied attempts: ${r.denied}`;
  doc.fontSize(11).fillColor('#111827').text(summary);
  doc.moveDown(0.3);
  doc
    .fontSize(8)
    .fillColor('#9ca3af')
    .text(`Generated ${fmtDateTime(new Date())}`);
  doc.moveDown(0.8);

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
      .lineTo(left + 515, y + 14)
      .strokeColor('#d1d5db')
      .stroke();
    doc.y = y + 20;
  };
  drawHeader();

  if (!r.rows.length) {
    doc.fontSize(10).fillColor('#6b7280').text('No records yet.', left, doc.y);
  }

  for (const row of r.rows) {
    doc.fontSize(9);
    const heights = cols.map((c) =>
      doc.heightOfString(String((row as any)[c.key] ?? ''), { width: c.w - 6 }),
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
      const val = String((row as any)[c.key] ?? '');
      doc
        .fillColor(
          c.key === 'status'
            ? STATUS_COLOR[row.status] || '#111827'
            : '#111827',
        )
        .text(val, x, y, { width: c.w - 6 });
      x += c.w;
    }
    doc.y = y + h + 5;
  }

  return collect(doc);
}
