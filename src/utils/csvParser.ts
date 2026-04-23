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
                        // 1. 出展者名の取得 (日本語・英語両対応)
                        const name = row['出展名'] || row['Exhibitor Name'] || row['氏名'] || `出展者 ${index + 1}`;
                        
                        // 2. ブースサイズと壁側希望の解析
                        // '出展ブース' や 'Booth Size' などのカラムから抽出
                        const boothTypeStr = String(row['出展ブース'] || row['Booth Size'] || row['ブースタイプ'] || '1.0');
                        
                        let size: BoothSize = 1.0;
                        if (boothTypeStr.includes('0.5') || boothTypeStr.includes('半')) size = 0.5;
                        else if (boothTypeStr.includes('2.0') || boothTypeStr.includes('2')) size = 2.0;
                        else if (boothTypeStr.includes('3.0') || boothTypeStr.includes('3')) size = 3.0;
                        else if (boothTypeStr.includes('大')) size = 2.0; // 特殊ケース

                        // 壁側希望の判定
                        const posPrefStr = String(row['Position Preference'] || row['配置希望'] || row['備考・質問'] || '');
                        const wall = boothTypeStr.includes('壁') || posPrefStr.includes('壁') || posPrefStr.includes('Wall');

                        // 3. カテゴリの取得
                        const category: VendorCategory = (row['出展カテゴリ'] || row['Category'] || row['カテゴリ'] || 'その他') as VendorCategory;

                        return {
                            id: `imported-${index + 1}`,
                            name: name.trim(),
                            size: size,
                            category: category,
                            preferences: {
                                wall: wall,
                            },
                            x: 0,
                            y: 0,
                            rotation: 0,
                            isPlaced: false,
                        };
                    });
                    // 空の名前の行（パースミスなど）を除外
                    resolve(parsedBooths.filter(b => b.name !== ''));
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

        // Google Sheets URLの処理
        if (url.includes('docs.google.com/spreadsheets')) {
            // すでにCSV出力用のURL（/pub?output=csv や /export?format=csv）ならそのまま使う
            if (url.includes('output=csv') || url.includes('export?')) {
                fetchUrl = url;
            } else {
                // 通常の編集用URL (/edit) をエクスポート用URLに変換
                const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
                if (match && match[1]) {
                    const sheetId = match[1];
                    const gidMatch = url.match(/gid=([0-9]+)/);
                    const gid = gidMatch ? `&gid=${gidMatch[1]}` : '';
                    fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid}`;
                }
            }
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`CSVの取得に失敗しました: ${response.statusText}. スプレッドシートが「ウェブに公開」されているか、またはリンクが正しいか確認してください。`);
        }
        const csvText = await response.text();
        return parseSheetData(csvText);
    } catch (error) {
        console.error('Error fetching/parsing sheet:', error);
        throw error;
    }
};
