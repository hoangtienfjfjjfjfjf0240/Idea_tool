import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildFrameworkInjection,
  buildIdeaOutputSpec,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  normalizeIdeaOutput,
  parseJsonLoose,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';

export const maxDuration = 120;

function parseJson(text: string) {
  return parseJsonLoose(text);
}

function resolveModel(selected?: string): string {
  const map: Record<string, string> = {
    'gemini-2.5-pro': 'gemini/gemini-2.5-pro',
    'gemini-3-pro': 'gemini/gemini-3-pro-preview',
    'gpt-5.4': 'openai/gpt-5.4',
    'gpt-5.4-pro': 'openai/gpt-5.4-pro-2026-03-05',
    'gpt-5.4-mini': 'openai/gpt-5.4-mini',
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'gemini/gemini-3-pro-preview';
}

export async function POST(request: NextRequest) {
  try {
    const { hook, quantity = 3, duration = '30s', appName, appCategory, ideaDirection, selectedModel } = await request.json();
    const cappedQty = Math.min(quantity, 5);
    const targetLanguage = 'English';

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory || 'General',
      coreUsers: [hook.core_user || ''].filter(Boolean),
      primaryEmotion: hook.emotion || 'Curiosity',
      visualTheme: `${hook.creative_type || hook.subtitle || 'UGC'}; use the winning hook as DNA, then expand it into a full brief.`,
      psp: hook.hook_concept || hook.description || appName,
      pillars: [hook.painpoint || 'General user friction'].filter(Boolean),
      anglesPerPillar: 1,
      ideasPerAngle: cappedQty,
      language: `Vietnamese strategy notes + ${targetLanguage} copy`,
      priority: 'A',
      extraContext: [
        'Task type: expand a proven winning hook into new full ideas.',
        'Keep the same strategic DNA, but change situation, character, setting, and opening approach enough to avoid clones.',
        ideaDirection ? `User direction: ${ideaDirection}` : 'No additional user direction.',
      ],
    });

    const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## WINNING HOOK DNA
- Title: "${hook.title}"
- Description: ${hook.description || 'N/A'}
- Hook concept: ${hook.hook_concept || 'N/A'}
- Creative type: ${hook.creative_type || hook.subtitle || 'N/A'}
- Visual: ${hook.visual_detail || 'N/A'}
- Core user: ${hook.core_user || 'N/A'}
- Painpoint: ${hook.painpoint || 'N/A'}
- Viewer emotion target: ${hook.emotion || 'N/A'}

## TASK
Create ${cappedQty} full ideas inspired by the winning hook.
- Keep the same strategic DNA and problem-solution logic.
- Change situation, character, setting, and opening mechanism enough that they are not shallow rewrites.
- Each output must include hook, body, and CTA for a ${duration} video.
- If the user provided an idea direction, prioritize it without breaking the winning DNA.

${buildIdeaOutputSpec({ quantity: cappedQty, duration, appName, language: targetLanguage })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

    console.log('[generate-ideas-from-hook] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro');
    const text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: 0.8,
      max_tokens: 16384,
      useCreativePersona: false,
    });

    if (!text) {
      console.error('[generate-ideas-from-hook] AI returned null');
      return NextResponse.json({ error: 'AI khong phan hoi. Thu lai.' }, { status: 500 });
    }

    const parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas-from-hook] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'Khong parse duoc response.' }, { status: 500 });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const valid = arr
      .map(item => normalizeIdeaOutput(item, { duration, appName, pillar: hook.painpoint || 'General user friction' }))
      .filter(item => {
        const section = (item?.hook || {}) as Record<string, unknown>;
        return String(section.visual || section.script || '').trim().length > 0;
      })
      .slice(0, cappedQty);

    if (valid.length === 0) {
      return NextResponse.json({ error: 'AI tra ve format sai.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
