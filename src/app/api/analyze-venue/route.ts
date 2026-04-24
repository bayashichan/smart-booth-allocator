import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

// ============================================================
// 共通プロンプト
// ============================================================
const VENUE_ANALYSIS_PROMPT = `
あなたは会場図面の解析専門AIです。
添付された会場図面の画像を解析して、壁・柱・仕切りなどの障害物を検出してください。

出力は以下のJSON配列形式のみで返してください（説明文やMarkdownコードブロック不要）:
[
  { "type": "wall",   "x": number, "y": number, "width": number, "height": number, "rotation": 0 },
  { "type": "column", "x": number, "y": number, "width": number, "height": number, "rotation": 0 }
]

グリッド仕様:
- 会場全体を 50×50 グリッドにマッピングする
- x は水平方向 (0 が左端、50 が右端)
- y は垂直方向 (0 が上端、50 が下端)
- width / height はグリッド単位の整数値
- すべての値は 0〜50 の整数

検出ルール:
- 外壁・内壁・間仕切りは type: "wall" として検出する
- 柱・構造物は type: "column" として検出する
- 廊下・通路は壁で挟まれた空白として扱い、壁を検出する
- 細かいテキスト・装飾は無視する
- 画像の縦横比を考慮してグリッドに正確にマッピングする

必ず有効なJSONのみ返してください。
`;

// ============================================================
// MIMEタイプを Base64 ヘッダーから自動検出
// ============================================================
function detectMimeType(dataUrl: string): string {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    return match ? match[1] : 'image/jpeg';
}

// ============================================================
// JSON配列を文字列から安全に抽出・パース
// ============================================================
function extractJsonArray(text: string): any[] {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
        return JSON.parse(match[0]);
    } catch {
        return [];
    }
}

// ============================================================
// Gemini を使った解析
// ============================================================
async function analyzeWithGemini(base64Data: string, mimeType: string): Promise<any[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません');

    const genAI = new GoogleGenerativeAI(apiKey);
    // GEMINI_MODEL_NAME を動的に参照（デフォルト: gemini-flash-latest）
    const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-flash-latest';
    const model = genAI.getGenerativeModel({ model: modelName });

    const imagePart = {
        inlineData: {
            data: base64Data,
            mimeType: mimeType as any,
        },
    };

    const result = await model.generateContent([VENUE_ANALYSIS_PROMPT, imagePart]);
    const text = result.response.text();
    return extractJsonArray(text);
}

// ============================================================
// Groq を使った解析（LLaMA Vision）
// ============================================================
async function analyzeWithGroq(base64Data: string, mimeType: string): Promise<any[]> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY が設定されていません');

    const groq = new Groq({ apiKey });
    // GROQ_MODEL_NAME を動的に参照（デフォルト: meta-llama/llama-4-scout-17b-16e-instruct）
    const modelName = process.env.GROQ_MODEL_NAME || 'meta-llama/llama-4-scout-17b-16e-instruct';

    const response = await groq.chat.completions.create({
        model: modelName,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: VENUE_ANALYSIS_PROMPT,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64Data}`,
                        },
                    },
                ],
            },
        ],
        temperature: 0.1,
        max_tokens: 4096,
    });

    const text = response.choices[0]?.message?.content || '[]';
    return extractJsonArray(text);
}

// ============================================================
// API Route Handler
// ============================================================
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { image, provider } = body;
        // provider: 'gemini' | 'groq' (未指定時は環境変数 AI_PROVIDER → デフォルト gemini)
        const resolvedProvider = provider || process.env.AI_PROVIDER || 'gemini';

        if (!image) {
            return NextResponse.json({ error: '画像データが必要です' }, { status: 400 });
        }

        const mimeType = detectMimeType(image);
        const base64Data = image.split(',')[1];

        let rawObstacles: any[] = [];

        if (resolvedProvider === 'groq') {
            rawObstacles = await analyzeWithGroq(base64Data, mimeType);
        } else {
            rawObstacles = await analyzeWithGemini(base64Data, mimeType);
        }

        // IDを付与
        const obstacles = rawObstacles.map((obs: any, index: number) => ({
            ...obs,
            id: `ai-obs-${Date.now()}-${index}`,
            rotation: obs.rotation || 0,
        }));

        return NextResponse.json({
            provider: resolvedProvider,
            obstacles,
        });

    } catch (error: any) {
        console.error('AI解析エラー:', error);
        return NextResponse.json(
            { error: error.message || '解析に失敗しました' },
            { status: 500 }
        );
    }
}
