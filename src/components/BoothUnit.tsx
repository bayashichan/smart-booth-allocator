'use client';

import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { Booth, VendorCategory } from '@/types/layout';

interface BoothUnitProps {
    data: Booth;
    gridPixelSize: number; // 1グリッドあたりのピクセル数
    gridUnitMm?: number;
    baseTableWidthMm?: number;
    baseTableDepthMm?: number;
    fontSize?: number; // 座席番号フォントサイズ
    isSelected?: boolean; // 選択中フラグ
    onDragStart?: (e: any) => void;
    onDragEnd?: (e: any) => void;
    onClick?: (e: any) => void;
    draggable?: boolean;
}

// カテゴリごとの色定義（枠線 + 薄い塗り）
const CATEGORY_COLORS: Record<VendorCategory, { stroke: string; fill: string }> = {
    '占い・スピリチュアル': { stroke: '#7c3aed', fill: '#ede9fe' }, // 紫
    '物販':                 { stroke: '#0284c7', fill: '#e0f2fe' }, // 青
    'ボディケア・美容':     { stroke: '#db2777', fill: '#fce7f3' }, // ピンク
    '飲食':                 { stroke: '#ea580c', fill: '#fff7ed' }, // オレンジ
    'ワークショップ':       { stroke: '#16a34a', fill: '#dcfce7' }, // 緑
    'その他':               { stroke: '#6b7280', fill: '#f3f4f6' }, // グレー
};

export default function BoothUnit({
    data,
    gridPixelSize,
    gridUnitMm = 450,
    baseTableWidthMm = 1800,
    baseTableDepthMm = 450,
    fontSize = 14,
    isSelected = false,
    onDragStart,
    onDragEnd,
    onClick,
    draggable = true,
}: BoothUnitProps) {
    // mm → px 変換
    const mmToPx = (mm: number) => (mm / gridUnitMm) * gridPixelSize;

    // ブース幅（mm）
    const widthMm = data.sizeMm ? data.sizeMm.width : data.size * baseTableWidthMm;
    // ブース奥行き（mm）
    const depthMm = data.sizeMm ? data.sizeMm.depth : baseTableDepthMm;

    const widthPx = mmToPx(widthMm);
    const heightPx = mmToPx(depthMm);

    const colors = CATEGORY_COLORS[data.category] ?? CATEGORY_COLORS['その他'];

    // 表示テキスト：座席番号があればそれのみ、なければ出展名
    const displayText = data.seatNumber ? data.seatNumber : data.name;

    return (
        <Group
            x={data.x * gridPixelSize}
            y={data.y * gridPixelSize}
            rotation={data.rotation}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onClick}
        >
            {/* 机の枠線のみ描画（薄い背景色 + カテゴリカラーの枠線） */}
            <Rect
                x={0}
                y={0}
                width={widthPx}
                height={heightPx}
                fill={colors.fill}
                stroke={isSelected ? '#f59e0b' : colors.stroke}
                strokeWidth={isSelected ? 3 : 2}
                cornerRadius={2}
            />

            {/* 座席番号（または出展名）のみ中央に表示 */}
            <Text
                x={4}
                y={0}
                width={widthPx - 8}
                height={heightPx}
                text={displayText}
                fontSize={fontSize}
                fontStyle="bold"
                align="center"
                verticalAlign="middle"
                fill={colors.stroke}
                wrap="word"
                listening={false}
            />
        </Group>
    );
}
