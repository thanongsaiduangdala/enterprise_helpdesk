import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';




export function rowsToPdfBuffer(title: string, rows: Record<string, any>[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Optional custom font (e.g. Lao) — falls back to the built-in font when unset/missing
        const fontPath = process.env.PDF_FONT_PATH;
        if (fontPath && existsSync(fontPath)) {
            doc.registerFont('ReportFont', fontPath);
            doc.font('ReportFont');
        }

        doc.fontSize(16).text(title, { underline: true });
        doc.moveDown();

        if (!rows.length) {
            doc.fontSize(11).text('No data for this report.');
            doc.end();
            return;
        }

        const headerSet = new Set<string>();
        rows.forEach((row) => {
            Object.keys(row).forEach((k) => headerSet.add(k));
        });
        const headers = Array.from(headerSet);

        doc.fontSize(10);
        doc.text(headers.join('  |  '), { underline: true });
        doc.moveDown(0.5);

        rows.forEach((row) => {
            const line = headers.map((h) => String(row[h] ?? '')).join('  |  ');
            doc.text(line);
        });

        doc.end();
    });
}