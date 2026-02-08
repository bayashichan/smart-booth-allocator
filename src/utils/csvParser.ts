import Papa from 'papaparse';
import { Booth, BoothSize, VendorCategory } from '@/types/layout';

export const parseSheetData = (csvText: string): Promise<Booth[]> => {
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const parsedBooths: Booth[] = results.data.map((row: any, index: number) => {
                        // サイズ変換
                        let size: BoothSize = 1.0;
                        const sizeStr = String(row['Booth Size'] || '1.0');
                        if (sizeStr.includes('0.5')) size = 0.5;
                        else if (sizeStr.includes('2.0')) size = 2.0;
                        else if (sizeStr.includes('3.0')) size = 3.0;

                        // カテゴリ変換
                        const category: VendorCategory = (row['Category'] as VendorCategory) || 'その他';

                        // 壁側希望
                        const wall = String(row['Position Preference'] || '').includes('壁') || String(row['Position Preference'] || '').includes('Wall');

                        return {
                            id: `imported-${index + 1}`,
                            name: row['Exhibitor Name'] || `出展者 ${index + 1}`,
                            size: size,
                            category: category,
                            preferences: {
                                wall: wall,
                            },
                            // 初期位置は未配置または適当な場所
                            x: 0,
                            y: 0,
                            rotation: 0,
                            isPlaced: false,
                        };
                    });
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
            // /edit 等を削除して /export?format=csv に置き換え
            // gid (シートID) がある場合は引き継ぐ
            const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                const sheetId = match[1];
                const gidMatch = url.match(/gid=([0-9]+)/);
                const gid = gidMatch ? `&gid=${gidMatch[1]}` : '';
                fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid}`;
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
