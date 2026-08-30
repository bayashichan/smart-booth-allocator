'use client';

import React, { useRef, useEffect } from 'react';
import { Rect, Transformer, Group, Text, Arrow } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Entrance } from '@/types/layout';
import {
    getEntranceArrowPoints,
    getEntranceArrowHeadSize,
    resolveEntranceColor,
    resolveEntranceFontSize,
    resolveEntranceLabel,
    resolveEntranceStrokeWidth,
} from '@/utils/entrance';

interface EntranceComponentProps {
    data: Entrance;
    gridPixelSize: number;
    isSelected: boolean;
    isEditable: boolean;
    onSelect: () => void;
    onChange: (newAttrs: Entrance) => void;
}

export default function EntranceComponent({
    data,
    gridPixelSize,
    isSelected,
    isEditable,
    onSelect,
    onChange,
}: EntranceComponentProps) {
    const shapeRef = useRef<Konva.Rect | null>(null);
    const trRef    = useRef<Konva.Transformer | null>(null);

    useEffect(() => {
        if (isSelected && isEditable && shapeRef.current) {
            trRef.current?.nodes([shapeRef.current]);
            trRef.current?.getLayer()?.batchDraw();
        }
    }, [isSelected, isEditable]);

    const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
        onChange({
            ...data,
            x: Math.round(e.target.x() / gridPixelSize),
            y: Math.round(e.target.y() / gridPixelSize),
        });
    };

    const handleTransformEnd = () => {
        const node = shapeRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        // 左上のハンドルを引くと矩形がグループ内でずれるので、
        // そのずれを（回転を戻したうえで）入口の位置に足し込む。
        const rad = ((data.rotation ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = node.x();
        const dy = node.y();
        node.scaleX(1);
        node.scaleY(1);
        node.x(0);
        node.y(0);
        // ハンドルでのリサイズはマス目に丸める（mm 指定はパネル側で行う）
        onChange({
            ...data,
            x: Math.round(data.x + (dx * cos - dy * sin) / gridPixelSize),
            y: Math.round(data.y + (dx * sin + dy * cos) / gridPixelSize),
            width:  Math.max(1, Math.round((node.width()  * scaleX) / gridPixelSize)),
            height: Math.max(1, Math.round((node.height() * scaleY) / gridPixelSize)),
        });
    };

    const color    = resolveEntranceColor(data);
    const strokeW  = resolveEntranceStrokeWidth(data);
    const rotation = data.rotation ?? 0;

    const pixelX      = data.x * gridPixelSize;
    const pixelY      = data.y * gridPixelSize;
    const pixelWidth  = data.width  * gridPixelSize;
    const pixelHeight = data.height * gridPixelSize;

    const label    = resolveEntranceLabel(data);
    // 90/270度では文字の描画枠の縦横が入れ替わる（そのままだと文字が切れる）
    const normRot  = ((rotation % 360) + 360) % 360;
    const swapped  = normRot === 90 || normRot === 270;
    const textAreaWidth  = swapped ? pixelHeight : pixelWidth;
    const textAreaHeight = swapped ? pixelWidth  : pixelHeight;
    const fontSize = resolveEntranceFontSize(data, pixelHeight);
    const arrow    = getEntranceArrowPoints(pixelWidth, pixelHeight);
    const headSize = getEntranceArrowHeadSize(arrow.len);

    return (
        <React.Fragment>
            <Group
                draggable={isEditable}
                onDragStart={onSelect}
                onDragEnd={handleDragEnd}
                onClick={onSelect}
                onTap={onSelect}
                x={pixelX}
                y={pixelY}
                width={pixelWidth}
                height={pixelHeight}
                rotation={rotation}
            >
                {/* 開口部。壁・柱と見分けがつくよう薄く塗る */}
                <Rect
                    ref={shapeRef}
                    width={pixelWidth}
                    height={pixelHeight}
                    fill={`${color}26`}
                    stroke={isSelected ? '#2196f3' : color}
                    strokeWidth={isSelected ? strokeW + 1 : strokeW}
                    dash={isSelected ? [6, 3] : undefined}
                    cornerRadius={2}
                    onTransformEnd={handleTransformEnd}
                />

                {/* 進入方向の矢印（枠の外側に描くので文字と重ならない） */}
                {data.showArrow !== false && (
                    <Arrow
                        points={[arrow.x1, arrow.y1, arrow.x2, arrow.y2]}
                        stroke={color}
                        fill={color}
                        strokeWidth={strokeW}
                        pointerLength={headSize}
                        pointerWidth={headSize}
                        listening={false}
                    />
                )}

                {/* 文字は常に水平に読めるよう、グループの回転を打ち消す */}
                {label && (
                    <Text
                        x={pixelWidth / 2}
                        y={pixelHeight / 2}
                        offsetX={textAreaWidth / 2}
                        offsetY={textAreaHeight / 2}
                        rotation={-rotation}
                        width={textAreaWidth}
                        height={textAreaHeight}
                        text={label}
                        fontSize={fontSize}
                        fontStyle="bold"
                        fill={color}
                        align="center"
                        verticalAlign="middle"
                        listening={false}
                    />
                )}
            </Group>

            {isSelected && isEditable && (
                <Transformer
                    ref={trRef}
                    keepRatio={false}
                    rotateEnabled={false}
                    boundBoxFunc={(oldBox, newBox) => {
                        if (newBox.width < gridPixelSize / 2 || newBox.height < gridPixelSize / 2) {
                            return oldBox;
                        }
                        return newBox;
                    }}
                    anchorSize={20}
                    anchorCornerRadius={10}
                />
            )}
        </React.Fragment>
    );
}
