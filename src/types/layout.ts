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
  fontSize?: number;     // このブースだけの文字サイズ (px)。未指定なら全体設定
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
  x: number;      // グリッド座標 X（左上基準）
  y: number;      // グリッド座標 Y
  width: number;  // グリッド単位（端数可）
  height: number;
  /** 進入方向。0 = 下向き（上側の壁から会場へ入る） */
  rotation?: number;
  label?: string;       // 図面に書く文字。未指定なら「入口」
  color?: string;       // 枠線・矢印の色
  strokeWidth?: number; // 線の太さ (px)
  fontSize?: number;    // 文字サイズ (px)。未指定なら枠の大きさから自動
  /** 進入方向の矢印を描くか。未指定なら描く */
  showArrow?: boolean;
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

export type CategoryColors = {
  stroke: string;
  fill: string;
  /** 未指定なら枠線色を文字色に使う */
  text?: string;
};

export type CategoryColorMap = Record<string, CategoryColors>;

/** 図面の背景色（会場の地色。エクスポートの下地にも使う） */
export const DEFAULT_BACKGROUND_COLOR = '#ffffff';

/** ブースに書く文字の既定サイズ (px) */
export const DEFAULT_BOOTH_FONT_SIZE = 14;

/** 図面に置くカテゴリカラーの凡例 */
export interface LegendConfig {
  visible: boolean;
  x: number;        // ピクセル座標（テキストラベルと同じ座標系）
  y: number;
  fontSize: number;
  /** 枠ごと拡大・縮小する倍率 */
  scale: number;
  title: string;    // 空文字なら見出しを描かない
  /** 「その他」を凡例に載せるか */
  showOther: boolean;
}

export const DEFAULT_LEGEND: LegendConfig = {
  visible: false,
  x: 0,
  y: 0,
  fontSize: 16,
  scale: 1,
  title: 'カテゴリ',
  showOther: false,
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
  // ブース文字サイズの全体設定
  boothFontSize?: number;
  // v4 以降。入口。古いデータには存在しないため任意。
  entrances?: Entrance[];
}
