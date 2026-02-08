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

// 3層構造の定義 (単位: グリッド数)
// 全体奥行き: 通路(4) + テーブル(1〜1.5) + スタッフ(2) = 約7〜8グリッド
// ここでは簡易的に グリッド単位で定義
// 通路: 4グリッド (180cm)
// テーブル: 1グリッド (45cm) または 1.5グリッド (60cm)
// スタッフ: 2グリッド (90cm)

const LAYERS = {
    aisle: { depth: 4, color: '#e0f2f1', label: '通路' }, // 薄い青緑
    table: { depth: 1, color: '#bdbdbd', label: '机' },   // グレー
    staff: { depth: 2, color: '#ffecb3', label: 'スタッフ' } // 薄い黄色
};

export default function BoothUnit({ data, gridPixelSize, onDragStart, onDragEnd, draggable = true }: BoothUnitProps) {
    // サイズごとの幅 (グリッド数)
    // 0.5: 2グリッド (90cm)
    // 1.0: 4グリッド (180cm)
    // 2.0: 8グリッド (360cm)
    // 3.0: 12グリッド (540cm)
    const widthGrids = data.size * 4;
    const widthPx = widthGrids * gridPixelSize;

    // 各層の高さ (ピクセル)
    const aisleHeight = LAYERS.aisle.depth * gridPixelSize;
    const tableHeight = LAYERS.table.depth * gridPixelSize;
    const staffHeight = LAYERS.staff.depth * gridPixelSize;

    const totalHeight = aisleHeight + tableHeight + staffHeight;

    // 中心座標合わせのためのオフセット (KonvaのGroupは左上が原点だが、グリッド吸着のために調整が必要かも)
    // 一旦左上原点で実装

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
                fill={LAYERS.aisle.color}
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
                fill={LAYERS.table.color}
                stroke="#666"
                strokeWidth={1}
            />

            {/* 3. スタッフエリア (Staff Zone) */}
            <Rect
                x={0}
                y={aisleHeight + tableHeight}
                width={widthPx}
                height={staffHeight}
                fill={LAYERS.staff.color}
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
                text={`${data.size}卓`}
                fontSize={10}
                align="center"
                fill="#666"
            />
        </Group>
    );
}
