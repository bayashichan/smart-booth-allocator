'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Line, Rect, Image as KonvaImage, Transformer } from 'react-konva';
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

    // Painting / Line Tool State
    const [activeTool, setActiveTool] = useState<ToolType>('none');
    const isPaintingRef = useRef(false);
    const dragStartRef = useRef<{ gx: number, gy: number } | null>(null);
    const [previewRect, setPreviewRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    // Obstacle editing state
    const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);

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
        // Initial call
        updateSize();
        // A small delay to ensure layout is settled
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
            // Check current tool, if none maybe keep or set to wall? Let's just reset if coming from booth?
            // Usually fine to keep current state unless specifically needed.
            if (activeTool === 'none' && !isBgEditing) {
                // setActiveTool('wall'); // Optional: force wall tool on venue mode entry
            }
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
                // 初期位置：中央付近
                setBgConfig({
                    x: 100,
                    y: 100,
                    scaleX: 1, // 初期スケール
                    scaleY: 1,
                    rotation: 0,
                    opacity: 0.5
                });
                setIsBgEditing(true); // アップロード直後は編集モードに
                setActiveTool('none'); // ペンはオフに
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

    // 指定座標(gx, gy)にある障害物を探す
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
        if (isBgEditing) return; // Background editing takes precedence

        const stage = e.target.getStage();
        if (!stage) return;

        // ツールが選択されていない場合はステージドラッグ (Stage definition handles draggable)
        if (mode === 'venue' && activeTool === 'none') {
            setSelectedObstacleId(null); // 障害物選択解除
            return;
        }

        if (mode === 'venue' && activeTool !== 'none') {
            isPaintingRef.current = true;
            const pos = stage.getPointerPosition();
            if (pos) {
                const { gx, gy } = getGridPos(pos.x, pos.y);
                dragStartRef.current = { gx, gy };

                // 消しゴムの場合は即座に消していく（なぞり消し）
                if (activeTool === 'eraser') {
                    handleEraser(gx, gy);
                } else {
                    // 壁・柱の場合はプレビュー開始
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
                // 壁・柱：ドラッグ領域の計算
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
            // 矩形・直線確定
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

    return (
        <div ref={containerRef} className="bg-white flex flex-col h-full w-full relative">

            {/* Mode Toggle */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white shadow-lg rounded-full px-4 py-2 flex gap-4 items-center border border-gray-200">
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

            {/* Venue Editing Toolbar */}
            {mode === 'venue' && (
                <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 bg-white/90 backdrop-blur shadow-xl rounded-xl p-2 flex gap-2 border border-orange-100 animate-in slide-in-from-top-4 items-center">

                    {/* 背景画像操作セクション */}
                    <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
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

                    <button
                        onClick={() => { setActiveTool('none'); setIsBgEditing(false); }}
                        className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'none' && !isBgEditing ? 'bg-gray-200 ring-2 ring-gray-300' : 'hover:bg-gray-100'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-700 mb-1">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m7.5-15v15M3 10.5h18M3 16.5h18" />
                        </svg>
                        <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">移動</span>
                    </button>

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

                    <div className="w-px bg-gray-300 h-8 mx-1"></div>

                    {/* AI Scan Button */}
                    <label className="flex flex-col items-center p-2 hover:bg-blue-50 rounded cursor-pointer relative group w-16">
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
                        <div className="text-blue-500 mb-1">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-medium text-blue-600 leading-tight text-center">AI解析</span>
                    </label>
                </div>
            )}

            {/* Instruction Toast */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm pointer-events-none animate-pulse z-20">
                    {isBgEditing ? '下絵をドラッグ/拡大縮小してグリッドに合わせてください' : activeTool !== 'none' ? 'ドラッグしてなぞると連続配置できます' : '移動モード: 左上のツールを選択してください'}
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
        </div>
    );
}
