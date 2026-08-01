import { Booth, DimensionSettings } from '@/types/layout';
import { getBoothGridBounds } from './boothGeometry';

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type Axis = 'h' | 'v';

const targets = (booths: Booth[], ids: Set<string>, dims: DimensionSettings) =>
    booths
        .filter(b => ids.has(b.id) && b.isPlaced !== false)
        .map(b => ({ booth: b, ...getBoothGridBounds(b, dims) }));

const applyPositions = (booths: Booth[], moved: Map<string, { x: number; y: number }>) =>
    booths.map(b => {
        const p = moved.get(b.id);
        return p ? { ...b, x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) } : b;
    });

/** 選択したブースを揃える */
export const alignBooths = (
    booths: Booth[],
    ids: Set<string>,
    kind: AlignKind,
    dims: DimensionSettings,
): Booth[] => {
    const items = targets(booths, ids, dims);
    if (items.length < 2) return booths;

    const minX = Math.min(...items.map(i => i.x));
    const maxX = Math.max(...items.map(i => i.x + i.w));
    const minY = Math.min(...items.map(i => i.y));
    const maxY = Math.max(...items.map(i => i.y + i.h));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const moved = new Map<string, { x: number; y: number }>();
    for (const i of items) {
        let { x, y } = i;
        switch (kind) {
            case 'left':    x = minX;            break;
            case 'right':   x = maxX - i.w;      break;
            case 'hcenter': x = cx - i.w / 2;    break;
            case 'top':     y = minY;            break;
            case 'bottom':  y = maxY - i.h;      break;
            case 'vcenter': y = cy - i.h / 2;    break;
        }
        moved.set(i.booth.id, { x, y });
    }
    return applyPositions(booths, moved);
};

/**
 * 両端は動かさず、間のブースの隙間が均等になるよう配置する。
 * （デザインツールの「等間隔に分布」と同じ挙動）
 */
export const distributeBooths = (
    booths: Booth[],
    ids: Set<string>,
    axis: Axis,
    dims: DimensionSettings,
): Booth[] => {
    const items = targets(booths, ids, dims);
    if (items.length < 3) return booths;

    const horizontal = axis === 'h';
    const sorted = [...items].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));

    const first = sorted[0];
    const last  = sorted[sorted.length - 1];
    const span = horizontal
        ? (last.x + last.w) - first.x
        : (last.y + last.h) - first.y;
    const totalSize = sorted.reduce((sum, i) => sum + (horizontal ? i.w : i.h), 0);
    const gap = (span - totalSize) / (sorted.length - 1);

    const moved = new Map<string, { x: number; y: number }>();
    let cursor = horizontal ? first.x : first.y;
    for (const i of sorted) {
        moved.set(i.booth.id, horizontal ? { x: cursor, y: i.y } : { x: i.x, y: cursor });
        cursor += (horizontal ? i.w : i.h) + gap;
    }
    return applyPositions(booths, moved);
};

/**
 * 指定した隙間で一列に並べ直す。
 * 先頭のブース位置を起点に、座席番号順ではなく現在の並び順を保つ。
 */
export const arrangeInLine = (
    booths: Booth[],
    ids: Set<string>,
    axis: Axis,
    gap: number,
    dims: DimensionSettings,
): Booth[] => {
    const items = targets(booths, ids, dims);
    if (items.length < 2) return booths;

    const horizontal = axis === 'h';
    const sorted = [...items].sort((a, b) => (horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
    const originX = Math.min(...items.map(i => i.x));
    const originY = Math.min(...items.map(i => i.y));

    const moved = new Map<string, { x: number; y: number }>();
    let cursor = horizontal ? originX : originY;
    for (const i of sorted) {
        moved.set(i.booth.id, horizontal ? { x: cursor, y: originY } : { x: originX, y: cursor });
        cursor += (horizontal ? i.w : i.h) + gap;
    }
    return applyPositions(booths, moved);
};
