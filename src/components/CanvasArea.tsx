'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Line, Rect } from 'react-konva';
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
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Viewport State
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // Painting State
    const [activeTool, setActiveTool] = useState<ToolType>('none');
    const isPaintingRef = useRef(false);

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

    // モード切り替え時にツールをリセット
    useEffect(() => {
        if (mode === 'booth') {
            setActiveTool('none');
        } else {
            setActiveTool('wall'); // デフォルトで壁ペンを持たせる
        }
    }, [mode]);

    if (dimensions.width === 0) {
        return <div className="w-full h-full bg-gray-100 flex items-center justify-center">Loading...</div>;
    }

    // --- Grid Rendering ---
    const gridLines = [];
    const maxGrid = 200;
    for (let i = 0; i <= maxGrid; i++) {
        gridLines.push(<Line key={`v-${i}`} points={[i * GRID_SIZE, 0, i * GRID_SIZE, maxGrid * GRID_SIZE]} stroke="#eee" strokeWidth={1} listening={false} />);
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

    // グリッドを塗りつぶす / 消す
    const paintGrid = (stageX: number, stageY: number) => {
        if (mode !== 'venue' || activeTool === 'none') return;

        // ステージ座標からグリッド座標へ変換
        const gx = Math.floor((stageX - stagePos.x) / (stageScale * GRID_SIZE));
        const gy = Math.floor((stageY - stagePos.y) / (stageScale * GRID_SIZE));

        if (gx < 0 || gy < 0) return;

        const existingObs = findObstacleAt(gx, gy);

        if (activeTool === 'eraser') {
            if (existingObs) {
                // 既存の障害物を削除するが、1x1単位で消すために、
                // もし大きな矩形(2x2以上など)だった場合は分割するか、単純にそのオブジェクトごと消すか。
                // ここではシンプルに「その座標を含むオブジェクトを削除」する。
                // ※ユーザー体験としては「塗りつぶし」なので、部分削除が望ましいが、矩形管理だと複雑になるため
                // 一旦「オブジェクト単位」での削除とする。
                // 改善案: ヒットしたオブジェクトが1x1より大きい場合、そのグリッド部分だけ穴を開ける（＝分割する）処理が必要だが、
                // 今回は「塗りつぶしモード」で作成されたものは基本的に1x1の集合になると仮定し、
                // 大きなオブジェクトも一括削除で許容する。
                onObstaclesChange(obstacles.filter(o => o.id !== existingObs.id));
            }
        } else {
            // wall または column
            if (!existingObs) {
                // 新規作成 (1x1)
                const newObstacle: Obstacle = {
                    id: `obs-${Date.now()}-${gx}-${gy}`,
                    x: gx,
                    y: gy,
                    width: 1, // 1グリッド
                    height: 1, // 1グリッド
                    rotation: 0,
                    type: activeTool,
                };
                onObstaclesChange([...obstacles, newObstacle]);
            } else {
                // 既に別のタイプがある場合は上書きするか？
                // 同じタイプなら何もしない、違うタイプなら書き換え
                if (existingObs.type !== activeTool) {
                    const updated = obstacles.map(o => o.id === existingObs.id ? { ...o, type: activeTool } : o);
                    onObstaclesChange(updated);
                }
            }
        }
    };

    // --- Mouse / Touch Handlers for Stage ---

    const handleMouseDown = (e: any) => {
        const stage = e.target.getStage();
        if (!stage) return;

        // Venurモードかつツール選択中のみ描画開始
        if (mode === 'venue' && activeTool !== 'none') {
            isPaintingRef.current = true;
            const pos = stage.getPointerPosition();
            if (pos) paintGrid(pos.x, pos.y);
        }
    };

    const handleMouseMove = (e: any) => {
        const stage = e.target.getStage();
        if (!stage) return;

        if (isPaintingRef.current && mode === 'venue') {
            const pos = stage.getPointerPosition();
            if (pos) paintGrid(pos.x, pos.y);
        }
    };

    const handleMouseUp = () => {
        isPaintingRef.current = false;
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
        <div className="bg-white flex flex-col h-full w-full relative">

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

                    <button
                        onClick={() => setActiveTool('wall')}
                        className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'wall' ? 'bg-orange-100 ring-2 ring-orange-300' : 'hover:bg-gray-100'}`}
                    >
                        <div className="w-6 h-6 bg-gray-600 mb-1 border border-gray-700"></div>
                        <span className="text-xs font-medium text-gray-700">壁ペン</span>
                    </button>

                    <button
                        onClick={() => setActiveTool('column')}
                        className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'column' ? 'bg-orange-100 ring-2 ring-orange-300' : 'hover:bg-gray-100'}`}
                    >
                        <div className="w-6 h-6 bg-[#795548] mb-1 border border-gray-700"></div>
                        <span className="text-xs font-medium text-gray-700">柱ペン</span>
                    </button>

                    <button
                        onClick={() => setActiveTool('eraser')}
                        className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'eraser' ? 'bg-red-100 ring-2 ring-red-300' : 'hover:bg-gray-100'}`}
                    >
                        <div className="w-6 h-6 mb-1 text-red-500 border border-current rounded flex items-center justify-center">
                            ✕
                        </div>
                        <span className="text-xs font-medium text-red-600">消しゴム</span>
                    </button>

                    <div className="w-px bg-gray-300 h-8 mx-1"></div>

                    {/* 画像解析ボタン (既存維持) */}
                    <label className="flex flex-col items-center p-2 hover:bg-blue-50 rounded cursor-pointer relative group w-16">
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const confirmScan = window.confirm('画像を解析して障害物を配置しますか？\n（現在の配置に追加されます）');
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
                        <span className="text-xs font-medium text-blue-600">スキャン</span>
                    </label>
                </div>
            )}

            {/* Instruction Toast */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm pointer-events-none animate-pulse">
                    ドラッグしてなぞると連続配置できます
                </div>
            )}

            {/* Canvas */}
            <div className="flex-grow overflow-hidden cursor-crosshair">
                <Stage
                    width={dimensions.width}
                    height={dimensions.height}
                    draggable={mode === 'booth' || activeTool === 'none'} // 描画中はドラッグ無効
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
                        {gridLines}
                    </Layer>
                    <Layer>
                        {/* 障害物 */}
                        {obstacles.map(obs => (
                            <ObstacleComponent
                                key={obs.id}
                                data={obs}
                                isSelected={false} // 塗りつぶしモードでは選択状態は不要
                                isEditable={false} // ドラッグ移動はさせない
                                onSelect={() => { }}
                                onChange={() => { }}
                            />
                        ))}
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
