import { Booth, Obstacle, Entrance, DimensionSettings } from '@/types/layout';

export interface GridRect { x: number; y: number; w: number; h: number }

/**
 * ブースの実寸 (mm) を返す。
 * sizeMm があればそれを優先し、無ければ「基本卓 × size」で計算する。
 */
export const getBoothSizeMm = (booth: Booth, dims: DimensionSettings) => ({
    width: booth.sizeMm ? booth.sizeMm.width : booth.size * dims.baseTableWidthMm,
    depth: booth.sizeMm ? booth.sizeMm.depth : dims.baseTableDepthMm,
});

/**
 * 回転を考慮したブースの占有サイズ（グリッド単位）。
 * 90/270度では幅と奥行きが入れ替わる。
 */
export const getBoothGridSize = (booth: Booth, dims: DimensionSettings) => {
    const { width, depth } = getBoothSizeMm(booth, dims);
    const rot = booth.rotation ?? 0;
    const swapped = rot === 90 || rot === 270;
    return {
        w: (swapped ? depth : width) / dims.gridUnitMm,
        h: (swapped ? width : depth) / dims.gridUnitMm,
    };
};

/** 回転を考慮したブースの占有矩形（グリッド単位・左上基準） */
export const getBoothGridBounds = (booth: Booth, dims: DimensionSettings) => {
    const { w, h } = getBoothGridSize(booth, dims);
    return { x: booth.x, y: booth.y, w, h };
};

/**
 * Konva の Group / SVG の <g> は原点 (x, y) を中心に回転するため、
 * 回転後も「見た目の左上」がグリッド座標 (x, y) に一致するよう、
 * 矩形自体をあらかじめずらしておくためのオフセット。
 *
 *   rot=0   → (0, 0)        rot=90  → (0, -h)
 *   rot=180 → (-w, -h)      rot=270 → (-w, 0)
 */
export const getBoothRectOffset = (rotation: number, widthPx: number, heightPx: number) => {
    const rot = ((rotation % 360) + 360) % 360;
    return {
        x: rot === 180 || rot === 270 ? -widthPx : 0,
        y: rot === 90 || rot === 180 ? -heightPx : 0,
    };
};

/** 2つの矩形が重なるか（AABB） */
export const rectsOverlap = (a: GridRect, b: GridRect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 左上を原点に回転する矩形（障害物・入口）の共通形 */
type RotatedBox = { x: number; y: number; width: number; height: number; rotation?: number };

/**
 * 左上原点で回転する矩形の占有範囲（グリッド単位）。
 * 回転している場合は 4隅から軸平行の外接矩形を求めて安全側で扱う。
 */
const getRotatedBoxGridBounds = (box: RotatedBox): GridRect => {
    const rot = ((box.rotation ?? 0) % 360 + 360) % 360;
    if (rot === 0) return { x: box.x, y: box.y, w: box.width, h: box.height };

    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [
        [0, 0],
        [box.width, 0],
        [box.width, box.height],
        [0, box.height],
    ].map(([cx, cy]) => ({
        x: box.x + cx * cos - cy * sin,
        y: box.y + cx * sin + cy * cos,
    }));

    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/** 障害物の占有矩形（グリッド単位） */
export const getObstacleGridBounds = (obs: Obstacle): GridRect => getRotatedBoxGridBounds(obs);

/** 入口の占有矩形（グリッド単位）。ブースでふさがないための判定に使う。 */
export const getEntranceGridBounds = (ent: Entrance): GridRect => getRotatedBoxGridBounds(ent);

/**
 * ドラッグ中のブースを他のブース・会場端に吸着させるための候補位置。
 * すべてグリッド整数になるよう丸めて返すので、位置はグリッドから外れない。
 *
 * guide は吸着したときに表示する補助線の座標（グリッド単位）。
 */
export interface SnapCandidate { value: number; guide: number }

export const buildSnapCandidates = (
    self: GridRect,
    others: GridRect[],
    venue: { cols: number; rows: number },
) => {
    const xs: SnapCandidate[] = [];
    const ys: SnapCandidate[] = [];
    const pushX = (value: number, guide: number) => xs.push({ value: Math.round(value), guide });
    const pushY = (value: number, guide: number) => ys.push({ value: Math.round(value), guide });

    for (const o of others) {
        // 左揃え / 右揃え / 中央揃え / 左右に接する
        pushX(o.x,                         o.x);
        pushX(o.x + o.w - self.w,          o.x + o.w);
        pushX(o.x + o.w / 2 - self.w / 2,  o.x + o.w / 2);
        pushX(o.x + o.w,                   o.x + o.w);
        pushX(o.x - self.w,                o.x);

        pushY(o.y,                         o.y);
        pushY(o.y + o.h - self.h,          o.y + o.h);
        pushY(o.y + o.h / 2 - self.h / 2,  o.y + o.h / 2);
        pushY(o.y + o.h,                   o.y + o.h);
        pushY(o.y - self.h,                o.y);
    }

    // 会場の端
    pushX(0, 0);
    pushX(venue.cols - self.w, venue.cols);
    pushY(0, 0);
    pushY(venue.rows - self.h, venue.rows);

    return { xs, ys };
};

/** 候補の中から現在位置に最も近いものを閾値内で選ぶ */
export const findSnap = (
    current: number,
    candidates: SnapCandidate[],
    threshold: number,
): SnapCandidate | null => {
    let best: SnapCandidate | null = null;
    let bestDist = threshold;
    for (const c of candidates) {
        const d = Math.abs(c.value - current);
        if (d <= bestDist) { bestDist = d; best = c; }
    }
    return best;
};
