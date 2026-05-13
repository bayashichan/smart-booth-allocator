export type VendorCategory = '占い・スピリチュアル' | '物販' | 'ボディケア・美容' | '飲食' | 'ワークショップ' | 'その他';

export type BoothSize = 0.5 | 1.0 | 2.0 | 3.0;

export interface Booth {
  id: string;
  name: string; // 出展者名
  seatNumber?: string; // 座席番号
  size: BoothSize; // 0.5, 1.0, 2.0, 3.0
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

// 保存ファイル形式
export interface SaveFile {
  version: number;
  savedAt: string;
  booths: Booth[];
  obstacles: Obstacle[];
  textLabels: TextLabel[];
}
