import { NextRequest, NextResponse } from 'next/server';
import { logAction } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { actionName, details } = body;
    logAction(actionName, details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false });
  }
}
