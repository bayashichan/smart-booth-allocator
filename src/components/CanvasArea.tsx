'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Line, Rect, Group, Image as KonvaImage, Transformer } from 'react-konva';
import BoothUnit from './BoothUnit';
import ObstacleComponent from './ObstacleComponent';
import TextLabelComponent from './TextLabelComponent';
import { Booth, Obstacle, TextLabel } from '@/types/layout';

const GRID_SIZE = 40;

interface CanvasAreaProps {
    booths: Booth[];
    onBoothsChange: (newBooths: Booth[]) => void;
    obstacles: Obstacle[];
    onObstaclesChange: (newObstacles: Obstacle[]) => void;
    textLabels: TextLabel[];
    onTextLabelsChange: (labels: TextLabel[]) => void;
    stageRef?: React.RefObject<any>;
    mode: 'booth' | 'venue';
    onModeChange: (mode: 'booth' | 'venue') => void;
}

type ToolType = 'none' | 'wall' | 'column' | 'eraser' | 'text';

export default function CanvasArea({
    booths,
    onBoothsChange,
    obstacles,
    onObstaclesChange,
    textLabels,
    onTextLabelsChange,
    stageRef: externalStageRef,
    mode,
    onModeChange
}: CanvasAreaProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const internalStageRef = useRef<any>(null);
    const stageRef = externalStageRef ?? internalStageRef;
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Viewport State
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // AI プロバイダー選択
    const [aiProvider, setAiProvider] = useState<'gemini' | 'groq'>('gemini');

    // Global Config State
    const [gridUnitMm, setGridUnitMm] = useState(450);
    const [baseTableWidthMm, setBaseTableWidthMm] = useState(1800);
    const [baseTableDepthMm, setBaseTableDepthMm] = useState(900);
    const [seatFontSize, setSeatFontSize] = useState(14);

    // 障害物描画設定
    const [obstacleColor, setObstacleColor] = useState('#607d8b');
    const [obstacleStrokeWidth, setObstacleStrokeWidth] = useState(2);
    const [obstacleDimW, setObstacleDimW] = useState(1800);
    const [obstacleDimH, setObstacleDimH] = useState(450);

    // ブース カテゴリ別カラーマップ
    const [categoryColors, setCategoryColors] = useState<Record<string, { stroke: string; fill: string }>>({});

    // テキストラベル 選択・スタイル設定
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [textSettings, setTextSettings] = useState({ fontSize: 20, color: '#1f2937', fontStyle: '' });
    
    // UI Toggles
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
    // 複数選択ドラッグ追随用
    const multiDragStartRef  = useRef<Map<string, { x: number; y: number }>>(new Map());
    const multiDragAnchorRef = useRef<{ x: number; y: number } | null>(null);
    // ブースレイヤーへのリフ（ノード直接操作用）
    const boothLayerRef = useRef<any>(null);
    // ブースリサイズ用 Transformer
    const boothTrRef = useRef<any>(null);
    // 中ボタンパン用
    const isPanningRef = useRef(false);
    const panStartRef  = useRef<{ x: number; y: number; stagePosX: number; stagePosY: number } | null>(null);

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

    // Pinch Zoom State
    const lastCenter = useRef<{ x: number, y: number } | null>(null);
    const lastDist = useRef<number>(0);

    useEffect(() => {
        if (isBgEditing && bgNodeRef.current && bgTrRef.current) {
            bgTrRef.current.nodes([bgNodeRef.current]);
            bgTrRef.current.getLayer().batchDraw();
        }
    }, [isBgEditing, bgImage]);

    // === 画像（PNG）エクスポート ===
    const handleExport = () => {
        const stage = stageRef.current;
        if (!stage) return;
        // グリッドレイヤー（最初のレイヤー）を一時非表示
        const layers = stage.getLayers();
        const gridLayer = layers[0];
        if (gridLayer) gridLayer.visible(false);
        stage.batchDraw();

        // 印刷用・高解像度にするため pixelRatio を 5 に設定（かなり綺麗になります）
        const dataUrl = stage.toDataURL({ pixelRatio: 5 });

        if (gridLayer) gridLayer.visible(true);
        stage.batchDraw();

        const link = document.createElement('a');
        link.download = `booth-layout-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = dataUrl;
        link.click();
    };

    // === ベクター画像（SVG）エクスポート ===
    const handleExportSVG = () => {
        const svgW = dimensions.width;
        const svgH = dimensions.height;

        const DEFAULT_CATEGORY_COLORS: Record<string, { stroke: string; fill: string }> = {
            '占い・スピリチュアル': { stroke: '#7c3aed', fill: '#ede9fe' },
            '物販':                 { stroke: '#0284c7', fill: '#e0f2fe' },
            'ボディケア・美容':     { stroke: '#db2777', fill: '#fce7f3' },
            '飲食':                 { stroke: '#ea580c', fill: '#fff7ed' },
            'ワークショップ':       { stroke: '#16a34a', fill: '#dcfce7' },
            'その他':               { stroke: '#6b7280', fill: '#f3f4f6' },
        };

        // 1. ブースをSVG要素に変換
        const boothsSvg = booths.map(b => {
            const widthMm = b.sizeMm ? b.sizeMm.width : b.size * baseTableWidthMm;
            const depthMm = b.sizeMm ? b.sizeMm.depth : baseTableDepthMm;
            const w = (widthMm / gridUnitMm) * GRID_SIZE;
            const h = (depthMm / gridUnitMm) * GRID_SIZE;
            const colors = categoryColors[b.category] || DEFAULT_CATEGORY_COLORS[b.category] || DEFAULT_CATEGORY_COLORS['その他'];
            const rot = b.rotation || 0;
            const text = b.seatNumber || b.name;

            const cx = w / 2;
            const cy = h / 2;

            return `<g transform="translate(${b.x * GRID_SIZE}, ${b.y * GRID_SIZE}) rotate(${rot})">
                <rect width="${w}" height="${h}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2" rx="2" />
                <text x="${cx}" y="${cy}" font-family="sans-serif" font-size="${seatFontSize}px" font-weight="bold" fill="${colors.stroke}" text-anchor="middle" dominant-baseline="central" transform="rotate(${-rot}, ${cx}, ${cy})">${text}</text>
            </g>`;
        }).join('\n');

        // 2. 障害物をSVG要素に変換
        const obstaclesSvg = obstacles.map(obs => {
            return `<rect x="${obs.x * GRID_SIZE}" y="${obs.y * GRID_SIZE}" width="${obs.width * GRID_SIZE}" height="${obs.height * GRID_SIZE}" fill="none" stroke="${obstacleColor}" stroke-width="${obstacleStrokeWidth}" stroke-dasharray="4 4" />`;
        }).join('\n');

        // 3. テキストラベルを変換
        const textLabelsSvg = textLabels.map(l => {
            const fontStyle = l.fontStyle || '';
            const fw = fontStyle.includes('bold') ? 'bold' : 'normal';
            const fs = fontStyle.includes('italic') ? 'italic' : 'normal';
            return `<text x="${l.x}" y="${l.y + l.fontSize}" font-family="sans-serif" font-size="${l.fontSize}px" font-weight="${fw}" font-style="${fs}" fill="${l.color}" transform="rotate(${l.rotation}, ${l.x}, ${l.y})">${l.text}</text>`;
        }).join('\n');

        // 4. 下絵
        let bgSvg = '';
        if (bgImage) {
            const canvas = document.createElement('canvas');
            canvas.width = bgImage.width;
            canvas.height = bgImage.height;
            const ctx = canvas.getContext('2d');
            if(ctx) {
                ctx.drawImage(bgImage, 0, 0);
                const dataURL = canvas.toDataURL('image/png');
                bgSvg = `<image href="${dataURL}" x="${bgConfig.x}" y="${bgConfig.y}" width="${bgImage.width * bgConfig.scaleX}" height="${bgImage.height * bgConfig.scaleY}" transform="rotate(${bgConfig.rotation} ${bgConfig.x} ${bgConfig.y})" opacity="${bgConfig.opacity}" />`;
            }
        }

        const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
            <g transform="translate(${stagePos.x}, ${stagePos.y}) scale(${stageScale})">
                ${bgSvg}
                ${obstaclesSvg}
                ${boothsSvg}
                ${textLabelsSvg}
            </g>
        </svg>`;

        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `booth-layout-${new Date().toISOString().slice(0, 10)}.svg`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // === テキスト追加（キャンバスクリック） ===
    const handleAddText = (stageX: number, stageY: number) => {
        const newLabel: TextLabel = {
            id:        `text-${Date.now()}`,
            text:      'テキスト',
            x:         stageX,
            y:         stageY,
            fontSize:  textSettings.fontSize,
            color:     textSettings.color,
            fontStyle: textSettings.fontStyle,
            rotation:  0,
        };
        onTextLabelsChange([...textLabels, newLabel]);
        setSelectedTextId(newLabel.id);
        setActiveTool('none');
    };

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

    // --- ブースの削除・カラー変更ヘルパー ---
    const deleteSelectedBooths = () => {
        if (selectedBoothIds.size === 0 && !selectedBoothId) return;
        const idsToDelete = selectedBoothIds.size > 0 ? selectedBoothIds : new Set([selectedBoothId!]);
        onBoothsChange(booths.filter(b => !idsToDelete.has(b.id)));
        setSelectedBoothId(null);
        setSelectedBoothIds(new Set());
    };

    const updateSelectedBoothsColor = (color: string) => {
        if (selectedBoothIds.size === 0 && !selectedBoothId) return;
        const idsToUpdate = selectedBoothIds.size > 0 ? selectedBoothIds : new Set([selectedBoothId!]);
        onBoothsChange(booths.map(b => idsToUpdate.has(b.id) ? { ...b, color } : b));
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // 入力要素にフォーカスがある場合は無視
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            // Escape: 選択解除
            if (e.key === 'Escape') {
                setSelectedBoothId(null);
                setSelectedBoothIds(new Set());
                setSelectedObstacleId(null);
                setSelectedTextId(null);
                return;
            }

            // Ctrl+A / Cmd+A: 全選択
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                if (mode === 'booth') {
                    e.preventDefault();
                    setSelectedBoothIds(new Set(booths.map(b => b.id)));
                    setSelectedBoothId(null);
                }
                return;
            }

            // Delete / Backspace: 削除
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (mode === 'booth' && (selectedBoothId || selectedBoothIds.size > 0)) {
                    deleteSelectedBooths();
                } else if (mode === 'venue' && selectedObstacleId) {
                    onObstaclesChange(obstacles.filter(o => o.id !== selectedObstacleId));
                    setSelectedObstacleId(null);
                } else if (selectedTextId) {
                    onTextLabelsChange(textLabels.filter(t => t.id !== selectedTextId));
                    setSelectedTextId(null);
                }
                return;
            }

            // 矢印キー: 選択ブースを移動（Shiftで5グリッド単位）
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                if (mode === 'booth' && (selectedBoothId || selectedBoothIds.size > 0)) {
                    e.preventDefault();
                    const step = e.shiftKey ? 5 : 1;
                    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
                    const ids = selectedBoothIds.size > 0 ? selectedBoothIds : new Set([selectedBoothId!]);
                    onBoothsChange(booths.map(b =>
                        ids.has(b.id)
                            ? { ...b, x: Math.max(0, b.x + dx), y: Math.max(0, b.y + dy) }
                            : b
                    ));
                }
                return;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mode, selectedBoothId, selectedBoothIds, selectedObstacleId, selectedTextId, booths, obstacles, textLabels]);

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

        // 中ボタン（ホイールボタン）: パン開始
        if (e.evt?.button === 1) {
            e.evt.preventDefault();
            isPanningRef.current = true;
            panStartRef.current = {
                x: e.evt.clientX,
                y: e.evt.clientY,
                stagePosX: stage.x(),
                stagePosY: stage.y(),
            };
            return;
        }

        // 背景クリックで選択解除
        const clickedOnStage = e.target === stage;
        if (clickedOnStage) {
            setSelectedBoothId(null);
            setSelectedObstacleId(null);
            setSelectedTextId(null);
            // テキストツール → クリック位置にテキスト追加
            if (activeTool === 'text') {
                const pos = stage.getPointerPosition();
                if (pos) {
                    const sx = (pos.x - stage.x()) / stage.scaleX();
                    const sy = (pos.y - stage.y()) / stage.scaleY();
                    handleAddText(sx, sy);
                }
                return;
            }
            // ブースモードでは範囲選択開始（マウスのみ・タッチはパン優先）
            if (mode === 'booth' && !e.evt?.touches) {
                // Stageのドラッグをキャンセルしてゴムバンド優先
                stage.stopDrag();
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
        // 中ボタンパン
        if (isPanningRef.current && panStartRef.current) {
            const stage = e.target.getStage();
            if (!stage) return;
            const dx = e.evt.clientX - panStartRef.current.x;
            const dy = e.evt.clientY - panStartRef.current.y;
            const newPos = {
                x: panStartRef.current.stagePosX + dx,
                y: panStartRef.current.stagePosY + dy,
            };
            setStagePos(newPos);
            stage.position(newPos);
            stage.batchDraw();
            return;
        }

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
        // 中ボタンパン終了
        if (isPanningRef.current) {
            isPanningRef.current = false;
            panStartRef.current = null;
            return;
        }

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

    // ズーム・パン操作
    const handleWheel = (e: any) => {
        e.evt.preventDefault();
        const stage = e.target.getStage();
        const scaleBy = 1.1;

        const doZoom = () => {
            const oldScale = stage.scaleX();
            const pointer = stage.getPointerPosition();
            const mousePointTo = {
                x: pointer.x / oldScale - stage.x() / oldScale,
                y: pointer.y / oldScale - stage.y() / oldScale,
            };
            const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            if (newScale < 0.1 || newScale > 5) return;
            const newPos = {
                x: -(mousePointTo.x - pointer.x / newScale) * newScale,
                y: -(mousePointTo.y - pointer.y / newScale) * newScale,
            };
            setStageScale(newScale);
            setStagePos(newPos);
        };

        if (e.evt.ctrlKey) {
            // Ctrl+スクロール or トラックパッドピンチ → ズーム
            doZoom();
        } else if (e.evt.deltaMode === 0 && (Math.abs(e.evt.deltaX) > 0 || Math.abs(e.evt.deltaY) > 0)) {
            // トラックパッド2本指スクロール (deltaMode=0: pixel単位) → パン
            const newPos = {
                x: stagePos.x - e.evt.deltaX,
                y: stagePos.y - e.evt.deltaY,
            };
            setStagePos(newPos);
            stage.position(newPos);
            stage.batchDraw();
        } else {
            // マウスホイール → ズーム
            doZoom();
        }
    };

    // --- タッチ操作（ピンチズーム・パン） ---
    const handleTouchStart = (e: any) => {
        // ピンチズーム開始
        if (e.evt.touches && e.evt.touches.length === 2) {
            e.evt.preventDefault();
            return;
        }
        handleMouseDown(e);
    };

    const handleTouchMove = (e: any) => {
        if (e.evt.touches && e.evt.touches.length === 2) {
            e.evt.preventDefault();
            const stage = e.target.getStage();
            if (!stage) return;

            const touch1 = e.evt.touches[0];
            const touch2 = e.evt.touches[1];

            const p1 = { x: touch1.clientX, y: touch1.clientY };
            const p2 = { x: touch2.clientX, y: touch2.clientY };

            const getDistance = (p1: any, p2: any) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            const getCenter = (p1: any, p2: any) => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });

            if (!lastCenter.current) {
                lastCenter.current = getCenter(p1, p2);
                return;
            }
            const newCenter = getCenter(p1, p2);
            const dist = getDistance(p1, p2);

            if (!lastCenter.current) {
                lastCenter.current = newCenter;
                lastDist.current = dist;
                return;
            }

            // 平行移動分
            const dx = newCenter.x - lastCenter.current.x;
            const dy = newCenter.y - lastCenter.current.y;

            const pointTo = {
                x: (newCenter.x - stage.x() - dx) / stage.scaleX(),
                y: (newCenter.y - stage.y() - dy) / stage.scaleX(),
            };

            const scale = stage.scaleX() * (dist / (lastDist.current || dist));
            const newScale = Math.max(0.1, Math.min(scale, 5));

            stage.scaleX(newScale);
            stage.scaleY(newScale);
            setStageScale(newScale);

            const newPos = {
                x: newCenter.x - pointTo.x * newScale,
                y: newCenter.y - pointTo.y * newScale,
            };

            stage.position(newPos);
            setStagePos(newPos);

            lastDist.current = dist;
            lastCenter.current = newCenter;
        } else {
            // ピンチでない場合は通常のMove処理
            handleMouseMove(e);
        }
    };

    const handleTouchEnd = (e: any) => {
        if (lastCenter.current) {
            lastDist.current = 0;
            lastCenter.current = null;
        }
        handleMouseUp();
    };
    const handleDragEndBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        const rawX = Math.round(e.target.x() / GRID_SIZE);
        const rawY = Math.round(e.target.y() / GRID_SIZE);

        // 複数選択中は全て移動（重なりチェック付き）
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            const startPos = multiDragStartRef.current.get(id);
            const anchor   = multiDragAnchorRef.current;
            if (!startPos || !anchor) {
                // フォールバック: 差分方式
                const orig = booths.find(b => b.id === id);
                const dx = rawX - (orig?.x ?? 0);
                const dy = rawY - (orig?.y ?? 0);
                const tentative = booths.map(b =>
                    selectedBoothIds.has(b.id) ? { ...b, x: b.x + dx, y: b.y + dy, isPlaced: true } : b
                );
                onBoothsChange(tentative);
                multiDragStartRef.current.clear();
                multiDragAnchorRef.current = null;
                return;
            }
            // ドラッグ開始位置からの差分（グリッド単位）
            const dx = rawX - startPos.x;
            const dy = rawY - startPos.y;
            const tentative = booths.map(b => {
                if (!selectedBoothIds.has(b.id)) return b;
                const orig = multiDragStartRef.current.get(b.id);
                if (!orig) return b;
                return { ...b, x: orig.x + dx, y: orig.y + dy, isPlaced: true };
            });
            // 選択外との衝突チェック
            const hasCollision = Array.from(selectedBoothIds).some(bid => {
                const nb = tentative.find(b => b.id === bid);
                if (!nb) return false;
                return tentative.some(b => {
                    if (selectedBoothIds.has(b.id)) return false;
                    const bounds = getBoothGridBounds(b);
                    const widthMm = nb.sizeMm ? nb.sizeMm.width : nb.size * baseTableWidthMm;
                    const depthMm = nb.sizeMm ? nb.sizeMm.depth : baseTableDepthMm;
                    const rot = nb.rotation ?? 0;
                    const mw = (rot === 90 || rot === 270) ? depthMm / gridUnitMm : widthMm / gridUnitMm;
                    const mh = (rot === 90 || rot === 270) ? widthMm / gridUnitMm : depthMm / gridUnitMm;
                    return nb.x < bounds.x + bounds.w && nb.x + mw > bounds.x &&
                           nb.y < bounds.y + bounds.h && nb.y + mh > bounds.y;
                });
            });
            if (!hasCollision) {
                onBoothsChange(tentative);
                // 他の選択ブースを正しい位置にアニメーション
                tentative.forEach(b => {
                    if (b.id !== id && selectedBoothIds.has(b.id)) {
                        // Konvaノードを直接動かす手段がないため state更新のみで対応
                    }
                });
            } else {
                // 衝突 → ドラッグしたブースだけ元に戻す
                const orig = multiDragStartRef.current.get(id);
                e.target.to({ x: (orig?.x ?? rawX) * GRID_SIZE, y: (orig?.y ?? rawY) * GRID_SIZE, duration: 0.1 });
            }
            multiDragStartRef.current.clear();
            multiDragAnchorRef.current = null;
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

    // 複数選択ドラッグ開始
    const handleDragStartBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            multiDragStartRef.current = new Map(
                booths
                    .filter(b => selectedBoothIds.has(b.id))
                    .map(b => [b.id, { x: b.x, y: b.y }])
            );
            multiDragAnchorRef.current = { x: e.target.x(), y: e.target.y() };
        }
    };

    // 複数選択ドラッグ中（リアルタイム追随）
    const handleDragMoveBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        if (!selectedBoothIds.has(id) || selectedBoothIds.size <= 1) return;
        const anchor = multiDragAnchorRef.current;
        if (!anchor || !boothLayerRef.current) return;

        // ドラッグ中のピクセル差分
        const dxPx = e.target.x() - anchor.x;
        const dyPx = e.target.y() - anchor.y;

        // 他の選択ブースをリアルタイムで移動
        selectedBoothIds.forEach(bid => {
            if (bid === id) return;
            const startPos = multiDragStartRef.current.get(bid);
            if (!startPos) return;
            const node = boothLayerRef.current.findOne(`#booth-group-${bid}`);
            if (node) {
                node.x(startPos.x * GRID_SIZE + dxPx);
                node.y(startPos.y * GRID_SIZE + dyPx);
            }
        });
        boothLayerRef.current.batchDraw();
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

    // --- Transformer: 選択ブースにアタッチ ---
    useEffect(() => {
        if (!boothTrRef.current || !boothLayerRef.current) return;
        // 単一選択かつブースモードのみリサイズハンドルを表示
        if (selectedBoothId && selectedBoothIds.size === 1 && mode === 'booth') {
            const node = boothLayerRef.current.findOne(`#booth-group-${selectedBoothId}`);
            if (node) {
                boothTrRef.current.nodes([node]);
                boothTrRef.current.getLayer()?.batchDraw();
                return;
            }
        }
        boothTrRef.current.nodes([]);
        boothTrRef.current.getLayer()?.batchDraw();
    }, [selectedBoothId, selectedBoothIds, mode]);

    // --- ブースリサイズ完了ハンドラ ---
    const handleBoothTransformEnd = (e: any) => {
        if (!selectedBoothId) return;
        const node = e.target;
        const booth = booths.find(b => b.id === selectedBoothId);
        if (!booth || !node) return;

        const scaleX = Math.abs(node.scaleX());
        const scaleY = Math.abs(node.scaleY());

        // スケールをリセット（サイズ変化は sizeMm に反映）
        node.scaleX(1);
        node.scaleY(1);

        const currentWidthMm = booth.sizeMm ? booth.sizeMm.width : booth.size * baseTableWidthMm;
        const currentDepthMm = booth.sizeMm ? booth.sizeMm.depth : baseTableDepthMm;

        // グリッドにスナップ（最小 1マス）
        const newWidthMm = Math.max(gridUnitMm, Math.round(currentWidthMm * scaleX / gridUnitMm) * gridUnitMm);
        const newDepthMm = Math.max(gridUnitMm, Math.round(currentDepthMm * scaleY / gridUnitMm) * gridUnitMm);

        // 位置もグリッドにスナップ（左上から縮小した場合に位置が変わる）
        const snappedX = Math.max(0, Math.round(node.x() / GRID_SIZE));
        const snappedY = Math.max(0, Math.round(node.y() / GRID_SIZE));
        node.x(snappedX * GRID_SIZE);
        node.y(snappedY * GRID_SIZE);

        onBoothsChange(booths.map(b =>
            b.id === selectedBoothId
                ? { ...b, x: snappedX, y: snappedY, sizeMm: { width: newWidthMm, depth: newDepthMm } }
                : b
        ));
    };

    const selectedBooth = booths.find(b => b.id === selectedBoothId);

    const handleResetView = () => {
        setStageScale(1);
        setStagePos({ x: 0, y: 0 });
    };

    return (
        <div ref={containerRef} className="bg-white flex flex-col h-full w-full relative">

            {/* Mode & Global Settings */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex flex-col lg:flex-row gap-2 lg:gap-4 items-center pointer-events-none w-full max-w-[100vw] px-2 justify-center">
                <div className="bg-white shadow-lg rounded-full px-4 py-2 flex gap-4 items-center border border-gray-200 pointer-events-auto shrink-0">
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
                     <div className="bg-white shadow-lg rounded-xl px-3 lg:px-4 py-2 border border-gray-200 pointer-events-auto hidden lg:flex flex-wrap justify-center items-center gap-x-4 gap-y-2 w-max max-w-full text-xs">
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
                <div className="absolute bottom-0 left-0 right-0 lg:top-20 lg:bottom-auto lg:right-4 lg:left-auto z-50 bg-white/95 backdrop-blur shadow-2xl lg:shadow-xl rounded-t-2xl lg:rounded-xl p-4 border-t border-blue-100 lg:border lg:w-64 animate-in slide-in-from-bottom lg:slide-in-from-right-4 max-h-[60vh] overflow-y-auto">
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
                        <div className="flex gap-2">
                            <input
                                type="color"
                                value={selectedBooth.color || categoryColors[selectedBooth.category]?.stroke || '#cccccc'}
                                onChange={(e) => updateSelectedBoothsColor(e.target.value)}
                                className="w-10 h-10 rounded border border-gray-200 cursor-pointer p-0.5 shrink-0"
                                title="カラー変更"
                            />
                            <button
                                onClick={rotateSelectedBooths}
                                className="flex-1 flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition"
                                title="90度回転"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                </svg>
                            </button>
                            <button
                                onClick={deleteSelectedBooths}
                                className="flex-1 flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition"
                                title="削除"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
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
                            ※基本サイズ: 1.0師={baseTableWidthMm}mm幅 / 奥行{baseTableDepthMm}mm
                        </div>
                    </div>
                </div>
            )}

            {/* 複数選択中のバネル */}
            {selectedBoothIds.size > 1 && mode === 'booth' && (
                <div className="absolute bottom-0 left-0 right-0 lg:top-20 lg:bottom-auto lg:right-4 lg:left-auto z-50 bg-white/95 backdrop-blur shadow-2xl lg:shadow-xl rounded-t-2xl lg:rounded-xl p-4 border-t border-amber-200 lg:border lg:w-64 animate-in slide-in-from-bottom lg:slide-in-from-right-4 max-h-[60vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-bold text-amber-700">{selectedBoothIds.size}帪選択中</span>
                        <button onClick={() => { setSelectedBoothIds(new Set()); setSelectedBoothId(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={rotateSelectedBooths}
                            className="w-full flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg py-2 text-sm font-medium transition"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            まとめて 90度回転
                        </button>
                        
                        <div className="flex gap-2">
                            <input
                                type="color"
                                value={'#cccccc'}
                                onChange={(e) => updateSelectedBoothsColor(e.target.value)}
                                className="w-10 h-10 rounded border border-gray-200 cursor-pointer p-0.5 shrink-0"
                                title="一括カラー変更"
                            />
                            <button
                                onClick={deleteSelectedBooths}
                                className="flex-1 flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                                まとめて削除
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 text-center">ドラッグで移動 / ↑↓←→ キーで精密移動</p>
                </div>
            )}


            {/* ブース配置モードのツールバー */}
            {mode === 'booth' && (
                <div className="absolute top-20 left-4 z-10 flex flex-col items-start gap-2">
                    <button
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        className={`bg-white/90 backdrop-blur shadow-md rounded-xl px-3 py-2 border border-blue-100 flex items-center gap-2 text-sm font-medium transition ${isSettingsOpen ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                        </svg>
                        表示設定
                    </button>

                    {isSettingsOpen && (
                        <div className="bg-white/95 backdrop-blur shadow-xl rounded-xl p-3 border border-blue-100 animate-in slide-in-from-top-2 flex flex-col gap-3 w-56 lg:w-64 max-h-[50vh] overflow-y-auto">
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
                            <p className="text-[10px] text-gray-400 leading-tight">範囲ドラッグ / Shift+クリック: 複数選択<br/>矢印キー: 移動 / Shift+矢印: 5グリッド移動<br/>Ctrl+A: 全選択 / Esc: 解除<br/>中ボタンドラッグ / 2本指スクロール: パン<br/>選択後 ハンドルをドラッグ: リサイズ</p>
                        </div>
                    )}
                </div>
            )}

            {/* Venue Editing Toolbar */}
            {mode === 'venue' && (
                <div className="absolute top-24 lg:top-20 left-2 lg:left-4 z-10 bg-white/95 backdrop-blur shadow-xl rounded-xl p-2 flex flex-col gap-2 border border-orange-100 animate-in slide-in-from-left-4 items-start max-w-[calc(100vw-16px)]">

                    <div className="flex gap-1 sm:gap-2 overflow-x-auto w-full pb-0.5 scrollbar-none">
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

                        <button
                            onClick={() => { setActiveTool('text'); setIsBgEditing(false); }}
                            className={`flex flex-col items-center p-2 rounded w-16 transition-colors ${activeTool === 'text' ? 'bg-purple-100 ring-2 ring-purple-300' : 'hover:bg-gray-100'}`}
                        >
                            <div className="w-6 h-6 mb-1 flex items-center justify-center text-purple-700 font-bold text-lg">T</div>
                            <span className="text-[10px] font-medium text-purple-700 leading-tight text-center">テキスト</span>
                        </button>
                    </div>

                    {/* テキストツール選択時のスタイル設定 */}
                    {activeTool === 'text' && (
                        <div className="w-full border-t border-gray-100 pt-2 flex flex-col gap-2 px-1">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 whitespace-nowrap">文字色:</label>
                                <input
                                    type="color"
                                    value={textSettings.color}
                                    onChange={(e) => setTextSettings(s => ({ ...s, color: e.target.value }))}
                                    className="w-7 h-7 rounded border border-gray-200 cursor-pointer p-0.5"
                                />
                                <label className="text-[10px] text-gray-500 whitespace-nowrap">サイズ:</label>
                                <input
                                    type="number"
                                    min={8} max={200} step={2}
                                    value={textSettings.fontSize}
                                    onChange={(e) => setTextSettings(s => ({ ...s, fontSize: Number(e.target.value) }))}
                                    className="w-12 border rounded px-1 text-xs text-gray-800"
                                />
                            </div>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setTextSettings(s => ({ ...s, fontStyle: s.fontStyle.includes('bold') ? s.fontStyle.replace('bold','').trim() : (s.fontStyle + ' bold').trim() }))}
                                    className={`text-xs px-2 py-0.5 rounded border font-bold transition ${textSettings.fontStyle.includes('bold') ? 'bg-purple-100 border-purple-400 text-purple-700' : 'border-gray-300 text-gray-600'}`}
                                >B</button>
                                <button
                                    onClick={() => setTextSettings(s => ({ ...s, fontStyle: s.fontStyle.includes('italic') ? s.fontStyle.replace('italic','').trim() : (s.fontStyle + ' italic').trim() }))}
                                    className={`text-xs px-2 py-0.5 rounded border italic transition ${textSettings.fontStyle.includes('italic') ? 'bg-purple-100 border-purple-400 text-purple-700' : 'border-gray-300 text-gray-600'}`}
                                ><em>I</em></button>
                                <span className="text-[10px] text-gray-400 my-auto ml-1">クリックで追加</span>
                            </div>
                        </div>
                    )}

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
                <div className="absolute bottom-4 right-2 lg:right-4 z-10 bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden min-w-[120px] lg:min-w-[200px]">
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

            {/* エクスポートボタン群 + ビューリセット */}
            <div className="absolute bottom-4 left-2 lg:left-4 z-10 flex flex-col gap-2">
                {/* ビューリセット */}
                <button
                    onClick={handleResetView}
                    className="flex items-center gap-1 bg-white/90 hover:bg-gray-100 border border-gray-300 text-gray-700 px-2 py-2 rounded-xl shadow text-xs font-medium transition"
                    title="表示位置・ズームをリセット"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
                    </svg>
                    <span className="hidden sm:inline">表示リセット</span>
                </button>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-2 rounded-xl shadow-lg text-xs font-semibold transition"
                    title="高画質 PNG でダウンロード（印刷用）"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    <span className="hidden sm:inline">PNG保存</span>
                </button>
                <button
                    onClick={handleExportSVG}
                    className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-2 rounded-xl shadow-lg text-xs font-semibold transition"
                    title="ベクターデータ (SVG) でダウンロード"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <span className="hidden sm:inline">SVG保存</span>
                </button>
            </div>


            {/* Instruction Toast */}
            {mode === 'venue' && (
                <div className="absolute bottom-20 sm:bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-3 py-1.5 rounded-full text-xs sm:text-sm pointer-events-none animate-pulse z-20 whitespace-nowrap">
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
            <div className="flex-grow overflow-hidden" style={{ cursor: mode === 'venue' && activeTool !== 'none' ? 'crosshair' : mode === 'venue' ? 'grab' : 'default' }}>
                <Stage
                    ref={stageRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    draggable={!isBgEditing && activeTool === 'none' && mode === 'venue'}
                    onWheel={handleWheel}
                    scaleX={stageScale}
                    scaleY={stageScale}
                    x={stagePos.x}
                    y={stagePos.y}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
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
                                isEditable={mode === 'venue' && activeTool === 'none' && !isBgEditing}
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
                    <Layer ref={boothLayerRef} opacity={mode === 'venue' ? 0.3 : 1}>
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
                            <BoothUnit
                                key={booth.id}
                                data={booth}
                                gridPixelSize={GRID_SIZE}
                                gridUnitMm={gridUnitMm}
                                baseTableWidthMm={baseTableWidthMm}
                                baseTableDepthMm={baseTableDepthMm}
                                fontSize={seatFontSize}
                                isSelected={selectedBoothIds.has(booth.id)}
                                categoryColors={categoryColors}
                                draggable={mode === 'booth'}
                                onClick={(e) => handleBoothClick(e, booth.id)}
                                onDragStart={(e) => handleDragStartBooth(e, booth.id)}
                                onDragMove={(e) => handleDragMoveBooth(e, booth.id)}
                                onDragEnd={(e) => handleDragEndBooth(e, booth.id)}
                                onTransformEnd={selectedBoothId === booth.id ? handleBoothTransformEnd : undefined}
                            />
                        ))}
                        {/* リサイズ用 Transformer（単一選択時のみ表示） */}
                        <Transformer
                            ref={boothTrRef}
                            rotateEnabled={false}
                            keepRatio={false}
                            anchorSize={12}
                            anchorCornerRadius={4}
                            borderStroke="#f59e0b"
                            borderStrokeWidth={2}
                            anchorStroke="#d97706"
                            anchorFill="#fef3c7"
                            anchorStyleFunc={(anchor) => {
                                // 中央ハンドルは非表示（角と辺のみ）
                                if (anchor.hasName('rotater')) anchor.visible(false);
                            }}
                            boundBoxFunc={(oldBox, newBox) => {
                                // 最小サイズ: 1グリッド
                                if (Math.abs(newBox.width) < GRID_SIZE) return oldBox;
                                if (Math.abs(newBox.height) < GRID_SIZE) return oldBox;
                                return newBox;
                            }}
                        />
                    </Layer>

                    {/* テキストラベルレイヤー（最上位） */}
                    <Layer>
                        {textLabels.map(label => (
                            <TextLabelComponent
                                key={label.id}
                                data={label}
                                isSelected={selectedTextId === label.id}
                                isEditable={true}
                                stageScale={stageScale}
                                stagePos={stagePos}
                                containerOffset={{ left: 0, top: 0 }}
                                onSelect={() => setSelectedTextId(label.id)}
                                onChange={(updated) => onTextLabelsChange(textLabels.map(l => l.id === updated.id ? updated : l))}
                                onDelete={() => onTextLabelsChange(textLabels.filter(l => l.id !== label.id))}
                            />
                        ))}
                    </Layer>
                </Stage>
            </div>
        </div>
    );
}


