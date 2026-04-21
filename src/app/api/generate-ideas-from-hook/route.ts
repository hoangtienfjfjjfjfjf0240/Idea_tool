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
const TRACKING_ID_PATTERN = /^P\d+-A\d+-I\d+$/;
const PATTERN_INTERRUPT_PATTERN = /(?:\?|\d|=|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|painful\b|awkward\b|annoying\b|sao\b|vẫn\b|đừng\b|không cần\b|thay vì|bao giờ|tệ nhất|mệt|phiền|khổ)/i;
const MEDICAL_CLAIM_PATTERN = /\b(?:diagnos(?:e|is|ing)|cure|treat(?:ment|ing)?|heal(?:ed|ing)?|detect disease|replace doctor|medical results?|clinical diagnosis|chẩn đoán|điều trị|chữa(?: khỏi)?|phát hiện bệnh|thay thế bác sĩ|kết quả y tế chính xác)\b/i;
const BEFORE_AFTER_PATTERN = /\b(?:before\s*\/\s*after|before and after|trước\s+và\s+sau|trước\s*\/\s*sau)\b/i;
const HEALTH_CONTEXT_PATTERN = /\b(?:health|doctor|disease|symptom|condition|therapy|medical|bệnh|bác sĩ|triệu chứng|sức khỏe|điều trị)\b/i;

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeCompareText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: string, b: string) {
  const tokensA = new Set(normalizeCompareText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompareText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasDistinctHookVariations(variations: string[]): boolean {
  const normalized = variations.map(normalizeCompareText);
  if (new Set(normalized).size !== normalized.length) return false;

  for (let i = 0; i < variations.length; i++) {
    for (let j = i + 1; j < variations.length; j++) {
      if (jaccardSimilarity(variations[i], variations[j]) >= 0.78) {
        return false;
      }
    }
  }

  return true;
}

function isSpecificDontDo(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (countWords(text) < 4) return false;
  return !/^(dont|don't|do not|avoid|khong|không)\s+(generic|bad|boring|ugly|messy)$/.test(normalized);
}

function totalVoiceWords(item: Record<string, unknown>): number {
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);
  return countWords([asText(hook.voice), asText(body.voice), asText(cta.voice)].filter(Boolean).join(' '));
}

function repairIdeaTrackingFields(
  item: Record<string, unknown>,
  context: { batchStartIndex: number; ideaIndex: number; pillar: string }
): Record<string, unknown> {
  const next = { ...item };
  const meta = { ...asRecord(item.meta) };
  const id = asText(item.id);
  const globalIdeaIndex = context.batchStartIndex + context.ideaIndex;

  next.id = TRACKING_ID_PATTERN.test(id) ? id : `P0-A0-I${globalIdeaIndex}`;
  meta.builderVersion = asText(meta.builderVersion) || 'prompt_system_builder_v1';
  meta.pillar = asText(meta.pillar) || context.pillar;
  meta.pillarIndex = Number(meta.pillarIndex ?? 0) || 0;
  next.meta = meta;

  return next;
}

function validateIdeaOutput(item: Record<string, unknown>): string[] {
  const meta = asRecord(item.meta);
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);

  const id = asText(item.id);
  const hookPrimary = asText(meta.hookPrimary);
  const hookAlt1 = asText(meta.hookAlt1);
  const hookAlt2 = asText(meta.hookAlt2);
  const hookVisual = asText(hook.visual) || asText(hook.script);
  const hookVoice = asText(hook.voice);
  const hookTextOverlay = asText(hook.textOverlay) || asText(hook.text);
  const bodyVisual = asText(body.visual) || asText(body.script);
  const bodyVoice = asText(body.voice);
  const bodyTextOverlay = asText(body.textOverlay) || asText(body.text);
  const ctaVisual = asText(cta.visual) || asText(cta.script);
  const ctaVoice = asText(cta.voice);
  const ctaTextOverlay = asText(cta.textOverlay) || asText(cta.text);
  const ctaEndCard = asText(cta.endCard);
  const dontDo = asText(meta.dontDo);

  const errors: string[] = [];

  if (!TRACKING_ID_PATTERN.test(id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!hookPrimary) errors.push('meta.hookPrimary is required');
  if (hookPrimary && countWords(hookPrimary) > 12) errors.push('meta.hookPrimary exceeds 12 words');
  if (!hookAlt1 || !hookAlt2) errors.push('meta.hookAlt1 and meta.hookAlt2 are required');
  if (hookPrimary && hookAlt1 && hookAlt2 && !hasDistinctHookVariations([hookPrimary, hookAlt1, hookAlt2])) {
    errors.push('hook variations must be genuinely different');
  }
  if (hookPrimary && !PATTERN_INTERRUPT_PATTERN.test([hookPrimary, hookVoice, hookTextOverlay].filter(Boolean).join(' '))) {
    errors.push('meta.hookPrimary lacks a clear interrupt signal');
  }
  if (!hookVisual) errors.push('hook.visual is required');
  if (!hookVoice && !hookTextOverlay) errors.push('hook needs voice or text overlay');
  if (!bodyVisual) errors.push('body.visual is required');
  if (!bodyVoice && !bodyTextOverlay) errors.push('body needs voice or text overlay');
  if (!ctaVisual) errors.push('cta.visual is required');
  if (!ctaVoice && !ctaTextOverlay) errors.push('cta needs voice or text overlay');
  if (!ctaEndCard) errors.push('cta.endCard is required');
  if (totalVoiceWords(item) > 60) errors.push('voiceover exceeds 60 words');
  if (!isSpecificDontDo(dontDo)) errors.push('meta.dontDo is too generic');

  const complianceText = [
    hookPrimary,
    hookAlt1,
    hookAlt2,
    hookVisual,
    hookVoice,
    hookTextOverlay,
    bodyVisual,
    bodyVoice,
    bodyTextOverlay,
    ctaVisual,
    ctaVoice,
    ctaTextOverlay,
    ctaEndCard,
  ]
    .filter(Boolean)
    .join(' ');

  if (MEDICAL_CLAIM_PATTERN.test(complianceText)) {
    errors.push('contains prohibited medical claim language');
  }

  if (BEFORE_AFTER_PATTERN.test(complianceText) && HEALTH_CONTEXT_PATTERN.test(complianceText)) {
    errors.push('contains prohibited before/after health framing');
  }

  return errors;
}

function normalizeAndValidateIdeas(
  items: unknown[],
  context: { duration: string; appName: string; pillar: string; batchStartIndex: number }
) {
  const valid: Record<string, unknown>[] = [];
  const invalidReasons: string[] = [];

  items.forEach((item, ideaIndex) => {
    const normalized = repairIdeaTrackingFields(
      normalizeIdeaOutput(item, {
        duration: context.duration,
        appName: context.appName,
        pillar: context.pillar,
      }),
      { batchStartIndex: context.batchStartIndex, ideaIndex, pillar: context.pillar }
    );
    const errors = validateIdeaOutput(normalized);

    if (errors.length === 0) valid.push(normalized);
    else invalidReasons.push(`Idea ${context.batchStartIndex + ideaIndex + 1}: ${errors.join('; ')}`);
  });

  return { valid, invalidReasons };
}

function buildIdeaFingerprint(item: Record<string, unknown>) {
  const meta = asRecord(item.meta);
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);

  return [
    asText(meta.hookPrimary),
    asText(hook.voice),
    asText(hook.textOverlay) || asText(hook.text),
    asText(hook.visual) || asText(hook.script),
    asText(body.visual) || asText(body.script),
    asText(cta.voice),
    asText(cta.textOverlay) || asText(cta.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function dedupeIdeas(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[]
) {
  const unique: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    const candidateFingerprint = buildIdeaFingerprint(candidate);
    const isUnique = [...existing, ...unique].every(item => (
      jaccardSimilarity(candidateFingerprint, buildIdeaFingerprint(item)) < 0.74
    ));

    if (isUnique) unique.push(candidate);
  }

  return unique;
}

function buildFallbackIdeasFromHook(
  hook: Record<string, unknown>,
  options: { quantity: number; startIndex?: number; duration: string; appName: string; ideaDirection?: string | null }
) {
  const title = asText(hook.title) || 'Winning Hook';
  const baseTitle = title.replace(/\s*-\s*Biến thể\s*\d+\s*$/i, '').trim() || title;
  const painpoint = asText(hook.painpoint) || 'the user blocker';
  const coreUser = asText(hook.core_user) || 'General viewer';
  const emotion = asText(hook.emotion) || 'Curiosity';
  const psp = asText(hook.hook_concept) || asText(hook.description) || options.appName;
  const visualBase = asText(hook.visual_detail) || 'A social-first handheld setup that shows the problem clearly.';
  const directionHint = asText(options.ideaDirection) || psp;
  const patterns = [
    {
      creativeType: 'UGC',
      hookPrimary: 'Why this move matters',
      hookAlt1: 'Still missing this detail?',
      hookAlt2: 'The clue is here',
      hookVoice: `Wait, why does this simple move expose ${painpoint}?`,
      bodyVoice: `The reveal lands faster when the blocker is visible before the explanation starts.`,
      ctaVoice: `Open ${options.appName} and test this angle before you lock the creative.`,
      bodyOverlay: 'See the clue faster',
      ctaOverlay: `Try ${options.appName} now`,
      angle: 'Desk setup macro reveal',
    },
    {
      creativeType: 'POV',
      hookPrimary: 'The detail people miss',
      hookAlt1: 'Most viewers miss this',
      hookAlt2: 'Look closer here',
      hookVoice: 'Most people miss this detail in the first second.',
      bodyVoice: 'Use a tighter POV to make the pain point and solution click faster.',
      ctaVoice: `Build one more POV version inside ${options.appName}.`,
      bodyOverlay: 'Show the blocker early',
      ctaOverlay: 'Build another version',
      angle: 'Tighter POV reveal',
    },
    {
      creativeType: 'Social Proof',
      hookPrimary: 'Same pain, new angle',
      hookAlt1: 'This compare changes it',
      hookAlt2: 'Spot the real trigger',
      hookVoice: 'Same pain point, but this compare makes it click instantly.',
      bodyVoice: 'Frame the old friction and the fix in one contrast so the payoff is obvious.',
      ctaVoice: `Turn this winning DNA into a fresh test in ${options.appName}.`,
      bodyOverlay: 'Make the contrast obvious',
      ctaOverlay: `Test in ${options.appName}`,
      angle: 'Compare-frame social proof',
    },
  ];

  return Array.from({ length: options.quantity }, (_, index) => {
    const pattern = patterns[((options.startIndex || 0) + index) % patterns.length];
    const displayIndex = (options.startIndex || 0) + index;
    return {
      id: `P0-A0-I${displayIndex}`,
      title: `${baseTitle} - Full Idea ${displayIndex + 1}`,
      duration: options.duration,
      creativeType: pattern.creativeType,
      meta: {
        builderVersion: 'hook_library_full_idea_api_fallback_v1',
        pillar: painpoint,
        pillarIndex: 0,
        angleName: `Winning Hook: ${title}`,
        angleType: 'Curiosity',
        angleDesc: pattern.angle,
        hookPrimary: pattern.hookPrimary,
        hookAlt1: pattern.hookAlt1,
        hookAlt2: pattern.hookAlt2,
        visualRefNotes: visualBase,
        talentProfile: coreUser,
        dontDo: 'Do not let body and CTA drift away from the opening pain point.',
        track: 'B',
        priority: 'A',
      },
      framework: {
        coreUser,
        painpoint,
        emotion,
        psp,
      },
      explanation: `Expand the winning hook into a full brief that keeps the pain point "${painpoint}" and pushes direction "${directionHint}".`,
      hook: {
        visual: `${visualBase} Reframe the opening around ${pattern.angle} so "${directionHint}" is visible immediately in the first action.`,
        voice: pattern.hookVoice,
        textOverlay: pattern.hookPrimary,
        viTranslation: `Giữ đúng nỗi đau "${painpoint}" nhưng mở theo hướng "${directionHint}" để người xem dừng lại ngay giây đầu.`,
        viewerProfile: `Người xem giống ${coreUser} và nhận ra đúng bối cảnh của họ.`,
        viewerEmotion: `Người xem thấy ${emotion.toLowerCase()} ngay khi blocker lộ ra.`,
        painpointImpact: `Pain point "${painpoint}" trở nên cụ thể vì blocker xuất hiện ngay khung đầu.`,
        whyTheyStopScrolling: `Khung đầu cho thấy pain point "${painpoint}" theo góc "${pattern.angle}" nên người xem dừng lại để hiểu tiếp.`,
      },
      body: {
        visual: `Push into a closer demo of the same problem, then show how ${psp} changes the situation in a way that is easy to copy for production.`,
        voice: pattern.bodyVoice,
        textOverlay: pattern.bodyOverlay,
        viTranslation: `Cho thấy ${psp} xử lý tình huống này như thế nào theo cách dễ quay và dễ hiểu.`,
      },
      cta: {
        visual: 'End on the app screen with the key action ready to tap and the result visible enough for one clean CTA beat.',
        voice: pattern.ctaVoice,
        textOverlay: pattern.ctaOverlay,
        viTranslation: `Kêu gọi người xem mở app và test biến thể này ngay.`,
        endCard: `${options.appName} - ${psp}`,
      },
    };
  });
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
    const warnings: string[] = [];

    for (const plan of batchPlans) {
      const frameworkInjection = buildFrameworkInjection({
        appName,
        category: appCategory || 'General',
        coreUsers: [hook.core_user || ''].filter(Boolean),
        primaryEmotion: hook.emotion || 'Curiosity',
        visualTheme: `${hook.creative_type || hook.subtitle || 'UGC'}; use the winning hook as DNA, then expand it into a full brief.`,
        psp: hook.hook_concept || hook.description || appName,
        pillars: [hook.painpoint || 'General user friction'].filter(Boolean),
        anglesPerPillar: 1,
        ideasPerAngle: plan.batchQuantity,
        language: `Vietnamese strategy notes + ${targetLanguage} copy`,
        priority: 'A',
        extraContext: [
          'Task type: expand a proven winning hook into new full ideas.',
          'Keep the same strategic DNA, but change situation, character, setting, and opening approach enough to avoid clones.',
          ideaDirection ? `User direction: ${ideaDirection}` : 'No additional user direction.',
        ],
      });
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
        warnings.push(`Batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}: AI returned null, used fallback.`);
        aggregatedIdeas.push(...buildFallbackIdeasFromHook(hook, {
          quantity: plan.batchQuantity,
          startIndex: aggregatedIdeas.length,
          duration,
          appName,
          ideaDirection,
        }));
        continue;
      }

      const parsed = parseJson(text);
      if (!parsed) {
        console.error('[generate-ideas-from-hook] Failed to parse batch:', text.substring(0, 300));
        warnings.push(`Batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}: parse failed, used fallback.`);
        aggregatedIdeas.push(...buildFallbackIdeasFromHook(hook, {
          quantity: plan.batchQuantity,
          startIndex: aggregatedIdeas.length,
          duration,
          appName,
          ideaDirection,
        }));
        continue;
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const validation = normalizeAndValidateIdeas(arr, {
        duration,
        appName,
        pillar: hook.painpoint || 'General user friction',
        batchStartIndex: plan.batchStartIndex,
      });

      if (validation.invalidReasons.length > 0) {
        warnings.push(...validation.invalidReasons);
      }

      const dedupedBatch = dedupeIdeas(validation.valid, aggregatedIdeas).slice(0, plan.batchQuantity);
      aggregatedIdeas.push(...dedupedBatch);

      if (dedupedBatch.length < plan.batchQuantity) {
        warnings.push(`Batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}: only ${dedupedBatch.length}/${plan.batchQuantity} valid unique ideas, topped up with fallback.`);
        aggregatedIdeas.push(...buildFallbackIdeasFromHook(hook, {
          quantity: plan.batchQuantity - dedupedBatch.length,
          startIndex: aggregatedIdeas.length,
          duration,
          appName,
          ideaDirection,
        }));
      }
    }

    if (aggregatedIdeas.length === 0) {
      return NextResponse.json({ error: 'AI tra ve format sai.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: aggregatedIdeas.slice(0, requestedQty),
      meta: { warnings },
    });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
