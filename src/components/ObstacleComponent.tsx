'use client';

import React, { useRef, useEffect } from 'react';
import { Rect, Transformer, Group, Text } from 'react-konva';
import { Obstacle } from '@/types/layout';

interface ObstacleComponentProps {
    data: Obstacle;
    isSelected: boolean;
    isEditable: boolean;
    onSelect: () => void;
    onChange: (newAttrs: Obstacle) => void;
}

export default function ObstacleComponent({
    data,
    isSelected,
    isEditable,
    onSelect,
    onChange,
}: ObstacleComponentProps) {
    const shapeRef = useRef<any>(null);
    const trRef = useRef<any>(null);

    useEffect(() => {
        if (isSelected && isEditable) {
            // 選択状態かつ編集モードならTransformerをアタッチ
            trRef.current?.nodes([shapeRef.current]);
            trRef.current?.getLayer()?.batchDraw();
        }
    }, [isSelected, isEditable]);

    const handleDragEnd = (e: any) => {
        onChange({
            ...data,
            x: e.target.x(),
            y: e.target.y(),
        });
    };

    const handleTransformEnd = () => {
        // Transformerによる変形後の値を反映
        const node = shapeRef.current;
        if (!node) return;

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();

        // スケールをリセットして幅・高さに適用する (その方が管理しやすい)
        node.scaleX(1);
        node.scaleY(1);

        onChange({
            ...data,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX), // 最小サイズ制限
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
        });
    };

    // タイプごとの色設定
    const getColor = () => {
        switch (data.type) {
            case 'column': return '#795548'; // 茶色
            case 'wall': return '#607d8b';   // グレー
            case 'void': return '#000000';   // 黒 (穴)
            default: return '#9e9e9e';
        }
    };

    const getLabel = () => {
        switch (data.type) {
            case 'column': return '柱';
            case 'wall': return '壁';
            case 'void': return '無効';
            default: return '';
        }
    };

    return (
        <React.Fragment>
            <Group
                draggable={isEditable}
                onDragStart={onSelect}
                onDragEnd={handleDragEnd}
                onClick={onSelect}
                onTap={onSelect}
                x={data.x}
                y={data.y} // グリッドスナップさせるかどうかは親で制御してもいいが、障害物は自由配置もありうる
                width={data.width}
                height={data.height}
                rotation={data.rotation}
            >
                <Rect
                    ref={shapeRef}
                    width={data.width}
                    height={data.height}
                    fill={getColor()}
                    opacity={0.8}
                    stroke={isSelected ? '#2196f3' : '#333'}
                    strokeWidth={isSelected ? 2 : 1}
                    onTransformEnd={handleTransformEnd}
                />
                <Text
                    text={getLabel()}
                    fontSize={12}
                    fill="#fff"
                    padding={5}
                    align="center"
                    width={data.width}
                />
            </Group>

            {isSelected && isEditable && (
                <Transformer
                    ref={trRef}
                    keepRatio={false} // 縦横比固定しない
                    boundBoxFunc={(oldBox, newBox) => {
                        // 極端に小さくならないように制限
                        if (newBox.width < 20 || newBox.height < 20) {
                            return oldBox;
                        }
                        return newBox;
                    }}
                    // スマホ向けにアンカーサイズを大きく
                    anchorSize={20}
                    anchorCornerRadius={10}
                />
            )}
        </React.Fragment>
    );
}
