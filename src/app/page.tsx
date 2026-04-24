'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Booth, Obstacle } from '@/types/layout';
import { fetchAndParseSheet } from '@/utils/csvParser';
import { autoLayout } from '@/utils/layoutAlgorithm';

const CanvasArea = dynamic(() => import('@/components/CanvasArea'), {
  ssr: false,
  loading: () => <div className="p-10 text-center">Loading Editor...</div>,
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
  const [mode, setMode] = useState<'booth' | 'venue'>('booth');

  const handleLoadData = async () => {
    if (!csvUrl) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchAndParseSheet(csvUrl);
      const initialData = data.map((b, i) => ({
        ...b,
        x: i % 10,
        y: i % 10,
        isPlaced: false
      }));
      setBooths(initialData);
    } catch (err) {
      console.error(err);
      setError('データの読み込みに失敗しました。URLを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLayout = () => {
    // 簡易的にグリッドサイズを固定
    const gridRows = 50;
    const gridCols = 50;
    const layoutedBooths = autoLayout(booths, gridRows, gridCols);
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
          width: 50,
          height: 50
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

  return (
    <main className="flex min-h-screen flex-col p-4 bg-gray-50">
      <header className="mb-4 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Smart Booth Allocator (Prototype)</h1>
            <p className="text-sm text-gray-500">ブースをドラッグして移動できます</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAutoLayout}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
            >
              自動配置 (ルールベース)
            </button>
            <button
              onClick={handleAiLayout}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-pink-500 text-white rounded shadow-md hover:opacity-90 transition flex items-center gap-2"
            >
              ✨ AI自動配置 (Gemini)
            </button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
              保存 (未実装)
            </button>
          </div>
        </div>

        {/* データインポート UI */}
        <div className="bg-white p-4 rounded shadow flex items-center gap-4">
          <input
            type="text"
            placeholder="Google Sheets CSV URL (e.g. https://docs.google.com/.../pub?output=csv)"
            className="flex-grow border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 bg-white"
            value={csvUrl}
            onChange={(e) => setCsvUrl(e.target.value)}
          />
          <button
            onClick={handleLoadData}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 text-sm whitespace-nowrap"
          >
            {loading ? '読み込み中...' : 'データをロード'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
      </header>

      <div className="flex-grow w-full h-[70vh] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative">
        <CanvasArea
          booths={booths}
          onBoothsChange={setBooths}
          obstacles={obstacles}
          onObstaclesChange={setObstacles}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
    </main>
  );
}
