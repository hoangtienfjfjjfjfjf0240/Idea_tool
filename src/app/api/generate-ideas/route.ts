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

const getStructureInstructions = (structureName: string): string => {
  const strictDemoRule = `
    * DEMO SECTION RULES:
      - Step 1 (Prep): Show phone, opening the feature.
      - Step 2 (Action): ONE simple interaction.
      - Step 3 (Result): Show UI result. Voice: "Đây là kết quả của bạn."`;

  if (structureName.includes('PAS') || structureName.includes('Vấn đề'))
    return `[STRUCTURE: PAS]\n1. HOOK: Highlight PAIN POINT.\n2. BODY: problem→solution→demo.\n${strictDemoRule}`;
  if (structureName.includes('BAB') || structureName.includes('Trước'))
    return `[STRUCTURE: BAB]\n1. HOOK: Show BEFORE state.\n2. BODY: before→after→bridge.\n${strictDemoRule}`;
  if (structureName.includes('Story') || structureName.includes('Kể chuyện'))
    return `[STRUCTURE: STORYTELLING]\n1. HOOK: Dramatic opener.\n2. BODY: conflict→discovery→resolution.\n${strictDemoRule}`;
  return `[STRUCTURE: BASIC]\n1. HOOK: Visual shock or benefit.\n2. BODY: demo 3 steps.\n${strictDemoRule}`;
};

export async function POST(request: NextRequest) {
  try {
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge } = await request.json();
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const structureSelection = filters?.videoStructure?.length ? filters.videoStructure[0] : "Cơ bản";
    const structureInstruction = getStructureInstructions(structureSelection);
    const quantity = config?.quantity || 3;
    const duration = config?.duration || '30s';

    const knowledgeBlock = appKnowledge
      ? `\n[APP BRAIN - Kiến thức AI đã tích lũy cho app này. ĐÂY LÀ NGUỒN THAM KHẢO QUAN TRỌNG NHẤT.]\n${appKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas 
      ? `\n[IDEAS GẦN ĐÂY - Tham khảo phong cách & cách triển khai, học hỏi và nâng cấp]\n${previousIdeas}\n`
      : '';

    const prompt = `[ROLE] Senior Performance Marketing Creative Strategist.
${knowledgeBlock}
[INPUT DATA]
App: "${appName}", Category: "${appCategory || 'General'}", Feature: "${featureContext}", Context: "${config?.ideaDescription || "Creative Freedom"}"
Target: ${filters?.coreUser?.join(', ') || "General"}, Pain: ${filters?.painPoint?.join(', ') || "General"}
Motivation: ${filters?.motivation?.join(', ') || "General"}, Quantity: ${quantity}
${ideasBlock}
[OBJECTIVE] Generate exactly ${quantity} DISTINCT direct-response Meta ad ideas.
${structureInstruction}

[VISUAL & VOICE] Visuals: clear, easy to shoot. Voice: Full Vietnamese, Natural, Viral.

[OUTPUT] JSON ARRAY of ${quantity} objects. No Markdown.
[{"id":1,"title":"Title (Vietnamese)","duration":"${duration}","explanation":"Why this works...","hook":{"visual":"...","text":"...","voice":"..."},"problem":{"scenes":[{"visual":"...","voice":"..."}]},"solution":{"visual":"...","voice":"...","text":"..."},"demo":{"step1_prep":{"visual":"...","voice":"..."},"step2_action":{"visual":"...","voice":"..."},"step3_result":{"visual":"...","voice":"Đây là kết quả của bạn."}},"cta":{"voice":"Thử ngay.","text":"Tải miễn phí"}}]`;

    const text = await askAI(prompt, { model: 'gemini/gemini-2.5-pro', temperature: 0.8 });
    if (!text) return NextResponse.json({ error: 'No AI response' }, { status: 500 });

    const parsed = parseJson(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook && i?.demo).slice(0, quantity);

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
