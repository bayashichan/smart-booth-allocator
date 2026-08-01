'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Stage, Layer, Line, Rect, Group, Image as KonvaImage, Transformer } from 'react-konva';
import BoothUnit, { resolveBoothColors } from './BoothUnit';
import ObstacleComponent from './ObstacleComponent';
import TextLabelComponent from './TextLabelComponent';
import {
    Booth,
    Obstacle,
    TextLabel,
    DimensionSettings,
    CategoryColorMap,
    VendorCategory,
} from '@/types/layout';
import {
    getBoothSizeMm,
    getBoothGridBounds,
    getBoothRectOffset,
    getObstacleGridBounds,
    buildSnapCandidates,
    findSnap,
    rectsOverlap,
    type GridRect,
    type SnapCandidate,
} from '@/utils/boothGeometry';
import { alignBooths, distributeBooths, arrangeInLine, type AlignKind, type Axis } from '@/utils/align';

const GRID_SIZE = 40;
const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

/**
 * 連続した細かい編集（カラーピッカーのドラッグ、テキスト入力）は
 * coalesceKey を渡すことで Undo 履歴を1操作にまとめる。
 */
export type ChangeOptions = { coalesceKey?: string };

interface CanvasAreaProps {
    booths: Booth[];
    onBoothsChange: (newBooths: Booth[], opts?: ChangeOptions) => void;
    obstacles: Obstacle[];
    onObstaclesChange: (newObstacles: Obstacle[], opts?: ChangeOptions) => void;
    textLabels: TextLabel[];
    onTextLabelsChange: (labels: TextLabel[], opts?: ChangeOptions) => void;
    stageRef?: React.RefObject<any>;
    mode: 'booth' | 'venue';
    onModeChange: (mode: 'booth' | 'venue') => void;
    venueCols: number;
    venueRows: number;
    dims: DimensionSettings;
    categoryColors: CategoryColorMap;
    onCategoryColorsChange: (colors: CategoryColorMap) => void;
}

type ToolType = 'none' | 'wall' | 'column' | 'eraser' | 'text';

const TOOLS_BY_MODE: Record<'booth' | 'venue', ToolType[]> = {
    booth: ['none', 'text'],
    venue: ['none', 'wall', 'column', 'eraser', 'text'],
};

const CATEGORY_PRESETS: { key: VendorCategory; def: string }[] = [
    { key: '占い・スピリチュアル', def: '#7c3aed' },
    { key: '物販',                 def: '#0284c7' },
    { key: 'ボディケア・美容',     def: '#db2777' },
    { key: '飲食',                 def: '#ea580c' },
    { key: 'ワークショップ',       def: '#16a34a' },
    { key: 'その他',               def: '#6b7280' },
];

const escapeXml = (s: string) =>
    String(s).replace(/[<>&'"]/g, (c) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string),
    );

const isTypingTarget = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
};

export default function CanvasArea({
    booths,
    onBoothsChange,
    obstacles,
    onObstaclesChange,
    textLabels,
    onTextLabelsChange,
    stageRef: externalStageRef,
    mode,
    onModeChange,
    venueCols,
    venueRows,
    dims,
    categoryColors,
    onCategoryColorsChange,
}: CanvasAreaProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const internalStageRef = useRef<any>(null);
    const stageRef = externalStageRef ?? internalStageRef;
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    // Viewport State
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // AI プロバイダー選択
    const [aiProvider, setAiProvider] = useState<'gemini' | 'groq'>('gemini');

    const [seatFontSize, setSeatFontSize] = useState(14);

    // 障害物描画設定
    const [obstacleColor, setObstacleColor] = useState('#607d8b');
    const [obstacleStrokeWidth, setObstacleStrokeWidth] = useState(2);
    const [obstacleDimW, setObstacleDimW] = useState(1800);
    const [obstacleDimH, setObstacleDimH] = useState(450);

    // テキストラベル 選択・スタイル設定
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [textSettings, setTextSettings] = useState({ fontSize: 20, color: '#1f2937', fontStyle: '' });

    // UI Toggles
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTrayOpen, setIsTrayOpen] = useState(true);

    // Painting / Line Tool State
    const [activeTool, setActiveTool] = useState<ToolType>('none');
    const isPaintingRef = useRef(false);
    const dragStartRef = useRef<{ gx: number, gy: number } | null>(null);
    const [previewRect, setPreviewRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    // Obstacle editing state
    const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);

    // Booth editing state
    const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);
    const [selectedBoothIds, setSelectedBoothIds] = useState<Set<string>>(new Set());
    const [dragSelect, setDragSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const isDragSelectingRef = useRef(false);
    const multiDragStartRef  = useRef<Map<string, { x: number; y: number }>>(new Map());
    const multiDragAnchorRef = useRef<{ x: number; y: number } | null>(null);
    const boothLayerRef = useRef<any>(null);
    const boothTrRef = useRef<any>(null);
    // スナップガイド（Konva ノードを直接操作して再レンダーを避ける）
    const guideVRef = useRef<any>(null);
    const guideHRef = useRef<any>(null);
    const snapRef = useRef<{ xs: SnapCandidate[]; ys: SnapCandidate[] } | null>(null);
    const [snapEnabled, setSnapEnabled] = useState(true);

    // パン操作
    const isPanningRef = useRef(false);
    const panStartRef  = useRef<{ x: number; y: number; stagePosX: number; stagePosY: number } | null>(null);
    const [isSpacePanning, setIsSpacePanning] = useState(false);
    // タッチ直後の合成マウスイベントを無視するための時刻
    const lastTouchAtRef = useRef(0);

    // Background Image State
    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
    const [bgConfig, setBgConfig] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 });
    const [isBgEditing, setIsBgEditing] = useState(false);
    const [isBgVisible, setIsBgVisible] = useState(true);
    const bgNodeRef = useRef<any>(null);
    const bgTrRef = useRef<any>(null);

    // Calibration State
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [calibrationPoints, setCalibrationPoints] = useState<{ x: number, y: number }[]>([]);

    // エクスポート用ノード
    const gridGroupRef = useRef<any>(null);
    const exportBgRef  = useRef<any>(null);

    // Pinch Zoom State
    const lastCenter = useRef<{ x: number, y: number } | null>(null);
    const lastDist = useRef<number>(0);

    const placedBooths   = useMemo(() => booths.filter(b => b.isPlaced !== false), [booths]);
    const unplacedBooths = useMemo(() => booths.filter(b => b.isPlaced === false), [booths]);

    // 壁・柱を避けるかどうか。会場の外周を「壁」で囲う描き方をしている場合は
    // 全ブースが警告になってしまうため、切り替えられるようにしてある。
    const [avoidObstacles, setAvoidObstacles] = useState(true);
    const obstacleRects = useMemo<GridRect[]>(
        () => (avoidObstacles ? obstacles.map(getObstacleGridBounds) : []),
        [obstacles, avoidObstacles],
    );

    /** 重なり・会場はみ出し・障害物との干渉があるブースIDを検出 */
    const problemBoothIds = useMemo(() => {
        const bad = new Set<string>();
        const rects = placedBooths.map(b => ({ id: b.id, ...getBoothGridBounds(b, dims) }));
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.x < 0 || r.y < 0 || r.x + r.w > venueCols || r.y + r.h > venueRows) bad.add(r.id);
            if (obstacleRects.some(o => rectsOverlap(r, o))) bad.add(r.id);
            for (let j = i + 1; j < rects.length; j++) {
                if (rectsOverlap(r, rects[j])) { bad.add(r.id); bad.add(rects[j].id); }
            }
        }
        return bad;
    }, [placedBooths, dims, venueCols, venueRows, obstacleRects]);

    useEffect(() => {
        if (isBgEditing && bgNodeRef.current && bgTrRef.current) {
            bgTrRef.current.nodes([bgNodeRef.current]);
            bgTrRef.current.getLayer().batchDraw();
        }
    }, [isBgEditing, bgImage]);

    // ─── 表示範囲の計算 ───────────────────────────────────────────────────────

    /** 会場・ブース・障害物・テキストをすべて含む外接矩形（ピクセル） */
    const getContentBoundsPx = useCallback(() => {
        let minX = 0, minY = 0;
        let maxX = venueCols * GRID_SIZE, maxY = venueRows * GRID_SIZE;
        const include = (x: number, y: number, w: number, h: number) => {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        };
        placedBooths.forEach(b => {
            const g = getBoothGridBounds(b, dims);
            include(g.x * GRID_SIZE, g.y * GRID_SIZE, g.w * GRID_SIZE, g.h * GRID_SIZE);
        });
        obstacles.forEach(o =>
            include(o.x * GRID_SIZE, o.y * GRID_SIZE, o.width * GRID_SIZE, o.height * GRID_SIZE));
        textLabels.forEach(l =>
            include(l.x, l.y, Math.max(40, l.text.length * l.fontSize * 0.7), l.fontSize * 1.4));

        const pad = GRID_SIZE;
        return {
            x: minX - pad,
            y: minY - pad,
            width:  Math.max(GRID_SIZE, maxX - minX + pad * 2),
            height: Math.max(GRID_SIZE, maxY - minY + pad * 2),
        };
    }, [placedBooths, obstacles, textLabels, dims, venueCols, venueRows]);

    /** 全体が画面に収まるようズーム・位置を調整 */
    const fitToView = useCallback(() => {
        const { width, height } = canvasSize;
        if (!width || !height) return;
        const b = getContentBoundsPx();
        const scale = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, Math.min(width / b.width, height / b.height) * 0.95),
        );
        setStageScale(scale);
        setStagePos({
            x: (width  - b.width  * scale) / 2 - b.x * scale,
            y: (height - b.height * scale) / 2 - b.y * scale,
        });
    }, [canvasSize, getContentBoundsPx]);

    /** 画面中央のグリッド座標 */
    const getViewCenterGrid = useCallback(() => ({
        x: Math.max(0, Math.round((canvasSize.width  / 2 - stagePos.x) / stageScale / GRID_SIZE)),
        y: Math.max(0, Math.round((canvasSize.height / 2 - stagePos.y) / stageScale / GRID_SIZE)),
    }), [canvasSize, stagePos, stageScale]);

    const zoomBy = useCallback((factor: number) => {
        const { width, height } = canvasSize;
        const oldScale = stageScale;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
        if (newScale === oldScale) return;
        // 画面中央を基準にズーム
        const cx = width / 2, cy = height / 2;
        setStageScale(newScale);
        setStagePos({
            x: cx - (cx - stagePos.x) * (newScale / oldScale),
            y: cy - (cy - stagePos.y) * (newScale / oldScale),
        });
    }, [canvasSize, stageScale, stagePos]);

    // === 画像（PNG）エクスポート：表示範囲ではなく全体を出力 ===
    const runExportPng = () => {
        const stage = stageRef.current;
        if (!stage) return;

        const b = getContentBoundsPx();

        // 出力中だけ 等倍・原点に戻す（toDataURL の座標はステージ座標系のため）
        const prev = { scale: stage.scaleX(), x: stage.x(), y: stage.y() };
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });

        // グリッド線を隠し、白背景を敷く
        gridGroupRef.current?.visible(false);
        const bgNode = exportBgRef.current;
        if (bgNode) {
            bgNode.setAttrs({ x: b.x, y: b.y, width: b.width, height: b.height, visible: true });
            bgNode.moveToBottom();
        }
        stage.batchDraw();

        // キャンバスの上限を超えないよう解像度を調整
        const MAX_PIXELS = 40_000_000;
        const MAX_SIDE   = 12000;
        const pixelRatio = Math.max(1, Math.min(
            5,
            Math.sqrt(MAX_PIXELS / (b.width * b.height)),
            MAX_SIDE / b.width,
            MAX_SIDE / b.height,
        ));

        let dataUrl = '';
        try {
            dataUrl = stage.toDataURL({ ...b, pixelRatio });
        } finally {
            bgNode?.visible(false);
            gridGroupRef.current?.visible(true);
            stage.scale({ x: prev.scale, y: prev.scale });
            stage.position({ x: prev.x, y: prev.y });
            stage.batchDraw();
        }
        if (!dataUrl) return;

        const link = document.createElement('a');
        link.download = `booth-layout-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = dataUrl;
        link.click();
    };

    // === ベクター画像（SVG）エクスポート ===
    const runExportSvg = () => {
        const b = getContentBoundsPx();

        const boothsSvg = placedBooths.map(bo => {
            const { width: widthMm, depth: depthMm } = getBoothSizeMm(bo, dims);
            const w = (widthMm / dims.gridUnitMm) * GRID_SIZE;
            const h = (depthMm / dims.gridUnitMm) * GRID_SIZE;
            const colors = resolveBoothColors(bo, categoryColors);
            const rot = bo.rotation || 0;
            const off = getBoothRectOffset(rot, w, h);
            const text = escapeXml(bo.seatNumber || bo.name);
            // 矩形の中心（グループ内座標）。文字は逆回転させて水平に保つ。
            const cx = off.x + w / 2;
            const cy = off.y + h / 2;

            return `<g transform="translate(${bo.x * GRID_SIZE}, ${bo.y * GRID_SIZE}) rotate(${rot})">
                <rect x="${off.x}" y="${off.y}" width="${w}" height="${h}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2" rx="2" />
                <text x="${cx}" y="${cy}" font-family="sans-serif" font-size="${seatFontSize}px" font-weight="bold" fill="${colors.text}" text-anchor="middle" dominant-baseline="central" transform="rotate(${-rot}, ${cx}, ${cy})">${text}</text>
            </g>`;
        }).join('\n');

        const obstaclesSvg = obstacles.map(obs =>
            `<rect x="${obs.x * GRID_SIZE}" y="${obs.y * GRID_SIZE}" width="${obs.width * GRID_SIZE}" height="${obs.height * GRID_SIZE}" fill="none" stroke="${obs.color ?? obstacleColor}" stroke-width="${obs.strokeWidth ?? obstacleStrokeWidth}" stroke-dasharray="4 4" />`,
        ).join('\n');

        const textLabelsSvg = textLabels.map(l => {
            const fontStyle = l.fontStyle || '';
            const fw = fontStyle.includes('bold')   ? 'bold'   : 'normal';
            const fs = fontStyle.includes('italic') ? 'italic' : 'normal';
            return `<text x="${l.x}" y="${l.y + l.fontSize}" font-family="sans-serif" font-size="${l.fontSize}px" font-weight="${fw}" font-style="${fs}" fill="${l.color}" transform="rotate(${l.rotation ?? 0}, ${l.x}, ${l.y})">${escapeXml(l.text)}</text>`;
        }).join('\n');

        let bgSvg = '';
        if (bgImage && isBgVisible) {
            const canvas = document.createElement('canvas');
            canvas.width  = bgImage.naturalWidth;
            canvas.height = bgImage.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(bgImage, 0, 0);
                bgSvg = `<image href="${canvas.toDataURL('image/png')}" x="${bgConfig.x}" y="${bgConfig.y}" width="${bgImage.width * bgConfig.scaleX}" height="${bgImage.height * bgConfig.scaleY}" transform="rotate(${bgConfig.rotation} ${bgConfig.x} ${bgConfig.y})" opacity="${bgConfig.opacity}" />`;
            }
        }

        const venueSvg = `<rect x="0" y="0" width="${venueCols * GRID_SIZE}" height="${venueRows * GRID_SIZE}" fill="none" stroke="#334155" stroke-width="3" />`;

        const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" width="${Math.round(b.width)}" height="${Math.round(b.height)}">
            <rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#ffffff" />
            ${bgSvg}
            ${venueSvg}
            ${obstaclesSvg}
            ${boothsSvg}
            ${textLabelsSvg}
        </svg>`;

        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `booth-layout-${new Date().toISOString().slice(0, 10)}.svg`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // 選択中のハンドル・強調枠が出力に写り込まないよう、
    // 選択を解除した状態で再描画されてから書き出す。
    const [pendingExport, setPendingExport] = useState<'png' | 'svg' | null>(null);

    const clearSelection = () => {
        setSelectedBoothId(null);
        setSelectedBoothIds(new Set());
        setSelectedObstacleId(null);
        setSelectedTextId(null);
    };

    useEffect(() => {
        if (!pendingExport) return;
        const id = requestAnimationFrame(() => {
            if (pendingExport === 'png') runExportPng();
            else runExportSvg();
            setPendingExport(null);
        });
        return () => cancelAnimationFrame(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingExport]);

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
        const el = containerRef.current;
        if (!el) return;
        const updateSize = () =>
            setCanvasSize({ width: el.offsetWidth, height: el.offsetHeight });
        updateSize();
        const ro = new ResizeObserver(updateSize);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 初回だけ自動で全体表示
    const didInitialFitRef = useRef(false);
    useEffect(() => {
        if (didInitialFitRef.current) return;
        if (canvasSize.width > 0 && canvasSize.height > 0) {
            didInitialFitRef.current = true;
            fitToView();
        }
    }, [canvasSize, fitToView]);

    // Handle Mode Changes
    useEffect(() => {
        setActiveTool(prev => (TOOLS_BY_MODE[mode].includes(prev) ? prev : 'none'));
        if (mode === 'booth') {
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

    // スペースキーでパン（PC）
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !isTypingTarget()) {
                e.preventDefault();
                setIsSpacePanning(true);
            }
        };
        const up = (e: KeyboardEvent) => { if (e.code === 'Space') setIsSpacePanning(false); };
        const blur = () => setIsSpacePanning(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', blur);
        };
    }, []);

    // --- ブースの削除・カラー変更ヘルパー ---
    const targetBoothIds = useCallback(() => {
        if (selectedBoothIds.size > 0) return selectedBoothIds;
        if (selectedBoothId) return new Set([selectedBoothId]);
        return new Set<string>();
    }, [selectedBoothIds, selectedBoothId]);

    const deleteSelectedBooths = () => {
        const ids = targetBoothIds();
        if (ids.size === 0) return;
        onBoothsChange(booths.filter(b => !ids.has(b.id)));
        setSelectedBoothId(null);
        setSelectedBoothIds(new Set());
    };

    /** 配置済みブースを未配置トレイに戻す */
    const unplaceSelectedBooths = () => {
        const ids = targetBoothIds();
        if (ids.size === 0) return;
        onBoothsChange(booths.map(b => (ids.has(b.id) ? { ...b, isPlaced: false } : b)));
        setSelectedBoothId(null);
        setSelectedBoothIds(new Set());
        setIsTrayOpen(true);
    };

    const updateSelectedBoothsColor = (color: string, target: 'stroke' | 'fill' | 'text') => {
        const ids = targetBoothIds();
        if (ids.size === 0) return;
        onBoothsChange(booths.map(b => {
            if (!ids.has(b.id)) return b;
            if (target === 'stroke') return { ...b, strokeColor: color };
            if (target === 'fill')   return { ...b, fillColor: color };
            return { ...b, textColor: color };
        }), { coalesceKey: `booth-color-${target}` });
    };

    const resetBoothColor = (boothId: string, target: 'stroke' | 'fill' | 'text') => {
        const field = target === 'stroke' ? 'strokeColor' : target === 'fill' ? 'fillColor' : 'textColor';
        onBoothsChange(booths.map(b => {
            if (b.id !== boothId) return b;
            const next = { ...b };
            delete next[field];
            return next;
        }));
    };

    // --- 指定座標にブースを置いた場合に他のブース・障害物・会場外と干渉するか ---
    const checkBoothCollision = useCallback((movingId: string, newX: number, newY: number, boothList: Booth[]) => {
        const moving = boothList.find(b => b.id === movingId);
        if (!moving) return false;
        const rect = getBoothGridBounds({ ...moving, x: newX, y: newY }, dims);
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > venueCols || rect.y + rect.h > venueRows) return true;
        if (obstacleRects.some(o => rectsOverlap(rect, o))) return true;
        return boothList.some(b =>
            b.id !== movingId &&
            b.isPlaced !== false &&
            rectsOverlap(rect, getBoothGridBounds(b, dims)),
        );
    }, [dims, venueCols, venueRows, obstacleRects]);

    // --- 重ならない最近傍グリッドを探す（新規追加・トレイからの配置で使用） ---
    const findFreePosition = useCallback((movingId: string, preferX: number, preferY: number, boothList: Booth[]) => {
        for (let r = 0; r <= 40; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = Math.max(0, preferX + dx);
                    const ny = Math.max(0, preferY + dy);
                    if (!checkBoothCollision(movingId, nx, ny, boothList)) return { x: nx, y: ny };
                }
            }
        }
        return { x: preferX, y: preferY };
    }, [checkBoothCollision]);

    // --- ブースを新規追加 ---
    const handleAddBooth = () => {
        const center = getViewCenterGrid();
        const id = `booth-${Date.now()}`;
        const draft: Booth = {
            id,
            name: '新規ブース',
            size: 1.0,
            category: 'その他',
            preferences: { wall: false },
            x: center.x,
            y: center.y,
            rotation: 0,
            isPlaced: true,
        };
        const pos = findFreePosition(id, center.x, center.y, [...booths, draft]);
        onBoothsChange([...booths, { ...draft, x: pos.x, y: pos.y }]);
        setSelectedBoothId(id);
        setSelectedBoothIds(new Set([id]));
    };

    // --- 未配置トレイからキャンバスへ配置 ---
    const placeBoothFromTray = (boothId: string) => {
        const center = getViewCenterGrid();
        const target = booths.find(b => b.id === boothId);
        if (!target) return;
        const candidate = { ...target, x: center.x, y: center.y, isPlaced: true };
        const pos = findFreePosition(
            boothId,
            center.x,
            center.y,
            booths.map(b => (b.id === boothId ? candidate : b)),
        );
        onBoothsChange(booths.map(b =>
            b.id === boothId ? { ...b, x: pos.x, y: pos.y, isPlaced: true } : b,
        ));
        setSelectedBoothId(boothId);
        setSelectedBoothIds(new Set([boothId]));
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isTypingTarget()) return;

            if (e.key === 'Escape') {
                setSelectedBoothId(null);
                setSelectedBoothIds(new Set());
                setSelectedObstacleId(null);
                setSelectedTextId(null);
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                if (mode === 'booth') {
                    e.preventDefault();
                    setSelectedBoothIds(new Set(placedBooths.map(b => b.id)));
                    setSelectedBoothId(null);
                }
                return;
            }

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

            if (e.key === 'r' && mode === 'booth' && (selectedBoothId || selectedBoothIds.size > 0)) {
                rotateSelectedBooths();
                return;
            }

            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                if (mode === 'booth' && (selectedBoothId || selectedBoothIds.size > 0)) {
                    e.preventDefault();
                    const step = e.shiftKey ? 5 : 1;
                    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
                    const ids = targetBoothIds();
                    onBoothsChange(booths.map(b =>
                        ids.has(b.id)
                            ? { ...b, x: Math.max(0, b.x + dx), y: Math.max(0, b.y + dy) }
                            : b,
                    ));
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    });

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
                setBgConfig({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 });
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
            x: node.x(), y: node.y(),
            scaleX: node.scaleX(), scaleY: node.scaleY(),
            rotation: node.rotation(),
        });
    };

    const handleBgDragEnd = (e: any) => {
        setBgConfig({ ...bgConfig, x: e.target.x(), y: e.target.y() });
    };

    // --- Grid Rendering（会場サイズに追従 / 5マスごとに主線） ---
    const showMinorGrid = stageScale > 0.3;
    const gridLines = useMemo(() => {
        const lines: React.ReactElement[] = [];
        const w = venueCols * GRID_SIZE;
        const h = venueRows * GRID_SIZE;
        for (let i = 0; i <= venueCols; i++) {
            const major = i % 5 === 0;
            if (!major && !showMinorGrid) continue;
            lines.push(<Line key={`v-${i}`} points={[i * GRID_SIZE, 0, i * GRID_SIZE, h]}
                stroke={major ? '#c7d2dd' : '#e9edf2'} strokeWidth={1} listening={false} perfectDrawEnabled={false} />);
        }
        for (let i = 0; i <= venueRows; i++) {
            const major = i % 5 === 0;
            if (!major && !showMinorGrid) continue;
            lines.push(<Line key={`h-${i}`} points={[0, i * GRID_SIZE, w, i * GRID_SIZE]}
                stroke={major ? '#c7d2dd' : '#e9edf2'} strokeWidth={1} listening={false} perfectDrawEnabled={false} />);
        }
        return lines;
    }, [venueCols, venueRows, showMinorGrid]);

    // --- Obstacle Logic ---
    const findObstacleAt = (gx: number, gy: number) =>
        obstacles.find(obs =>
            gx >= obs.x && gx < obs.x + obs.width &&
            gy >= obs.y && gy < obs.y + obs.height);

    const handleObstacleChange = (updatedObstacle: Obstacle) => {
        onObstaclesChange(obstacles.map(obs => obs.id === updatedObstacle.id ? updatedObstacle : obs));
    };

    // --- Mouse / Touch Handlers for Stage ---
    const getGridPos = (stageX: number, stageY: number) => ({
        gx: Math.floor((stageX - stagePos.x) / (stageScale * GRID_SIZE)),
        gy: Math.floor((stageY - stagePos.y) / (stageScale * GRID_SIZE)),
    });

    const handleEraser = (gx: number, gy: number) => {
        const existingObs = findObstacleAt(gx, gy);
        if (existingObs) onObstaclesChange(obstacles.filter(o => o.id !== existingObs.id));
    };

    const handleMouseDown = (e: any) => {
        const stage = e.target.getStage();
        if (!stage) return;

        const fromTouch = !!e.evt?.touches || Date.now() - lastTouchAtRef.current < 700;

        // 中ボタン（ホイールボタン）: パン開始
        if (e.evt?.button === 1) {
            e.evt.preventDefault();
            isPanningRef.current = true;
            panStartRef.current = {
                x: e.evt.clientX, y: e.evt.clientY,
                stagePosX: stage.x(), stagePosY: stage.y(),
            };
            return;
        }

        // スペース押下中はステージのドラッグ（パン）に専念
        if (isSpacePanning) return;

        const clickedOnStage = e.target === stage;
        if (clickedOnStage) {
            setSelectedBoothId(null);
            setSelectedObstacleId(null);
            setSelectedTextId(null);

            if (activeTool === 'text') {
                const pos = stage.getPointerPosition();
                if (pos) {
                    handleAddText(
                        (pos.x - stage.x()) / stage.scaleX(),
                        (pos.y - stage.y()) / stage.scaleY(),
                    );
                }
                return;
            }

            // マウス操作時のみ範囲選択。タッチは1本指パンを優先。
            if (mode === 'booth' && !fromTouch) {
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
                const point = {
                    x: (pos.x - stage.x()) / stage.scaleX(),
                    y: (pos.y - stage.y()) / stage.scaleY(),
                };
                const newPoints = [...calibrationPoints, point];
                setCalibrationPoints(newPoints);

                if (newPoints.length === 2) {
                    setTimeout(() => {
                        const [p1, p2] = newPoints;
                        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                        const input = window.prompt('2点間の実際の距離(mm)を入力してください:', '5000');
                        if (input) {
                            const realDistMm = parseFloat(input);
                            if (!isNaN(realDistMm) && realDistMm > 0 && distPx > 0) {
                                const targetDistPx = (realDistMm / dims.gridUnitMm) * GRID_SIZE;
                                const scaleFactor = targetDistPx / distPx;
                                setBgConfig(prev => ({
                                    ...prev,
                                    scaleX: prev.scaleX * scaleFactor,
                                    scaleY: prev.scaleY * scaleFactor,
                                }));
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

        if (mode === 'venue' && activeTool === 'none') {
            setSelectedObstacleId(null);
            return;
        }

        if (mode === 'venue' && activeTool !== 'none' && activeTool !== 'text') {
            isPaintingRef.current = true;
            const pos = stage.getPointerPosition();
            if (pos) {
                const { gx, gy } = getGridPos(pos.x, pos.y);
                dragStartRef.current = { gx, gy };
                if (activeTool === 'eraser') handleEraser(gx, gy);
                else setPreviewRect({ x: gx, y: gy, w: 1, h: 1 });
            }
        }
    };

    const handleMouseMove = (e: any) => {
        if (isPanningRef.current && panStartRef.current) {
            const stage = e.target.getStage();
            if (!stage) return;
            const newPos = {
                x: panStartRef.current.stagePosX + (e.evt.clientX - panStartRef.current.x),
                y: panStartRef.current.stagePosY + (e.evt.clientY - panStartRef.current.y),
            };
            setStagePos(newPos);
            stage.position(newPos);
            stage.batchDraw();
            return;
        }

        if (isBgEditing || isCalibrating) return;

        const stage = e.target.getStage();
        if (!stage) return;

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
                setPreviewRect({
                    x: startX,
                    y: startY,
                    w: Math.max(dragStartRef.current.gx, gx) - startX + 1,
                    h: Math.max(dragStartRef.current.gy, gy) - startY + 1,
                });
            }
        }
    };

    const handleMouseUp = () => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            panStartRef.current = null;
            return;
        }
        if (isCalibrating) return;

        if (isDragSelectingRef.current && dragSelect) {
            isDragSelectingRef.current = false;
            const minX = Math.min(dragSelect.startX, dragSelect.endX);
            const maxX = Math.max(dragSelect.startX, dragSelect.endX);
            const minY = Math.min(dragSelect.startY, dragSelect.endY);
            const maxY = Math.max(dragSelect.startY, dragSelect.endY);
            const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

            const selected = new Set<string>();
            placedBooths.forEach(b => {
                // 回転を考慮した占有矩形で判定
                const g = getBoothGridBounds(b, dims);
                const r = { x: g.x * GRID_SIZE, y: g.y * GRID_SIZE, w: g.w * GRID_SIZE, h: g.h * GRID_SIZE };
                if (rectsOverlap(r, box)) selected.add(b.id);
            });
            setSelectedBoothIds(selected);
            setSelectedBoothId(selected.size === 1 ? Array.from(selected)[0] : null);
            setDragSelect(null);
            return;
        }

        if (isPaintingRef.current && mode === 'venue' && activeTool !== 'eraser' && previewRect) {
            const obstacleType = (activeTool === 'wall' || activeTool === 'column') ? activeTool : 'wall';
            onObstaclesChange([...obstacles, {
                id: `obs-${Date.now()}`,
                x: previewRect.x, y: previewRect.y,
                width: previewRect.w, height: previewRect.h,
                rotation: 0,
                type: obstacleType,
                color: obstacleColor,
                strokeWidth: obstacleStrokeWidth,
            }]);
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
            if (!pointer) return;
            const mousePointTo = {
                x: pointer.x / oldScale - stage.x() / oldScale,
                y: pointer.y / oldScale - stage.y() / oldScale,
            };
            const raw = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
            if (newScale === oldScale) return;
            setStageScale(newScale);
            setStagePos({
                x: -(mousePointTo.x - pointer.x / newScale) * newScale,
                y: -(mousePointTo.y - pointer.y / newScale) * newScale,
            });
        };

        if (e.evt.ctrlKey) {
            doZoom();
        } else if (e.evt.deltaMode === 0 && (Math.abs(e.evt.deltaX) > 0 || Math.abs(e.evt.deltaY) > 0)) {
            const newPos = { x: stagePos.x - e.evt.deltaX, y: stagePos.y - e.evt.deltaY };
            setStagePos(newPos);
            stage.position(newPos);
            stage.batchDraw();
        } else {
            doZoom();
        }
    };

    // --- タッチ操作（ピンチズーム・1本指パン） ---
    const handleTouchStart = (e: any) => {
        lastTouchAtRef.current = Date.now();
        if (e.evt.touches && e.evt.touches.length === 2) {
            e.evt.preventDefault();
            // ピンチ中はステージのドラッグと競合させない
            e.target.getStage()?.stopDrag();
            return;
        }
        handleMouseDown(e);
    };

    const handleTouchMove = (e: any) => {
        lastTouchAtRef.current = Date.now();
        if (e.evt.touches && e.evt.touches.length === 2) {
            e.evt.preventDefault();
            const stage = e.target.getStage();
            if (!stage) return;

            const [touch1, touch2] = [e.evt.touches[0], e.evt.touches[1]];
            const p1 = { x: touch1.clientX, y: touch1.clientY };
            const p2 = { x: touch2.clientX, y: touch2.clientY };
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            if (!lastCenter.current || !lastDist.current) {
                lastCenter.current = center;
                lastDist.current = dist;
                return;
            }

            const dx = center.x - lastCenter.current.x;
            const dy = center.y - lastCenter.current.y;
            const pointTo = {
                x: (center.x - stage.x() - dx) / stage.scaleX(),
                y: (center.y - stage.y() - dy) / stage.scaleX(),
            };
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, stage.scaleX() * (dist / lastDist.current)));

            stage.scaleX(newScale);
            stage.scaleY(newScale);
            setStageScale(newScale);

            const newPos = { x: center.x - pointTo.x * newScale, y: center.y - pointTo.y * newScale };
            stage.position(newPos);
            setStagePos(newPos);

            lastDist.current = dist;
            lastCenter.current = center;
        } else {
            handleMouseMove(e);
        }
    };

    const handleTouchEnd = () => {
        lastTouchAtRef.current = Date.now();
        lastDist.current = 0;
        lastCenter.current = null;
        handleMouseUp();
    };

    // --- ブースのドラッグ ---
    const handleDragEndBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        clearGuides();
        const rawX = Math.max(0, Math.round(e.target.x() / GRID_SIZE));
        const rawY = Math.max(0, Math.round(e.target.y() / GRID_SIZE));

        // 複数選択中は全て同じ差分で移動
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            const startPos = multiDragStartRef.current.get(id);
            const dx = rawX - (startPos?.x ?? booths.find(b => b.id === id)?.x ?? 0);
            const dy = rawY - (startPos?.y ?? booths.find(b => b.id === id)?.y ?? 0);
            onBoothsChange(booths.map(b => {
                if (!selectedBoothIds.has(b.id)) return b;
                const orig = multiDragStartRef.current.get(b.id) ?? { x: b.x, y: b.y };
                return { ...b, x: Math.max(0, orig.x + dx), y: Math.max(0, orig.y + dy), isPlaced: true };
            }));
            multiDragStartRef.current.clear();
            multiDragAnchorRef.current = null;
            return;
        }

        // 単体移動：ドロップした場所にそのまま置く（重なりは赤枠で警告）
        onBoothsChange(booths.map(b => b.id === id ? { ...b, x: rawX, y: rawY, isPlaced: true } : b));
        e.target.to({ x: rawX * GRID_SIZE, y: rawY * GRID_SIZE, duration: 0.08 });
    };

    /** スナップ時の補助線を Konva ノードに直接反映する */
    const setGuide = (ref: React.RefObject<any>, grid: number | null, vertical: boolean) => {
        const node = ref.current;
        if (!node) return;
        if (grid === null) { node.visible(false); return; }
        const margin = GRID_SIZE * 2;
        node.points(vertical
            ? [grid * GRID_SIZE, -margin, grid * GRID_SIZE, venueRows * GRID_SIZE + margin]
            : [-margin, grid * GRID_SIZE, venueCols * GRID_SIZE + margin, grid * GRID_SIZE]);
        node.visible(true);
    };

    const clearGuides = () => {
        setGuide(guideVRef, null, true);
        setGuide(guideHRef, null, false);
        snapRef.current = null;
        boothLayerRef.current?.batchDraw();
    };

    const handleDragStartBooth = (e: any, id: string) => {
        if (mode === 'venue') return;
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            multiDragStartRef.current = new Map(
                booths.filter(b => selectedBoothIds.has(b.id)).map(b => [b.id, { x: b.x, y: b.y }]),
            );
            multiDragAnchorRef.current = { x: e.target.x(), y: e.target.y() };
            snapRef.current = null;
            return;
        }
        // 単体ドラッグのときだけ、他のブース・障害物・会場端への吸着候補を作る
        const self = booths.find(b => b.id === id);
        if (!self || !snapEnabled) { snapRef.current = null; return; }
        const others = placedBooths
            .filter(b => b.id !== id)
            .map(b => getBoothGridBounds(b, dims));
        snapRef.current = buildSnapCandidates(
            getBoothGridBounds(self, dims),
            [...others, ...obstacleRects],
            { cols: venueCols, rows: venueRows },
        );
    };

    const handleDragMoveBooth = (e: any, id: string) => {
        if (mode === 'venue') return;

        // 複数選択: 他のブースを追随させる（吸着はしない）
        if (selectedBoothIds.has(id) && selectedBoothIds.size > 1) {
            const anchor = multiDragAnchorRef.current;
            if (!anchor || !boothLayerRef.current) return;
            const dxPx = e.target.x() - anchor.x;
            const dyPx = e.target.y() - anchor.y;
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
            return;
        }

        // 単体ドラッグ: 近い候補に吸着し、補助線を出す
        const snap = snapRef.current;
        if (!snap) return;
        const threshold = 0.75; // グリッド単位
        const sx = findSnap(e.target.x() / GRID_SIZE, snap.xs, threshold);
        const sy = findSnap(e.target.y() / GRID_SIZE, snap.ys, threshold);
        if (sx) e.target.x(sx.value * GRID_SIZE);
        if (sy) e.target.y(sy.value * GRID_SIZE);
        setGuide(guideVRef, sx ? sx.guide : null, true);
        setGuide(guideHRef, sy ? sy.guide : null, false);
        boothLayerRef.current?.batchDraw();
    };

    const handleBoothClick = (e: any, boothId: string) => {
        if (mode !== 'booth') return;
        e.cancelBubble = true;
        if (e.evt?.shiftKey) {
            const next = new Set(selectedBoothIds);
            if (next.has(boothId)) next.delete(boothId); else next.add(boothId);
            setSelectedBoothIds(next);
            setSelectedBoothId(next.size === 1 ? Array.from(next)[0] : null);
        } else {
            setSelectedBoothId(boothId);
            setSelectedBoothIds(new Set([boothId]));
        }
    };

    // --- 整列・等間隔配置 ---
    const [lineGap, setLineGap] = useState(1);
    const doAlign      = (kind: AlignKind) => onBoothsChange(alignBooths(booths, targetBoothIds(), kind, dims));
    const doDistribute = (axis: Axis)      => onBoothsChange(distributeBooths(booths, targetBoothIds(), axis, dims));
    const doArrange    = (axis: Axis)      => onBoothsChange(arrangeInLine(booths, targetBoothIds(), axis, lineGap, dims));

    const rotateSelectedBooths = () => {
        const ids = targetBoothIds();
        if (ids.size === 0) return;
        onBoothsChange(booths.map(b =>
            ids.has(b.id) ? { ...b, rotation: (((b.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 } : b,
        ));
    };

    const updateBoothSize = (boothId: string, width: number, depth: number) => {
        onBoothsChange(
            booths.map(b => b.id === boothId ? { ...b, sizeMm: { width, depth } } : b),
            { coalesceKey: `booth-size-${boothId}` },
        );
    };

    // --- Transformer: 選択ブースにアタッチ ---
    useEffect(() => {
        if (!boothTrRef.current || !boothLayerRef.current) return;
        if (selectedBoothId && selectedBoothIds.size === 1 && mode === 'booth' && !isSpacePanning) {
            const node = boothLayerRef.current.findOne(`#booth-group-${selectedBoothId}`);
            if (node) {
                boothTrRef.current.nodes([node]);
                boothTrRef.current.getLayer()?.batchDraw();
                return;
            }
        }
        boothTrRef.current.nodes([]);
        boothTrRef.current.getLayer()?.batchDraw();
    }, [selectedBoothId, selectedBoothIds, mode, isSpacePanning, booths]);

    const handleBoothTransformEnd = (e: any) => {
        if (!selectedBoothId) return;
        const node = e.target;
        const booth = booths.find(b => b.id === selectedBoothId);
        if (!booth || !node) return;

        const scaleX = Math.abs(node.scaleX());
        const scaleY = Math.abs(node.scaleY());
        node.scaleX(1);
        node.scaleY(1);

        // Transformer のスケールはグループのローカル軸（=幅/奥行き軸）に効く
        const { width: curW, depth: curD } = getBoothSizeMm(booth, dims);
        const newWidthMm = Math.max(dims.gridUnitMm, Math.round(curW * scaleX / dims.gridUnitMm) * dims.gridUnitMm);
        const newDepthMm = Math.max(dims.gridUnitMm, Math.round(curD * scaleY / dims.gridUnitMm) * dims.gridUnitMm);

        const snappedX = Math.max(0, Math.round(node.x() / GRID_SIZE));
        const snappedY = Math.max(0, Math.round(node.y() / GRID_SIZE));
        node.x(snappedX * GRID_SIZE);
        node.y(snappedY * GRID_SIZE);

        onBoothsChange(booths.map(b =>
            b.id === selectedBoothId
                ? { ...b, x: snappedX, y: snappedY, sizeMm: { width: newWidthMm, depth: newDepthMm } }
                : b,
        ));
    };

    const selectedBooth = booths.find(b => b.id === selectedBoothId);
    const stageDraggable =
        !isBgEditing && !isCalibrating &&
        (isSpacePanning || (mode === 'booth' ? activeTool !== 'text' : activeTool === 'none'));

    const cursor = isSpacePanning
        ? 'grab'
        : activeTool === 'text'
            ? 'text'
            : mode === 'venue' && activeTool !== 'none'
                ? 'crosshair'
                : mode === 'venue'
                    ? 'grab'
                    : 'default';

    // パネルの共通クラス（モバイルはボトムシート / PCは右上カード）
    const panelClass =
        'absolute z-40 bg-white/97 backdrop-blur shadow-2xl border-gray-200 overflow-y-auto ' +
        'inset-x-0 bottom-0 rounded-t-2xl border-t p-4 max-h-[46vh] ' +
        'lg:inset-x-auto lg:bottom-auto lg:top-16 lg:right-3 lg:w-64 lg:rounded-xl lg:border lg:max-h-[calc(100%-8rem)]';

    return (
        <div ref={containerRef} className="bg-white flex flex-col h-full w-full relative overflow-hidden">

            {/* ── 上部中央: モード切替 ─────────────────────────────────── */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white shadow-lg rounded-full p-1 flex border border-gray-200 pointer-events-auto">
                    <button
                        onClick={() => onModeChange('booth')}
                        className={`px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition ${mode === 'booth' ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                        ブース配置
                    </button>
                    <button
                        onClick={() => onModeChange('venue')}
                        className={`px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition ${mode === 'venue' ? 'bg-orange-600 text-white shadow' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                        会場編集
                    </button>
                </div>
            </div>

            {/* ── 右上: ズーム操作（スマホ・PC共通） ────────────────────── */}
            <div className="absolute top-2 right-2 z-30 flex flex-col gap-1">
                <button onClick={() => zoomBy(1.25)} aria-label="拡大"
                    className="w-10 h-10 rounded-lg bg-white/95 shadow border border-gray-200 text-gray-700 text-lg font-bold active:bg-gray-100">＋</button>
                <button onClick={() => zoomBy(0.8)} aria-label="縮小"
                    className="w-10 h-10 rounded-lg bg-white/95 shadow border border-gray-200 text-gray-700 text-lg font-bold active:bg-gray-100">−</button>
                <button onClick={fitToView} title="全体を表示" aria-label="全体を表示"
                    className="w-10 h-10 rounded-lg bg-white/95 shadow border border-gray-200 text-gray-700 flex items-center justify-center active:bg-gray-100">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                </button>
                <div className="w-10 text-center text-[10px] text-gray-500 bg-white/90 rounded py-0.5 border border-gray-200">
                    {Math.round(stageScale * 100)}%
                </div>
            </div>

            {/* ── 左上: ツールバー ─────────────────────────────────────── */}
            <div className="absolute top-14 left-2 z-20 flex flex-col items-start gap-2 max-w-[calc(100%-4rem)]">
                {mode === 'booth' && (
                    <div className="bg-white/95 backdrop-blur shadow-lg rounded-xl border border-gray-200 p-1.5 flex gap-1.5 items-center">
                        <button
                            onClick={handleAddBooth}
                            className="h-10 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold active:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
                        >
                            ＋ ブース
                        </button>
                        <button
                            onClick={() => setActiveTool(t => (t === 'text' ? 'none' : 'text'))}
                            title="テキストを追加"
                            className={`w-10 h-10 rounded-lg font-bold transition ${activeTool === 'text' ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-300' : 'text-gray-600 active:bg-gray-100'}`}
                        >T</button>
                        <button
                            onClick={() => setIsSettingsOpen(o => !o)}
                            title="表示設定"
                            className={`w-10 h-10 rounded-lg flex items-center justify-center transition ${isSettingsOpen ? 'bg-blue-50 text-blue-600 ring-2 ring-blue-200' : 'text-gray-600 active:bg-gray-100'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                            </svg>
                        </button>
                        {problemBoothIds.size > 0 && (
                            <span className="h-10 px-2 rounded-lg bg-red-50 text-red-600 text-[11px] font-bold flex items-center whitespace-nowrap">
                                ⚠ {problemBoothIds.size}
                            </span>
                        )}
                    </div>
                )}

                {mode === 'booth' && isSettingsOpen && (
                    <div className="bg-white/97 backdrop-blur shadow-xl rounded-xl p-3 border border-gray-200 flex flex-col gap-3 w-60 max-h-[55vh] overflow-y-auto">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 whitespace-nowrap">文字サイズ</span>
                            <input type="range" min={8} max={32} step={1} value={seatFontSize}
                                onChange={(e) => setSeatFontSize(Number(e.target.value))}
                                className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                            <span className="text-xs font-bold text-gray-700 w-6 text-right">{seatFontSize}</span>
                        </div>

                        <div className="border-t border-gray-100 pt-2 space-y-1.5">
                            <label className="flex items-center gap-2 text-xs text-gray-700">
                                <input type="checkbox" checked={snapEnabled}
                                    onChange={(e) => setSnapEnabled(e.target.checked)} className="w-4 h-4" />
                                ドラッグ時に他のブースへ吸着
                            </label>
                            <label className="flex items-start gap-2 text-xs text-gray-700">
                                <input type="checkbox" checked={avoidObstacles}
                                    onChange={(e) => setAvoidObstacles(e.target.checked)} className="w-4 h-4 mt-0.5" />
                                <span>
                                    壁・柱との重なりを警告
                                    <span className="block text-[10px] text-gray-400">
                                        会場の外周を壁で囲っている場合はオフに
                                    </span>
                                </span>
                            </label>
                        </div>

                        <div className="border-t border-gray-100 pt-2">
                            <p className="text-[11px] font-semibold text-gray-500 mb-2">カテゴリカラー</p>
                            {CATEGORY_PRESETS.map(({ key, def }) => (
                                <div key={key} className="flex items-center gap-2 mb-1">
                                    <input type="color" value={categoryColors[key]?.stroke ?? def}
                                        onChange={(e) => onCategoryColorsChange({
                                            ...categoryColors,
                                            [key]: { stroke: e.target.value, fill: e.target.value + '22' },
                                        })}
                                        className="w-7 h-7 rounded border border-gray-200 cursor-pointer p-0" />
                                    <span className="text-[11px] text-gray-600 truncate">{key}</span>
                                    {categoryColors[key] && (
                                        <button className="text-[10px] text-gray-400 hover:text-red-500 ml-auto"
                                            onClick={() => {
                                                const next = { ...categoryColors };
                                                delete next[key];
                                                onCategoryColorsChange(next);
                                            }}>↩</button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="border-t border-gray-100 pt-2 text-[10px] text-gray-500 leading-relaxed">
                            <p className="font-semibold text-gray-600 mb-1">操作</p>
                            スマホ: 1本指ドラッグで移動 / 2本指でズーム<br />
                            PC: スペース+ドラッグ or 中ボタンで移動<br />
                            PC: 空白を左ドラッグで範囲選択 / Shift+クリックで追加選択<br />
                            矢印キー: 移動（Shiftで5マス） / R: 回転<br />
                            Ctrl+A: 全選択 / Esc: 解除 / Delete: 削除
                        </div>
                    </div>
                )}

                {mode === 'venue' && (
                    <div className="bg-white/97 backdrop-blur shadow-xl rounded-xl p-1.5 flex flex-col gap-2 border border-orange-100 items-start max-w-full">
                        <div className="flex gap-1 overflow-x-auto w-full">
                            {([
                                { tool: 'none'   as ToolType, label: '移動',     ring: 'bg-gray-200 ring-gray-300' },
                                { tool: 'wall'   as ToolType, label: '壁ペン',   ring: 'bg-orange-100 ring-orange-300' },
                                { tool: 'column' as ToolType, label: '柱ペン',   ring: 'bg-orange-100 ring-orange-300' },
                                { tool: 'eraser' as ToolType, label: '消しゴム', ring: 'bg-red-100 ring-red-300' },
                                { tool: 'text'   as ToolType, label: 'テキスト', ring: 'bg-purple-100 ring-purple-300' },
                            ]).map(({ tool, label, ring }) => (
                                <button key={tool}
                                    onClick={() => { setActiveTool(tool); if (tool !== 'none') setIsBgEditing(false); }}
                                    className={`shrink-0 px-2 py-2 rounded-lg min-w-[3.5rem] text-[10px] font-medium transition ${activeTool === tool && !isBgEditing ? `${ring} ring-2` : 'text-gray-700 active:bg-gray-100'}`}
                                >{label}</button>
                            ))}
                        </div>

                        {activeTool === 'text' && (
                            <div className="w-full border-t border-gray-100 pt-2 flex flex-wrap items-center gap-2 px-1">
                                <input type="color" value={textSettings.color}
                                    onChange={(e) => setTextSettings(s => ({ ...s, color: e.target.value }))}
                                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5" title="文字色" />
                                <input type="number" min={8} max={200} step={2} value={textSettings.fontSize}
                                    onChange={(e) => setTextSettings(s => ({ ...s, fontSize: Number(e.target.value) }))}
                                    className="w-14 border rounded px-1 py-1 text-xs text-gray-800" title="サイズ" />
                                <button
                                    onClick={() => setTextSettings(s => ({ ...s, fontStyle: s.fontStyle.includes('bold') ? s.fontStyle.replace('bold', '').trim() : (s.fontStyle + ' bold').trim() }))}
                                    className={`w-8 h-8 rounded border font-bold text-xs ${textSettings.fontStyle.includes('bold') ? 'bg-purple-100 border-purple-400 text-purple-700' : 'border-gray-300 text-gray-600'}`}>B</button>
                                <span className="text-[10px] text-gray-400">クリックで追加</span>
                            </div>
                        )}

                        {(activeTool === 'wall' || activeTool === 'column') && (
                            <div className="w-full border-t border-gray-100 pt-2 flex flex-col gap-2 px-1">
                                <div className="flex items-center gap-2">
                                    <input type="color" value={obstacleColor} onChange={(e) => setObstacleColor(e.target.value)}
                                        className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5" title="線色" />
                                    <label className="text-[10px] text-gray-500">太さ</label>
                                    <input type="number" min={1} max={20} step={1} value={obstacleStrokeWidth}
                                        onChange={(e) => setObstacleStrokeWidth(Number(e.target.value))}
                                        className="w-12 border rounded px-1 py-1 text-xs text-gray-800" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <label className="text-[10px] text-gray-500">W</label>
                                    <input type="number" min={10} step={10} value={obstacleDimW}
                                        onChange={(e) => setObstacleDimW(Number(e.target.value))}
                                        className="w-16 border rounded px-1 py-1 text-xs text-gray-800" />
                                    <label className="text-[10px] text-gray-500">H</label>
                                    <input type="number" min={10} step={10} value={obstacleDimH}
                                        onChange={(e) => setObstacleDimH(Number(e.target.value))}
                                        className="w-16 border rounded px-1 py-1 text-xs text-gray-800" />
                                    <span className="text-[10px] text-gray-400">mm</span>
                                </div>
                                <button
                                    className="text-[11px] bg-orange-50 active:bg-orange-100 text-orange-700 rounded py-1.5 px-2 font-medium"
                                    onClick={() => {
                                        const center = getViewCenterGrid();
                                        onObstaclesChange([...obstacles, {
                                            id: `obs-${Date.now()}`,
                                            x: center.x, y: center.y,
                                            width:  Math.max(1, Math.round(obstacleDimW / dims.gridUnitMm)),
                                            height: Math.max(1, Math.round(obstacleDimH / dims.gridUnitMm)),
                                            rotation: 0,
                                            type: activeTool === 'wall' ? 'wall' : 'column',
                                            color: obstacleColor,
                                            strokeWidth: obstacleStrokeWidth,
                                        }]);
                                    }}
                                >画面中央に配置 ({obstacleDimW}×{obstacleDimH}mm)</button>
                            </div>
                        )}

                        {/* 下絵操作 */}
                        <div className="w-full border-t border-gray-100 pt-2 flex gap-1 overflow-x-auto">
                            <label className="shrink-0 px-2 py-2 active:bg-gray-100 rounded-lg cursor-pointer min-w-[3.5rem] text-[10px] font-medium text-gray-700 text-center">
                                <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                                下絵読込
                            </label>
                            {bgImage && (
                                <>
                                    <button onClick={() => setIsBgVisible(v => !v)}
                                        className={`shrink-0 px-2 py-2 rounded-lg min-w-[3.5rem] text-[10px] font-medium ${!isBgVisible ? 'bg-gray-200 ring-2 ring-gray-400' : 'text-gray-700 active:bg-gray-100'}`}>
                                        {isBgVisible ? '非表示' : '表示'}
                                    </button>
                                    <button onClick={() => { setIsBgEditing(v => !v); if (!isBgEditing) setActiveTool('none'); }}
                                        className={`shrink-0 px-2 py-2 rounded-lg min-w-[3.5rem] text-[10px] font-medium ${isBgEditing ? 'bg-blue-100 ring-2 ring-blue-300 text-blue-700' : 'text-gray-700 active:bg-gray-100'}`}>
                                        調整
                                    </button>
                                    <button onClick={() => {
                                        setIsCalibrating(v => !v);
                                        if (!isCalibrating) { setActiveTool('none'); setIsBgEditing(false); setCalibrationPoints([]); }
                                    }}
                                        className={`shrink-0 px-2 py-2 rounded-lg min-w-[3.5rem] text-[10px] font-medium ${isCalibrating ? 'bg-green-100 ring-2 ring-green-300 text-green-700' : 'text-gray-700 active:bg-gray-100'}`}>
                                        縮尺合せ
                                    </button>
                                    <button onClick={() => {
                                        if (window.confirm('下絵を削除しますか？')) { setBgImage(null); setIsBgEditing(false); }
                                    }}
                                        className="shrink-0 px-2 py-2 rounded-lg min-w-[3.5rem] text-[10px] font-medium text-gray-500 active:bg-red-50">
                                        削除
                                    </button>
                                    <div className="shrink-0 flex flex-col justify-center w-16 px-1">
                                        <label className="text-[10px] text-gray-500 text-center">透明度</label>
                                        <input type="range" min="0.1" max="1" step="0.1" value={bgConfig.opacity}
                                            onChange={(e) => setBgConfig({ ...bgConfig, opacity: parseFloat(e.target.value) })}
                                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── 選択中ブースのパネル ──────────────────────────────────── */}
            {selectedBooth && selectedBoothIds.size <= 1 && mode === 'booth' && (
                <div className={panelClass}>
                    <div className="flex justify-between items-center mb-2 border-b pb-2">
                        <h3 className="font-bold text-gray-900 truncate">{selectedBooth.name}</h3>
                        <button onClick={() => { setSelectedBoothId(null); setSelectedBoothIds(new Set()); }}
                            className="w-8 h-8 shrink-0 text-gray-400 active:text-gray-700">✕</button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs text-gray-700 block mb-1">出展者名</label>
                            <input type="text" value={selectedBooth.name}
                                onChange={(e) => onBoothsChange(
                                    booths.map(b => b.id === selectedBooth.id ? { ...b, name: e.target.value } : b),
                                    { coalesceKey: `booth-name-${selectedBooth.id}` })}
                                className="w-full border rounded px-2 py-2 text-sm text-gray-900 bg-white" />
                        </div>

                        <div>
                            <label className="text-xs text-gray-700 block mb-1">座席番号</label>
                            <input type="text" value={selectedBooth.seatNumber || ''}
                                onChange={(e) => onBoothsChange(
                                    booths.map(b => b.id === selectedBooth.id ? { ...b, seatNumber: e.target.value || undefined } : b),
                                    { coalesceKey: `booth-seat-${selectedBooth.id}` })}
                                placeholder="例: A-01"
                                className="w-full border rounded px-2 py-2 text-sm text-gray-900 bg-white" />
                        </div>

                        <div>
                            <label className="text-xs text-gray-700 block mb-1">出展者を入れ替え</label>
                            <select
                                value={selectedBooth.id}
                                onChange={(e) => {
                                    const targetId = e.target.value;
                                    if (targetId === selectedBooth.id) return;
                                    const target = booths.find(b => b.id === targetId);
                                    if (!target) return;
                                    const pick = (b: Booth) => ({
                                        name: b.name, category: b.category, seatNumber: b.seatNumber,
                                        preferences: b.preferences, color: b.color,
                                        strokeColor: b.strokeColor, fillColor: b.fillColor, textColor: b.textColor,
                                    });
                                    // 2つの座席の中身だけを入れ替える（位置はそのまま）
                                    onBoothsChange(booths.map(b => {
                                        if (b.id === selectedBooth.id) return { ...b, ...pick(target) };
                                        if (b.id === targetId)          return { ...b, ...pick(selectedBooth) };
                                        return b;
                                    }));
                                }}
                                className="w-full border rounded px-2 py-2 text-sm text-gray-900 bg-white"
                            >
                                {booths.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.seatNumber ? `#${b.seatNumber} ` : ''}{b.name}{b.isPlaced === false ? ' (未配置)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs text-gray-700 block mb-1">幅 (mm)</label>
                                <input type="number" step={10}
                                    value={getBoothSizeMm(selectedBooth, dims).width}
                                    onChange={(e) => updateBoothSize(selectedBooth.id, Number(e.target.value), getBoothSizeMm(selectedBooth, dims).depth)}
                                    className={`w-full border rounded px-2 py-2 text-sm text-gray-900 ${selectedBooth.sizeMm ? 'bg-white border-blue-300' : 'bg-gray-50'}`} />
                            </div>
                            <div>
                                <label className="text-xs text-gray-700 block mb-1">奥行 (mm)</label>
                                <input type="number" step={10}
                                    value={getBoothSizeMm(selectedBooth, dims).depth}
                                    onChange={(e) => updateBoothSize(selectedBooth.id, getBoothSizeMm(selectedBooth, dims).width, Number(e.target.value))}
                                    className={`w-full border rounded px-2 py-2 text-sm text-gray-900 ${selectedBooth.sizeMm ? 'bg-white border-blue-300' : 'bg-gray-50'}`} />
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {([
                                { label: '枠線', target: 'stroke' as const },
                                { label: '塗り', target: 'fill'   as const },
                                { label: '文字', target: 'text'   as const },
                            ]).map(({ label, target }) => {
                                const c = resolveBoothColors(selectedBooth, categoryColors);
                                const value = target === 'stroke' ? c.stroke : target === 'fill' ? c.fill : c.text;
                                return (
                                    <div key={target} className="flex flex-col items-center gap-1">
                                        <input type="color" value={value.length === 9 ? value.slice(0, 7) : value}
                                            onChange={(e) => updateSelectedBoothsColor(e.target.value, target)}
                                            className="w-9 h-9 rounded border border-gray-200 cursor-pointer p-0.5" title={label} />
                                        <button onClick={() => resetBoothColor(selectedBooth.id, target)}
                                            className="text-[10px] text-gray-400 active:text-gray-700">{label} ↩</button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={rotateSelectedBooths}
                                className="py-2.5 bg-blue-50 active:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                                ⟳ 90度回転
                            </button>
                            <button onClick={unplaceSelectedBooths}
                                className="py-2.5 bg-amber-50 active:bg-amber-100 text-amber-700 rounded-lg text-sm font-medium">
                                ⇩ 未配置に戻す
                            </button>
                            {selectedBooth.sizeMm && (
                                <button
                                    onClick={() => onBoothsChange(booths.map(b =>
                                        b.id === selectedBooth.id ? { ...b, sizeMm: undefined } : b))}
                                    className="py-2.5 bg-gray-50 active:bg-gray-100 text-gray-600 rounded-lg text-xs font-medium">
                                    基本サイズに戻す
                                </button>
                            )}
                            <button onClick={deleteSelectedBooths}
                                className="py-2.5 bg-red-50 active:bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                                🗑 削除
                            </button>
                        </div>

                        <p className="text-[11px] text-gray-500">
                            基本サイズ: 1.0卓 = {dims.baseTableWidthMm}×{dims.baseTableDepthMm}mm / 1マス {dims.gridUnitMm}mm
                        </p>
                    </div>
                </div>
            )}

            {/* ── 複数選択パネル ────────────────────────────────────────── */}
            {selectedBoothIds.size > 1 && mode === 'booth' && (
                <div className={panelClass}>
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-bold text-amber-700">{selectedBoothIds.size}件を選択中</span>
                        <button onClick={() => { setSelectedBoothIds(new Set()); setSelectedBoothId(null); }}
                            className="w-8 h-8 text-gray-400 active:text-gray-700">✕</button>
                    </div>
                    <div className="flex flex-col gap-2">
                        {/* 整列 */}
                        <div className="border border-gray-200 rounded-lg p-2">
                            <p className="text-[11px] font-semibold text-gray-500 mb-1.5">整列</p>
                            <div className="grid grid-cols-6 gap-1">
                                {([
                                    { kind: 'left'    as AlignKind, label: '⇤', title: '左揃え' },
                                    { kind: 'hcenter' as AlignKind, label: '⇹', title: '左右中央' },
                                    { kind: 'right'   as AlignKind, label: '⇥', title: '右揃え' },
                                    { kind: 'top'     as AlignKind, label: '⤒', title: '上揃え' },
                                    { kind: 'vcenter' as AlignKind, label: '⇳', title: '上下中央' },
                                    { kind: 'bottom'  as AlignKind, label: '⤓', title: '下揃え' },
                                ]).map(({ kind, label, title }) => (
                                    <button key={kind} onClick={() => doAlign(kind)} title={title}
                                        className="h-9 rounded bg-gray-50 active:bg-gray-200 text-gray-700 text-sm">
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <p className="text-[11px] font-semibold text-gray-500 mt-2 mb-1.5">
                                等間隔に分布 <span className="font-normal text-gray-400">(3件以上)</span>
                            </p>
                            <div className="grid grid-cols-2 gap-1">
                                <button onClick={() => doDistribute('h')} disabled={selectedBoothIds.size < 3}
                                    className="h-9 rounded bg-gray-50 active:bg-gray-200 disabled:opacity-40 text-gray-700 text-xs">
                                    横に均等
                                </button>
                                <button onClick={() => doDistribute('v')} disabled={selectedBoothIds.size < 3}
                                    className="h-9 rounded bg-gray-50 active:bg-gray-200 disabled:opacity-40 text-gray-700 text-xs">
                                    縦に均等
                                </button>
                            </div>

                            <p className="text-[11px] font-semibold text-gray-500 mt-2 mb-1.5">
                                隙間を指定して並べ直す
                            </p>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <input type="number" min={0} max={20} value={lineGap}
                                    onChange={(e) => setLineGap(Math.max(0, Number(e.target.value)))}
                                    className="w-14 border rounded px-1 py-1.5 text-xs text-gray-900 text-right" />
                                <span className="text-[11px] text-gray-500 whitespace-nowrap">
                                    マス = {lineGap * dims.gridUnitMm}mm
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                <button onClick={() => doArrange('h')}
                                    className="h-9 rounded bg-blue-50 active:bg-blue-100 text-blue-700 text-xs font-medium">
                                    横に並べる
                                </button>
                                <button onClick={() => doArrange('v')}
                                    className="h-9 rounded bg-blue-50 active:bg-blue-100 text-blue-700 text-xs font-medium">
                                    縦に並べる
                                </button>
                            </div>
                        </div>

                        <button onClick={rotateSelectedBooths}
                            className="w-full py-2.5 bg-blue-50 active:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                            ⟳ まとめて90度回転
                        </button>
                        <div className="flex items-center gap-3 justify-center py-1">
                            <input type="color" defaultValue="#cccccc" onChange={(e) => updateSelectedBoothsColor(e.target.value, 'stroke')}
                                className="w-9 h-9 rounded border border-gray-300 cursor-pointer p-0.5" title="一括 枠線色" />
                            <input type="color" defaultValue="#ffffff" onChange={(e) => updateSelectedBoothsColor(e.target.value, 'fill')}
                                className="w-9 h-9 rounded border border-gray-300 cursor-pointer p-0.5" title="一括 塗り色" />
                            <input type="color" defaultValue="#333333" onChange={(e) => updateSelectedBoothsColor(e.target.value, 'text')}
                                className="w-9 h-9 rounded border border-gray-300 cursor-pointer p-0.5" title="一括 文字色" />
                        </div>
                        <button onClick={unplaceSelectedBooths}
                            className="w-full py-2.5 bg-amber-50 active:bg-amber-100 text-amber-700 rounded-lg text-sm font-medium">
                            ⇩ まとめて未配置に戻す
                        </button>
                        <button onClick={deleteSelectedBooths}
                            className="w-full py-2.5 bg-red-50 active:bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                            🗑 まとめて削除
                        </button>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2 text-center">ドラッグで移動 / 矢印キーで微調整</p>
                </div>
            )}

            {/* ── 未配置トレイ ──────────────────────────────────────────── */}
            {mode === 'booth' && unplacedBooths.length > 0 && selectedBoothIds.size === 0 && (
                <div className="absolute z-30 inset-x-0 bottom-0 lg:inset-x-auto lg:top-16 lg:right-3 lg:bottom-auto lg:w-64">
                    <div className="bg-white/97 backdrop-blur shadow-2xl border-t lg:border lg:rounded-xl border-amber-200 rounded-t-2xl">
                        <button
                            onClick={() => setIsTrayOpen(o => !o)}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-bold text-amber-800"
                        >
                            <span>未配置 {unplacedBooths.length}件</span>
                            <span className={`transition-transform ${isTrayOpen ? '' : 'rotate-180'}`}>▾</span>
                        </button>
                        {isTrayOpen && (
                            <div className="px-3 pb-3">
                                <p className="text-[11px] text-gray-500 mb-2">タップで画面中央に配置。まとめて並べるなら「自動配置」。</p>
                                <div className="flex flex-wrap gap-1.5 max-h-[28vh] lg:max-h-[45vh] overflow-y-auto">
                                    {unplacedBooths.map(b => (
                                        <button key={b.id}
                                            onClick={() => placeBoothFromTray(b.id)}
                                            className="px-2.5 py-2 rounded-lg border border-amber-200 bg-amber-50 active:bg-amber-100 text-xs text-gray-800 max-w-full truncate"
                                            title={b.name}
                                        >
                                            {b.seatNumber ? `${b.seatNumber} · ` : ''}{b.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── AI解析パネル（会場編集モード） ────────────────────────── */}
            {mode === 'venue' && bgImage && (
                <div className="absolute bottom-3 right-2 z-20 bg-white rounded-xl shadow-lg border border-blue-100 overflow-hidden w-40">
                    <div className="flex border-b border-gray-100">
                        {(['gemini', 'groq'] as const).map(p => (
                            <button key={p} onClick={() => setAiProvider(p)}
                                className={`flex-1 px-2 py-1.5 text-[11px] font-semibold transition ${aiProvider === p ? (p === 'groq' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700') : 'text-gray-400'}`}>
                                {p === 'groq' ? 'Groq' : 'Gemini'}
                            </button>
                        ))}
                    </div>
                    <button
                        className="px-3 py-2.5 w-full text-left active:bg-blue-50"
                        onClick={async () => {
                            const base64 = getBgImageBase64();
                            if (!base64) { alert('下絵の読み込みに失敗しました'); return; }
                            if (!window.confirm('下絵を解析して障害物を追加しますか？')) return;
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
                                alert(`${newObstacles.length}個のオブジェクトを検出しました`);
                            } catch (err: any) {
                                alert(`エラー: ${err.message || 'エラーが発生しました'}`);
                            }
                        }}
                    >
                        <span className="font-bold text-sm text-blue-600">✨ 下絵を解析</span>
                        <span className="block text-[10px] text-gray-400">縮尺調整後に実行</span>
                    </button>
                </div>
            )}

            {/* ── 左下: エクスポート ────────────────────────────────────── */}
            <div className="absolute bottom-3 left-2 z-20 flex gap-2">
                <button onClick={() => { clearSelection(); setPendingExport('png'); }}
                    disabled={pendingExport !== null}
                    className="px-3 py-2.5 bg-emerald-600 active:bg-emerald-700 disabled:opacity-60 text-white rounded-xl shadow-lg text-xs font-semibold"
                    title="レイアウト全体を高画質 PNG で保存">PNG保存</button>
                <button onClick={() => { clearSelection(); setPendingExport('svg'); }}
                    disabled={pendingExport !== null}
                    className="px-3 py-2.5 bg-indigo-600 active:bg-indigo-700 disabled:opacity-60 text-white rounded-xl shadow-lg text-xs font-semibold"
                    title="レイアウト全体をベクター (SVG) で保存">SVG保存</button>
            </div>

            {/* ── 操作ヒント ────────────────────────────────────────────── */}
            {(mode === 'venue' || isSpacePanning || activeTool === 'text') && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/70 text-white px-3 py-1.5 rounded-full text-xs pointer-events-none z-20 whitespace-nowrap">
                    {isSpacePanning ? 'ドラッグで画面移動'
                        : isCalibrating ? (calibrationPoints.length === 0 ? '始点をクリック' : '終点をクリック')
                        : isBgEditing ? '下絵を調整中：グリッドに合わせてください'
                        : activeTool === 'text' ? 'キャンバスをタップしてテキストを追加'
                        : activeTool !== 'none' ? 'ドラッグでなぞると連続配置'
                        : '移動モード'}
                </div>
            )}

            {/* ── Canvas ────────────────────────────────────────────────── */}
            <div className="flex-grow overflow-hidden" style={{ cursor }}>
                <Stage
                    ref={stageRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    draggable={stageDraggable}
                    dragDistance={4}
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
                    style={{ background: '#e8ecf1' }}
                >
                    <Layer>
                        {/* エクスポート時だけ表示する白背景 */}
                        <Rect ref={exportBgRef} visible={false} fill="#ffffff" listening={false} />

                        {/* 会場（白地） */}
                        <Rect
                            x={0} y={0}
                            width={venueCols * GRID_SIZE}
                            height={venueRows * GRID_SIZE}
                            fill="#ffffff"
                            listening={false}
                        />

                        {/* 下絵（グリッドの下） */}
                        {bgImage && (
                            <React.Fragment>
                                <KonvaImage
                                    image={bgImage}
                                    ref={bgNodeRef}
                                    x={bgConfig.x} y={bgConfig.y}
                                    scaleX={bgConfig.scaleX} scaleY={bgConfig.scaleY}
                                    rotation={bgConfig.rotation}
                                    opacity={bgConfig.opacity}
                                    visible={isBgVisible}
                                    draggable={isBgEditing}
                                    onDragEnd={handleBgDragEnd}
                                    onTransformEnd={handleBgTransformEnd}
                                />
                                {isBgEditing && (
                                    <Transformer ref={bgTrRef} anchorSize={18} anchorCornerRadius={9}
                                        boundBoxFunc={(oldBox, newBox) =>
                                            (newBox.width < 5 || newBox.height < 5) ? oldBox : newBox} />
                                )}
                            </React.Fragment>
                        )}

                        {/* グリッド線（PNG出力時は非表示） */}
                        <Group ref={gridGroupRef} listening={false}>{gridLines}</Group>

                        {/* 会場の外周 */}
                        <Rect
                            x={0} y={0}
                            width={venueCols * GRID_SIZE}
                            height={venueRows * GRID_SIZE}
                            stroke="#334155"
                            strokeWidth={3}
                            listening={false}
                        />
                    </Layer>

                    <Layer>
                        {obstacles.map(obs => (
                            <ObstacleComponent
                                key={obs.id}
                                data={obs}
                                gridPixelSize={GRID_SIZE}
                                isSelected={selectedObstacleId === obs.id}
                                isEditable={mode === 'venue' && activeTool === 'none' && !isBgEditing && !isSpacePanning}
                                onSelect={() => { if (mode === 'venue' && activeTool === 'none' && !isBgEditing) setSelectedObstacleId(obs.id); }}
                                onChange={handleObstacleChange}
                            />
                        ))}
                        {previewRect && (
                            <Rect
                                x={previewRect.x * GRID_SIZE} y={previewRect.y * GRID_SIZE}
                                width={previewRect.w * GRID_SIZE} height={previewRect.h * GRID_SIZE}
                                fill="transparent" stroke={obstacleColor} strokeWidth={obstacleStrokeWidth}
                                opacity={0.7} dash={[4, 4]}
                            />
                        )}
                    </Layer>

                    <Layer ref={boothLayerRef} opacity={mode === 'venue' ? 0.5 : 1} listening={mode === 'booth'}>
                        {dragSelect && mode === 'booth' && (
                            <Rect
                                x={Math.min(dragSelect.startX, dragSelect.endX)}
                                y={Math.min(dragSelect.startY, dragSelect.endY)}
                                width={Math.abs(dragSelect.endX - dragSelect.startX)}
                                height={Math.abs(dragSelect.endY - dragSelect.startY)}
                                fill="rgba(59, 130, 246, 0.08)"
                                stroke="#3b82f6" strokeWidth={1.5} dash={[6, 4]} listening={false}
                            />
                        )}
                        {placedBooths.map(booth => (
                            <BoothUnit
                                key={booth.id}
                                data={booth}
                                gridPixelSize={GRID_SIZE}
                                dimensions={dims}
                                fontSize={seatFontSize}
                                isSelected={selectedBoothIds.has(booth.id)}
                                isColliding={problemBoothIds.has(booth.id)}
                                categoryColors={categoryColors}
                                draggable={mode === 'booth' && !isSpacePanning}
                                onClick={(e) => handleBoothClick(e, booth.id)}
                                onDragStart={(e) => handleDragStartBooth(e, booth.id)}
                                onDragMove={(e) => handleDragMoveBooth(e, booth.id)}
                                onDragEnd={(e) => handleDragEndBooth(e, booth.id)}
                                onTransformEnd={selectedBoothId === booth.id ? handleBoothTransformEnd : undefined}
                            />
                        ))}
                        {/* スナップ補助線 */}
                        <Line ref={guideVRef} visible={false} points={[]} stroke="#ec4899"
                            strokeWidth={1} dash={[4, 4]} listening={false} perfectDrawEnabled={false} />
                        <Line ref={guideHRef} visible={false} points={[]} stroke="#ec4899"
                            strokeWidth={1} dash={[4, 4]} listening={false} perfectDrawEnabled={false} />
                        <Transformer
                            ref={boothTrRef}
                            rotateEnabled={false}
                            keepRatio={false}
                            anchorSize={16}
                            anchorCornerRadius={5}
                            borderStroke="#f59e0b"
                            borderStrokeWidth={2}
                            anchorStroke="#d97706"
                            anchorFill="#fef3c7"
                            boundBoxFunc={(oldBox, newBox) =>
                                (Math.abs(newBox.width) < GRID_SIZE || Math.abs(newBox.height) < GRID_SIZE)
                                    ? oldBox : newBox}
                        />
                    </Layer>

                    <Layer>
                        {textLabels.map(label => (
                            <TextLabelComponent
                                key={label.id}
                                data={label}
                                isSelected={selectedTextId === label.id}
                                isEditable={!isSpacePanning}
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
