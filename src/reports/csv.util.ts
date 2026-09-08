// Small, dependency-free CSV converter for flat report rows. Not meant for deeply
// nested objects — report data is flattened before being passed in here.
export function toCsv(rows: Record<string, any>[]): string {
    if (!rows.length) return '';
    const headerSet = new Set<string>();
    rows.forEach((row) => {
        Object.keys(row).forEach((k) => headerSet.add(k));
    });
    const headers = Array.from(headerSet);

    const escape = (value: any) => {
        const str = value === null || value === undefined ? '' : String(value);
        // Quote every field and escape internal quotes — safest default for CSV.
        return `"${str.replace(/"/g, '""')}"`;
    };

    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ];
    return lines.join('\n');
}
