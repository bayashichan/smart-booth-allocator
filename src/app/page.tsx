'use client';

import React, { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Booth, Obstacle, TextLabel, SaveFile } from '@/types/layout';
import { fetchAndParseSheet } from '@/utils/csvParser';
import { autoLayout } from '@/utils/layoutAlgorithm';

const CanvasArea = dynamic(() => import('@/components/CanvasArea'), {
  ssr: false,
  loading: () => <div className="p-10 text-center text-gray-500">エディタを読み込み中...</div>,
});

export default function Home() {
  const [csvUrl, setCsvUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // State
  const [booths, setBooths] = useState<Booth[]>([
    { id: '1', name: 'サンプルA', size: 1.0, category: '物販', preferences: { wall: true }, x: 1, y: 1, rotation: 0, isPlaced: true },
    { id: '2', name: 'サンプルB', size: 2.0, category: '飲食', preferences: { wall: false }, x: 6, y: 1, rotation: 0, isPlaced: true },
  ]);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [textLabels, setTextLabels] = useState<TextLabel[]>([]);
  const [mode, setMode] = useState<'booth' | 'venue'>('booth');
  
  // 会場サイズ（自動配置用）
  const [layoutCols, setLayoutCols] = useState(50);
  const [layoutRows, setLayoutRows] = useState(50);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadData = async () => {
    if (!csvUrl) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchAndParseSheet(csvUrl);

      // 重ならないように左→右→折り返しでグリッドパッキング配置
      const GRID_UNIT_MM  = 450;  // 1マスのmm（CanvasAreaと合わせる）
      const BASE_WIDTH_MM = 1800; // 基本卓の幅mm
      const BASE_DEPTH_MM = 450;  // 基本卓の奥行mm
      const GRID_COLS     = 80;   // 最大列数

      const placed: { x: number; y: number; w: number; h: number }[] = [];

      const isColliding = (x: number, y: number, w: number, h: number) =>
        placed.some(r =>
          x < r.x + r.w && x + w > r.x &&
          y < r.y + r.h && y + h > r.y
        );

      const findFreePos = (w: number, h: number) => {
        for (let row = 0; row < 200; row++) {
          for (let col = 0; col + w <= GRID_COLS; col++) {
            if (!isColliding(col, row, w, h)) return { x: col, y: row };
          }
        }
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

      setBooths(initialData);
    } catch (err) {
      console.error(err);
      setError('データの読み込みに失敗しました。URLを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLayout = () => {
    const layoutedBooths = autoLayout(booths, layoutRows, layoutCols);
    setBooths(layoutedBooths);
  };

  const handleAiLayout = async () => {
    setLoading(true);
    setError('');
    try {
      // 障害物データも含めてAPIへ送信
      const response = await fetch('/api/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booths: booths,
          obstacles: obstacles, // 現在の障害物配置を送信
          width: layoutCols,
          height: layoutRows
        }),
      });

      if (!response.ok) {
        throw new Error('AI配置に失敗しました');
      }

      const layoutData = await response.json();

      const newBooths = booths.map(b => {
        const aiResult = layoutData.find((res: any) => res.id === b.id);
        if (aiResult) {
          return { ...b, x: aiResult.x, y: aiResult.y, rotation: aiResult.rotation || 0, isPlaced: true };
        }
        return b;
      });

      setBooths(newBooths);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // === 保存処理 ===
  const handleSave = () => {
    const saveData: SaveFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      booths,
      obstacles,
      textLabels,
    };
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `booth-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // === 読み込み処理 ===
  const handleLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const data: SaveFile = JSON.parse(json);
        if (data.booths) setBooths(data.booths);
        if (data.obstacles) setObstacles(data.obstacles);
        if (data.textLabels) setTextLabels(data.textLabels);
      } catch (err) {
        console.error('Failed to parse JSON', err);
        setError('ファイルの読み込みに失敗しました。正しいJSONファイルを選択してください。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <main className="flex min-h-screen flex-col p-2 lg:p-4 bg-gray-50 font-sans">
      <header className="mb-4 space-y-4">
        {/* レスポンシブヘッダー */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-gray-800">Smart Booth Allocator</h1>
            <p className="text-xs lg:text-sm text-gray-500">ブースをドラッグして移動できます</p>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-2 w-full lg:w-auto">
            {/* 会場サイズ指定UI */}
            <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5 rounded shadow-sm text-sm border border-gray-200 w-full lg:w-auto justify-between lg:justify-start">
              <span className="text-gray-600 font-medium whitespace-nowrap">会場サイズ(マス):</span>
              <div className="flex gap-2">
                <label className="flex items-center gap-1">
                  <span className="text-gray-500 text-xs">横</span>
                  <input type="number" min={10} max={200} step={5} value={layoutCols} onChange={e => setLayoutCols(Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 text-right bg-white" />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-gray-500 text-xs">縦</span>
                  <input type="number" min={10} max={200} step={5} value={layoutRows} onChange={e => setLayoutRows(Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 text-right bg-white" />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              <button
                onClick={handleAutoLayout}
                className="flex-1 lg:flex-none px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition text-sm text-center"
              >
                自動配置
              </button>
              <button
                onClick={handleAiLayout}
                className="flex-1 lg:flex-none px-3 py-2 bg-gradient-to-r from-indigo-500 to-pink-500 text-white rounded shadow-md hover:opacity-90 transition flex items-center justify-center gap-1 text-sm whitespace-nowrap"
              >
                ✨ AI自動配置
              </button>
              <button
                onClick={handleSave}
                className="flex-1 lg:flex-none px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm flex items-center justify-center gap-1"
              >
                💾 保存
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 lg:flex-none px-3 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition text-sm flex items-center justify-center gap-1 bg-white"
              >
                📂 読込
              </button>
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                onChange={handleLoadFile}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* データインポート UI */}
        <div className="bg-white p-3 lg:p-4 rounded shadow flex flex-col lg:flex-row items-stretch lg:items-center gap-2 lg:gap-4">
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
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 text-sm font-bold shadow-sm transition"
          >
            {loading ? '読込中...' : 'データをロード'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm px-1">{error}</p>}
      </header>

      <div className="flex-grow w-full h-[60vh] lg:h-[75vh] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative touch-none">
        <CanvasArea
          booths={booths}
          onBoothsChange={setBooths}
          obstacles={obstacles}
          onObstaclesChange={setObstacles}
          textLabels={textLabels}
          onTextLabelsChange={setTextLabels}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </main>
  );
}
