'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Text, Transformer, Group } from 'react-konva';
import { TextLabel } from '@/types/layout';

interface TextLabelComponentProps {
    data: TextLabel;
    isSelected: boolean;
    isEditable: boolean;
    stageScale: number;
    stagePos: { x: number; y: number };
    containerOffset: { left: number; top: number };
    onSelect: () => void;
    onChange: (updated: TextLabel) => void;
    onDelete: () => void;
}

export default function TextLabelComponent({
    data,
    isSelected,
    isEditable,
    stageScale,
    stagePos,
    containerOffset,
    onSelect,
    onChange,
    onDelete,
}: TextLabelComponentProps) {
    const textRef = useRef<any>(null);
    const trRef   = useRef<any>(null);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        if (isSelected && isEditable && textRef.current && trRef.current) {
            trRef.current.nodes([textRef.current]);
            trRef.current.getLayer()?.batchDraw();
        }
    }, [isSelected, isEditable]);

    const handleDblClick = () => {
        if (!isEditable) return;
        const node = textRef.current;
        if (!node) return;

        // テキストノードを一時非表示にしてHTML textareaを重ねる
        node.hide();
        setIsEditing(true);

        const stageBox = node.getStage().container().getBoundingClientRect();
        const absPos   = node.getAbsolutePosition();

        const areaX = stageBox.left + absPos.x;
        const areaY = stageBox.top  + absPos.y;

        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        Object.assign(textarea.style, {
            position:    'fixed',
            left:        `${areaX}px`,
            top:         `${areaY}px`,
            width:       `${Math.max(120, node.width() * stageScale)}px`,
            minHeight:   '40px',
            fontSize:    `${data.fontSize * stageScale}px`,
            color:       data.color,
            background:  'rgba(255,255,255,0.95)',
            border:      '2px solid #3b82f6',
            borderRadius:'4px',
            padding:     '4px',
            lineHeight:  '1.2',
            zIndex:      '9999',
            resize:      'both',
            outline:     'none',
            fontFamily:  'inherit',
            fontStyle:   data.fontStyle?.includes('italic') ? 'italic' : 'normal',
            fontWeight:  data.fontStyle?.includes('bold')   ? 'bold'   : 'normal',
        });
        textarea.value = data.text;
        textarea.focus();
        textarea.select();

        const finish = () => {
            const newText = textarea.value;
            document.body.removeChild(textarea);
            node.show();
            setIsEditing(false);
            if (newText !== data.text) onChange({ ...data, text: newText });
        };

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') finish();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(); }
        });
        textarea.addEventListener('blur', finish);
    };

    const handleTransformEnd = () => {
        const node = textRef.current;
        if (!node) return;
        onChange({
            ...data,
            x:        node.x(),
            y:        node.y(),
            rotation: node.rotation(),
            fontSize: Math.max(8, Math.round(data.fontSize * node.scaleX())),
        });
        node.scaleX(1);
        node.scaleY(1);
    };

    return (
        <>
            <Text
                ref={textRef}
                id={`text-label-${data.id}`}
                x={data.x}
                y={data.y}
                text={data.text}
                fontSize={data.fontSize}
                fill={data.color}
                fontStyle={data.fontStyle ?? ''}
                draggable={isEditable}
                rotation={data.rotation ?? 0}
                onDragEnd={(e) => onChange({ ...data, x: e.target.x(), y: e.target.y() })}
                onClick={() => { onSelect(); }}
                onTap={() => { onSelect(); }}
                onDblClick={handleDblClick}
                onDblTap={handleDblClick}
            />
            {isSelected && isEditable && (
                <Transformer
                    ref={trRef}
                    keepRatio={false}
                    enabledAnchors={['middle-left', 'middle-right']}
                    onTransformEnd={handleTransformEnd}
                    anchorSize={12}
                    anchorCornerRadius={6}
                />
            )}
        </>
    );
}
