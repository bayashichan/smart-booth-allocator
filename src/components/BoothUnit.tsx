'use client';

import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { Booth } from '@/types/layout';

interface BoothUnitProps {
    data: Booth;
    gridPixelSize: number; // 1グリッドあたりのピクセル数 (例: 40px)
    onDragStart?: (e: any) => void;
    onDragEnd?: (e: any) => void;
    draggable?: boolean;
}

const UNIT_GRID_SIZE = 450; // mm

// 3層構造の定義 (単位: mm)
// 全体奥行き: 通路(1800) + テーブル(450〜600) + スタッフ(900) = 約3150〜3300mm
const LAYERS_MM = {
    aisle: { depth: 1800, color: '#e0f2f1', label: '通路' }, // 薄い青緑
    table: { depth: 450, color: '#bdbdbd', label: '机' },   // グレー
    staff: { depth: 900, color: '#ffecb3', label: 'スタッフ' } // 薄い黄色
};

export default function BoothUnit({ data, gridPixelSize, gridUnitMm = 450, onDragStart, onDragEnd, draggable = true }: BoothUnitProps & { gridUnitMm?: number }) {
    // 幅 (mm)
    // sizeMmが指定されていればそれを使用、なければ size (倍率) から計算
    // 1.0卓 = 1800mm幅 とする
    const widthMm = data.sizeMm ? data.sizeMm.width : data.size * 1800;

    // ピクセル換算: (mm / gridUnitMm) * gridPixelSize
    const mmToPx = (mm: number) => (mm / gridUnitMm) * gridPixelSize;

    const widthPx = mmToPx(widthMm);

    // 各層の高さ (ピクセル)
    // sizeMm.depth があれば、それをテーブルの奥行きとする
    const tableDepthMm = data.sizeMm ? data.sizeMm.depth : LAYERS_MM.table.depth;

    const aisleHeight = mmToPx(LAYERS_MM.aisle.depth);
    const tableHeight = mmToPx(tableDepthMm);
    const staffHeight = mmToPx(LAYERS_MM.staff.depth);

    // const totalHeight = aisleHeight + tableHeight + staffHeight;

    return (
        <Group
            x={data.x * gridPixelSize}
            y={data.y * gridPixelSize}
            rotation={data.rotation}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
        >
            {/* 1. 客用通路 (Customer Aisle) */}
            <Rect
                x={0}
                y={0}
                width={widthPx}
                height={aisleHeight}
                fill={LAYERS_MM.aisle.color}
                stroke="#ccc"
                strokeWidth={1}
            />
            <Text
                x={5}
                y={5}
                text="通路"
                fontSize={10}
                fill="#555"
            />

            {/* 2. テーブル (Table) */}
            <Rect
                x={0}
                y={aisleHeight}
                width={widthPx}
                height={tableHeight}
                fill={LAYERS_MM.table.color}
                stroke="#666"
                strokeWidth={1}
            />

            {/* 3. スタッフエリア (Staff Zone) */}
            <Rect
                x={0}
                y={aisleHeight + tableHeight}
                width={widthPx}
                height={staffHeight}
                fill={LAYERS_MM.staff.color}
                stroke="#ccc"
                strokeWidth={1}
            />

            {/* ブース名ラベル */}
            <Text
                x={0}
                y={aisleHeight + tableHeight + 5}
                width={widthPx}
                text={data.name}
                fontSize={12}
                align="center"
                fill="#333"
            />
            <Text
                x={0}
                y={aisleHeight + tableHeight + 20}
                width={widthPx}
                text={data.sizeMm ? `${data.sizeMm.width}x${data.sizeMm.depth}mm` : `${data.size}卓`}
                fontSize={10}
                align="center"
                fill="#666"
            />
        </Group>
    );
}
