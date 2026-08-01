import { Booth, DimensionSettings } from '@/types/layout';

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
export const rectsOverlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
