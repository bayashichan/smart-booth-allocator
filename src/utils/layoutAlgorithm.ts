import { Booth, GridConfig } from '@/types/layout';

/**
 * 自動配置アルゴリズム (プロトタイプ)
 * @param booths 配置するブースのリスト
 * @param gridRows グリッドの行数
 * @param gridCols グリッドの列数
 * @returns 配置座標が更新されたブースのリスト
 */
export const autoLayout = (booths: Booth[], gridRows: number, gridCols: number): Booth[] => {
    // 1. 壁側希望 (wall=true) とその他に分離
    const wallBooths = booths.filter(b => b.preferences.wall);
    const islandBooths = booths.filter(b => !b.preferences.wall);

    // カテゴリ順にソート (簡易的なグルーピング)
    wallBooths.sort((a, b) => a.category.localeCompare(b.category));
    islandBooths.sort((a, b) => a.category.localeCompare(b.category));

    const newBooths: Booth[] = [];
    const placedRects: { x: number, y: number, w: number, h: number }[] = [];

    // ヘルパー: 衝突判定
    const isColliding = (x: number, y: number, w: number, h: number) => {
        // グリッド範囲外チェック
        if (x < 0 || y < 0 || x + w > gridCols || y + h > gridRows) return true;

        // 既存ブースとの衝突チェック
        for (const r of placedRects) {
            if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) {
                return true;
            }
        }
        return false;
    };

    // 配置処理関数
    const placeBooth = (booth: Booth, x: number, y: number, w: number, h: number) => {
        newBooths.push({
            ...booth,
            x,
            y,
            isPlaced: true
        });
        placedRects.push({ x, y, w, h });
    };

    // 2. 壁側配置 (外周を時計回りに埋めていく等の戦略だが、ここでは簡易的に上端と下端、左右端を使う)
    // 上端 (y=1)
    let currentX = 1;
    let currentY = 1;

    // 壁側希望を配置
    for (const booth of wallBooths) {
        const w = booth.size * 4;
        const h = 8; // 通路+机+椅子でざっくり8グリッド高さとする (実際はBoothUnitの実装に依存)

        // 上の壁に配置できるか？
        if (!isColliding(currentX, 1, w, h)) {
            placeBooth(booth, currentX, 1, w, h);
            currentX += w + 1; // +1は隙間
        } else {
            // 下の壁に配置 (グリッドの下端付近)
            const bottomY = gridRows - h - 1;
            // 下端用のX管理が必要だが、プロトタイプなので簡易的に
            // 実際はもっとスマートなループが必要
            // ここでは入り切らない場合は islandBooths に回すなどの処理が必要だが省略
            // とりあえず適当な場所に置く
            islandBooths.push(booth);
        }
    }

    // 3. 島配置 (中央エリア)
    // グリッドの中央付近から埋めていく
    currentX = 2;
    currentY = 12; // 上の壁配置エリアを避ける
    const islandRowHeight = 10; // 島配置の行の高さ

    for (const booth of islandBooths) {
        const w = booth.size * 4;
        const h = 8;

        if (currentX + w > gridCols - 2) {
            // 改行
            currentX = 2;
            currentY += islandRowHeight;
        }

        if (!isColliding(currentX, currentY, w, h)) {
            placeBooth(booth, currentX, currentY, w, h);
            currentX += w + 1;
        } else {
            // 配置場所がない... (強制配置または警告)
            // とりあえず重ねて置く (ユーザーが手動修正)
            placeBooth(booth, 0, 0, w, h);
        }
    }

    return newBooths;
};
