'use client';

import React, { useState, useEffect } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import BoothUnit from './BoothUnit';
import ObstacleComponent from './ObstacleComponent';
import { Booth, Obstacle } from '@/types/layout';

const GRID_SIZE = 40; // 画面上の1グリッドのピクセルサイズ

interface CanvasAreaProps {
    booths: Booth[];
    onBoothsChange: (newBooths: Booth[]) => void;
    obstacles: Obstacle[];
    onObstaclesChange: (newObstacles: Obstacle[]) => void;
    mode: 'booth' | 'venue';
    onModeChange: (mode: 'booth' | 'venue') => void;
}

export default function CanvasArea({
    booths,
    onBoothsChange,
    obstacles,
    onObstaclesChange,
    mode,
    onModeChange
}: CanvasAreaProps) {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Viewport State
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);

    useEffect(() => {
        setDimensions({
            width: window.innerWidth,
            height: window.innerHeight - 200
        });

        const handleResize = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight - 200
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (dimensions.width === 0) {
        return <div className="w-full h-full bg-gray-100 flex items-center justify-center">Loading...</div>;
    }

    // --- Grid Rendering ---
    const gridLines = [];
    const maxGrid = 200;
    for (let i = 0; i <= maxGrid; i++) {
        gridLines.push(<Line key={`v-${i}`} points={[i * GRID_SIZE, 0, i * GRID_SIZE, maxGrid * GRID_SIZE]} stroke="#eee" strokeWidth={1} />);
        gridLines.push(<Line key={`h-${i}`} points={[0, i * GRID_SIZE, maxGrid * GRID_SIZE, i * GRID_SIZE]} stroke="#eee" strokeWidth={1} />);
    }

    // --- Handlers ---
    const handleDragEndBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        const x = Math.round(e.target.x() / GRID_SIZE);
        const y = Math.round(e.target.y() / GRID_SIZE);
        const newBooths = booths.map(booth => booth.id === id ? { ...booth, x, y, isPlaced: true } : booth);
        onBoothsChange(newBooths);
        e.target.to({ x: x * GRID_SIZE, y: y * GRID_SIZE, duration: 0.1 });
    };

    const handleObstacleChange = (newAttrs: Obstacle) => {
        onObstaclesChange(obstacles.map(obs => obs.id === newAttrs.id ? newAttrs : obs));
    };

    const handleAddObstacle = (type: 'wall' | 'column') => {
        const newId = `obs-${Date.now()}`;
        const centerX = (-stagePos.x + dimensions.width / 2) / stageScale;
        const centerY = (-stagePos.y + dimensions.height / 2) / stageScale;

        const newObstacle: Obstacle = {
            id: newId,
            x: centerX,
            y: centerY,
            width: type === 'column' ? GRID_SIZE : GRID_SIZE * 4,
            height: type === 'column' ? GRID_SIZE : GRID_SIZE / 2,
            rotation: 0,
            type: type,
        };
        onObstaclesChange([...obstacles, newObstacle]);
        setSelectedObstacleId(newId);
    };

    const handleDeleteObstacle = () => {
        if (selectedObstacleId) {
            onObstaclesChange(obstacles.filter(o => o.id !== selectedObstacleId));
            setSelectedObstacleId(null);
        }
    };

    const handleWheel = (e: any) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const stage = e.target.getStage();
        const oldScale = stage.scaleX();
        const mousePointTo = {
            x: stage.getPointerPosition().x / oldScale - stage.x() / oldScale,
            y: stage.getPointerPosition().y / oldScale - stage.y() / oldScale,
        };
        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        if (newScale < 0.1 || newScale > 5) return;
        setStageScale(newScale);
        setStagePos({
            x: -(mousePointTo.x - stage.getPointerPosition().x / newScale) * newScale,
            y: -(mousePointTo.y - stage.getPointerPosition().y / newScale) * newScale,
        });
    };

    return (
        <div className="bg-white flex flex-col h-full w-full relative">

            {/* Editor Toolbar */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white shadow-lg rounded-full px-4 py-2 flex gap-4 items-center border border-gray-200">
                <div className="flex bg-gray-100 rounded-full p-1">
                    <button
                        onClick={() => { onModeChange('booth'); setSelectedObstacleId(null); }}
                        className={`px-4 py-1 rounded-full text-sm font-medium transition ${mode === 'booth' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        ブース配置
                    </button>
                    <button
                        onClick={() => onModeChange('venue')}
                        className={`px-4 py-1 rounded-full text-sm font-medium transition ${mode === 'venue' ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        会場編集
                    </button>
                </div>
            </div>

            {/* 会場編集ツールバー */}
            {mode === 'venue' && (
                <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-10 bg-white/90 backdrop-blur shadow-xl rounded-xl p-2 flex gap-2 border border-orange-100 animate-in slide-in-from-bottom-4">
                    <button onClick={() => handleAddObstacle('wall')} className="flex flex-col items-center p-2 hover:bg-orange-50 rounded">
                        <div className="w-8 h-4 bg-gray-500 mb-1 border border-gray-600"></div>
                        <span className="text-xs text-gray-600">壁追加</span>
                    </button>
                    <button onClick={() => handleAddObstacle('column')} className="flex flex-col items-center p-2 hover:bg-orange-50 rounded">
                        <div className="w-6 h-6 bg-brown-500 mb-1 border border-gray-600 bg-[#795548]"></div>
                        <span className="text-xs text-gray-600">柱追加</span>
                    </button>
                    <div className="w-px bg-gray-200 mx-1"></div>
                    <button
                        onClick={handleDeleteObstacle}
                        disabled={!selectedObstacleId}
                        className="flex flex-col items-center p-2 hover:bg-red-50 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                        <span className="text-red-500 font-bold text-lg leading-none mb-1">×</span>
                        <span className="text-xs text-red-500">削除</span>
                    </button>
                </div>
            )}

            {/* Canvas */}
            <div className="flex-grow overflow-hidden">
                <Stage
                    width={dimensions.width}
                    height={dimensions.height}
                    draggable
                    onWheel={handleWheel}
                    scaleX={stageScale}
                    scaleY={stageScale}
                    x={stagePos.x}
                    y={stagePos.y}
                    onDragEnd={(e) => {
                        if (e.target === e.target.getStage()) {
                            setStagePos({ x: e.target.x(), y: e.target.y() });
                        }
                    }}
                    onTap={(e) => {
                        if (e.target === e.target.getStage()) {
                            setSelectedObstacleId(null);
                        }
                    }}
                    onClick={(e) => {
                        if (e.target === e.target.getStage()) {
                            setSelectedObstacleId(null);
                        }
                    }}
                    style={{ background: '#fafafa' }}
                >
                    <Layer>
                        {gridLines}
                    </Layer>
                    <Layer>
                        {/* 障害物 */}
                        {obstacles.map(obs => (
                            <ObstacleComponent
                                key={obs.id}
                                data={obs}
                                isSelected={selectedObstacleId === obs.id}
                                isEditable={mode === 'venue'}
                                onSelect={() => { if (mode === 'venue') setSelectedObstacleId(obs.id); }}
                                onChange={handleObstacleChange}
                            />
                        ))}
                    </Layer>
                    <Layer opacity={mode === 'venue' ? 0.5 : 1}>
                        {/* ブース */}
                        {booths.map(booth => (
                            <BoothUnit
                                key={booth.id}
                                data={booth}
                                gridPixelSize={GRID_SIZE}
                                draggable={mode === 'booth'}
                                onDragEnd={(e) => handleDragEndBooth(e, booth.id)}
                            />
                        ))}
                    </Layer>
                </Stage>
            </div>
            <div className="absolute bottom-4 left-4 text-xs text-gray-400 pointer-events-none">
                Mode: {mode === 'booth' ? 'Booth Placement' : 'Venue Editor'}
            </div>
        </div>
    );
}
