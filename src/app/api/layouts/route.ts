import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
      return NextResponse.json({ error: 'Database is not configured. Please connect Vercel KV.' }, { status: 500 });
    }

    const data = await req.json();
    
    // 短いIDを生成（8文字）
    const id = uuidv4().substring(0, 8);

    // 有効期限を90日（約3ヶ月）に設定して保存
    await redis.set(`layout:${id}`, data, { ex: 60 * 60 * 24 * 90 });

    return NextResponse.json({ id });
  } catch (error) {
    console.error('Error saving layout:', error);
    return NextResponse.json({ error: 'Failed to save layout' }, { status: 500 });
  }
}
