import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const baseUrl = url.searchParams.get('baseUrl');
  const apiKey = url.searchParams.get('apiKey') || '';

  if (!baseUrl) {
    return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch models');

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
