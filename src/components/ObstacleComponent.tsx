'use client';

import React, { useRef, useEffect } from 'react';
import { Rect, Transformer, Group, Text } from 'react-konva';
import { Obstacle } from '@/types/layout';

interface ObstacleComponentProps {
    data: Obstacle;
    gridPixelSize: number;
    isSelected: boolean;
    isEditable: boolean;
    onSelect: () => void;
    onChange: (newAttrs: Obstacle) => void;
}

// タイプごとのデフォルト色
const DEFAULT_COLORS: Record<string, string> = {
    wall:   '#607d8b',
    column: '#795548',
    void:   '#000000',
};

export default function ObstacleComponent({
    data,
    gridPixelSize,
    isSelected,
    isEditable,
    onSelect,
    onChange,
}: ObstacleComponentProps) {
    const shapeRef = useRef<any>(null);
    const trRef    = useRef<any>(null);

    useEffect(() => {
        if (isSelected && isEditable) {
            trRef.current?.nodes([shapeRef.current]);
            trRef.current?.getLayer()?.batchDraw();
        }
    }, [isSelected, isEditable]);

    const handleDragEnd = (e: any) => {
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
        node.scaleX(1);
        node.scaleY(1);
        const newWidth  = Math.max(1, Math.round((node.width()  * scaleX) / gridPixelSize));
        const newHeight = Math.max(1, Math.round((node.height() * scaleY) / gridPixelSize));
        onChange({
            ...data,
            x: Math.round(node.x() / gridPixelSize),
            y: Math.round(node.y() / gridPixelSize),
            width:  newWidth,
            height: newHeight,
            rotation: node.rotation(),
        });
    };

    const strokeColor = data.color ?? DEFAULT_COLORS[data.type] ?? '#607d8b';
    const strokeW     = data.strokeWidth ?? 2;

    const pixelX      = data.x * gridPixelSize;
    const pixelY      = data.y * gridPixelSize;
    const pixelWidth  = data.width  * gridPixelSize;
    const pixelHeight = data.height * gridPixelSize;

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
                rotation={data.rotation}
            >
                {/* アウトラインのみ描画（塗りつぶしなし） */}
                <Rect
                    ref={shapeRef}
                    width={pixelWidth}
                    height={pixelHeight}
                    fill="transparent"
                    stroke={isSelected ? '#2196f3' : strokeColor}
                    strokeWidth={isSelected ? strokeW + 1 : strokeW}
                    dash={isSelected ? [6, 3] : undefined}
                    onTransformEnd={handleTransformEnd}
                />
                {/* 選択時はラベルを中央に表示 */}
                {isSelected && (
                    <Text
                        text={data.type === 'wall' ? '壁' : data.type === 'column' ? '柱' : ''}
                        fontSize={Math.max(10, gridPixelSize / 4)}
                        fill={strokeColor}
                        width={pixelWidth}
                        height={pixelHeight}
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
