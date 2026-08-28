'use client';

import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { Booth, VendorCategory, DimensionSettings, CategoryColorMap, CategoryColors } from '@/types/layout';
import { getBoothSizeMm, getBoothRectOffset } from '@/utils/boothGeometry';

interface BoothUnitProps {
    data: Booth;
    gridPixelSize: number;
    dimensions: DimensionSettings;
    fontSize?: number;
    isSelected?: boolean;
    isColliding?: boolean;
    categoryColors?: CategoryColorMap;
    onDragStart?: (e: any) => void;
    onDragMove?:  (e: any) => void;
    onDragEnd?:      (e: any) => void;
    onClick?:        (e: any) => void;
    onTransformEnd?: (e: any) => void;
    draggable?: boolean;
}

export const DEFAULT_CATEGORY_COLORS: Record<VendorCategory, CategoryColors> = {
    '占い・スピリチュアル': { stroke: '#7c3aed', fill: '#ede9fe' },
    '物販':                 { stroke: '#0284c7', fill: '#e0f2fe' },
    'ボディケア・美容':     { stroke: '#db2777', fill: '#fce7f3' },
    '飲食':                 { stroke: '#ea580c', fill: '#fff7ed' },
    'ワークショップ':       { stroke: '#16a34a', fill: '#dcfce7' },
    'その他':               { stroke: '#6b7280', fill: '#f3f4f6' },
};

/** カテゴリの表示色を解決する（凡例・SVG エクスポートからも使う） */
export const resolveCategoryColors = (
    category: string,
    categoryColors: CategoryColorMap = {},
): CategoryColors =>
    categoryColors[category] ??
    DEFAULT_CATEGORY_COLORS[category as VendorCategory] ??
    DEFAULT_CATEGORY_COLORS['その他'];

/** ブースの表示色を解決する（SVG エクスポートからも使う） */
export const resolveBoothColors = (
    booth: Booth,
    categoryColors: CategoryColorMap = {},
) => {
    const base = resolveCategoryColors(booth.category, categoryColors);
    return {
        stroke: booth.strokeColor ?? booth.color ?? base.stroke,
        fill:   booth.fillColor   ?? (booth.color ? booth.color + '22' : base.fill),
        // カテゴリに文字色の指定があればそれを使い、無ければ枠線色に合わせる
        text:   booth.textColor   ?? base.text ?? booth.strokeColor ?? booth.color ?? base.stroke,
    };
};

export default function BoothUnit({
    data,
    gridPixelSize,
    dimensions,
    fontSize = 14,
    isSelected = false,
    isColliding = false,
    categoryColors = {},
    onDragStart,
    onDragMove,
    onDragEnd,
    onClick,
    onTransformEnd,
    draggable = true,
}: BoothUnitProps) {
    const mmToPx = (mm: number) => (mm / dimensions.gridUnitMm) * gridPixelSize;

    const { width: widthMm, depth: depthMm } = getBoothSizeMm(data, dimensions);
    const widthPx  = mmToPx(widthMm);
    const heightPx = mmToPx(depthMm);

    const colors = resolveBoothColors(data, categoryColors);
    const displayText = data.seatNumber ? data.seatNumber : data.name;
    // ブース個別の指定があればそちらを優先する
    const textSize = data.fontSize ?? fontSize;

    const rot = data.rotation ?? 0;
    // 回転しても左上がグリッド座標と一致するよう矩形をオフセット
    const rectOffset = getBoothRectOffset(rot, widthPx, heightPx);

    // 文字は常に水平に読めるよう、グループの回転を打ち消す
    const swapped = rot === 90 || rot === 270;
    const textAreaWidth  = Math.max(8, (swapped ? heightPx : widthPx) - 8);
    const textAreaHeight = swapped ? widthPx : heightPx;

    const strokeColor = isSelected ? '#f59e0b' : isColliding ? '#dc2626' : colors.stroke;

    return (
        <Group
            id={`booth-group-${data.id}`}   // レイヤー検索用ID
            x={data.x * gridPixelSize}
            y={data.y * gridPixelSize}
            rotation={rot}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onClick={onClick}
            onTap={onClick}
            onTransformEnd={onTransformEnd}
        >
            <Rect
                x={rectOffset.x}
                y={rectOffset.y}
                width={widthPx}
                height={heightPx}
                fill={colors.fill}
                stroke={strokeColor}
                strokeWidth={isSelected || isColliding ? 3 : 2}
                dash={isColliding && !isSelected ? [6, 3] : undefined}
                cornerRadius={2}
            />
            <Text
                x={rectOffset.x + widthPx / 2}
                y={rectOffset.y + heightPx / 2}
                offsetX={textAreaWidth / 2}
                offsetY={textAreaHeight / 2}
                rotation={-rot}
                width={textAreaWidth}
                height={textAreaHeight}
                text={displayText}
                fontSize={textSize}
                fontStyle="bold"
                align="center"
                verticalAlign="middle"
                fill={colors.text}
                wrap="word"
                listening={false}
            />
        </Group>
    );
}
