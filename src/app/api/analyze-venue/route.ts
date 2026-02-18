import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export async function POST(req: NextRequest) {
    if (!API_KEY) {
        return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
    }

    try {
        const body = await req.json();
        const { image } = body; // Base64 string (data:image/jpeg;base64,...)

        if (!image) {
            return NextResponse.json({ error: 'Image data is required' }, { status: 400 });
        }

        // Base64ヘッダーを除去
        const base64Data = image.split(',')[1];

        // モデル名を環境変数から取得 (デフォルト: gemini-flash-latest)
        const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-flash-latest';
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `
    Analyze this floor plan image and identify "walls" and "columns".
    The venue is represented as a 50x50 grid.
    
    Return a JSON array of obstacles with the following structure:
    [
      { "type": "wall", "x": number, "y": number, "width": number, "height": number, "rotation": 0 },
      { "type": "column", "x": number, "y": number, "width": number, "height": number, "rotation": 0 }
    ]

    Rules:
    - Map the image coordinates to a 50x50 grid system.
    - x and y must be integers between 0 and 50.
    - width and height must be in grid units (e.g., a standard wall might be 4x1).
    - Detect major walls (lines) and pillars (squares/circles).
    - Be careful! "x" is horizontal position (0-50), "y" is vertical position (0-50).
    - Return ONLY valid JSON array. Do not include markdown code blocks.
    `;

        // 画像パートの構造を修正
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: 'image/jpeg',
            },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        // Markdown除去 & JSONパース
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        // Geminiがたまに余計なテキストをつける場合があるので、配列部分だけ抽出する簡易ロジック
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        const validJson = arrayMatch ? arrayMatch[0] : '[]';

        const obstacles = JSON.parse(validJson);

        // IDを付与
        const obstaclesWithId = obstacles.map((obs: any, index: number) => ({
            ...obs,
            id: `ai-obs-${Date.now()}-${index}`,
            rotation: obs.rotation || 0
        }));

        return NextResponse.json(obstaclesWithId);
    } catch (error) {
        console.error('Gemini Vision API Error:', error);
        return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
    }
}
