import Papa from 'papaparse';
import { Booth, BoothSize, VendorCategory } from '@/types/layout';

export const VALID_CATEGORIES: VendorCategory[] = [
    '占い・スピリチュアル', '物販', 'ボディケア・美容', '飲食', 'ワークショップ', 'その他',
];

/** 列を「位置」で扱う。見出しが重複・空欄でも取り違えないため。 */
export interface SheetColumn {
    index: number;   // 0 始まり
    letter: string;  // スプレッドシート上の列名 (A, B, ... I, ... AA)
    header: string;  // 見出し行の文言
}

export interface SheetData {
    columns: SheetColumn[];
    rows: string[][]; // 見出しを除いたデータ行
}

/** どの列をどの項目として扱うか。-1 は「使わない」 */
export interface ColumnMapping {
    name: number;
    seatNumber: number;
    size: number;
    category: number;
    wall: number;
    widthMm: number;
    depthMm: number;
}

export const UNUSED_COLUMN = -1;

export const EMPTY_MAPPING: ColumnMapping = {
    name: UNUSED_COLUMN, seatNumber: UNUSED_COLUMN, size: UNUSED_COLUMN,
    category: UNUSED_COLUMN, wall: UNUSED_COLUMN,
    widthMm: UNUSED_COLUMN, depthMm: UNUSED_COLUMN,
};

export const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; hint: string }[] = [
    { key: 'name',       label: '出展者名',     hint: '空でも座席番号があれば取り込む' },
    { key: 'seatNumber', label: '座席番号',     hint: '例: A-01' },
    { key: 'size',       label: 'ブースサイズ', hint: '「1テーブル」「ボディケアブース大」など' },
    { key: 'category',   label: 'カテゴリ',     hint: '色分けに使用' },
    { key: 'wall',       label: '壁側希望',     hint: '「壁側」「TRUE」「○」など' },
    { key: 'widthMm',    label: '幅 (mm)',      hint: '個別サイズを直接指定する場合' },
    { key: 'depthMm',    label: '奥行 (mm)',    hint: '個別サイズを直接指定する場合' },
];

/** 0 -> A, 8 -> I, 26 -> AA */
export const columnLetter = (index: number): string => {
    let s = '';
    let n = index;
    while (n >= 0) {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
};

/** 全角の数字・記号・空白を半角に寄せてから判定する */
const normalize = (raw: string): string =>
    String(raw)
        .replace(/[０-９．／（）]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' ')
        .trim();

/**
 * ブースサイズの判定ルール。上から順に最初に一致したものを採用する。
 * 「半テーブル」は数字を含まないため、数字を見るルールより先に置く。
 */
const SIZE_RULES: { pattern: RegExp; size: BoothSize }[] = [
    { pattern: /ボディケア.*大/,        size: 1.5 },
    { pattern: /ボディケア.*小/,        size: 1.0 },
    { pattern: /半\s*テーブル/,         size: 0.5 },
    { pattern: /0\.5/,                  size: 0.5 },
    { pattern: /1\.5\s*テーブル?/,      size: 1.5 },
    { pattern: /3\s*テーブル/,          size: 3.0 },
    { pattern: /2\s*テーブル/,          size: 2.0 },
    { pattern: /1\s*テーブル/,          size: 1.0 },
];

const NUMERIC_SIZES: BoothSize[] = [0.5, 1.0, 1.5, 2.0, 3.0];

/**
 * サイズ表記のルールに一致するか。
 * 列の自動判別に使うため、裸の数字（電話番号・金額などと区別がつかない）は
 * ここでは一致とみなさない。
 */
export const looksLikeSize = (raw: string): boolean => {
    const s = normalize(raw);
    if (!s) return false;
    return SIZE_RULES.some(r => r.pattern.test(s));
};

export const parseSize = (raw: string): BoothSize => {
    const s = normalize(raw);
    if (!s) return 1.0;
    for (const rule of SIZE_RULES) {
        if (rule.pattern.test(s)) return rule.size;
    }
    // 「2」のように数値だけが入っている場合。
    // 卓数としてありえない値（電話番号など）は無視して既定値に戻す。
    const num = Number(s);
    if (Number.isFinite(num) && num > 0 && num <= 4) {
        return NUMERIC_SIZES.reduce((best, cand) =>
            Math.abs(cand - num) < Math.abs(best - num) ? cand : best, 1.0 as BoothSize);
    }
    return 1.0;
};

const parseWall = (wallRaw: string, sizeRaw: string): boolean => {
    const wall = normalize(wallRaw);
    if (/^(true|yes|y|1|○|◯|●|はい|希望|要)$/i.test(wall)) return true;
    // サイズ欄に「1テーブル（壁側希望）」のように併記されている場合も拾う
    return /壁/.test(wall) || /壁/.test(normalize(sizeRaw));
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
    const n = parseFloat(normalize(raw).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** CSV テキストを「見出し行 + データ行」に分解する */
export const parseCsvText = (csvText: string): SheetData => {
    const result = Papa.parse<string[]>(csvText, { skipEmptyLines: 'greedy' });
    const raw = (result.data ?? []).filter(r => Array.isArray(r));
    if (raw.length === 0) return { columns: [], rows: [] };

    const headerRow = raw[0];
    const width = raw.reduce((max, r) => Math.max(max, r.length), 0);
    const columns: SheetColumn[] = Array.from({ length: width }, (_, i) => ({
        index: i,
        letter: columnLetter(i),
        header: String(headerRow[i] ?? '').trim(),
    }));

    const rows = raw.slice(1)
        .map(r => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim()))
        .filter(r => r.some(cell => cell !== ''));

    return { columns, rows };
};

/** 見出し候補から最初に一致した列を返す */
const pickByHeader = (columns: SheetColumn[], patterns: RegExp[]): number => {
    for (const re of patterns) {
        const hit = columns.find(c => c.header && re.test(c.header));
        if (hit) return hit.index;
    }
    return UNUSED_COLUMN;
};

/** 中身がサイズ表記らしい列を探す（見出しで見つからなかったときの保険） */
const pickSizeByContent = (data: SheetData): number => {
    let best = UNUSED_COLUMN;
    let bestScore = 0;
    for (const col of data.columns) {
        const values = data.rows.map(r => r[col.index]).filter(v => v !== '');
        if (values.length === 0) continue;
        const matched = values.filter(looksLikeSize).length;
        const score = matched / values.length;
        // 2件以上かつ大半がサイズ表記に見える列だけを採用する
        if (matched >= 2 && score >= 0.6 && score > bestScore) { bestScore = score; best = col.index; }
    }
    return best;
};

/** 見出し行と中身から列の対応を推測する */
export const guessMapping = (data: SheetData): ColumnMapping => {
    const c = data.columns;
    const size = pickByHeader(c, [
        /出展ブース/, /出展形態/, /ブースサイズ|サイズ/, /テーブル/, /出展区分|申込区分/, /^size$/i,
    ]);
    return {
        name:       pickByHeader(c, [/出展名/, /出展者/, /店名|ブランド/, /名前|氏名/, /^name$/i]),
        seatNumber: pickByHeader(c, [/座席番号/, /座席|席番/, /ブース番号/, /^no\.?$/i, /^seat/i]),
        size:       size !== UNUSED_COLUMN ? size : pickSizeByContent(data),
        category:   pickByHeader(c, [/出展カテゴリ/, /カテゴリ|ジャンル|区分/, /^category$/i]),
        wall:       pickByHeader(c, [/壁側/, /壁/, /^wall$/i]),
        widthMm:    pickByHeader(c, [/幅.*mm|mm.*幅/, /^width/i]),
        depthMm:    pickByHeader(c, [/奥行.*mm|mm.*奥行/, /^depth/i]),
    };
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
    const data = parseCsvText(await res.text());
    if (data.columns.length === 0) {
        throw new Error('シートが空でした。1行目に見出しを入れてください。');
    }
    return data;
};

/** 列の対応にしたがって Booth[] を組み立てる */
export const buildBooths = (rows: string[][], mapping: ColumnMapping): Booth[] => {
    const get = (row: string[], key: keyof ColumnMapping) =>
        mapping[key] >= 0 ? (row[mapping[key]] ?? '') : '';

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
