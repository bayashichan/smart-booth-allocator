import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Booth, Obstacle } from '@/types/layout';

// APIキーは環境変数から取得 (後ほど設定)
const API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export async function POST(req: NextRequest) {
    if (!API_KEY) {
        return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
    }

    try {
        const body = await req.json();
        const { booths, obstacles, width, height } = body;

        // AIへの入力プロンプト構築
        const prompt = `
    You are an expert event layout designer.
    Optimize the booth layout for an event venue.

    # Venue Config
    - Width: ${width} grids
    - Height: ${height} grids
    - Obstacles (Walls/Columns): ${JSON.stringify(obstacles)}

    # Input Booths
    ${JSON.stringify(booths.map((b: Booth) => ({
            id: b.id,
            name: b.name,
            size: b.size,
            category: b.category,
            preferences: b.preferences
        })))}

    # Rules
    1. "wall: true" preference booths MUST be placed along the outer edges or near obstacles.
    2. Group similar "categories" together (e.g., place "Food" booths near each other).
    3. Ensure at least 3 grids of aisle space between booths.
    4. Do not overlap with obstacles or other booths.
    5. Booth orientation (rotation) can be 0, 90, 180, 270.
    6. CRITICAL: All booths MUST be placed strictly within the venue bounds (0 <= x < ${width} and 0 <= y < ${height}). Do NOT place any booth outside this area.

    # Output Format
    Return ONLY a valid JSON array of objects. No markdown formatting.
    [{ "id": "booth_id", "x": number, "y": number, "rotation": number }]
    `;

        // モデル名を環境変数から取得 (デフォルト: gemini-flash-latest)
        // ユーザー指定により動的に変更可能だが、基本はこのエイリアスを使用
        const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-flash-latest';
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Markdownのコードブロック記法などを除去してJSONパース
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const layoutData = JSON.parse(jsonStr);

        return NextResponse.json(layoutData);
    } catch (error) {
        console.error('Gemini API Error:', error);
        return NextResponse.json({ error: 'Failed to generate layout' }, { status: 500 });
    }
}
