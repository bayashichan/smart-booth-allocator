export type VendorCategory = '物販' | 'ボディケア' | '飲食' | 'ワークショップ' | 'その他';

export type BoothSize = 0.5 | 1.0 | 2.0 | 3.0;

export interface Booth {
  id: string;
  name: string; // 出展者名
  size: BoothSize; // 0.5, 1.0, 2.0, 3.0
  category: VendorCategory;
  preferences: {
    wall: boolean; // 壁側希望
    nearEntrance?: boolean;
    power?: boolean;
  };
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
