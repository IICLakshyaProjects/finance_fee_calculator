import { readFileSync, existsSync } from 'fs';
import path from 'path';

import { NextResponse } from 'next/server';
import { read, utils, write } from 'xlsx';

const TEMPLATE_ROW_LIMIT = 22;

/**
 * Serves a sample .xlsx by slicing the first sheet from a project file (no hardcoded grid).
 * Resolution order: `Lakshya Course Fees 2026-27 for AO .xlsx`, then `public/fee-structure-template.xlsx`.
 */
export async function GET() {
  const cwd = process.cwd();
  const envPath = process.env.FEE_SAMPLE_XLSX_PATH?.trim();
  const candidates = [
    ...(envPath ? [envPath] : []),
    path.join(cwd, 'Lakshya Course Fees 2026-27 for AO .xlsx'),
    path.join(cwd, 'public', 'fee-structure-template.xlsx'),
  ];

  for (const full of candidates) {
    if (!full || !existsSync(full)) {
      continue;
    }
    try {
      const wb = read(readFileSync(full), { type: 'buffer' });
      const sheetName =
        wb.SheetNames.find((n) => /draft|kerala|lakshya/i.test(n)) ?? wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet['!ref']) {
        continue;
      }
      const aoa = utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
      const slice = aoa.slice(0, Math.min(TEMPLATE_ROW_LIMIT, aoa.length));
      const out = utils.book_new();
      const ns = utils.aoa_to_sheet(slice);
      utils.book_append_sheet(out, ns, sheetName.slice(0, 31));
      const buffer = write(out, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="fee-upload-sample.xlsx"',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    {
      error:
        'No sample workbook found. Add Lakshya Course Fees 2026-27 for AO .xlsx at the project root, place fee-structure-template.xlsx under public/, or set FEE_SAMPLE_XLSX_PATH.',
    },
    { status: 404 }
  );
}
