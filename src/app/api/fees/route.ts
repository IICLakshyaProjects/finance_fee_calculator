import { NextResponse } from 'next/server';

import { FeeStructure } from '@/lib/fee';
import { generateId, parseFeeInput } from '@/lib/server/fee-utils';
import {
  getAllFeeStructures,
  insertFeeStructure,
  updateFeeStructure,
  deleteFeeStructure,
} from '@/lib/server/storage';

export async function GET() {
  const entries = await getAllFeeStructures();
  return NextResponse.json(entries);
}

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = parseFeeInput(payload);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid fee data' }, { status: 400 });
  }

  const newEntry: FeeStructure = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...parsed,
  };

  const saved = await insertFeeStructure(newEntry);
  return NextResponse.json(saved, { status: 201 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const deleted = await deleteFeeStructure(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const payload = await request.json();
  const parsed = parseFeeInput(payload);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid fee data' }, { status: 400 });
  }

  const updatedEntry = await updateFeeStructure(id, parsed);
  if (!updatedEntry) {
    return NextResponse.json({ error: 'Fee structure not found' }, { status: 404 });
  }

  return NextResponse.json(updatedEntry);
}
