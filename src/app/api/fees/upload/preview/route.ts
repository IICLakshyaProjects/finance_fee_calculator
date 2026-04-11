import { NextResponse } from 'next/server';

import {
  parseUploadedFeeFile,
  validateFlatFileHeaders,
} from '@/lib/server/fee-upload-parse';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Please choose a file to upload.' }, { status: 400 });
  }

  const fileName = 'name' in file && typeof file.name === 'string' ? file.name : 'upload.xlsx';
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const validation = validateFlatFileHeaders(fileName, buffer);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.message,
        headers: [],
        rawRows: [],
        rows: [],
        errors: [],
        layout: null,
        sheetName: null,
        canSave: false,
      },
      { status: 400 }
    );
  }

  const sheetField = formData.get('sheetName');
  const sheetName =
    typeof sheetField === 'string' && sheetField.trim().length > 0 ? sheetField.trim() : undefined;

  const preview = parseUploadedFeeFile(buffer, fileName, { sheetName });

  if (preview.rawRows.length === 0) {
    return NextResponse.json(
      {
        error: 'No data rows were found under the detected header row.',
        headers: preview.headers,
        rawRows: preview.rawRows,
        rows: preview.rows,
        errors: preview.errors,
        layout: preview.layout,
        sheetName: preview.sheetName,
        canSave: preview.canSave,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    headers: preview.headers,
    rawRows: preview.rawRows,
    rows: preview.rows,
    errors: preview.errors,
    layout: preview.layout,
    sheetName: preview.sheetName,
    canSave: preview.canSave,
    fileName,
  });
}
