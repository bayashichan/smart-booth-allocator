'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Line, Rect, Group, Image as KonvaImage, Transformer } from 'react-konva';
import BoothUnit from './BoothUnit';
import ObstacleComponent from './ObstacleComponent';
import { Booth, Obstacle } from '@/types/layout';

const GRID_SIZE = 40; // 画面上の1グリッドのピクセルサイズ (表示用スケール基準)

interface CanvasAreaProps {
    booths: Booth[];
    onBoothsChange: (newBooths: Booth[]) => void;
    obstacles: Obstacle[];
    onObstaclesChange: (newObstacles: Obstacle[]) => void;
    mode: 'booth' | 'venue';
    onModeChange: (mode: 'booth' | 'venue') => void;
}

type ToolType = 'none' | 'wall' | 'column' | 'eraser';

export default function CanvasArea({
    booths,
    onBoothsChange,
    obstacles,
    onObstaclesChange,
    mode,
    onModeChange
}: CanvasAreaProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Viewport State
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // Global Config State
    const [gridUnitMm, setGridUnitMm] = useState(450); // 1グリッド＝何mmか
    const [baseTableWidthMm, setBaseTableWidthMm] = useState(1800); // 標準テーブル幅
    const [baseTableDepthMm, setBaseTableDepthMm] = useState(450); // 標準テーブル奥行

    // Painting / Line Tool State
    const [activeTool, setActiveTool] = useState<ToolType>('none');
    const isPaintingRef = useRef(false);
    const dragStartRef = useRef<{ gx: number, gy: number } | null>(null);
    const [previewRect, setPreviewRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    // Obstacle editing state
    const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);

    // Booth editing state
    const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);

    // Background Image State
    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
    const [bgConfig, setBgConfig] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 });
    const [isBgEditing, setIsBgEditing] = useState(false);
    const bgNodeRef = useRef<any>(null);
    const bgTrRef = useRef<any>(null);

    useEffect(() => {
        if (isBgEditing && bgNodeRef.current && bgTrRef.current) {
            bgTrRef.current.nodes([bgNodeRef.current]);
            bgTrRef.current.getLayer().batchDraw();
        }
    }, [isBgEditing, bgImage]);

    // Handle Resize
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight
                });
            }
        };

        window.addEventListener('resize', updateSize);
        updateSize();
        setTimeout(updateSize, 100);

        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Handle Mode Changes
    useEffect(() => {
        if (mode === 'booth') {
            setActiveTool('none');
            setSelectedObstacleId(null);
            setIsBgEditing(false); // ブースモードでは背景編集オフ
        } else {
            setSelectedBoothId(null); // 会場モードではブース選択解除
        }
    }, [mode]);

    // --- Background Image Handlers ---

    const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new window.Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                setBgImage(img);
                setBgConfig({
                    x: 100,
                    y: 100,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 0.5
                });
                setIsBgEditing(true);
                setActiveTool('none');
            };
        };
        reader.readAsDataURL(file);
    };

    const handleBgTransformEnd = () => {
        const node = bgNodeRef.current;
        if (!node) return;
        setBgConfig({
            ...bgConfig,
            x: node.x(),
            y: node.y(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
        });
    };

    const handleBgDragEnd = (e: any) => {
        setBgConfig({
            ...bgConfig,
            x: e.target.x(),
            y: e.target.y(),
        });
    };


    // --- Grid Rendering ---
    const gridLines = [];
    const maxGrid = 200;
    for (let i = 0; i <= maxGrid; i++) {
        // Vertical lines
        gridLines.push(<Line key={`v-${i}`} points={[i * GRID_SIZE, 0, i * GRID_SIZE, maxGrid * GRID_SIZE]} stroke="#eee" strokeWidth={1} listening={false} />);
        // Horizontal lines
        gridLines.push(<Line key={`h-${i}`} points={[0, i * GRID_SIZE, maxGrid * GRID_SIZE, i * GRID_SIZE]} stroke="#eee" strokeWidth={1} listening={false} />);
    }

    // --- Obstacle Logic ---

    const findObstacleAt = (gx: number, gy: number) => {
        return obstacles.find(obs =>
            gx >= obs.x && gx < obs.x + obs.width &&
            gy >= obs.y && gy < obs.y + obs.height
        );
    };

    const handleObstacleChange = (updatedObstacle: Obstacle) => {
        onObstaclesChange(obstacles.map(obs => obs.id === updatedObstacle.id ? updatedObstacle : obs));
    };

    // --- Mouse / Touch Handlers for Stage ---

    const getGridPos = (stageX: number, stageY: number) => {
        return {
            gx: Math.floor((stageX - stagePos.x) / (stageScale * GRID_SIZE)),
            gy: Math.floor((stageY - stagePos.y) / (stageScale * GRID_SIZE))
        };
    };

    const handleEraser = (gx: number, gy: number) => {
        const existingObs = findObstacleAt(gx, gy);
        if (existingObs) {
            onObstaclesChange(obstacles.filter(o => o.id !== existingObs.id));
        }
    };

    const handleMouseDown = (e: any) => {
        const stage = e.target.getStage();
        if (!stage) return;

        // 背景クリックで選択解除
        const clickedOnStage = e.target === stage;
        if (clickedOnStage) {
            setSelectedBoothId(null);
            setSelectedObstacleId(null);
        }

        if (isBgEditing) return;

        // ツールが選択されていない場合はステージドラッグ
        if (mode === 'venue' && activeTool === 'none') {
            setSelectedObstacleId(null);
            return;
        }

        if (mode === 'venue' && activeTool !== 'none') {
            isPaintingRef.current = true;
            const pos = stage.getPointerPosition();
            if (pos) {
                const { gx, gy } = getGridPos(pos.x, pos.y);
                dragStartRef.current = { gx, gy };

                if (activeTool === 'eraser') {
                    handleEraser(gx, gy);
                } else {
                    setPreviewRect({ x: gx, y: gy, w: 1, h: 1 });
                }
            }
        }
    };

    const handleMouseMove = (e: any) => {
        if (isBgEditing) return;

        const stage = e.target.getStage();
        if (!stage) return;

        if (isPaintingRef.current && mode === 'venue') {
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const { gx, gy } = getGridPos(pos.x, pos.y);

            if (activeTool === 'eraser') {
                handleEraser(gx, gy);
            } else if (dragStartRef.current) {
                const startX = Math.min(dragStartRef.current.gx, gx);
                const startY = Math.min(dragStartRef.current.gy, gy);
                const endX = Math.max(dragStartRef.current.gx, gx);
                const endY = Math.max(dragStartRef.current.gy, gy);
                const w = endX - startX + 1;
                const h = endY - startY + 1;
                setPreviewRect({ x: startX, y: startY, w, h });
            }
        }
    };

    const handleMouseUp = () => {
        if (isPaintingRef.current && mode === 'venue' && activeTool !== 'eraser' && previewRect) {
            const obstacleType = (activeTool === 'wall' || activeTool === 'column') ? activeTool : 'wall';
            const newObstacle: Obstacle = {
                id: `obs-${Date.now()}`,
                x: previewRect.x,
                y: previewRect.y,
                width: previewRect.w,
                height: previewRect.h,
                rotation: 0,
                type: obstacleType,
            };
            onObstaclesChange([...obstacles, newObstacle]);
        }

        isPaintingRef.current = false;
        dragStartRef.current = null;
        setPreviewRect(null);
    };

    // ズーム操作
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

    const handleDragEndBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        const x = Math.round(e.target.x() / GRID_SIZE);
        const y = Math.round(e.target.y() / GRID_SIZE);
        const newBooths = booths.map(booth => booth.id === id ? { ...booth, x, y, isPlaced: true } : booth);
        onBoothsChange(newBooths);
        e.target.to({ x: x * GRID_SIZE, y: y * GRID_SIZE, duration: 0.1 });
    };

    // Booth Click Handler (for selection)
    const handleBoothClick = (e: any, boothId: string) => {
        if (mode === 'booth') {
            e.cancelBubble = true;
            setSelectedBoothId(boothId);
        }
    };

    // Update Booth Size
    const updateBoothSize = (boothId: string, width: number, depth: number) => {
        const newBooths = booths.map(b =>
            b.id === boothId ? { ...b, sizeMm: { width, depth } } : b
        );
        onBoothsChange(newBooths);
    };

    const selectedBooth = booths.find(b => b.id === selectedBoothId);

    return (
        <div ref={containerRef} className="bg-white flex flex-col h-full w-full relative">

            {/* Mode & Global Settings */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-4 items-start pointer-events-none">
                <div className="bg-white shadow-lg rounded-full px-4 py-2 flex gap-4 items-center border border-gray-200 pointer-events-auto">
                    <div className="flex bg-gray-100 rounded-full p-1">
                        <button
                            onClick={() => onModeChange('booth')}
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

                {/* Grid & Table Setting (Venue Mode) */}
                {mode === 'venue' && (
                    <div className="bg-white shadow-lg rounded-xl px-4 py-2 border border-gray-200 pointer-events-auto flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">1マス:</span>
                            <input
                                type="number"
                                value={gridUnitMm}
                                onChange={(e) => setGridUnitMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-gray-50"
                                step={10}
                            />
                            <span className="text-xs text-gray-500">mm</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">基本卓:</span>
                            <input
                                type="number"
                                value={baseTableWidthMm}
                                onChange={(e) => setBaseTableWidthMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-gray-50"
                                step={10}
                                title="幅"
                            />
                            <span className="text-gray-400">x</span>
                            <input
                                type="number"
                                value={baseTableDepthMm}
                                onChange={(e) => setBaseTableDepthMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-gray-50"
                                step={10}
                                title="奥行"
                            />
                            <span className="text-xs text-gray-500">mm</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Booth Edit Panel (When Selected) */}
            {selectedBooth && mode === 'booth' && (
                <div className="absolute top-20 right-4 z-20 bg-white shadow-xl rounded-xl p-4 border border-blue-100 w-64 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-center mb-2 border-b pb-2">
                        <h3 className="font-bold text-gray-700 truncate">{selectedBooth.name}</h3>
                        <button onClick={() => setSelectedBoothId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs text-gray-500 block mb-1">現在のサイズ</label>
                            <div className="text-sm font-medium">
                                {selectedBooth.sizeMm
                                    ? `${selectedBooth.sizeMm.width}mm x ${selectedBooth.sizeMm.depth}mm`
                                    : `${selectedBooth.size}卓 (${selectedBooth.size * baseTableWidthMm}x${baseTableDepthMm}mm)`
                                }
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">幅 (mm)</label>
                                <input
                                    type="number"
                                    value={selectedBooth.sizeMm?.width ?? (selectedBooth.size * baseTableWidthMm)}
                                    onChange={(e) => updateBoothSize(selectedBooth.id, Number(e.target.value), selectedBooth.sizeMm?.depth ?? baseTableDepthMm)}
                                    className={`w-full border rounded px-2 py-1 text-sm ${selectedBooth.sizeMm ? 'bg-white border-blue-300' : 'bg-gray-50'}`}
                                    step={10}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">奥行 (mm)</label>
                                <input
                                    type="number"
                                    value={selectedBooth.sizeMm?.depth ?? baseTableDepthMm}
                                    onChange={(e) => updateBoothSize(selectedBooth.id, selectedBooth.sizeMm?.width ?? (selectedBooth.size * baseTableWidthMm), Number(e.target.value))}
                                    className={`w-full border rounded px-2 py-1 text-sm ${selectedBooth.sizeMm ? 'bg-white border-blue-300' : 'bg-gray-50'}`}
                                    step={10}
                                />
                            </div>
                        </div>

                        {selectedBooth.sizeMm && (
                            <button
                                onClick={() => {
                                    const newBooths = booths.map(b => b.id === selectedBooth.id ? { ...b, sizeMm: undefined } : b);
                                    onBoothsChange(newBooths);
                                }}
                                className="text-xs text-blue-600 underline hover:text-blue-800"
                            >
                                基本サイズに戻す
                            </button>
                        )}

                        <div className="text-xs text-gray-400 mt-2">
                            ※基本サイズ: 1.0卓={baseTableWidthMm}mm幅 / 奥行{baseTableDepthMm}mm
                        </div>
                    </div>
                </div>
            )}


            {/* Venue Editing Toolbar */}
            {mode === 'venue' && (
                <div className="absolute top-20 left-4 z-10 bg-white/90 backdrop-blur shadow-xl rounded-xl p-2 flex flex-col gap-2 border border-orange-100 animate-in slide-in-from-left-4 items-center">

                    <div className="flex gap-2">
                        <button
                            onClick={() => setActiveTool('none')}
                            className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'none' && !isBgEditing ? 'bg-gray-200 ring-2 ring-gray-300' : 'hover:bg-gray-100'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-700 mb-1">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m7.5-15v15M3 10.5h18M3 16.5h18" />
                            </svg>
                            <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">移動</span>
                        </button>

                        <div className="w-px bg-gray-300 h-full mx-1"></div>

                        <button
                            onClick={() => { setActiveTool('wall'); setIsBgEditing(false); }}
                            className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'wall' ? 'bg-orange-100 ring-2 ring-orange-300' : 'hover:bg-gray-100'}`}
                        >
                            <div className="w-6 h-6 bg-gray-600 mb-1 border border-gray-700"></div>
                            <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">壁ペン</span>
                        </button>

                        <button
                            onClick={() => { setActiveTool('column'); setIsBgEditing(false); }}
                            className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'column' ? 'bg-orange-100 ring-2 ring-orange-300' : 'hover:bg-gray-100'}`}
                        >
                            <div className="w-6 h-6 bg-[#795548] mb-1 border border-gray-700"></div>
                            <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">柱ペン</span>
                        </button>

                        <button
                            onClick={() => { setActiveTool('eraser'); setIsBgEditing(false); }}
                            className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'eraser' ? 'bg-red-100 ring-2 ring-red-300' : 'hover:bg-gray-100'}`}
                        >
                            <div className="w-6 h-6 mb-1 text-red-500 border border-current rounded flex items-center justify-center">✕</div>
                            <span className="text-[10px] font-medium text-red-600 leading-tight text-center">消しゴム</span>
                        </button>
                    </div>

                    <div className="h-px bg-gray-300 w-full my-1"></div>

                    {/* 背景画像操作セクション */}
                    <div className="flex items-center gap-1 w-full justify-center">
                        <label className="flex flex-col items-center p-2 hover:bg-gray-100 rounded cursor-pointer w-16" title="下絵を読み込む">
                            <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-600 mb-1">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                            </svg>
                            <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">下絵読込</span>
                        </label>

                        {bgImage && (
                            <>
                                <button
                                    onClick={() => {
                                        setIsBgEditing(!isBgEditing);
                                        if (!isBgEditing) setActiveTool('none');
                                    }}
                                    className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${isBgEditing ? 'bg-blue-100 ring-2 ring-blue-300' : 'hover:bg-gray-100'}`}
                                    title="下絵のサイズ・位置調整"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-700 mb-1">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                                    </svg>
                                    <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">調整</span>
                                </button>

                                <button
                                    onClick={() => {
                                        if (window.confirm('下絵を削除しますか？')) {
                                            setBgImage(null);
                                            setIsBgEditing(false);
                                        }
                                    }}
                                    className="flex flex-col items-center p-2 rounded w-16 transition-colors hover:bg-red-50 group"
                                    title="下絵を削除"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mb-1 text-gray-400 group-hover:text-red-500 transition-colors">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                    <span className="text-[10px] font-medium text-gray-500 group-hover:text-red-600 leading-tight text-center transition-colors">削除</span>
                                </button>
                                <div className="flex flex-col justify-center w-20 px-1">
                                    <label className="text-[10px] text-gray-500 text-center mb-1">透明度</label>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="1"
                                        step="0.1"
                                        value={bgConfig.opacity}
                                        onChange={(e) => setBgConfig({ ...bgConfig, opacity: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* AI Scan Button - Bottom Right */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 right-4 z-10">
                    <label className="flex items-center gap-2 p-3 bg-white hover:bg-blue-50 rounded-full shadow-lg cursor-pointer border border-blue-100 transition-all">
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const confirmScan = window.confirm('画像を解析して障害物を配置しますか？\n（現在の配置に追加されます）\n※下絵として読み込む場合は「下絵読込」を使用してください');
                                if (!confirmScan) return;
                                try {
                                    const reader = new FileReader();
                                    reader.onload = async (event) => {
                                        const base64 = event.target?.result as string;
                                        // TODO: Loading state
                                        const res = await fetch('/api/analyze-venue', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ image: base64 }),
                                        });
                                        if (!res.ok) throw new Error('解析失敗');
                                        const newObstacles = await res.json();
                                        onObstaclesChange([...obstacles, ...newObstacles]);
                                        alert(`解析完了: ${newObstacles.length}個のオブジェクトを検出しました`);
                                    };
                                    reader.readAsDataURL(file);
                                } catch (err) {
                                    alert('エラーが発生しました');
                                }
                            }}
                        />
                        <div className="text-blue-500">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                            </svg>
                        </div>
                        <span className="font-bold text-blue-600">AI自動解析</span>
                    </label>
                </div>
            )}


            {/* Instruction Toast */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm pointer-events-none animate-pulse z-20 whitespace-nowrap">
                    {isBgEditing ? '下絵を調整中：グリッドに合わせてください' : activeTool !== 'none' ? 'ドラッグしてなぞると連続配置できます' : '移動モード'}
                </div>
            )}

            {/* Canvas */}
            <div className="flex-grow overflow-hidden" style={{ cursor: mode === 'venue' && activeTool !== 'none' ? 'crosshair' : 'grab' }}>
                <Stage
                    width={dimensions.width}
                    height={dimensions.height}
                    draggable={!isBgEditing && (mode === 'booth' || activeTool === 'none')}
                    onWheel={handleWheel}
                    scaleX={stageScale}
                    scaleY={stageScale}
                    x={stagePos.x}
                    y={stagePos.y}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onDragEnd={(e) => {
                        if (e.target === e.target.getStage()) {
                            setStagePos({ x: e.target.x(), y: e.target.y() });
                        }
                    }}
                    style={{ background: '#fafafa' }}
                >
                    <Layer>
                        {/* 背景画像 (グリッドの下に表示) */}
                        {bgImage && (
                            <React.Fragment>
                                <KonvaImage
                                    image={bgImage}
                                    ref={bgNodeRef}
                                    x={bgConfig.x}
                                    y={bgConfig.y}
                                    scaleX={bgConfig.scaleX}
                                    scaleY={bgConfig.scaleY}
                                    rotation={bgConfig.rotation}
                                    opacity={bgConfig.opacity}
                                    draggable={isBgEditing}
                                    onDragEnd={handleBgDragEnd}
                                    onTransformEnd={handleBgTransformEnd}
                                />
                                {isBgEditing && (
                                    <Transformer
                                        ref={bgTrRef}
                                        boundBoxFunc={(oldBox, newBox) => {
                                            if (newBox.width < 5 || newBox.height < 5) return oldBox;
                                            return newBox;
                                        }}
                                        anchorSize={15}
                                        anchorCornerRadius={8}
                                    />
                                )}
                            </React.Fragment>
                        )}
                        {gridLines}
                    </Layer>
                    <Layer>
                        {/* 障害物 */}
                        {obstacles.map(obs => (
                            <ObstacleComponent
                                key={obs.id}
                                data={obs}
                                gridPixelSize={GRID_SIZE}
                                isSelected={selectedObstacleId === obs.id}
                                isEditable={mode === 'venue' && activeTool === 'none' && !isBgEditing} // 背景編集中も障害物移動不可
                                onSelect={() => { if (mode === 'venue' && activeTool === 'none' && !isBgEditing) setSelectedObstacleId(obs.id); }}
                                onChange={handleObstacleChange}
                            />
                        ))}
                        {/* 描画中のプレビュー */}
                        {previewRect && (
                            <Rect
                                x={previewRect.x * GRID_SIZE}
                                y={previewRect.y * GRID_SIZE}
                                width={previewRect.w * GRID_SIZE}
                                height={previewRect.h * GRID_SIZE}
                                fill={activeTool === 'wall' ? '#607d8b' : '#795548'}
                                opacity={0.5}
                                stroke="#2196f3"
                                strokeWidth={2}
                                dash={[4, 4]}
                            />
                        )}
                    </Layer>
                    <Layer opacity={mode === 'venue' ? 0.3 : 1}>
                        {/* ブース */}
                        {booths.map(booth => (
                            <Group
                                key={booth.id}
                                onClick={(e) => handleBoothClick(e, booth.id)}
                            >
                                <BoothUnit
                                    data={booth}
                                    gridPixelSize={GRID_SIZE}
                                    gridUnitMm={gridUnitMm}
                                    baseTableWidthMm={baseTableWidthMm}
                                    baseTableDepthMm={baseTableDepthMm}
                                    draggable={mode === 'booth'}
                                    onDragEnd={(e) => handleDragEndBooth(e, booth.id)}
                                />
                                {/* 選択時の枠線 */}
                                {selectedBoothId === booth.id && (
                                    <Rect
                                        x={booth.x * GRID_SIZE}
                                        y={booth.y * GRID_SIZE}
                                        width={(booth.sizeMm?.width ?? (booth.size * 1800)) / gridUnitMm * GRID_SIZE}
                                        height={(
                                            (1800 + (booth.sizeMm?.depth ?? 450) + 900) / gridUnitMm * GRID_SIZE
                                        )}
                                        stroke="#2196f3"
                                        strokeWidth={2}
                                        listening={false}
                                        dash={[5, 5]}
                                    />
                                )}
                            </Group>
                        ))}
                    </Layer>
                </Stage>
            </div>
        </div>
    );
}


