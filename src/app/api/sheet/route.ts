import { NextRequest, NextResponse } from 'next/server';
import { toCsvUrl } from '@/utils/sheetUrl';

export const dynamic = 'force-dynamic';

const SHARING_HINT =
  'スプレッドシートを開けませんでした。共有設定を「リンクを知っている全員」→「閲覧者」にするか、'
  + '「ファイル > 共有 > ウェブに公開」でCSVを公開してください。';

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'URLが指定されていません' }, { status: 400 });
  }

  const target = toCsvUrl(raw);
  if (!target) {
    return NextResponse.json(
      { error: 'Google スプレッドシートのURL（またはシートID）を指定してください' },
      { status: 400 },
    );
  }

  try {
    // ブラウザから直接叩くと CORS で失敗するため、サーバー側で取得して返す
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SmartBoothAllocator/1.0)' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: `${SHARING_HINT}（HTTP ${res.status}）` }, { status: 400 });
    }

    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    // 非公開シートはログイン画面のHTMLが返ってくる
    if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
      return NextResponse.json({ error: SHARING_HINT }, { status: 400 });
    }

    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'スプレッドシートの取得に失敗しました' }, { status: 502 });
  }
}
