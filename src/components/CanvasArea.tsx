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

    // AI プロバイダー選択
    const [aiProvider, setAiProvider] = useState<'gemini' | 'groq'>('gemini');

    // Global Config State
    const [gridUnitMm, setGridUnitMm] = useState(450);
    const [baseTableWidthMm, setBaseTableWidthMm] = useState(1800);
    const [baseTableDepthMm, setBaseTableDepthMm] = useState(450);
    const [seatFontSize, setSeatFontSize] = useState(14);

    // 障害物描画設定
    const [obstacleColor, setObstacleColor] = useState('#607d8b');
    const [obstacleStrokeWidth, setObstacleStrokeWidth] = useState(2);
    const [obstacleDimW, setObstacleDimW] = useState(1800); // mm
    const [obstacleDimH, setObstacleDimH] = useState(450);  // mm

    // ブース カテゴリ別カラーマップ
    const [categoryColors, setCategoryColors] = useState<Record<string, { stroke: string; fill: string }>>({});

    // Painting / Line Tool State
    const [activeTool, setActiveTool] = useState<ToolType>('none');
    const isPaintingRef = useRef(false);
    const dragStartRef = useRef<{ gx: number, gy: number } | null>(null);
    const [previewRect, setPreviewRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    // Obstacle editing state
    const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);

    // Booth editing state
    const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);
    // 複数選択
    const [selectedBoothIds, setSelectedBoothIds] = useState<Set<string>>(new Set());
    // ドラッグ範囲選択
    const [dragSelect, setDragSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const isDragSelectingRef = useRef(false);

    // Background Image State
    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
    const [bgConfig, setBgConfig] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 });
    const [isBgEditing, setIsBgEditing] = useState(false);
    const [isBgVisible, setIsBgVisible] = useState(true); // 下絵の表示・非表示
    const bgNodeRef = useRef<any>(null);
    const bgTrRef = useRef<any>(null);

    // Calibration State
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [calibrationPoints, setCalibrationPoints] = useState<{ x: number, y: number }[]>([]);

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
            setIsBgEditing(false);
            setIsCalibrating(false);
            setCalibrationPoints([]);
        } else {
            setSelectedBoothId(null);
            setSelectedBoothIds(new Set());
            setDragSelect(null);
        }
    }, [mode]);

    // --- ブースのグリッド占有矩形を取得（グリッド単位） ---
    const getBoothGridBounds = (booth: Booth) => {
        const widthMm  = booth.sizeMm ? booth.sizeMm.width : booth.size * baseTableWidthMm;
        const depthMm  = booth.sizeMm ? booth.sizeMm.depth : baseTableDepthMm;
        // 90/270度回転時は幅と奥行きを入れ替え
        const rot = booth.rotation ?? 0;
        const w = (rot === 90 || rot === 270)
            ? depthMm  / gridUnitMm
            : widthMm  / gridUnitMm;
        const h = (rot === 90 || rot === 270)
            ? widthMm  / gridUnitMm
            : depthMm  / gridUnitMm;
        return { x: booth.x, y: booth.y, w, h };
    };

    // --- 指定座標にブースを置いた場合に他と重なるか確認 ---
    const checkBoothCollision = (movingId: string, newX: number, newY: number, boothList: Booth[]) => {
        const moving = boothList.find(b => b.id === movingId);
        if (!moving) return false;
        const widthMm  = moving.sizeMm ? moving.sizeMm.width : moving.size * baseTableWidthMm;
        const depthMm  = moving.sizeMm ? moving.sizeMm.depth : baseTableDepthMm;
        const rot = moving.rotation ?? 0;
        const mw = (rot === 90 || rot === 270) ? depthMm / gridUnitMm : widthMm / gridUnitMm;
        const mh = (rot === 90 || rot === 270) ? widthMm / gridUnitMm : depthMm / gridUnitMm;

        return boothList.some(b => {
            if (b.id === movingId) return false;
            const bounds = getBoothGridBounds(b);
            // AABB重なり判定 (少しマージンを持たせる)
            return (
                newX        < bounds.x + bounds.w &&
                newX + mw   > bounds.x &&
                newY        < bounds.y + bounds.h &&
                newY + mh   > bounds.y
            );
        });
    };

    // --- 重ならない最近傍グリッドを探す ---
    const findFreePosition = (movingId: string, preferX: number, preferY: number, boothList: Booth[]) => {
        for (let r = 0; r <= 20; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = Math.max(0, preferX + dx);
                    const ny = Math.max(0, preferY + dy);
                    if (!checkBoothCollision(movingId, nx, ny, boothList)) {
                        return { x: nx, y: ny };
                    }
                }
            }
        }
        return { x: preferX, y: preferY };
    };

    // --- 下絵をbase64に変換 ---
    const getBgImageBase64 = (): string | null => {
        if (!bgImage) return null;
        const canvas = document.createElement('canvas');
        canvas.width  = bgImage.naturalWidth;
        canvas.height = bgImage.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bgImage, 0, 0);
        return canvas.toDataURL('image/png');
    };

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
        gridLines.push(<Line key={`v-${i}`} points={[i * GRID_SIZE, 0, i * GRID_SIZE, maxGrid * GRID_SIZE]} stroke="#bbb" strokeWidth={1} listening={false} />);
        // Horizontal lines
        gridLines.push(<Line key={`h-${i}`} points={[0, i * GRID_SIZE, maxGrid * GRID_SIZE, i * GRID_SIZE]} stroke="#bbb" strokeWidth={1} listening={false} />);
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
            // ブースモードでは範囲選択開始
            if (mode === 'booth') {
                setSelectedBoothIds(new Set());
                const pos = stage.getPointerPosition();
                if (pos) {
                    const stageX = (pos.x - stage.x()) / stage.scaleX();
                    const stageY = (pos.y - stage.y()) / stage.scaleY();
                    isDragSelectingRef.current = true;
                    setDragSelect({ startX: stageX, startY: stageY, endX: stageX, endY: stageY });
                }
                return;
            }
        }

        // Calibration Logic
        if (isCalibrating && bgImage) {
            const pos = stage.getPointerPosition();
            if (pos) {
                // ステージ上の座標を取得 (ズーム・パン考慮済み)
                const point = {
                    x: (pos.x - stage.x()) / stage.scaleX(),
                    y: (pos.y - stage.y()) / stage.scaleY()
                };

                const newPoints = [...calibrationPoints, point];
                setCalibrationPoints(newPoints);

                if (newPoints.length === 2) {
                    // 2点クリック完了
                    setTimeout(() => {
                        const p1 = newPoints[0];
                        const p2 = newPoints[1];
                        const distPx = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

                        const input = window.prompt('2点間の実際の距離(mm)を入力してください:', '5000');
                        if (input) {
                            const realDistMm = parseFloat(input);
                            if (!isNaN(realDistMm) && realDistMm > 0) {
                                // 目標のピクセル距離: (実距離mm / 1マスのmm) * 1マスのピクセル数
                                const targetDistPx = (realDistMm / gridUnitMm) * GRID_SIZE;
                                const scaleFactor = targetDistPx / distPx;

                                setBgConfig(prev => ({
                                    ...prev,
                                    scaleX: prev.scaleX * scaleFactor,
                                    scaleY: prev.scaleY * scaleFactor
                                }));
                                alert(`縮尺を調整しました (倍率: ${scaleFactor.toFixed(4)})`);
                            }
                        }
                        setIsCalibrating(false);
                        setCalibrationPoints([]);
                    }, 100);
                }
            }
            return;
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
        if (isCalibrating) return;

        const stage = e.target.getStage();
        if (!stage) return;

        // ドラッグ範囲選択の更新
        if (isDragSelectingRef.current && dragSelect) {
            const pos = stage.getPointerPosition();
            if (pos) {
                setDragSelect(prev => prev ? {
                    ...prev,
                    endX: (pos.x - stage.x()) / stage.scaleX(),
                    endY: (pos.y - stage.y()) / stage.scaleY(),
                } : null);
            }
            return;
        }

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
        if (isCalibrating) return;

        // ドラッグ範囲選択の確定
        if (isDragSelectingRef.current && dragSelect) {
            isDragSelectingRef.current = false;
            const minX = Math.min(dragSelect.startX, dragSelect.endX);
            const maxX = Math.max(dragSelect.startX, dragSelect.endX);
            const minY = Math.min(dragSelect.startY, dragSelect.endY);
            const maxY = Math.max(dragSelect.startY, dragSelect.endY);
            // 範囲内のブースを選択
            const selected = new Set<string>();
            booths.forEach(b => {
                const widthMm = b.sizeMm ? b.sizeMm.width : b.size * baseTableWidthMm;
                const depthMm = b.sizeMm ? b.sizeMm.depth : baseTableDepthMm;
                const bx = b.x * GRID_SIZE;
                const by = b.y * GRID_SIZE;
                const bw = (widthMm / gridUnitMm) * GRID_SIZE;
                const bh = (depthMm / gridUnitMm) * GRID_SIZE;
                if (bx < maxX && bx + bw > minX && by < maxY && by + bh > minY) {
                    selected.add(b.id);
                }
            });
            setSelectedBoothIds(selected);
            setDragSelect(null);
            return;
        }

        if (isPaintingRef.current && mode === 'venue' && activeTool !== 'eraser' && previewRect) {
            const obstacleType = (activeTool === 'wall' || activeTool === 'column') ? activeTool : 'wall';
            const newObstacle: Obstacle = {
                id: `obs-${Date.now()}`,
                x: previewRect.x,
                y: previewRect.y,
                width:  previewRect.w,
                height: previewRect.h,
                rotation: 0,
                type: obstacleType,
                color: obstacleColor,
                strokeWidth: obstacleStrokeWidth,
            };
            onObstaclesChange([...obstacles, newObstacle]);
        }

        isPaintingRef.current = false;
        dragStartRef.current  = null;
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
        const rawX = Math.round(e.target.x() / GRID_SIZE);
        const rawY = Math.round(e.target.y() / GRID_SIZE);
        const dx = rawX - (booths.find(b => b.id === id)?.x ?? 0);
        const dy = rawY - (booths.find(b => b.id === id)?.y ?? 0);

        // 複数選択中は全て移動（重なりチェック付き）
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            // 仮に全員を移動させた状態のboothListを作って判定
            let tentative = booths.map(b =>
                selectedBoothIds.has(b.id) ? { ...b, x: b.x + dx, y: b.y + dy, isPlaced: true } : b
            );
            // 各移動ブース同士の重なりは許容（グループ全体で移動）
            // 選択外のブースとの重なりだけチェック
            const hasCollision = Array.from(selectedBoothIds).some(bid => {
                const nb = tentative.find(b => b.id === bid);
                if (!nb) return false;
                return tentative.some(b => {
                    if (selectedBoothIds.has(b.id)) return false; // 同グループは無視
                    const bounds = getBoothGridBounds(b);
                    const widthMm = nb.sizeMm ? nb.sizeMm.width : nb.size * baseTableWidthMm;
                    const depthMm = nb.sizeMm ? nb.sizeMm.depth : baseTableDepthMm;
                    const rot = nb.rotation ?? 0;
                    const mw = (rot === 90 || rot === 270) ? depthMm / gridUnitMm : widthMm / gridUnitMm;
                    const mh = (rot === 90 || rot === 270) ? widthMm / gridUnitMm : depthMm / gridUnitMm;
                    return (
                        nb.x < bounds.x + bounds.w && nb.x + mw > bounds.x &&
                        nb.y < bounds.y + bounds.h && nb.y + mh > bounds.y
                    );
                });
            });
            if (!hasCollision) {
                onBoothsChange(tentative);
            } else {
                // 重なる場合は元の位置に戻す
                const orig = booths.find(b => b.id === id);
                e.target.to({ x: (orig?.x ?? rawX) * GRID_SIZE, y: (orig?.y ?? rawY) * GRID_SIZE, duration: 0.1 });
                return;
            }
        } else {
            // 単体移動：重なるなら最近傍の空きへスナップ
            const pos = findFreePosition(id, rawX, rawY, booths);
            const newBooths = booths.map(b => b.id === id ? { ...b, x: pos.x, y: pos.y, isPlaced: true } : b);
            onBoothsChange(newBooths);
            e.target.to({ x: pos.x * GRID_SIZE, y: pos.y * GRID_SIZE, duration: 0.1 });
            return;
        }
        e.target.to({ x: rawX * GRID_SIZE, y: rawY * GRID_SIZE, duration: 0.1 });
    };

    // Booth Click Handler (Shift で複数選択)
    const handleBoothClick = (e: any, boothId: string) => {
        if (mode === 'booth') {
            e.cancelBubble = true;
            if (e.evt?.shiftKey) {
                // Shiftクリックで追加/解除
                const next = new Set(selectedBoothIds);
                if (next.has(boothId)) next.delete(boothId); else next.add(boothId);
                setSelectedBoothIds(next);
                setSelectedBoothId(next.size === 1 ? boothId : null);
            } else {
                setSelectedBoothId(boothId);
                setSelectedBoothIds(new Set([boothId]));
            }
        }
    };

    // 選択ブースを 90度回転
    const rotateSelectedBooths = () => {
        const ids = selectedBoothIds.size > 0 ? selectedBoothIds : selectedBoothId ? new Set([selectedBoothId]) : new Set<string>();
        if (ids.size === 0) return;
        const newBooths = booths.map(b =>
            ids.has(b.id)
                ? { ...b, rotation: ((b.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
                : b
        );
        onBoothsChange(newBooths);
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
                            <span className="text-xs text-gray-600 font-medium whitespace-nowrap">1マス:</span>
                            <input
                                type="number"
                                value={gridUnitMm}
                                onChange={(e) => setGridUnitMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-white text-gray-800"
                                step={10}
                            />
                            <span className="text-xs text-gray-600">mm</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 font-medium whitespace-nowrap">基本卓:</span>
                            <input
                                type="number"
                                value={baseTableWidthMm}
                                onChange={(e) => setBaseTableWidthMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-white text-gray-800"
                                step={10}
                                title="幅"
                            />
                            <span className="text-gray-500">x</span>
                            <input
                                type="number"
                                value={baseTableDepthMm}
                                onChange={(e) => setBaseTableDepthMm(Number(e.target.value))}
                                className="w-14 text-right border rounded px-1 text-sm bg-white text-gray-800"
                                step={10}
                                title="奥行"
                            />
                            <span className="text-xs text-gray-600">mm</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Booth Edit Panel (When Selected) */}
            {selectedBooth && mode === 'booth' && (
                <div className="absolute top-20 right-4 z-20 bg-white shadow-xl rounded-xl p-4 border border-blue-100 w-64 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-center mb-2 border-b pb-2">
                        <h3 className="font-bold text-gray-700 truncate">{selectedBooth.name}</h3>
                        <button onClick={() => { setSelectedBoothId(null); setSelectedBoothIds(new Set()); }} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>

                    <div className="space-y-3">
                        {/* 座席番号 */}
                        {selectedBooth.seatNumber && (
                            <div className="text-sm font-medium text-purple-700">#{selectedBooth.seatNumber}</div>
                        )}

                        <div>
                            <label className="text-xs text-gray-500 block mb-1">現在のサイズ</label>
                            <div className="text-sm font-medium">
                                {selectedBooth.sizeMm
                                    ? `${selectedBooth.sizeMm.width}mm x ${selectedBooth.sizeMm.depth}mm`
                                    : `${selectedBooth.size}師 (${selectedBooth.size * baseTableWidthMm}x${baseTableDepthMm}mm)`
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

                        {/* 回転ボタン */}
                        <button
                            onClick={rotateSelectedBooths}
                            className="w-full flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg py-1.5 text-sm font-medium transition"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            90度回転{selectedBoothIds.size > 1 ? ` (選択中 ${selectedBoothIds.size}帪)` : ''}
                        </button>

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
                            ※基本サイズ: 1.0師={baseTableWidthMm}mm幅 / 奥行{baseTableDepthMm}mm
                        </div>
                    </div>
                </div>
            )}

            {/* 複数選択中のバネル */}
            {selectedBoothIds.size > 1 && mode === 'booth' && (
                <div className="absolute top-20 right-4 z-20 bg-white shadow-xl rounded-xl p-4 border border-amber-200 w-64 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-bold text-amber-700">{selectedBoothIds.size}帪選択中</span>
                        <button onClick={() => { setSelectedBoothIds(new Set()); setSelectedBoothId(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    <button
                        onClick={rotateSelectedBooths}
                        className="w-full flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg py-2 text-sm font-medium transition"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        まとめて 90度回転
                    </button>
                    <p className="text-xs text-gray-400 mt-2 text-center">ドラッグでまとめて移動できます</p>
                </div>
            )}


            {/* ブース配置モードのツールバー */}
            {mode === 'booth' && (
                <div className="absolute top-20 left-4 z-10 bg-white/90 backdrop-blur shadow-xl rounded-xl p-3 border border-blue-100 animate-in slide-in-from-left-4 flex flex-col gap-3 w-64">
                    {/* 文字サイズ */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 whitespace-nowrap">文字サイズ:</span>
                        <input
                            type="range"
                            min={8}
                            max={32}
                            step={1}
                            value={seatFontSize}
                            onChange={(e) => setSeatFontSize(Number(e.target.value))}
                            className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-xs font-bold text-gray-700 w-6 text-right">{seatFontSize}</span>
                    </div>

                    {/* カテゴリカラー */}
                    <div className="border-t border-gray-100 pt-2">
                        <p className="text-[11px] font-semibold text-gray-500 mb-2">カテゴリカラー</p>
                        {([
                            { key: '占い・スピリチュアル', def: '#7c3aed' },
                            { key: '物販',                 def: '#0284c7' },
                            { key: 'ボディケア・美容',     def: '#db2777' },
                            { key: '飲食',                 def: '#ea580c' },
                            { key: 'ワークショップ',       def: '#16a34a' },
                            { key: 'その他',               def: '#6b7280' },
                        ] as const).map(({ key, def }) => {
                            const cur = categoryColors[key]?.stroke ?? def;
                            return (
                                <div key={key} className="flex items-center gap-2 mb-1">
                                    <input
                                        type="color"
                                        value={cur}
                                        onChange={(e) => {
                                            const c = e.target.value;
                                            setCategoryColors(prev => ({
                                                ...prev,
                                                [key]: { stroke: c, fill: c + '22' }
                                            }));
                                        }}
                                        className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0"
                                    />
                                    <span className="text-[11px] text-gray-600 truncate">{key}</span>
                                    {categoryColors[key] && (
                                        <button
                                            className="text-[10px] text-gray-400 hover:text-red-500 ml-auto"
                                            onClick={() => setCategoryColors(prev => { const n = {...prev}; delete n[key]; return n; })}
                                        >↩</button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-xs text-gray-400">Shift+クリック or 空白ドラッグ→範囲選択</p>
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

                    {/* 障害物の描画設定（壁/柱ペン選択時のみ） */}
                    {(activeTool === 'wall' || activeTool === 'column') && (
                        <div className="w-full border-t border-gray-100 pt-2 flex flex-col gap-2 px-1">
                            {/* 色・線幅 */}
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 whitespace-nowrap">線色:</label>
                                <input
                                    type="color"
                                    value={obstacleColor}
                                    onChange={(e) => setObstacleColor(e.target.value)}
                                    className="w-7 h-7 rounded border border-gray-200 cursor-pointer p-0.5"
                                />
                                <label className="text-[10px] text-gray-500 whitespace-nowrap">太さ:</label>
                                <input
                                    type="number"
                                    min={1} max={20} step={1}
                                    value={obstacleStrokeWidth}
                                    onChange={(e) => setObstacleStrokeWidth(Number(e.target.value))}
                                    className="w-10 border rounded px-1 text-xs text-gray-800"
                                />
                                <span className="text-[10px] text-gray-400">px</span>
                            </div>
                            {/* 寸法指定 */}
                            <div className="flex items-center gap-1">
                                <label className="text-[10px] text-gray-500 whitespace-nowrap">W:</label>
                                <input
                                    type="number"
                                    min={10} step={10}
                                    value={obstacleDimW}
                                    onChange={(e) => setObstacleDimW(Number(e.target.value))}
                                    className="w-14 border rounded px-1 text-xs text-gray-800"
                                />
                                <label className="text-[10px] text-gray-500">H:</label>
                                <input
                                    type="number"
                                    min={10} step={10}
                                    value={obstacleDimH}
                                    onChange={(e) => setObstacleDimH(Number(e.target.value))}
                                    className="w-14 border rounded px-1 text-xs text-gray-800"
                                />
                                <span className="text-[10px] text-gray-400">mm</span>
                            </div>
                            {/* 寸法クリック配置ボタン */}
                            <button
                                className="text-[11px] bg-orange-50 hover:bg-orange-100 text-orange-700 rounded py-1 px-2 font-medium transition"
                                onClick={() => {
                                    // クリックなしで現在のグリッド原点に即配置
                                    const wGrid = Math.max(1, Math.round(obstacleDimW / gridUnitMm));
                                    const hGrid = Math.max(1, Math.round(obstacleDimH / gridUnitMm));
                                    const newObs: Obstacle = {
                                        id: `obs-${Date.now()}`,
                                        x: 1, y: 1,
                                        width: wGrid, height: hGrid,
                                        rotation: 0,
                                        type: activeTool === 'wall' ? 'wall' : 'column',
                                        color: obstacleColor,
                                        strokeWidth: obstacleStrokeWidth,
                                    };
                                    onObstaclesChange([...obstacles, newObs]);
                                }}
                            >
                                寸法で配置 ({obstacleDimW}×{obstacleDimH}mm)
                            </button>
                        </div>
                    )}

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
                                {/* 表示/非表示トグル */}
                                <button
                                    onClick={() => setIsBgVisible(v => !v)}
                                    className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${!isBgVisible ? 'bg-gray-200 ring-2 ring-gray-400' : 'hover:bg-gray-100'}`}
                                    title={isBgVisible ? '下絵を非表示' : '下絵を表示'}
                                >
                                    {isBgVisible ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-700 mb-1">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-400 mb-1">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                                        </svg>
                                    )}
                                    <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">{isBgVisible ? '非表示' : '表示'}</span>
                                </button>

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
                                        setIsCalibrating(!isCalibrating);
                                        if (!isCalibrating) {
                                            setActiveTool('none');
                                            setIsBgEditing(false);
                                            setCalibrationPoints([]);
                                        }
                                    }}
                                    className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${isCalibrating ? 'bg-green-100 ring-2 ring-green-300' : 'hover:bg-gray-100'}`}
                                    title="2点間の距離を指定して縮尺を合わせる"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-700 mb-1">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                    <span className="text-[10px] font-medium text-gray-700 leading-tight text-center">縮尺合せ</span>
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

            {/* AI解析パネル - Bottom Right */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 right-4 z-10 bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden min-w-[200px]">
                    {/* プロバイダー選択タブ */}
                    <div className="flex border-b border-gray-100">
                        <button
                            onClick={() => setAiProvider('gemini')}
                            className={`flex-1 px-3 py-1.5 text-xs font-semibold transition ${aiProvider === 'gemini' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Gemini
                        </button>
                        <button
                            onClick={() => setAiProvider('groq')}
                            className={`flex-1 px-3 py-1.5 text-xs font-semibold transition ${aiProvider === 'groq' ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-500' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Groq
                        </button>
                    </div>

                    {/* 下絵がある場合は解析ボタン、ない場合はガイド */}
                    {bgImage ? (
                        <button
                            className={`flex items-center gap-2 px-4 py-3 w-full transition-all ${aiProvider === 'groq' ? 'hover:bg-orange-50' : 'hover:bg-blue-50'}`}
                            onClick={async () => {
                                const base64 = getBgImageBase64();
                                if (!base64) { alert('下絵の読み込みに失敗しました'); return; }
                                const confirmScan = window.confirm(
                                    `下絵を ${aiProvider === 'groq' ? 'Groq (LLaMA Vision)' : 'Gemini'} で解析して障害物を配置しますか？\n（現在の障害物配置に追加されます）`
                                );
                                if (!confirmScan) return;
                                try {
                                    const res = await fetch('/api/analyze-venue', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ image: base64, provider: aiProvider }),
                                    });
                                    if (!res.ok) {
                                        const err = await res.json().catch(() => ({}));
                                        throw new Error(err.error || '解析失敗');
                                    }
                                    const data = await res.json();
                                    const newObstacles = Array.isArray(data) ? data : (data.obstacles || []);
                                    onObstaclesChange([...obstacles, ...newObstacles]);
                                    alert(`解析完了 (${data.provider || aiProvider}): ${newObstacles.length}個のオブジェクトを検出しました`);
                                } catch (err: any) {
                                    alert(`エラー: ${err.message || 'エラーが発生しました'}`);
                                }
                            }}
                        >
                            <div className={aiProvider === 'groq' ? 'text-orange-500' : 'text-blue-500'}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                                </svg>
                            </div>
                            <div className="flex flex-col items-start">
                                <span className={`font-bold text-sm ${aiProvider === 'groq' ? 'text-orange-600' : 'text-blue-600'}`}>
                                    下絵を解析
                                </span>
                                <span className="text-[10px] text-gray-400">縮尺調整済み下絵を使用</span>
                            </div>
                        </button>
                    ) : (
                        <div className="px-4 py-3 text-xs text-gray-400 text-center">
                            先に下絵を読み込んで<br />縮尺を調整してください
                        </div>
                    )}
                </div>
            )}



            {/* Instruction Toast */}
            {mode === 'venue' && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm pointer-events-none animate-pulse z-20 whitespace-nowrap">
                    {isCalibrating
                        ? (calibrationPoints.length === 0 ? '画像上の始点をクリックしてください' : '画像上の終点をクリックしてください')
                        : isBgEditing
                            ? '下絵を調整中：グリッドに合わせてください'
                            : activeTool !== 'none'
                                ? 'ドラッグしてなぞると連続配置できます'
                                : '移動モード'}
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
                                    visible={isBgVisible}
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
                                fill="transparent"
                                stroke={obstacleColor}
                                strokeWidth={obstacleStrokeWidth}
                                opacity={0.7}
                                dash={[4, 4]}
                            />
                        )}
                    </Layer>
                    <Layer opacity={mode === 'venue' ? 0.3 : 1}>
                        {/* ドラッグ範囲選択の矩形 */}
                        {dragSelect && mode === 'booth' && (
                            <Rect
                                x={Math.min(dragSelect.startX, dragSelect.endX)}
                                y={Math.min(dragSelect.startY, dragSelect.endY)}
                                width={Math.abs(dragSelect.endX - dragSelect.startX)}
                                height={Math.abs(dragSelect.endY - dragSelect.startY)}
                                fill="rgba(59, 130, 246, 0.08)"
                                stroke="#3b82f6"
                                strokeWidth={1.5}
                                dash={[6, 4]}
                                listening={false}
                            />
                        )}
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
                                    fontSize={seatFontSize}
                                    isSelected={selectedBoothIds.has(booth.id)}
                                    categoryColors={categoryColors}
                                    draggable={mode === 'booth'}
                                    onDragEnd={(e) => handleDragEndBooth(e, booth.id)}
                                />
                            </Group>
                        ))}
                    </Layer>
                </Stage>
            </div>
        </div>
    );
}


