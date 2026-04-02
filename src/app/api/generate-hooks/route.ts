import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

function parseJson(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);
    return JSON.parse(clean);
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const { hook, instruction, quantity = 3, appName, appCategory } = await request.json();

    const appContext = appName ? `\nApp: "${appName}" (${appCategory || 'General'}). Generate hooks specifically for this app's audience.` : '';

    const prompt = `Generate exactly ${quantity} DISTINCT variations of HOOKS based on:
- WINNING HOOK: "${hook.title}" (${hook.hook_concept || ''}). Visual: "${hook.visual_detail || ''}".
- USER INSTRUCTION: "${instruction}"${appContext}

Focus ONLY ON THE HOOK (First 3-5 seconds).
Visual: Detailed, easy to shoot. Text: Short, punchy. Voice: Catchy, viral (Vietnamese).

JSON ARRAY of ${quantity} objects. No Markdown.
[{"id":1,"title":"...","explanation":"...","hook":{"visual":"...","text":"...","voice":"..."}}]`;

    const text = await askAI(prompt, { model: 'gemini/gemini-2.5-pro', temperature: 0.8 });
    if (!text) return NextResponse.json({ error: 'No AI response' }, { status: 500 });

    const parsed = parseJson(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse' }, { status: 500 });

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = arr.slice(0, quantity).map((item: any, i: number) => ({
      id: `hook-${Date.now()}-${i}`,
      title: item.title || `Biến thể ${i + 1}`,
      explanation: item.explanation || '',
      hook: item.hook || { visual: '', text: '', voice: '' },
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
