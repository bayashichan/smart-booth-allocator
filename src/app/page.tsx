'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Booth,
  Obstacle,
  TextLabel,
  SaveFile,
  DimensionSettings,
  CategoryColorMap,
  DEFAULT_DIMENSIONS,
} from '@/types/layout';
import {
  fetchSheet,
  guessMapping,
  buildBooths,
  mergeBooths,
  MAPPING_FIELDS,
  UNUSED_COLUMN,
  type ColumnMapping,
  type ImportMode,
  type SheetData,
} from '@/utils/csvParser';
import { autoLayout } from '@/utils/layoutAlgorithm';
import NumberField from '@/components/NumberField';

/** 大きな配列でも落ちないよう分割して base64 化する */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function encodeLayout(data: SaveFile): Promise<string> {
  const json = JSON.stringify(data);
  if (typeof CompressionStream !== 'undefined') {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(new TextEncoder().encode(json));
    writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return bytesToBase64(new Uint8Array(buf));
  }
  return btoa(encodeURIComponent(json));
}

async function decodeLayout(encoded: string): Promise<SaveFile> {
  // URLSearchParams は + をスペースにデコードするため、元の + に戻す
  const fixed = encoded.replace(/ /g, '+');
  const binary = atob(fixed);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (typeof DecompressionStream !== 'undefined' && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  return JSON.parse(decodeURIComponent(atob(fixed)));
}

const CanvasArea = dynamic(() => import('@/components/CanvasArea'), {
  ssr: false,
  loading: () => <div className="p-10 text-center text-gray-500">エディタを読み込み中...</div>,
});

const MAX_HISTORY  = 100;
const STORAGE_KEY  = 'sba:autosave:v2';
// これを超えたら共有用の短縮ID保存に切り替える（URL長の実用上限）
const MAX_DATA_URL_LEN = 6000;

type Snapshot = {
  booths: Booth[];
  obstacles: Obstacle[];
  textLabels: TextLabel[];
  venue: { cols: number; rows: number };
  dims: DimensionSettings;
  categoryColors: CategoryColorMap;
};

type ChangeOptions = { coalesceKey?: string };

export default function Home() {
  const [csvUrl, setCsvUrl]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');

  const [booths, setBooths] = useState<Booth[]>([
    { id: '1', name: 'サンプルA', size: 1.0, category: '物販', preferences: { wall: true },  x: 2, y: 2, rotation: 0, isPlaced: true },
    { id: '2', name: 'サンプルB', size: 2.0, category: '飲食', preferences: { wall: false }, x: 8, y: 2, rotation: 0, isPlaced: true },
  ]);
  const [obstacles,  setObstacles]  = useState<Obstacle[]>([]);
  const [textLabels, setTextLabels] = useState<TextLabel[]>([]);
  const [mode,       setMode]       = useState<'booth' | 'venue'>('booth');

  // 会場サイズ・寸法（アプリ全体の基準値）
  const [layoutCols, setLayoutCols] = useState(50);
  const [layoutRows, setLayoutRows] = useState(50);
  const [dims, setDims] = useState<DimensionSettings>(DEFAULT_DIMENSIONS);
  const [categoryColors, setCategoryColors] = useState<CategoryColorMap>({});
  const [venueInputMode, setVenueInputMode] = useState<'grid' | 'mm'>('grid');

  const [shareUrl, setShareUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [loadInput, setLoadInput] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string>('');

  // スプレッドシート取り込み（列の対応づけダイアログ用）
  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [mapping, setMapping]     = useState<ColumnMapping | null>(null);
  const [importMode, setImportMode]       = useState<ImportMode>('merge');
  const [removeMissing, setRemoveMissing] = useState(true);

  // ─── Undo / Redo ─────────────────────────────────────────────────────────
  const historyRef = useRef<Snapshot[]>([]);
  const redoRef    = useRef<Snapshot[]>([]);
  const stateRef   = useRef<Snapshot>({
    booths, obstacles, textLabels,
    venue: { cols: layoutCols, rows: layoutRows },
    dims, categoryColors,
  });
  const isRestoringRef = useRef(false);
  const lastCoalesceRef = useRef<{ key: string; at: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    stateRef.current = {
      booths, obstacles, textLabels,
      venue: { cols: layoutCols, rows: layoutRows },
      dims, categoryColors,
    };
  }, [booths, obstacles, textLabels, layoutCols, layoutRows, dims, categoryColors]);

  const applySnapshot = (s: Snapshot) => {
    isRestoringRef.current = true;
    setBooths(s.booths);
    setObstacles(s.obstacles);
    setTextLabels(s.textLabels);
    setLayoutCols(s.venue.cols);
    setLayoutRows(s.venue.rows);
    setDims(s.dims);
    setCategoryColors(s.categoryColors);
    isRestoringRef.current = false;
  };

  /**
   * 変更前の状態を履歴に積む。
   * coalesceKey が同じ変更が短時間に連続した場合（カラーピッカーのドラッグ、
   * テキスト入力など）は1つの操作としてまとめ、履歴が埋まらないようにする。
   */
  const snapshot = useCallback((opts?: ChangeOptions) => {
    if (isRestoringRef.current) return;
    const now = Date.now();
    const key = opts?.coalesceKey;
    if (key) {
      const last = lastCoalesceRef.current;
      if (last && last.key === key && now - last.at < 1500) {
        lastCoalesceRef.current = { key, at: now };
        return; // 直前の履歴にまとめる
      }
      lastCoalesceRef.current = { key, at: now };
    } else {
      lastCoalesceRef.current = null;
    }
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), stateRef.current];
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, stateRef.current];
    lastCoalesceRef.current = null;
    applySnapshot(prev);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, stateRef.current];
    lastCoalesceRef.current = null;
    applySnapshot(next);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 入力中は履歴操作を横取りしない
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) handleRedo(); else handleUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // 履歴付き setter（CanvasArea へ渡す）
  const setBoothsH = useCallback((v: Booth[], opts?: ChangeOptions) => {
    snapshot(opts); setBooths(v);
  }, [snapshot]);

  const setObstaclesH = useCallback((v: Obstacle[], opts?: ChangeOptions) => {
    snapshot(opts); setObstacles(v);
  }, [snapshot]);

  const setTextLabelsH = useCallback((v: TextLabel[], opts?: ChangeOptions) => {
    snapshot(opts); setTextLabels(v);
  }, [snapshot]);

  const setCategoryColorsH = useCallback((v: CategoryColorMap) => {
    snapshot({ coalesceKey: 'category-colors' }); setCategoryColors(v);
  }, [snapshot]);

  const buildSaveFile = useCallback((): SaveFile => ({
    version: 2,
    savedAt: new Date().toISOString(),
    booths, obstacles, textLabels,
    venue: { cols: layoutCols, rows: layoutRows },
    dimensions: dims,
    categoryColors,
  }), [booths, obstacles, textLabels, layoutCols, layoutRows, dims, categoryColors]);

  const applySaveFile = useCallback((data: SaveFile) => {
    if (data.booths)     setBooths(data.booths);
    if (data.obstacles)  setObstacles(data.obstacles);
    if (data.textLabels) setTextLabels(data.textLabels);
    if (data.venue) {
      setLayoutCols(data.venue.cols);
      setLayoutRows(data.venue.rows);
    }
    if (data.dimensions)     setDims({ ...DEFAULT_DIMENSIONS, ...data.dimensions });
    if (data.categoryColors) setCategoryColors(data.categoryColors);
  }, []);

  // ─── 起動時: URL パラメータ or 自動保存の復元 ─────────────────────────────
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const params  = new URLSearchParams(window.location.search);
    const encoded = params.get('data');
    const id      = params.get('id');

    if (!encoded && !id) {
      // 共有URLでなければ自動保存から復元
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw) as SaveFile;
          applySaveFile(data);
          setNotice('前回の続きを復元しました');
        }
      } catch {
        /* 壊れた自動保存は無視 */
      }
      return;
    }

    (async () => {
      setLoading(true);
      try {
        let data: SaveFile;
        if (encoded) {
          data = await decodeLayout(encoded);
        } else {
          const res = await fetch(`/api/layouts/${id}`);
          if (!res.ok) throw new Error();
          data = await res.json();
        }
        applySaveFile(data);
      } catch {
        setError('レイアウトデータの読み込みに失敗しました。URLが正しいか確認してください。');
      } finally {
        setLoading(false);
      }
    })();
  }, [applySaveFile]);

  // ─── 自動保存（localStorage） ─────────────────────────────────────────────
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSaveFile()));
        setSavedAt(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
      } catch {
        /* 容量超過などは無視（明示保存で回避してもらう） */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [buildSaveFile]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ─── URL / ID から読み込む ────────────────────────────────────────────────
  const handleLoadFromUrl = async () => {
    const raw = loadInput.trim();
    if (!raw) return;

    setLoading(true);
    setError('');
    try {
      let data: SaveFile;
      let newUrl = '';
      try {
        const parsed  = new URL(raw);
        const encoded = parsed.searchParams.get('data');
        const id      = parsed.searchParams.get('id');
        if (encoded) {
          data = await decodeLayout(encoded);
          newUrl = raw;
        } else if (id) {
          const res = await fetch(`/api/layouts/${id}`);
          if (!res.ok) throw new Error();
          data = await res.json();
          newUrl = `/?id=${id}`;
        } else {
          throw new Error();
        }
      } catch {
        const res = await fetch(`/api/layouts/${raw}`);
        if (!res.ok) throw new Error();
        data = await res.json();
        newUrl = `/?id=${raw}`;
      }
      snapshot();
      applySaveFile(data);
      window.history.pushState({}, '', newUrl);
      setLoadInput('');
      setNotice('レイアウトを読み込みました');
    } catch {
      setError('読み込みに失敗しました。URLまたはIDを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  // ─── スプレッドシート読み込み（取得 → 列の対応づけ → 取り込み） ───────────
  const handleFetchSheet = async () => {
    if (!csvUrl) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchSheet(csvUrl);
      setSheetData(data);
      setMapping(guessMapping(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'スプレッドシートの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const importPreview = sheetData && mapping ? buildBooths(sheetData.rows, mapping) : [];
  // 差分マージの結果はプレビューと取り込みの両方で使う
  const mergePreview = sheetData && mapping && importMode === 'merge'
    ? mergeBooths(booths, importPreview, { removeMissing })
    : null;

  const handleImportSheet = () => {
    if (!sheetData || !mapping) return;
    const imported = buildBooths(sheetData.rows, mapping);
    if (imported.length === 0) {
      setError('取り込める行がありませんでした。「出展者名」か「座席番号」の列を指定してください。');
      return;
    }
    snapshot();
    if (importMode === 'merge') {
      // 既存の配置を保ったまま、シートの内容で更新・追加する
      const result = mergeBooths(booths, imported, { removeMissing });
      setBooths(result.booths);
      const parts = [`更新 ${result.updated}件`, `追加 ${result.added}件`];
      if (result.removed) parts.push(`削除 ${result.removed}件`);
      if (result.kept)    parts.push(`シートに無い ${result.kept}件は据え置き`);
      setNotice(
        `${parts.join(' / ')}。配置済みのブースはそのままです。`
        + (result.added > 0 ? ' 追加分は未配置トレイにあります。' : ''),
      );
    } else {
      // 位置は決めず、すべて「未配置」としてトレイに入れる。
      // 並べるのは「自動配置」かトレイからのタップで行う。
      setBooths(imported);
      setNotice(`${imported.length}件を読み込みました。「自動配置」か未配置トレイから配置してください。`);
    }
    setSheetData(null);
    setMapping(null);
    setIsPanelOpen(false);
  };

  // ─── 自動配置 ─────────────────────────────────────────────────────────────
  const handleAutoLayout = () => {
    snapshot();
    setBooths(autoLayout(booths, layoutRows, layoutCols, dims));
  };

  // ─── AI 自動配置 ──────────────────────────────────────────────────────────
  const handleAiLayout = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booths, obstacles, width: layoutCols, height: layoutRows }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'AI配置に失敗しました');
      }
      const layoutData = await response.json();
      const newBooths = booths.map(b => {
        const ai = layoutData.find((r: { id: string }) => r.id === b.id);
        return ai ? { ...b, x: ai.x, y: ai.y, rotation: ai.rotation || 0, isPlaced: true } : b;
      });
      snapshot();
      setBooths(newBooths);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // ─── 共有URLを作る ────────────────────────────────────────────────────────
  const handleShare = async () => {
    setIsSaving(true);
    setError('');
    try {
      const encoded = await encodeLayout(buildSaveFile());
      const param   = encodeURIComponent(encoded);

      if (param.length <= MAX_DATA_URL_LEN) {
        const path = `/?data=${param}`;
        setShareUrl(`${window.location.origin}${path}`);
        window.history.replaceState({}, '', path);
        return;
      }

      // データが大きい場合は短縮ID保存にフォールバック
      const res = await fetch('/api/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSaveFile()),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.error
            ? `${err.error}（レイアウトが大きく、URLに収まりません）`
            : 'レイアウトが大きすぎて共有URLを作成できませんでした',
        );
      }
      const { id } = await res.json();
      setShareUrl(`${window.location.origin}/?id=${id}`);
      window.history.replaceState({}, '', `/?id=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '共有URLの作成に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('URLをコピーしました');
    } catch {
      setNotice('コピーできませんでした。URLを長押しして選択してください。');
    }
  };

  // 会場サイズ（マス）と寸法(mm)の許容範囲
  const clampCols = (n: number) => Math.min(500, Math.max(1, Math.round(n)));
  const clampMm   = (n: number) => Math.max(10, Math.round(n));

  // mm ⇔ マス 変換は共通の 1マス寸法を使う。
  // 端数は 1マス単位に丸めるため、確定後の値が入力値と一致しないことがある
  // （例: 1マス450mm で 1000mm → 2マス = 900mm）。
  const setVenueWidthMm = (mm: number) => setLayoutCols(clampCols(mm / dims.gridUnitMm));
  const setVenueDepthMm = (mm: number) => setLayoutRows(clampCols(mm / dims.gridUnitMm));

  const unplacedCount = booths.filter(b => b.isPlaced === false).length;

  const actionBtn = 'shrink-0 h-10 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap';

  return (
    <main className="flex flex-col h-[100dvh] bg-gray-100 font-sans overflow-hidden">
      {/* ── ヘッダー ─────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-2 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="hidden sm:block text-base font-bold text-gray-800 shrink-0 pl-1">
            Smart Booth Allocator
          </h1>

          {/* 操作ボタン（横スクロール可） */}
          <div className="flex-1 flex gap-1.5 overflow-x-auto py-0.5">
            <button onClick={handleUndo} disabled={!canUndo} title="元に戻す (Ctrl/⌘+Z)"
              className={`${actionBtn} border ${canUndo ? 'border-gray-300 text-gray-700 active:bg-gray-100' : 'border-gray-200 text-gray-300'}`}>
              ↩ 戻す
            </button>
            <button onClick={handleRedo} disabled={!canRedo} title="やり直す (Ctrl/⌘+Shift+Z)"
              className={`${actionBtn} border ${canRedo ? 'border-gray-300 text-gray-700 active:bg-gray-100' : 'border-gray-200 text-gray-300'}`}>
              ↪ 進む
            </button>
            <button onClick={handleAutoLayout} className={`${actionBtn} bg-purple-600 text-white active:bg-purple-700`}>
              自動配置
            </button>
            <button onClick={handleAiLayout} disabled={loading}
              className={`${actionBtn} bg-gradient-to-r from-indigo-500 to-pink-500 text-white disabled:opacity-60`}>
              ✨ AI配置
            </button>
            <button onClick={handleShare} disabled={isSaving}
              className={`${actionBtn} bg-blue-600 text-white active:bg-blue-700 disabled:opacity-60`}>
              {isSaving ? '作成中...' : '🔗 共有'}
            </button>
          </div>

          {/* 設定は常に見える位置に固定（横スクロールの外） */}
          <button onClick={() => setIsPanelOpen(o => !o)}
            className={`${actionBtn} border relative ${isPanelOpen ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 text-gray-700 active:bg-gray-100'}`}>
            ⚙<span className="hidden sm:inline"> 会場・データ</span>
            {unplacedCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] leading-4 text-center">
                {unplacedCount}
              </span>
            )}
          </button>
        </div>

        {/* 会場・データ設定パネル */}
        {isPanelOpen && (
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-3 max-h-[60vh] overflow-y-auto">
            {/* 会場サイズ */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-600 font-semibold w-20 shrink-0">会場サイズ</span>
              <div className="flex rounded overflow-hidden border border-gray-300 text-xs shrink-0">
                {(['grid', 'mm'] as const).map(m => (
                  <button key={m} onClick={() => setVenueInputMode(m)}
                    className={`px-2 py-1.5 ${venueInputMode === m ? 'bg-gray-700 text-white' : 'bg-white text-gray-600'}`}>
                    {m === 'grid' ? 'マス' : 'mm'}
                  </button>
                ))}
              </div>
              {venueInputMode === 'grid' ? (
                <>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    横
                    <NumberField min={1} max={500} value={layoutCols}
                      onCommit={n => setLayoutCols(clampCols(n))}
                      className="w-16 border rounded px-1 py-1.5 text-right bg-white text-gray-900" />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    縦
                    <NumberField min={1} max={500} value={layoutRows}
                      onCommit={n => setLayoutRows(clampCols(n))}
                      className="w-16 border rounded px-1 py-1.5 text-right bg-white text-gray-900" />
                  </label>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    横
                    <NumberField min={dims.gridUnitMm} step={dims.gridUnitMm} value={layoutCols * dims.gridUnitMm}
                      onCommit={setVenueWidthMm}
                      className="w-24 border rounded px-1 py-1.5 text-right bg-white text-gray-900" />
                    mm
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    縦
                    <NumberField min={dims.gridUnitMm} step={dims.gridUnitMm} value={layoutRows * dims.gridUnitMm}
                      onCommit={setVenueDepthMm}
                      className="w-24 border rounded px-1 py-1.5 text-right bg-white text-gray-900" />
                    mm
                  </label>
                </>
              )}
            </div>

            {/* 寸法設定（自動配置・CSV読込・手動配置すべてで共通） */}
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
              <span className="text-xs text-gray-600 font-semibold w-20 shrink-0">寸法</span>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                1マス
                <NumberField min={10} step={10} value={dims.gridUnitMm}
                  onCommit={n => setDims(d => ({ ...d, gridUnitMm: clampMm(n) }))}
                  className="w-20 border rounded px-1 py-1.5 text-right bg-white text-gray-900" />
                mm
              </label>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                基本卓
                <NumberField min={10} step={10} value={dims.baseTableWidthMm}
                  onCommit={n => setDims(d => ({ ...d, baseTableWidthMm: clampMm(n) }))}
                  className="w-20 border rounded px-1 py-1.5 text-right bg-white text-gray-900" title="幅" />
                ×
                <NumberField min={10} step={10} value={dims.baseTableDepthMm}
                  onCommit={n => setDims(d => ({ ...d, baseTableDepthMm: clampMm(n) }))}
                  className="w-20 border rounded px-1 py-1.5 text-right bg-white text-gray-900" title="奥行" />
                mm
              </label>
            </div>

            {/* スプレッドシート読み込み */}
            <div className="border-t border-gray-200 pt-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-xs text-gray-600 font-semibold w-20 shrink-0">シート読込</span>
                <input type="text" placeholder="スプレッドシートのURLを貼り付け"
                  className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white"
                  value={csvUrl} onChange={(e) => setCsvUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFetchSheet(); }} />
                <button onClick={handleFetchSheet} disabled={loading || !csvUrl}
                  className="h-10 px-4 bg-green-600 text-white rounded active:bg-green-700 disabled:bg-gray-300 text-sm font-bold shrink-0">
                  {loading ? '読込中...' : '読み込む'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mt-1 sm:pl-[5.5rem]">
                通常の共有URL（<code className="bg-gray-100 px-1 rounded">/edit#gid=0</code>）をそのまま貼れます。
                共有設定は「リンクを知っている全員が閲覧可」にしてください。
              </p>
            </div>

            {/* 保存済みレイアウト読み込み */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-t border-gray-200 pt-3">
              <span className="text-xs text-gray-600 font-semibold w-20 shrink-0">共有読込</span>
              <input type="text" placeholder="共有URL または ID"
                className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white"
                value={loadInput} onChange={(e) => setLoadInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLoadFromUrl(); }} />
              <button onClick={handleLoadFromUrl} disabled={loading || !loadInput.trim()}
                className="h-10 px-4 bg-indigo-600 text-white rounded active:bg-indigo-700 disabled:bg-gray-300 text-sm font-bold shrink-0">
                読み込む
              </button>
            </div>

            <p className="text-[11px] text-gray-500 border-t border-gray-200 pt-2">
              変更は自動保存されます{savedAt && `（最終保存 ${savedAt}）`}。
              {unplacedCount > 0 && ` 未配置 ${unplacedCount}件。`}
            </p>
          </div>
        )}

        {(error || notice) && (
          <p className={`text-xs px-1 ${error ? 'text-red-600' : 'text-green-700'}`}>
            {error || notice}
            {error && (
              <button onClick={() => setError('')} className="ml-2 underline text-gray-500">閉じる</button>
            )}
          </p>
        )}
      </header>

      {/* ── 列の対応づけダイアログ ──────────────────────────────────── */}
      {sheetData && mapping && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col max-h-[92dvh]">
            <div className="px-4 py-3 border-b border-gray-200 shrink-0">
              <h3 className="text-base font-bold text-gray-800">列の対応づけ</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {sheetData.rows.length}行 / {sheetData.columns.length}列を検出しました。
                どの列を使うか確認してください。
              </p>
            </div>

            <div className="px-4 py-3 overflow-y-auto space-y-2.5">
              {MAPPING_FIELDS.map(({ key, label, hint }) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="w-24 shrink-0">
                    <span className="text-xs font-medium text-gray-700 block">{label}</span>
                    <span className="text-[10px] text-gray-400 block leading-tight">{hint}</span>
                  </div>
                  <select
                    value={mapping[key]}
                    onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}
                    className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-2 text-sm text-gray-900 bg-white"
                  >
                    <option value={UNUSED_COLUMN}>— 使わない —</option>
                    {sheetData.columns.map(c => (
                      <option key={c.index} value={c.index}>
                        {c.letter}列{c.header ? `: ${c.header}` : '（見出しなし）'}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {/* 取り込み方法 */}
              <div className="border-t border-gray-200 pt-2.5">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">取り込み方法</p>
                <div className="space-y-1.5">
                  {([
                    { value: 'merge',   label: '配置を保って更新',   hint: '座席番号（無ければ出展者名）で照合し、配置済みの位置はそのまま。新しい行だけ未配置で追加します。' },
                    { value: 'replace', label: 'すべて置き換える', hint: '現在のブースを破棄してシートの内容だけにします。配置は全部やり直しです。' },
                  ] as const).map(opt => (
                    <label key={opt.value}
                      className={`flex gap-2 items-start border rounded p-2 cursor-pointer ${
                        importMode === opt.value ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
                      <input type="radio" name="import-mode" className="mt-0.5 shrink-0"
                        checked={importMode === opt.value}
                        onChange={() => setImportMode(opt.value)} />
                      <span className="min-w-0">
                        <span className="text-xs font-medium text-gray-800 block">{opt.label}</span>
                        <span className="text-[10px] text-gray-500 block leading-tight">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {importMode === 'merge' && (
                  <label className="flex gap-2 items-center mt-1.5 pl-1">
                    <input type="checkbox" checked={removeMissing}
                      onChange={(e) => setRemoveMissing(e.target.checked)} />
                    <span className="text-[11px] text-gray-600">
                      シートに無いブースを削除する（外すとそのまま残ります）
                    </span>
                  </label>
                )}
              </div>

              {/* プレビュー */}
              <div className="border-t border-gray-200 pt-2.5">
                <p className="text-xs font-semibold text-gray-600 mb-1">
                  取り込みプレビュー（{importPreview.length}件）
                </p>
                {mergePreview && importPreview.length > 0 && (
                  <p className="text-[11px] text-gray-600 mb-1">
                    更新 {mergePreview.updated}件 / 追加 {mergePreview.added}件
                    {mergePreview.removed > 0 && ` / 削除 ${mergePreview.removed}件`}
                    {mergePreview.kept > 0 && ` / 据え置き ${mergePreview.kept}件`}
                  </p>
                )}
                {importPreview.length === 0 ? (
                  <p className="text-xs text-red-600">
                    取り込める行がありません。「出展者名」か「座席番号」の列を指定してください。
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded">
                    <table className="text-[11px] w-full">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          {mergePreview && <th className="px-2 py-1 text-left font-medium">状態</th>}
                          <th className="px-2 py-1 text-left font-medium">座席</th>
                          <th className="px-2 py-1 text-left font-medium">出展者</th>
                          <th className="px-2 py-1 text-left font-medium">サイズ</th>
                          <th className="px-2 py-1 text-left font-medium">カテゴリ</th>
                          <th className="px-2 py-1 text-left font-medium">壁側</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-800">
                        {importPreview.slice(0, 4).map((b, i) => (
                          <tr key={b.id} className="border-t border-gray-100">
                            {mergePreview && (
                              <td className={`px-2 py-1 whitespace-nowrap ${
                                mergePreview.status[i] === 'added' ? 'text-green-700' : 'text-gray-500'}`}>
                                {mergePreview.status[i] === 'added' ? '追加' : '更新'}
                              </td>
                            )}
                            <td className="px-2 py-1 whitespace-nowrap">{b.seatNumber ?? '—'}</td>
                            <td className="px-2 py-1 max-w-[10rem] truncate">{b.name}</td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {b.sizeMm ? `${b.sizeMm.width}×${b.sizeMm.depth}` : `${b.size}卓`}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">{b.category}</td>
                            <td className="px-2 py-1">{b.preferences.wall ? '○' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex gap-2 shrink-0">
              <button onClick={handleImportSheet} disabled={importPreview.length === 0}
                className="flex-1 h-11 bg-green-600 text-white rounded active:bg-green-700 disabled:bg-gray-300 text-sm font-bold">
                {importPreview.length}件を{mergePreview ? '反映' : '取り込む'}
              </button>
              <button onClick={() => { setSheetData(null); setMapping(null); }}
                className="h-11 px-4 text-sm text-gray-600 border border-gray-300 rounded active:bg-gray-100">
                キャンセル
              </button>
            </div>
            <p className="px-4 pb-3 text-[11px] text-gray-500 shrink-0">
              {importMode === 'merge'
                ? '※ 配置済みのブースの位置と色はそのまま残ります'
                : '※ 取り込むと現在のブースは置き換わります'}
            </p>
          </div>
        </div>
      )}

      {/* ── 共有URL モーダル ─────────────────────────────────────────── */}
      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-md flex flex-col gap-3">
            <h3 className="text-lg font-bold text-gray-800">🔗 共有URLを作成しました</h3>
            <p className="text-sm text-gray-600">このURLを開くと同じレイアウトが表示されます。</p>
            <input type="text" readOnly value={shareUrl}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-gray-50 text-gray-800"
              onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <button onClick={copyShareUrl}
                className="flex-1 h-11 bg-blue-600 text-white rounded active:bg-blue-700 text-sm font-bold">
                コピー
              </button>
              <button onClick={() => setShareUrl('')}
                className="h-11 px-4 text-sm text-gray-600 border border-gray-300 rounded active:bg-gray-100">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── キャンバス（残り全部） ───────────────────────────────────── */}
      <div className="flex-1 min-h-0 w-full bg-white relative touch-none">
        <CanvasArea
          booths={booths}
          onBoothsChange={setBoothsH}
          obstacles={obstacles}
          onObstaclesChange={setObstaclesH}
          textLabels={textLabels}
          onTextLabelsChange={setTextLabelsH}
          mode={mode}
          onModeChange={setMode}
          venueCols={layoutCols}
          venueRows={layoutRows}
          dims={dims}
          categoryColors={categoryColors}
          onCategoryColorsChange={setCategoryColorsH}
        />
      </div>
    </main>
  );
}
