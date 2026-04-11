import { NextResponse } from 'next/server';

import { bulkDeleteFeeStructures } from '@/lib/server/storage';

export async function POST(request: Request) {
  let payload: { ids?: unknown } | null = null;
  try {
    payload = (await request.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!payload || !Array.isArray(payload.ids)) {
    return NextResponse.json({ error: 'ids array is required.' }, { status: 400 });
  }

  const ids = payload.ids
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid ids provided.' }, { status: 400 });
  }

  const deleted = await bulkDeleteFeeStructures(ids);
  return NextResponse.json({ deleted });
}
