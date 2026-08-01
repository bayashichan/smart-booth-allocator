import Papa from 'papaparse';
import { Booth, BoothSize, VendorCategory } from '@/types/layout';

export const VALID_CATEGORIES: VendorCategory[] = [
    '占い・スピリチュアル', '物販', 'ボディケア・美容', '飲食', 'ワークショップ', 'その他',
];

export type SheetRow = Record<string, string>;

export interface SheetData {
    headers: string[];
    rows: SheetRow[];
}

/** どの列をどの項目として扱うか。空文字は「使わない」 */
export interface ColumnMapping {
    name: string;
    seatNumber: string;
    size: string;
    category: string;
    wall: string;
    widthMm: string;
    depthMm: string;
}

export const EMPTY_MAPPING: ColumnMapping = {
    name: '', seatNumber: '', size: '', category: '', wall: '', widthMm: '', depthMm: '',
};

export const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; hint: string }[] = [
    { key: 'name',       label: '出展者名',   hint: '必須ではないが推奨' },
    { key: 'seatNumber', label: '座席番号',   hint: '例: A-01' },
    { key: 'size',       label: 'ブースサイズ', hint: '「1テーブル」「半テーブル」「2」など' },
    { key: 'category',   label: 'カテゴリ',   hint: '色分けに使用' },
    { key: 'wall',       label: '壁側希望',   hint: '「壁側」「TRUE」「○」など' },
    { key: 'widthMm',    label: '幅 (mm)',    hint: '個別サイズを直接指定する場合' },
    { key: 'depthMm',    label: '奥行 (mm)',  hint: '個別サイズを直接指定する場合' },
];

/** 列名の候補から最初に一致したものを返す */
const pickHeader = (headers: string[], patterns: RegExp[]): string => {
    for (const re of patterns) {
        const hit = headers.find(h => re.test(h));
        if (hit) return hit;
    }
    return '';
};

/** ヘッダー行から列の対応を推測する */
export const guessMapping = (headers: string[]): ColumnMapping => ({
    name:       pickHeader(headers, [/出展名/, /出展者/, /店名|ブランド/, /名前|氏名/, /^name$/i]),
    seatNumber: pickHeader(headers, [/座席番号/, /座席|席番/, /ブース番号/, /^no\.?$/i, /^seat/i]),
    size:       pickHeader(headers, [/出展ブース/, /ブースサイズ|サイズ/, /テーブル/, /^size$/i]),
    category:   pickHeader(headers, [/出展カテゴリ/, /カテゴリ|ジャンル|区分/, /^category$/i]),
    wall:       pickHeader(headers, [/壁側/, /壁/, /^wall$/i]),
    widthMm:    pickHeader(headers, [/幅.*mm|mm.*幅/, /^width/i]),
    depthMm:    pickHeader(headers, [/奥行.*mm|mm.*奥行/, /^depth/i]),
});

/** 「1テーブル」「半」「2」などからブースサイズを判定 */
const parseSize = (raw: string): BoothSize => {
    const s = raw.trim();
    if (!s) return 1.0;
    if (/半|0\.5/.test(s)) return 0.5;
    if (/3/.test(s)) return 3.0;
    if (/2/.test(s)) return 2.0;
    return 1.0;
};

const parseWall = (raw: string, sizeRaw: string): boolean => {
    const s = `${raw} ${sizeRaw}`.trim();
    if (!s) return false;
    return /壁/.test(s) || /^(true|yes|y|1|○|◯|●|はい|希望)$/i.test(raw.trim());
};

const parseCategory = (raw: string): VendorCategory => {
    const s = raw.trim();
    if (!s) return 'その他';
    const exact = VALID_CATEGORIES.find(c => c === s);
    if (exact) return exact;
    // 部分一致でも拾う（「物販・雑貨」など）
    const partial = VALID_CATEGORIES.find(c => c !== 'その他' && (s.includes(c) || c.includes(s)));
    return partial ?? 'その他';
};

const parseMm = (raw: string): number | undefined => {
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** CSV テキストをヘッダー付きで解析する */
export const parseCsvText = (csvText: string): SheetData => {
    const result = Papa.parse<SheetRow>(csvText, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim(),
    });
    const headers = (result.meta.fields ?? []).filter(h => h !== '');
    const rows = (result.data ?? []).map(row => {
        const clean: SheetRow = {};
        headers.forEach(h => { clean[h] = String(row[h] ?? '').trim(); });
        return clean;
    });
    return { headers, rows };
};

/**
 * スプレッドシートを読み込む。
 * ブラウザから docs.google.com を直接 fetch すると CORS で失敗するため、
 * 自前の API ルート経由で取得する。
 */
export const fetchSheet = async (url: string): Promise<SheetData> => {
    const res = await fetch(`/api/sheet?url=${encodeURIComponent(url.trim())}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'スプレッドシートの読み込みに失敗しました');
    }
    const csvText = await res.text();
    const data = parseCsvText(csvText);
    if (data.headers.length === 0) {
        throw new Error('シートに見出し行が見つかりませんでした。1行目に列名を入れてください。');
    }
    return data;
};

/** 列の対応にしたがって Booth[] を組み立てる */
export const buildBooths = (rows: SheetRow[], mapping: ColumnMapping): Booth[] => {
    const get = (row: SheetRow, key: keyof ColumnMapping) =>
        mapping[key] ? (row[mapping[key]] ?? '') : '';

    return rows
        .map((row, index): Booth | null => {
            const name       = get(row, 'name').trim();
            const seatNumber = get(row, 'seatNumber').trim();
            // 名前も座席番号も無い行は空行とみなす
            if (!name && !seatNumber) return null;

            const sizeRaw = get(row, 'size');
            const widthMm = parseMm(get(row, 'widthMm'));
            const depthMm = parseMm(get(row, 'depthMm'));

            return {
                id: `imported-${index + 1}`,
                name: name || `出展者 ${index + 1}`,
                seatNumber: seatNumber || undefined,
                size: parseSize(sizeRaw),
                category: parseCategory(get(row, 'category')),
                preferences: { wall: parseWall(get(row, 'wall'), sizeRaw) },
                // 幅・奥行きの両方が指定されたときだけ個別サイズを使う
                sizeMm: widthMm && depthMm ? { width: widthMm, depth: depthMm } : undefined,
                x: 0,
                y: 0,
                rotation: 0 as const,
                isPlaced: false,
            };
        })
        .filter((b): b is Booth => b !== null);
};
