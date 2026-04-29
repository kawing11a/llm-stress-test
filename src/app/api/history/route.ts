import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE_PATH = path.join(DATA_DIR, 'history.json');

async function ensureDataFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(FILE_PATH);
    } catch {
      await fs.writeFile(FILE_PATH, JSON.stringify([]));
    }
  } catch (error) {
    console.error('Failed to ensure data file:', error);
  }
}

export async function GET() {
  await ensureDataFile();
  try {
    const data = await fs.readFile(FILE_PATH, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read history' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await ensureDataFile();
  try {
    const record = await req.json();
    
    // Ensure ID is set properly based on timestamp if not already unique
    if (!record.id) {
      record.id = Date.now();
    }

    const data = await fs.readFile(FILE_PATH, 'utf-8');
    const history = JSON.parse(data);
    
    // Add new record to beginning of array
    history.unshift(record);
    
    await fs.writeFile(FILE_PATH, JSON.stringify(history, null, 2));
    return NextResponse.json({ success: true, record });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save record' }, { status: 500 });
  }
}
