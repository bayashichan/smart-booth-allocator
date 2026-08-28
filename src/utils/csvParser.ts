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

/** 取り込み方法。merge = 配置を保って差分更新、replace = 全置き換え */
export type ImportMode = 'merge' | 'replace';

export interface MergeOptions {
    /** シートに無くなった既存ブースを削除する */
    removeMissing?: boolean;
}

/** 取り込み行ごとの扱い（プレビュー表示用） */
export type RowStatus = 'updated' | 'added';

export interface MergeResult {
    booths: Booth[];
    /** 既存ブースと一致し、配置を保ったまま内容を更新した件数 */
    updated: number;
    /** 既存に無く、未配置として追加した件数 */
    added: number;
    /** シートに無いため削除した既存ブースの件数 */
    removed: number;
    /** シートに無いがそのまま残した既存ブースの件数 */
    kept: number;
    /** imported と同じ並びの、行ごとの扱い */
    status: RowStatus[];
}

/**
 * 照合キー。全角英数を半角に、ハイフン類とスペースを揃えてから比較する。
 * 「Ａ-01」「a－01」「A 01」を同じ席として扱うため。
 */
const matchKey = (raw?: string): string =>
    normalize(raw ?? '')
        .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/[-‐‑–—ー－_]/g, '-')
        .replace(/\s/g, '')
        .toLowerCase();

/** 既存 id と衝突しない id を作る */
const uniqueId = (used: Set<string>, base: string): string => {
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
};

/**
 * 既存のブースにシートの内容をマージする。
 * 座席番号 → 出展者名の順で既存ブースと突き合わせ、一致したものは
 * 配置（座標・向き・配置済みフラグ）と個別に設定した色を維持したまま、
 * シート由来の項目（名前・座席番号・サイズ・カテゴリ・壁側希望）だけを更新する。
 * 一致しなかったシート行は未配置のブースとして追加する。
 */
export const mergeBooths = (
    existing: Booth[],
    imported: Booth[],
    opts: MergeOptions = {},
): MergeResult => {
    type Slot = { booth: Booth; used: boolean };
    const slots: Slot[] = existing.map(booth => ({ booth, used: false }));

    const buildIndex = (key: (b: Booth) => string) => {
        const map = new Map<string, Slot[]>();
        for (const slot of slots) {
            const k = key(slot.booth);
            if (!k) continue;
            const list = map.get(k);
            if (list) list.push(slot);
            else map.set(k, [slot]);
        }
        return map;
    };
    const seatIndex = buildIndex(b => matchKey(b.seatNumber));
    const nameIndex = buildIndex(b => matchKey(b.name));

    const claim = (map: Map<string, Slot[]>, k: string): Slot | undefined => {
        if (!k) return undefined;
        const slot = map.get(k)?.find(s => !s.used);
        if (slot) slot.used = true;
        return slot;
    };

    // 座席番号での照合を先に済ませる。名前だけの行に席を横取りされないため。
    const matched: (Booth | undefined)[] = imported.map(row => claim(seatIndex, matchKey(row.seatNumber))?.booth);
    imported.forEach((row, i) => {
        if (!matched[i]) matched[i] = claim(nameIndex, matchKey(row.name))?.booth;
    });

    const leftovers = slots.filter(s => !s.used).map(s => s.booth);
    const removeMissing = opts.removeMissing ?? false;

    const usedIds = new Set<string>(
        [...matched.filter((b): b is Booth => !!b), ...(removeMissing ? [] : leftovers)].map(b => b.id),
    );

    const status: RowStatus[] = [];
    const merged = imported.map((row, i) => {
        const prev = matched[i];
        if (!prev) {
            status.push('added');
            return { ...row, id: uniqueId(usedIds, row.id) };
        }
        status.push('updated');
        return {
            ...row,
            id: prev.id,
            // 配置と見た目は既存のものを引き継ぐ
            x: prev.x,
            y: prev.y,
            rotation: prev.rotation,
            isPlaced: prev.isPlaced,
            color: prev.color,
            strokeColor: prev.strokeColor,
            fillColor: prev.fillColor,
            textColor: prev.textColor,
            preferences: { ...prev.preferences, wall: row.preferences.wall },
        };
    });

    return {
        booths: removeMissing ? merged : [...merged, ...leftovers],
        updated: matched.filter(Boolean).length,
        added: merged.length - matched.filter(Boolean).length,
        removed: removeMissing ? leftovers.length : 0,
        kept: removeMissing ? 0 : leftovers.length,
        status,
    };
};
