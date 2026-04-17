import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildFrameworkInjection,
  buildHookOutputSpec,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  normalizeHookOutput,
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
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'openai/gpt-4.1';
}

export async function POST(request: NextRequest) {
  try {
    const { hook, instruction, quantity = 3, appName, appCategory, selectedModel } = await request.json();
    const targetLanguage = 'English';

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory || 'General',
      coreUsers: [hook.core_user || ''].filter(Boolean),
      primaryEmotion: hook.emotion || 'Curiosity',
      visualTheme: `${hook.creative_type || hook.subtitle || 'UGC'}; keep the winning hook DNA but change the visual execution.`,
      psp: `Reuse the same product promise that made the winning hook work for ${appName}.`,
      pillars: [hook.painpoint || 'General user friction'].filter(Boolean),
      anglesPerPillar: 1,
      ideasPerAngle: quantity,
      language: `Vietnamese strategy notes + ${targetLanguage} copy`,
      priority: 'A',
      extraContext: [
        'Task type: modify a winning hook, not a full-video brief.',
        'Keep the same painpoint, core user, and viewer emotion unless the user explicitly changes them.',
      ],
    });

    const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## WINNING HOOK DNA
- Title: "${hook.title}"
- Description: ${hook.description || 'N/A'}
- Hook concept: ${hook.hook_concept || 'N/A'}
- Creative type: ${hook.creative_type || hook.subtitle || 'N/A'}
- Original visual: ${hook.visual_detail || 'N/A'}
- Core user: ${hook.core_user || 'N/A'}
- Painpoint: ${hook.painpoint || 'N/A'}
- Viewer emotion target: ${hook.emotion || 'N/A'}

## USER MODIFY BRIEF
"${instruction}"

## TASK
Create ${quantity} hook-only variations.
- Keep the winning DNA and same problem/emotion target.
- Change the visual execution enough that each variation is distinct.
- Preserve the interaction pattern and number of people when possible.
- Each variation should differ from the original on at least 3 of these axes: situation, character, setting, blocker, mood.

${buildHookOutputSpec({ quantity, language: targetLanguage })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

    const text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: 0.8,
      max_tokens: 16384,
      useCreativePersona: false,
    });
    if (!text) return NextResponse.json({ error: 'No AI response' }, { status: 500 });

    const parsed = parseJson(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse' }, { status: 500 });

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const data = arr.slice(0, quantity).map((item: unknown, i: number) => {
      const normalized = normalizeHookOutput(item);
      const normalizedHook = (normalized.hook || {}) as Record<string, unknown>;
      return {
        id: `hook-${Date.now()}-${i}`,
        title: normalized.title || `Bien the ${i + 1}`,
        explanation: normalized.explanation || '',
        meta: normalized.meta || {},
        hook: {
          script: normalizedHook.script || '',
          textOverlay: normalizedHook.textOverlay || '',
          visual: normalizedHook.visual || normalizedHook.script || '',
          text: normalizedHook.text || normalizedHook.textOverlay || '',
          voice: normalizedHook.voice || '',
          viTranslation: normalizedHook.viTranslation || '',
          viewerEmotion: normalizedHook.viewerEmotion || '',
          painpointImpact: normalizedHook.painpointImpact || '',
          whyTheyStopScrolling: normalizedHook.whyTheyStopScrolling || '',
        },
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
