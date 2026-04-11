import { NextResponse } from 'next/server';

import { deleteAllFeeStructures } from '@/lib/server/storage';

export async function POST() {
  const deleted = await deleteAllFeeStructures();
  return NextResponse.json({ deleted });
}
