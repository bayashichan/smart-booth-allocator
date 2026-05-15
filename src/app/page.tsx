'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Booth, Obstacle, TextLabel, SaveFile } from '@/types/layout';
import { fetchAndParseSheet } from '@/utils/csvParser';
import { autoLayout } from '@/utils/layoutAlgorithm';

async function encodeLayout(data: SaveFile): Promise<string> {
  const json = JSON.stringify(data);
  if (typeof CompressionStream !== 'undefined') {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(new TextEncoder().encode(json));
    writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
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

const GRID_UNIT_MM = 450;
const MAX_HISTORY  = 50;

type Snapshot = { booths: Booth[]; obstacles: Obstacle[]; textLabels: TextLabel[] };

export default function Home() {
  const [csvUrl, setCsvUrl]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [booths,     setBooths]     = useState<Booth[]>([
    { id: '1', name: 'サンプルA', size: 1.0, category: '物販', preferences: { wall: true },  x: 1, y: 1, rotation: 0, isPlaced: true },
    { id: '2', name: 'サンプルB', size: 2.0, category: '飲食', preferences: { wall: false }, x: 6, y: 1, rotation: 0, isPlaced: true },
  ]);
  const [obstacles,   setObstacles]   = useState<Obstacle[]>([]);
  const [textLabels,  setTextLabels]  = useState<TextLabel[]>([]);
  const [mode,        setMode]        = useState<'booth' | 'venue'>('booth');

  // 会場サイズ
  const [layoutCols,     setLayoutCols]     = useState(50);
  const [layoutRows,     setLayoutRows]     = useState(50);
  const [venueInputMode, setVenueInputMode] = useState<'grid' | 'mm'>('grid');
  const handleVenueWidthMm = (mm: number) => setLayoutCols(Math.max(1, Math.round(mm / GRID_UNIT_MM)));
  const handleVenueDepthMm = (mm: number) => setLayoutRows(Math.max(1, Math.round(mm / GRID_UNIT_MM)));

  const [shareUrl,     setShareUrl]     = useState('');
  const [isSaving,     setIsSaving]     = useState(false);
  const [loadInput,    setLoadInput]    = useState('');
  const [headerOpen,   setHeaderOpen]   = useState(false); // モバイル: 詳細ヘッダー開閉

  // ─── Undo ────────────────────────────────────────────────────────────────
  const historyRef   = useRef<Snapshot[]>([]);
  const boothsRef    = useRef(booths);
  const obstaclesRef = useRef(obstacles);
  const labelsRef    = useRef(textLabels);
  const isUndoingRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => { boothsRef.current    = booths;     }, [booths]);
  useEffect(() => { obstaclesRef.current = obstacles;  }, [obstacles]);
  useEffect(() => { labelsRef.current    = textLabels; }, [textLabels]);

  const snapshot = useCallback(() => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { booths: boothsRef.current, obstacles: obstaclesRef.current, textLabels: labelsRef.current },
    ];
    setCanUndo(true);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    isUndoingRef.current = true;
    setBooths(prev.booths);
    setObstacles(prev.obstacles);
    setTextLabels(prev.textLabels);
    isUndoingRef.current = false;
    setCanUndo(historyRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo]);

  // 履歴付き setter（CanvasArea へ渡す）
  const setBoothsH = useCallback((v: Booth[]) => {
    if (!isUndoingRef.current) snapshot();
    setBooths(v);
  }, [snapshot]);

  const setObstaclesH = useCallback((v: Obstacle[]) => {
    if (!isUndoingRef.current) snapshot();
    setObstacles(v);
  }, [snapshot]);

  const setTextLabelsH = useCallback((v: TextLabel[]) => {
    if (!isUndoingRef.current) snapshot();
    setTextLabels(v);
  }, [snapshot]);

  // ─── 起動時 URL パラメータ読み込み ───────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('data');
    const id = params.get('id');
    if (!encoded && !id) return;
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
        if (data.booths)     setBooths(data.booths);
        if (data.obstacles)  setObstacles(data.obstacles);
        if (data.textLabels) setTextLabels(data.textLabels);
      } catch {
        setError('レイアウトデータの読み込みに失敗しました。URLが正しいか確認してください。');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        const parsed = new URL(raw);
        const encoded = parsed.searchParams.get('data');
        const id = parsed.searchParams.get('id');
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
        // 素のIDとして試みる
        const res = await fetch(`/api/layouts/${raw}`);
        if (!res.ok) throw new Error();
        data = await res.json();
        newUrl = `/?id=${raw}`;
      }
      snapshot();
      if (data.booths)     setBooths(data.booths);
      if (data.obstacles)  setObstacles(data.obstacles);
      if (data.textLabels) setTextLabels(data.textLabels);
      window.history.pushState({}, '', newUrl);
      setLoadInput('');
    } catch {
      setError('読み込みに失敗しました。URLまたはIDを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  // ─── CSV 読み込み ─────────────────────────────────────────────────────────
  const handleLoadData = async () => {
    if (!csvUrl) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchAndParseSheet(csvUrl);

      const BASE_WIDTH_MM = 1800;
      const BASE_DEPTH_MM = 900;
      const GRID_COLS     = 80;
      const placed: { x: number; y: number; w: number; h: number }[] = [];

      const isColliding = (x: number, y: number, w: number, h: number) =>
        placed.some(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);

      const findFreePos = (w: number, h: number) => {
        for (let row = 0; row < 200; row++)
          for (let col = 0; col + w <= GRID_COLS; col++)
            if (!isColliding(col, row, w, h)) return { x: col, y: row };
        return { x: 0, y: 0 };
      };

      const initialData = data.map((b) => {
        const widthMm = b.sizeMm ? b.sizeMm.width : b.size * BASE_WIDTH_MM;
        const depthMm = b.sizeMm ? b.sizeMm.depth : BASE_DEPTH_MM;
        const w = Math.max(1, Math.round(widthMm / GRID_UNIT_MM));
        const h = Math.max(1, Math.round(depthMm / GRID_UNIT_MM));
        const pos = findFreePos(w, h);
        placed.push({ ...pos, w, h });
        return { ...b, x: pos.x, y: pos.y, isPlaced: false };
      });

      snapshot();
      setBooths(initialData);
    } catch {
      setError('データの読み込みに失敗しました。URLを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  // ─── 自動配置 ─────────────────────────────────────────────────────────────
  const handleAutoLayout = () => {
    snapshot();
    setBooths(autoLayout(booths, layoutRows, layoutCols));
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
      if (!response.ok) throw new Error('AI配置に失敗しました');

      const layoutData = await response.json();
      const newBooths = booths.map(b => {
        const ai = layoutData.find((r: any) => r.id === b.id);
        return ai ? { ...b, x: ai.x, y: ai.y, rotation: ai.rotation || 0, isPlaced: true } : b;
      });
      snapshot();
      setBooths(newBooths);
    } catch (err: any) {
      setError(err.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // ─── クラウド保存（URLエンコード方式） ───────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    const saveData: SaveFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      booths,
      obstacles,
      textLabels,
    };
    try {
      const encoded = await encodeLayout(saveData);
      const url = `${window.location.origin}/?data=${encodeURIComponent(encoded)}`;
      setShareUrl(url);
      window.history.pushState({}, '', `/?data=${encodeURIComponent(encoded)}`);
    } catch (err: any) {
      setError(err.message || 'クラウド保存中にエラーが発生しました');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── UI ──────────────────────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col p-2 lg:p-4 bg-gray-50 font-sans">
      <header className="mb-4 space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-gray-800">Smart Booth Allocator</h1>
            <p className="text-xs lg:text-sm text-gray-500">ブースをドラッグして移動できます</p>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-2 w-full lg:w-auto">

            {/* 会場サイズ */}
            <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5 rounded shadow-sm text-sm border border-gray-200 w-full lg:w-auto justify-between lg:justify-start">
              <span className="text-gray-600 font-medium whitespace-nowrap">会場サイズ:</span>
              <div className="flex rounded overflow-hidden border border-gray-300 text-xs">
                <button onClick={() => setVenueInputMode('grid')} className={`px-2 py-0.5 transition ${venueInputMode === 'grid' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>マス</button>
                <button onClick={() => setVenueInputMode('mm')}   className={`px-2 py-0.5 transition ${venueInputMode === 'mm'   ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>mm</button>
              </div>
              {venueInputMode === 'grid' ? (
                <div className="flex gap-2">
                  <label className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">横</span>
                    <input type="number" min={1} max={500} step={1} value={layoutCols} onChange={e => setLayoutCols(Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 text-right bg-white" />
                    <span className="text-gray-400 text-xs">マス</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">縦</span>
                    <input type="number" min={1} max={500} step={1} value={layoutRows} onChange={e => setLayoutRows(Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 text-right bg-white" />
                    <span className="text-gray-400 text-xs">マス</span>
                  </label>
                </div>
              ) : (
                <div className="flex gap-2">
                  <label className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">横</span>
                    <input type="number" min={450} max={225000} step={450} value={layoutCols * GRID_UNIT_MM} onChange={e => handleVenueWidthMm(Number(e.target.value))} className="w-20 border rounded px-1 py-0.5 text-right bg-white" />
                    <span className="text-gray-400 text-xs">mm</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">縦</span>
                    <input type="number" min={450} max={225000} step={450} value={layoutRows * GRID_UNIT_MM} onChange={e => handleVenueDepthMm(Number(e.target.value))} className="w-20 border rounded px-1 py-0.5 text-right bg-white" />
                    <span className="text-gray-400 text-xs">mm</span>
                  </label>
                </div>
              )}
            </div>

            {/* アクションボタン群 */}
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              {/* アンドゥ */}
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                title="元に戻す (⌘Z)"
                className={`flex-1 lg:flex-none px-3 py-2 rounded border transition text-sm flex items-center justify-center gap-1 ${canUndo ? 'border-gray-400 text-gray-700 bg-white hover:bg-gray-100' : 'border-gray-200 text-gray-300 bg-white cursor-not-allowed'}`}
              >
                ↩ 元に戻す
              </button>
              <button onClick={handleAutoLayout} className="flex-1 lg:flex-none px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition text-sm">
                自動配置
              </button>
              <button onClick={handleAiLayout} className="flex-1 lg:flex-none px-3 py-2 bg-gradient-to-r from-indigo-500 to-pink-500 text-white rounded shadow-md hover:opacity-90 transition flex items-center justify-center gap-1 text-sm whitespace-nowrap">
                ✨ AI自動配置
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`flex-1 lg:flex-none px-3 py-2 rounded transition text-sm flex items-center justify-center gap-1 ${isSaving ? 'bg-blue-400 text-white cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {isSaving ? '保存中...' : '🔗 クラウド保存'}
              </button>
            </div>
          </div>
        </div>

        {/* データインポート行（モバイルでは折りたたみ） */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setHeaderOpen(o => !o)}
            className="lg:hidden text-xs text-gray-500 flex items-center gap-1 self-start px-2 py-1 bg-white rounded border border-gray-200 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3 h-3 transition-transform ${headerOpen ? 'rotate-180' : ''}`}><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
            {headerOpen ? 'CSV・読込を閉じる' : 'CSV・読込を開く'}
          </button>
          <div className={`flex flex-col gap-2 ${headerOpen ? 'flex' : 'hidden'} lg:flex`}>
          {/* CSV 読み込み */}
          <div className="bg-white p-3 lg:p-4 rounded shadow flex flex-col lg:flex-row items-stretch lg:items-center gap-2 lg:gap-4">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">CSV 読込:</span>
            <input
              type="text"
              placeholder="Google Sheets CSV URL"
              className="flex-grow border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 bg-white"
              value={csvUrl}
              onChange={(e) => setCsvUrl(e.target.value)}
            />
            <button
              onClick={handleLoadData}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 text-sm font-bold shadow-sm transition whitespace-nowrap"
            >
              {loading ? '読込中...' : 'ロード'}
            </button>
          </div>

          {/* 保存済みレイアウト読み込み */}
          <div className="bg-white p-3 lg:p-4 rounded shadow flex flex-col lg:flex-row items-stretch lg:items-center gap-2 lg:gap-4">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">レイアウト読込:</span>
            <input
              type="text"
              placeholder="共有URL または ID を貼り付け"
              className="flex-grow border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 bg-white"
              value={loadInput}
              onChange={(e) => setLoadInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoadFromUrl(); }}
            />
            <button
              onClick={handleLoadFromUrl}
              disabled={loading || !loadInput.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400 text-sm font-bold shadow-sm transition whitespace-nowrap"
            >
              読み込む
            </button>
          </div>
          </div>{/* end collapsible */}
        </div>

        {error && <p className="text-red-500 text-sm px-1">{error}</p>}
      </header>

      {/* 共有URL モーダル */}
      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-800">🎉 クラウドに保存しました</h3>
            <p className="text-sm text-gray-600">以下のURLをチームメンバーと共有してください。</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-gray-50 text-gray-800"
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(shareUrl); alert('クリップボードにコピーしました！'); }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-bold shadow-sm whitespace-nowrap"
              >
                コピー
              </button>
            </div>
            <button onClick={() => setShareUrl('')} className="mt-2 text-sm text-gray-500 hover:text-gray-800 underline text-center">
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="flex-grow w-full h-[70vh] lg:h-[78vh] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative touch-none">
        <CanvasArea
          booths={booths}
          onBoothsChange={setBoothsH}
          obstacles={obstacles}
          onObstaclesChange={setObstaclesH}
          textLabels={textLabels}
          onTextLabelsChange={setTextLabelsH}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </main>
  );
}
