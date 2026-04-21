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
const MAX_IDEAS_PER_AI_BATCH = 5;
const MAX_IDEAS_PER_REQUEST = 10;

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildIdeaBatchPlans(totalRequestedQuantity: number) {
  const plans: Array<{ batchQuantity: number; batchStartIndex: number }> = [];
  for (let batchStartIndex = 0; batchStartIndex < totalRequestedQuantity; batchStartIndex += MAX_IDEAS_PER_AI_BATCH) {
    plans.push({
      batchQuantity: Math.min(MAX_IDEAS_PER_AI_BATCH, totalRequestedQuantity - batchStartIndex),
      batchStartIndex,
    });
  }
  return plans;
}

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
    const { hook, quantity = 3, duration = 'Short social-first runtime', appName, appCategory, ideaDirection, selectedModel } = await request.json();
    const requestedQty = Math.min(toPositiveInt(quantity, 3), MAX_IDEAS_PER_REQUEST);
    const targetLanguage = 'English';
    const batchPlans = buildIdeaBatchPlans(requestedQty);
    const aggregatedIdeas: Record<string, unknown>[] = [];

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory || 'General',
      coreUsers: [hook.core_user || ''].filter(Boolean),
      primaryEmotion: hook.emotion || 'Curiosity',
      visualTheme: `${hook.creative_type || hook.subtitle || 'UGC'}; use the winning hook as DNA, then expand it into a full brief.`,
      psp: hook.hook_concept || hook.description || appName,
      pillars: [hook.painpoint || 'General user friction'].filter(Boolean),
      anglesPerPillar: 1,
      ideasPerAngle: requestedQty,
      language: `Vietnamese strategy notes + ${targetLanguage} copy`,
      priority: 'A',
      extraContext: [
        'Task type: expand a proven winning hook into new full ideas.',
        'Keep the same strategic DNA, but change situation, character, setting, and opening approach enough to avoid clones.',
        ideaDirection ? `User direction: ${ideaDirection}` : 'No additional user direction.',
      ],
    });

    for (const plan of batchPlans) {
      const priorIdeasBlock = aggregatedIdeas.length > 0
        ? `\n## IDEAS ALREADY GENERATED IN THIS REQUEST\n${aggregatedIdeas.map((idea, index) => {
            const meta = (idea.meta || {}) as Record<string, unknown>;
            const hookSection = (idea.hook || {}) as Record<string, unknown>;
            return `${index + 1}. ${String(meta.hookPrimary || idea.title || 'Idea')}\n- Hook voice: ${String(hookSection.voice || '').trim()}\n- Hook text: ${String(hookSection.textOverlay || hookSection.text || '').trim()}`;
          }).join('\n')}\n- Do not repeat or lightly paraphrase these ideas.`
        : '';

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
${priorIdeasBlock}

## TASK
Create ${plan.batchQuantity} full ideas inspired by the winning hook for batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}/${batchPlans.length}.
- Keep the same strategic DNA and problem-solution logic.
- Change situation, character, setting, and opening mechanism enough that they are not shallow rewrites.
- Each output must include hook, body, and CTA, but keep runtime flexible and social-first instead of forcing a fixed 15s/30s/60s bucket.
- If the user provided an idea direction, prioritize it without breaking the winning DNA.

${buildIdeaOutputSpec({ quantity: plan.batchQuantity, duration, appName, language: targetLanguage })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

      console.log('[generate-ideas-from-hook] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro', 'batch:', plan);
      const text = await askAI(prompt, {
        model: resolveModel(selectedModel),
        temperature: 0.8,
        max_tokens: 16384,
        useCreativePersona: false,
      });

      if (!text) {
        console.error('[generate-ideas-from-hook] AI returned null for batch', plan);
        continue;
      }

      const parsed = parseJson(text);
      if (!parsed) {
        console.error('[generate-ideas-from-hook] Failed to parse batch:', text.substring(0, 300));
        continue;
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const validBatch = arr
        .map(item => normalizeIdeaOutput(item, { duration, appName, pillar: hook.painpoint || 'General user friction' }))
        .filter(item => {
          const section = (item?.hook || {}) as Record<string, unknown>;
          return String(section.visual || section.script || '').trim().length > 0;
        })
        .slice(0, plan.batchQuantity);

      aggregatedIdeas.push(...validBatch);
    }

    if (aggregatedIdeas.length === 0) {
      return NextResponse.json({ error: 'AI tra ve format sai.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: aggregatedIdeas.slice(0, requestedQty) });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
