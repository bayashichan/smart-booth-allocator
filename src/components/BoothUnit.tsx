'use client';

import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { Booth, VendorCategory } from '@/types/layout';

interface BoothUnitProps {
    data: Booth;
    gridPixelSize: number;
    gridUnitMm?: number;
    baseTableWidthMm?: number;
    baseTableDepthMm?: number;
    fontSize?: number;
    isSelected?: boolean;
    categoryColors?: Record<string, { stroke: string; fill: string }>;
    onDragStart?: (e: any) => void;
    onDragMove?:  (e: any) => void;
    onDragEnd?:      (e: any) => void;
    onClick?:        (e: any) => void;
    onTransformEnd?: (e: any) => void;
    draggable?: boolean;
}

const DEFAULT_CATEGORY_COLORS: Record<VendorCategory, { stroke: string; fill: string }> = {
    '占い・スピリチュアル': { stroke: '#7c3aed', fill: '#ede9fe' },
    '物販':                 { stroke: '#0284c7', fill: '#e0f2fe' },
    'ボディケア・美容':     { stroke: '#db2777', fill: '#fce7f3' },
    '飲食':                 { stroke: '#ea580c', fill: '#fff7ed' },
    'ワークショップ':       { stroke: '#16a34a', fill: '#dcfce7' },
    'その他':               { stroke: '#6b7280', fill: '#f3f4f6' },
};

export default function BoothUnit({
    data,
    gridPixelSize,
    gridUnitMm = 450,
    baseTableWidthMm = 1800,
    baseTableDepthMm = 450,
    fontSize = 14,
    isSelected = false,
    categoryColors = {},
    onDragStart,
    onDragMove,
    onDragEnd,
    onClick,
    onTransformEnd,
    draggable = true,
}: BoothUnitProps) {
    const mmToPx = (mm: number) => (mm / gridUnitMm) * gridPixelSize;

    const widthMm = data.sizeMm ? data.sizeMm.width : data.size * baseTableWidthMm;
    const depthMm = data.sizeMm ? data.sizeMm.depth : baseTableDepthMm;
    const widthPx  = mmToPx(widthMm);
    const heightPx = mmToPx(depthMm);

    const baseColors = categoryColors[data.category] ?? DEFAULT_CATEGORY_COLORS[data.category] ?? DEFAULT_CATEGORY_COLORS['その他'];
    const colors = {
        stroke: data.strokeColor ?? data.color ?? baseColors.stroke,
        fill:   data.fillColor   ?? (data.color ? data.color + '22' : baseColors.fill),
        text:   data.textColor   ?? data.strokeColor ?? data.color ?? baseColors.stroke,
    };
    const displayText = data.seatNumber ? data.seatNumber : data.name;

    const rot = data.rotation ?? 0;
    const textAreaWidth  = (rot === 90 || rot === 270) ? heightPx - 8 : widthPx - 8;
    const textAreaHeight = (rot === 90 || rot === 270) ? widthPx : heightPx;

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
                x={0}
                y={0}
                width={widthPx}
                height={heightPx}
                fill={colors.fill}
                stroke={isSelected ? '#f59e0b' : colors.stroke}
                strokeWidth={isSelected ? 3 : 2}
                cornerRadius={2}
            />
            <Text
                x={widthPx / 2}
                y={heightPx / 2}
                offsetX={textAreaWidth / 2}
                offsetY={textAreaHeight / 2}
                rotation={-rot}
                width={textAreaWidth}
                height={textAreaHeight}
                text={displayText}
                fontSize={fontSize}
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
