import { Entrance } from '@/types/layout';

/** 入口の既定色（会場図でも目立つよう、壁・柱とは違う色にしてある） */
export const DEFAULT_ENTRANCE_COLOR = '#0d9488';

/** 入口の既定ラベル */
export const DEFAULT_ENTRANCE_LABEL = '入口';

/** 入口の最小サイズ (mm) */
export const MIN_ENTRANCE_MM = 10;

/** 新規追加時の既定サイズ (mm) */
export const DEFAULT_ENTRANCE_WIDTH_MM = 1800;
export const DEFAULT_ENTRANCE_DEPTH_MM = 450;

export const resolveEntranceColor = (ent: Entrance) => ent.color ?? DEFAULT_ENTRANCE_COLOR;
export const resolveEntranceLabel = (ent: Entrance) =>
    ent.label === undefined ? DEFAULT_ENTRANCE_LABEL : ent.label;
export const resolveEntranceStrokeWidth = (ent: Entrance) => ent.strokeWidth ?? 3;

/**
 * 文字サイズ。指定が無ければ枠に収まる大きさを高さから決める。
 * 画面（Konva）と SVG 出力で同じ値を使うためここに置く。
 */
export const resolveEntranceFontSize = (ent: Entrance, heightPx: number) =>
    ent.fontSize ?? Math.max(9, Math.min(28, heightPx * 0.5));

/**
 * 進入方向の矢印。入口の枠の外側から枠の手前までを、
 * グループのローカル座標（左上が原点、rotation=0 で下向き）で返す。
 * 文字と重ならないよう、矢印は枠の外だけに描く。
 */
export const getEntranceArrowPoints = (widthPx: number, heightPx: number) => {
    const len = Math.max(12, Math.min(widthPx, heightPx) * 0.9);
    const gap = Math.min(6, heightPx * 0.15);
    const cx  = widthPx / 2;
    return { x1: cx, y1: -(len + gap), x2: cx, y2: -gap, len };
};

/** 矢印の先端の大きさ（Konva の Arrow と SVG の marker で同じ見た目にする） */
export const getEntranceArrowHeadSize = (len: number) => Math.max(6, Math.min(14, len * 0.35));
