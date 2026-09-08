import PDFDocument from 'pdfkit';

// Renders a simple titled table of flat rows into a PDF Buffer. Deliberately basic
// (no styling library) — good enough for an internal admin report, not a polished
// customer-facing document.
export function rowsToPdfBuffer(title: string, rows: Record<string, any>[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

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