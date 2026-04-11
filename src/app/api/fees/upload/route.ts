import { NextResponse } from 'next/server';

import { FeeStructure } from '@/lib/fee';
import { generateId, parseFeeInput } from '@/lib/server/fee-utils';
import { bulkInsertFeeStructures } from '@/lib/server/storage';

type CommitPayload = {
  entries: unknown[];
};

export async function POST(request: Request) {
  let payload: CommitPayload | null = null;
  try {
    payload = (await request.json()) as CommitPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!payload || !Array.isArray(payload.entries)) {
    return NextResponse.json({ error: 'entries array is required.' }, { status: 400 });
  }

  const parsedEntries: FeeStructure[] = [];
  const errors: string[] = [];

  payload.entries.forEach((entry, index) => {
    const parsed = parseFeeInput(entry);
    if (!parsed) {
      errors.push(`Row ${index + 1}: invalid values.`);
      return;
    }

    parsedEntries.push({
      id: generateId(),
      createdAt: new Date().toISOString(),
      ...parsed,
    });
  });

  if (parsedEntries.length === 0) {
    return NextResponse.json(
      { error: 'No valid rows were provided.', errors },
      { status: 400 }
    );
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Some rows contained invalid data.', errors },
      { status: 400 }
    );
  }

  await bulkInsertFeeStructures(parsedEntries);

  return NextResponse.json({ inserted: parsedEntries.length }, { status: 201 });
}
