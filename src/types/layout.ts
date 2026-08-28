export type VendorCategory = '占い・スピリチュアル' | '物販' | 'ボディケア・美容' | '飲食' | 'ワークショップ' | 'その他';

export type BoothSize = 0.5 | 1.0 | 1.5 | 2.0 | 3.0;

export interface Booth {
  id: string;
  name: string; // 出展者名
  seatNumber?: string; // 座席番号
  size: BoothSize; // 基本卓に対する倍率 (0.5, 1.0, 1.5, 2.0, 3.0)
  category: VendorCategory;
  preferences: {
    wall: boolean; // 壁側希望
    nearEntrance?: boolean;
    power?: boolean;
  };
  sizeMm?: { width: number; depth: number }; // 任意のサイズ (mm)
  color?: string;        // 後方互換用（旧データ）
  strokeColor?: string;  // 枠線色
  fillColor?: string;    // 塗りつぶし色
  textColor?: string;    // 文字色
  // 配置情報
  x: number; // グリッド座標 X
  y: number; // グリッド座標 Y
  rotation: 0 | 90 | 180 | 270; // 向き
  isPlaced: boolean; // 配置済みフラグ
}

export interface GridConfig {
  unitSizeMm: number; // 450mm
  cols: number; // 横のグリッド数
  rows: number; // 縦のグリッド数
  scale: number; // 表示倍率 (1グリッドあたりのピクセル数)
}

export interface Venue {
  widthMm: number; // 会場幅 (mm)
  depthMm: number; // 会場奥行き (mm)
  obstacles: Obstacle[]; // 柱や壁など
  entrances: Entrance[];
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  type: 'column' | 'wall' | 'void';
  color?: string;       // 実線の色（任意）
  strokeWidth?: number; // 線の太さ（px、任意）
}

export interface Entrance {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutState {
  venue: Venue;
  grid: GridConfig;
  booths: Booth[];
}

export interface TextLabel {
  id: string;
  text: string;
  x: number;      // ピクセル座標（グリッド非依存）
  y: number;
  fontSize: number;
  color: string;
  fontStyle?: string; // 'bold' | 'italic' | ''
  rotation?: number;
}

// 会場サイズ（グリッド数）
export interface VenueSize {
  cols: number;
  rows: number;
}

// 寸法設定（アプリ全体で共有する唯一の基準値）
export interface DimensionSettings {
  gridUnitMm: number;       // 1マスの実寸 (mm)
  baseTableWidthMm: number; // 1.0卓の幅 (mm)
  baseTableDepthMm: number; // 1.0卓の奥行 (mm)
}

export const DEFAULT_DIMENSIONS: DimensionSettings = {
  gridUnitMm: 450,
  baseTableWidthMm: 1800,
  baseTableDepthMm: 900,
};

export type CategoryColorMap = Record<string, { stroke: string; fill: string }>;

/** 図面の背景色（会場の地色。エクスポートの下地にも使う） */
export const DEFAULT_BACKGROUND_COLOR = '#ffffff';

/** 図面に置くカテゴリカラーの凡例 */
export interface LegendConfig {
  visible: boolean;
  x: number;        // ピクセル座標（テキストラベルと同じ座標系）
  y: number;
  fontSize: number;
  title: string;    // 空文字なら見出しを描かない
}

export const DEFAULT_LEGEND: LegendConfig = {
  visible: false,
  x: 0,
  y: 0,
  fontSize: 16,
  title: 'カテゴリ',
};

// 保存ファイル形式
export interface SaveFile {
  version: number;
  savedAt: string;
  booths: Booth[];
  obstacles: Obstacle[];
  textLabels: TextLabel[];
  // v2 以降。古いデータには存在しないため任意。
  venue?: VenueSize;
  dimensions?: DimensionSettings;
  categoryColors?: CategoryColorMap;
  // v3 以降。背景色と凡例。
  backgroundColor?: string;
  legend?: LegendConfig;
}
