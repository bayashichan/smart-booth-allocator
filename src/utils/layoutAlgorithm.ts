import { Booth, DimensionSettings, DEFAULT_DIMENSIONS } from '@/types/layout';

export interface AutoLayoutOptions extends Partial<DimensionSettings> {
    boothGap?: number; // ブース間の隙間（グリッド数）
    aisle?: number;    // 通路幅（グリッド数）
}

/**
 * 自然順ソート比較関数
 * 数字と文字が混在するブース番号に対応（例: 1, 2, 8a, 8b, 10, 11a）
 */
const naturalCompare = (a: string, b: string): number => {
    const tokenize = (s: string) => {
        const parts: Array<[number, string]> = [];
        s.replace(/(\d+)|(\D+)/g, (_, num, str) => {
            parts.push([num !== undefined ? parseInt(num, 10) : Infinity, str ?? '']);
            return '';
        });
        return parts;
    };
    const ax = tokenize(a);
    const bx = tokenize(b);
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
        const [an, as_] = ax[i] ?? [Infinity, ''];
        const [bn, bs_] = bx[i] ?? [Infinity, ''];
        if (an !== bn) return an - bn;
        const sc = as_.localeCompare(bs_);
        if (sc !== 0) return sc;
    }
    return 0;
};

const seatNum = (booth: Booth): string => booth.seatNumber ?? booth.name ?? '';

export const autoLayout = (
    booths: Booth[],
    gridRows: number,
    gridCols: number,
    options: AutoLayoutOptions = {},
): Booth[] => {
    const gridUnitMm       = options.gridUnitMm       ?? DEFAULT_DIMENSIONS.gridUnitMm;
    const baseTableWidthMm = options.baseTableWidthMm ?? DEFAULT_DIMENSIONS.baseTableWidthMm;
    const baseTableDepthMm = options.baseTableDepthMm ?? DEFAULT_DIMENSIONS.baseTableDepthMm;
    const BOOTH_GAP        = options.boothGap ?? 1;
    const AISLE            = options.aisle    ?? 2;

    const boothGridW = (booth: Booth) =>
        Math.max(1, Math.round((booth.sizeMm?.width ?? booth.size * baseTableWidthMm) / gridUnitMm));

    const boothGridH = (booth: Booth) =>
        Math.max(1, Math.round((booth.sizeMm?.depth ?? baseTableDepthMm) / gridUnitMm));

    const newBooths: Booth[] = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];

    const collides = (x: number, y: number, w: number, h: number): boolean => {
        if (x < 0 || y < 0 || x + w > gridCols || y + h > gridRows) return true;
        for (const r of placed) {
            if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
        }
        return false;
    };

    const place = (booth: Booth, x: number, y: number, w: number, h: number) => {
        newBooths.push({ ...booth, x, y, isPlaced: true });
        placed.push({ x, y, w, h });
    };

    // 配置できる場所を左上から順にスキャンして見つける
    const findFreePos = (w: number, h: number, startY = 0): { x: number; y: number } | null => {
        for (let y = startY; y + h <= gridRows; y++) {
            for (let x = 0; x + w <= gridCols; x++) {
                if (!collides(x, y, w, h)) return { x, y };
            }
        }
        return null;
    };

    // ── まず全体を座席番号の自然順でソート ──────────────────────────────
    const sorted = [...booths].sort((a, b) => naturalCompare(seatNum(a), seatNum(b)));

    const wallBooths   = sorted.filter(b => b.preferences.wall);
    const islandBooths = sorted.filter(b => !b.preferences.wall);

    // 壁側ブース: 上端（y=0）に座席番号順で左から並べる
    let wallX = 0;
    const overflowWall: Booth[] = [];
    for (const booth of wallBooths) {
        const w = boothGridW(booth);
        const h = boothGridH(booth);
        if (!collides(wallX, 0, w, h)) {
            place(booth, wallX, 0, w, h);
            wallX += w + BOOTH_GAP;
        } else {
            // 上端に入らなければ島配置に回す（番号順を保ったまま追加）
            overflowWall.push(booth);
        }
    }

    // 島配置の開始Y: 壁ブースがあれば通路分だけ下げる
    const islandStartY = wallBooths.length > 0 ? 1 + AISLE : 0;

    // 島ブース: 座席番号順のまま配置（サイズ順ソートはしない）
    const allIsland = [...islandBooths, ...overflowWall];

    let curX = 0;
    let curY = islandStartY;
    let rowH  = 0; // 現在行の最大高さ

    for (const booth of allIsland) {
        const w = boothGridW(booth);
        const h = boothGridH(booth);

        // 行に収まらなければ折り返し
        if (curX + w > gridCols) {
            curX = 0;
            curY += rowH + AISLE;
            rowH = 0;
        }

        if (!collides(curX, curY, w, h)) {
            place(booth, curX, curY, w, h);
            curX += w + BOOTH_GAP;
            rowH = Math.max(rowH, h);
        } else {
            // 万が一衝突する場合はスキャンして空き場所を探す
            const pos = findFreePos(w, h, islandStartY);
            if (pos) {
                place(booth, pos.x, pos.y, w, h);
            } else {
                // グリッド全体に空きがない（未配置扱い）
                newBooths.push({ ...booth, isPlaced: false });
            }
        }
    }

    return newBooths;
};
