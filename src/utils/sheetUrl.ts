// SSRF 防止のため Google スプレッドシートのみ許可する
const ALLOWED_HOSTS = new Set(['docs.google.com']);

/**
 * ユーザーが貼り付けた文字列を CSV エクスポート URL に正規化する。
 * 対応する形式:
 *   - https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
 *   - https://docs.google.com/spreadsheets/d/<ID>/edit?gid=0
 *   - https://docs.google.com/spreadsheets/d/e/<ID>/pubhtml        （ウェブに公開）
 *   - https://docs.google.com/spreadsheets/d/e/<ID>/pub?output=csv
 *   - <ID> だけの貼り付け
 *
 * 許可外のホストや形式は null を返す。
 */
export function toCsvUrl(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;

    // 素のシートIDだけを貼られた場合
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) {
        return `https://docs.google.com/spreadsheets/d/${s}/export?format=csv`;
    }

    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
        return null;
    }
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    if (!u.pathname.includes('/spreadsheets')) return null;

    // gid はクエリにもフラグメント (#gid=123) にも現れる
    const gid = u.searchParams.get('gid') ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null;

    const publishedMatch = u.pathname.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
    if (publishedMatch) {
        // 「ウェブに公開」されたシート
        return `https://docs.google.com/spreadsheets/d/e/${publishedMatch[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`;
    }

    const idMatch = u.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return null;
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}
