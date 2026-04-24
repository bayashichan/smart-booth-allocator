import Papa from 'papaparse';
import { Booth, BoothSize, VendorCategory } from '@/types/layout';

export const parseSheetData = (csvText: string): Promise<Booth[]> => {
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const parsedBooths: Booth[] = results.data
                        .map((row: any, index: number) => {
                            // 座席番号
                            const seatNumber = String(row['座席番号'] || '').trim();

                            // サイズ変換（出展ブース列から判定）
                            let size: BoothSize = 1.0;
                            const boothStr = String(row['出展ブース'] || '');
                            if (boothStr.includes('半テーブル')) size = 0.5;
                            else if (boothStr.includes('1テーブル')) size = 1.0;
                            else if (boothStr.includes('2テーブル')) size = 2.0;

                            // カテゴリ変換（出展カテゴリ列から取得）
                            const rawCategory = String(row['出展カテゴリ'] || '').trim();
                            const validCategories: VendorCategory[] = ['占い・スピリチュアル', '物販', 'ボディケア・美容', '飲食', 'ワークショップ'];
                            const category: VendorCategory = validCategories.includes(rawCategory as VendorCategory)
                                ? (rawCategory as VendorCategory)
                                : 'その他';

                            // 壁側希望
                            const wall = boothStr.includes('壁側');

                            return {
                                id: `imported-${index + 1}`,
                                name: row['出展名'] || `出展者 ${index + 1}`,
                                seatNumber: seatNumber || undefined,
                                size: size,
                                category: category,
                                preferences: {
                                    wall: wall,
                                },
                                // 初期位置は未配置または適当な場所
                                x: 0,
                                y: 0,
                                rotation: 0 as const,
                                isPlaced: false,
                            };
                        })
                        .filter((booth) => booth.seatNumber !== undefined && booth.seatNumber !== '');
                    resolve(parsedBooths);
                } catch (e) {
                    reject(e);
                }
            },
            error: (error: any) => {
                reject(error);
            }
        });
    });
};

export const fetchAndParseSheet = async (url: string): Promise<Booth[]> => {
    try {
        let fetchUrl = url;

        // Google Sheetsの標準URL ( /edit ) を CSVエクスポートURL ( /export?format=csv ) に変換
        // 例: https://docs.google.com/spreadsheets/d/KEY/edit#gid=0 -> https://docs.google.com/spreadsheets/d/KEY/export?format=csv
        if (url.includes('docs.google.com/spreadsheets')) {
            if (url.includes('/pub')) {
                // すでにウェブ公開用のURLの場合はそのまま使用する
                if (!url.includes('output=csv')) {
                    fetchUrl = url + (url.includes('?') ? '&' : '?') + 'output=csv';
                }
            } else {
                // /edit 等を削除して /export?format=csv に置き換え
                // gid (シートID) がある場合は引き継ぐ
                const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
                if (match && match[1] && match[1] !== 'e') {
                    const sheetId = match[1];
                    const gidMatch = url.match(/gid=([0-9]+)/);
                    const gid = gidMatch ? `&gid=${gidMatch[1]}` : '';
                    fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid}`;
                }
            }
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.statusText}. 公開設定を確認してください。`);
        }
        const csvText = await response.text();
        return parseSheetData(csvText);
    } catch (error) {
        console.error('Error fetching/parsing sheet:', error);
        throw error;
    }
};
