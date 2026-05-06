import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildHookOutputSpec,
  normalizeHookOutput,
  parseJsonLoose,
} from '@/lib/creativePromptSystem';
import { guardApiRequest } from '@/lib/apiGuards';
import {
  buildFilterConsistencyPromptBlock,
  detectTargetLanguageFromMarkets,
} from '@/lib/filterConsistency';
import { enrichHookWithFramework } from '@/lib/hookFramework';

export const maxDuration = 60;

const MAX_HOOK_VARIATIONS = 20;
const HOOK_MODEL_TIMEOUT_MS = 45000;
const HOOK_FALLBACK_TIMEOUT_MS = 20000;
const FAST_HOOK_MODELS = ['gemini/gemini-2.5-flash', 'gemini/gemini-2.0-flash', 'openai/gpt-5.4-mini'];

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseJson(text: string) {
  return parseJsonLoose(text);
}

function readText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => readText(item))
      .filter(Boolean);
  }
  const text = readText(value);
  return text ? [text] : [];
}

function stripVariantSuffix(value: string) {
  let next = value.trim();
  while (/\s*-\s*Biến thể\s*\d+\s*$/i.test(next)) {
    next = next.replace(/\s*-\s*Biến thể\s*\d+\s*$/i, '').trim();
  }
  return next;
}

function compactText(value: string, limit = 72) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function normalizeCompareText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function jaccardSimilarity(a: string, b: string) {
  const tokensA = new Set(normalizeCompareText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompareText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function extractInstructionHint(instruction: string, fallback: string) {
  const lines = instruction
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .filter(line => !/^ket hop hook\b/i.test(normalizeCompareText(line)));

  return compactText(lines[0] || fallback, 88);
}

function hasCjkText(value: string) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value);
}

function isUsableHookVariation(
  item: Record<string, unknown>,
  instruction: string,
  sourceHook: Record<string, unknown>,
) {
  const normalizedHook = (item.hook || {}) as Record<string, unknown>;
  const voice = readText(normalizedHook.voice);
  const textOverlay = readText(normalizedHook.textOverlay, readText(normalizedHook.text));
  const visual = readText(normalizedHook.visual, readText(normalizedHook.script));
  const combined = `${voice}\n${textOverlay}\n${visual}`.trim();
  if (!combined) return false;

  const normalizedCombined = normalizeCompareText(combined);
  const normalizedInstruction = normalizeCompareText(instruction);
  const normalizedTitle = normalizeCompareText(stripVariantSuffix(readText(sourceHook.title, '')));
  const bannedMarkers = [
    'ket hop hook',
    'phong cach',
  ];

  if (bannedMarkers.some(marker => normalizedCombined.includes(marker))) {
    return false;
  }

  if (normalizedInstruction && normalizedInstruction.length > 24 && normalizedCombined.includes(normalizedInstruction)) {
    return false;
  }

  if (
    normalizedTitle &&
    normalizedCombined.includes(normalizedTitle) &&
    (normalizedCombined.includes('bien the') || normalizedCombined.includes('variant'))
  ) {
    return false;
  }

  return true;
}

function buildHookVariationFingerprint(item: Record<string, unknown>) {
  const normalizedHook = (item.hook || {}) as Record<string, unknown>;
  return [
    readText(item.title),
    readText(normalizedHook.visual, readText(normalizedHook.script)),
    readText(normalizedHook.voice),
    readText(normalizedHook.textOverlay, readText(normalizedHook.text)),
  ]
    .filter(Boolean)
    .join('\n');
}

function isDistinctHookVariation(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>[],
) {
  const candidateHook = (candidate.hook || {}) as Record<string, unknown>;
  const candidateVoice = readText(candidateHook.voice);
  const candidateOverlay = readText(candidateHook.textOverlay, readText(candidateHook.text));
  const candidateVisual = readText(candidateHook.visual, readText(candidateHook.script));
  const candidateFingerprint = buildHookVariationFingerprint(candidate);
  const cjkCopy = hasCjkText(`${candidateVoice} ${candidateOverlay}`);

  if (!cjkCopy && countWords(candidateVoice) < 4 && countWords(candidateOverlay) < 2) {
    return false;
  }

  if (cjkCopy && `${candidateVoice}${candidateOverlay}`.replace(/\s+/g, '').length < 6) {
    return false;
  }

  return existing.every(item => {
    const hook = (item.hook || {}) as Record<string, unknown>;
    const voice = readText(hook.voice);
    const overlay = readText(hook.textOverlay, readText(hook.text));
    const visual = readText(hook.visual, readText(hook.script));
    const fingerprint = buildHookVariationFingerprint(item);

    const normalizedCandidateOverlay = normalizeCompareText(candidateOverlay);
    const normalizedOverlay = normalizeCompareText(overlay);
    if (normalizedCandidateOverlay && normalizedOverlay && normalizedCandidateOverlay === normalizedOverlay) {
      return false;
    }

    const normalizedCandidateVoice = normalizeCompareText(candidateVoice);
    const normalizedVoice = normalizeCompareText(voice);
    if (normalizedCandidateVoice && normalizedVoice && normalizedCandidateVoice === normalizedVoice) {
      return false;
    }

    if (jaccardSimilarity(candidateFingerprint, fingerprint) >= 0.72) {
      return false;
    }

    if (
      candidateVisual &&
      visual &&
      jaccardSimilarity(candidateVisual, visual) >= 0.82 &&
      jaccardSimilarity(candidateVoice, voice) >= 0.45
    ) {
      return false;
    }

    return true;
  });
}

function dedupeHookVariations(items: Record<string, unknown>[]) {
  const unique: Record<string, unknown>[] = [];
  for (const item of items) {
    if (isDistinctHookVariation(item, unique)) {
      unique.push(item);
    }
  }
  return unique;
}

function buildFallbackHookVariations(
  hook: Record<string, unknown>,
  instruction: string,
  quantity: number,
  startIndex = 0,
) {
  const title = readText(hook.title, 'Winning Hook');
  const baseTitle = stripVariantSuffix(title) || title;
  const concept = readText(hook.hook_concept, title);
  const visualDetail = readText(
    hook.visual_detail,
    'A tight handheld close-up that reveals the pain point immediately',
  );
  const painpoint = readText(hook.painpoint, 'the viewer pain point');
  const emotion = readText(hook.emotion, 'curiosity');
  const coreUser = readText(hook.core_user, 'target viewer');
  const instructionHint = extractInstructionHint(readText(instruction, concept), concept);
  const overlayBase = compactText(baseTitle, 32) || 'Winning hook';
  const bases = [
    'Change the setting and make the first frame more unexpected',
    'Keep the same object but reveal the blocker through a different action',
    'Turn the same hook into a direct POV moment with a clearer visual contrast',
    'Use a social proof or comparison frame without changing the pain point',
    'Make the first second feel more urgent through prop, framing, and text',
  ];

  return Array.from({ length: quantity }, (_, index) => {
    const angle = bases[index % bases.length];
    const displayIndex = startIndex + index + 1;

    return {
      id: `hook-fallback-${Date.now()}-${displayIndex}`,
      title: `${baseTitle} - Biến thể ${displayIndex}`,
      explanation: `Fallback nhanh vì AI gateway đang lỗi. Giữ concept "${concept}", đổi execution theo hướng: ${angle}.`,
      meta: {
        builderVersion: 'hook_library_fast_fallback_v1',
        hookPrimary: overlayBase,
        hookAlt1: compactText(`${overlayBase} - góc mở khác`, 40),
        hookAlt2: compactText(`${overlayBase} - nhấn đau hơn`, 40),
        visualRefNotes: visualDetail,
        talentProfile: coreUser,
        dontDo: 'Do not turn this into a full Body or CTA script',
      },
      hook: {
        script: `${angle}. Start from: ${visualDetail}. Keep the original pain point "${painpoint}" and make "${instructionHint || baseTitle}" visible in the first second.`,
        visual: `${angle}. Start from: ${visualDetail}. Keep "${instructionHint || baseTitle}" visible in the first second.`,
        text: overlayBase,
        voice: `${overlayBase}: keep the same pain point, but reveal it faster in the first second.`,
        textOverlay: overlayBase,
        viTranslation: `${overlayBase}: giữ đúng nỗi đau cũ, nhưng mở nhanh hơn ngay giây đầu tiên.`,
        viewerEmotion: emotion,
        painpointImpact: painpoint,
        whyTheyStopScrolling: `Visual đổi bối cảnh nhưng vẫn bám đúng nỗi đau "${painpoint}", nên người xem nhận ra vấn đề ngay.`,
      },
    };
  });
}

function buildBetterFallbackHookVariations(
  hook: Record<string, unknown>,
  instruction: string,
  quantity: number,
  startIndex = 0,
) {
  const title = readText(hook.title, 'Winning Hook');
  const baseTitle = stripVariantSuffix(title) || title;
  const concept = readText(hook.hook_concept, title);
  const visualDetail = readText(
    hook.visual_detail,
    'A tight handheld close-up that reveals the pain point immediately',
  );
  const painpoint = readText(hook.painpoint, 'the viewer pain point');
  const emotion = readText(hook.emotion, 'curiosity');
  const coreUser = readText(hook.core_user, 'target viewer');
  const instructionHint = extractInstructionHint(readText(instruction, concept), concept);
  const patterns = [
    {
      angle: 'Move the hook into a desk setup with a sudden close-up reveal',
      visualLead: 'Open in a real work desk setup with the hand hovering over the object, then snap into a macro close-up on the exact blocker.',
      voice: `Wait, why does this simple move expose ${painpoint}?`,
      overlay: compactText(`Why this move reveals ${painpoint}`, 36),
    },
    {
      angle: 'Keep the same object but show the blocker through a sharper hand action',
      visualLead: 'Start with the same object from the winning hook, but use a stop-start hand action so the blocker appears on the second beat.',
      voice: 'Same setup, but this gesture makes the blocker impossible to miss.',
      overlay: 'The detail people miss',
    },
    {
      angle: 'Switch to a POV angle with harder contrast and a tighter frame',
      visualLead: 'Turn the camera into a direct POV shot and make the problem pop through tighter framing and stronger contrast.',
      voice: 'From this angle, the problem hits instantly.',
      overlay: 'See the problem instantly',
    },
    {
      angle: 'Use a side-by-side compare frame to make the blocker feel social',
      visualLead: 'Split the screen into a familiar wrong version and a corrected version so the viewer spots the blocker on sight.',
      voice: 'Most people still miss the real trigger until they see this compare.',
      overlay: 'Most people miss this',
    },
    {
      angle: 'Add urgency with a faster prop cue and a cleaner first-second check',
      visualLead: 'Bring in one extra prop and a faster first gesture so the scene feels urgent before the explanation lands.',
      voice: 'If this keeps happening, check this first before you move on.',
      overlay: 'Check this first',
    },
  ];

  return Array.from({ length: quantity }, (_, index) => {
    const pattern = patterns[index % patterns.length];
    const displayIndex = startIndex + index + 1;

    return {
      id: `hook-fallback-clean-${Date.now()}-${displayIndex}`,
      title: `${baseTitle} - Biến thể ${displayIndex}`,
      explanation: `Fallback nhanh vì AI gateway đang lỗi. Giữ concept "${concept}", đổi execution theo hướng: ${pattern.angle}.`,
      meta: {
        builderVersion: 'hook_library_fast_fallback_v2',
        hookPrimary: pattern.overlay,
        hookAlt1: compactText('Still missing this detail?', 40),
        hookAlt2: compactText('The real trigger is here', 40),
        visualRefNotes: visualDetail,
        talentProfile: coreUser,
        dontDo: 'Do not turn this into a full Body or CTA script',
      },
      hook: {
        script: `[VISUAL] ${pattern.visualLead} Reference visual DNA: ${visualDetail}. Keep the original pain point "${painpoint}" but push the direction "${instructionHint || baseTitle}" through a clearly different opening action.\n[VOICE] ${pattern.voice}\n[TEXT OVERLAY] ${pattern.overlay}`,
        visual: `${pattern.visualLead} Reference visual DNA: ${visualDetail}. Keep "${instructionHint || baseTitle}" visible in the first second through a different opening action.`,
        text: pattern.overlay,
        voice: pattern.voice,
        textOverlay: pattern.overlay,
        viTranslation: `Giữ đúng nỗi đau "${painpoint}", nhưng mở theo hướng "${instructionHint}" để người xem thấy vấn đề ngay giây đầu.`,
        viewerEmotion: emotion,
        painpointImpact: painpoint,
        whyTheyStopScrolling: `Visual đổi bối cảnh nhưng vẫn bám đúng nỗi đau "${painpoint}", nên người xem nhận ra vấn đề ngay.`,
      },
    };
  });
}

function resolveHookModels(selected?: string): string[] {
  if (selected === 'gemini-3-pro') {
    return [
      'gemini/gemini-2.5-flash',
      'gemini/gemini-2.5-pro',
      'gemini/gemini-3-pro-preview',
      ...FAST_HOOK_MODELS,
    ].filter((model, index, models) => models.indexOf(model) === index);
  }

  const map: Record<string, string> = {
    'gemini-2.5-flash': 'gemini/gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini/gemini-2.5-pro',
    'gemini-3-pro': 'gemini/gemini-3-pro-preview',
    'gpt-5.4': 'openai/gpt-5.4',
    'gpt-5.4-pro': 'openai/gpt-5.4-pro-2026-03-05',
    'gpt-5.4-mini': 'openai/gpt-5.4-mini',
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  const resolved = map[selected || ''];

  const primary = resolved || FAST_HOOK_MODELS[0];
  return Array.from(new Set([primary, ...FAST_HOOK_MODELS]));
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'generate-hooks', max: 60, windowMs: 5 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const { hook: rawHook, instruction, quantity = 3, appName, appCategory, selectedModel, targetMarket } = await request.json();
    const hook = enrichHookWithFramework(rawHook || {}, { appName, appCategory });
    const requestedQuantity = Math.min(toPositiveInt(quantity, 3), MAX_HOOK_VARIATIONS);
    const targetMarketValues = [
      ...readTextList(targetMarket),
      ...readTextList(hook?.targetMarket),
      ...readTextList(hook?.target_market),
    ];
    const targetLanguage = detectTargetLanguageFromMarkets(targetMarketValues, [
      readText(hook.core_user),
      readText(hook.coreUser),
      readText(hook.viewerProfile),
    ].filter(Boolean)) || 'English';
    const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
      solutionValues: [readText(hook.hook_concept, readText(hook.description))].filter(Boolean),
      angleValues: [readText(hook.title), readText(hook.description), readText(instruction)].filter(Boolean),
      painPointValues: [readText(hook.painpoint)].filter(Boolean),
    });

    const prompt = `You are a senior performance creative strategist for mobile app ads.
Create hook-only variations for a winning hook. This is not a full idea and must stay fast.

## WINNING HOOK DNA
- App: ${appName || 'N/A'}
- Category: ${appCategory || 'N/A'}
- Title: "${hook.title}"
- Description: ${hook.description || 'N/A'}
- Hook concept: ${hook.hook_concept || 'N/A'}
- Creative type: ${hook.creative_type || hook.subtitle || 'N/A'}
- Original visual: ${hook.visual_detail || 'N/A'}
- Core user: ${hook.core_user || 'N/A'}
- Painpoint: ${hook.painpoint || 'N/A'}
- Viewer emotion target: ${hook.emotion || 'N/A'}
- Target market/localization: ${targetMarketValues.join(', ') || 'same as the winning hook'}
${filterConsistencyBlock || ''}

## USER MODIFY BRIEF
"${instruction}"

## TASK
Create exactly ${requestedQuantity} hook-only variations.
- Keep the winning DNA and same problem/emotion target.
- Change the visual execution enough that each variation is distinct.
- Preserve the interaction pattern and number of people when possible.
- Each variation should differ from the original on at least 3 of these axes: situation, character, setting, blocker, mood.
- Strategy/explanation fields can be Vietnamese; title, hook voice, character speech, voiceover, and textOverlay must be ${targetLanguage}.
- Target market controls local behavior, setting, culture, props, and vibe only. Do not switch copy away from ${targetLanguage}.
- Output compact JSON only. No markdown fences. No full Body or CTA.

${buildHookOutputSpec({ quantity: requestedQuantity, language: targetLanguage })}`;

    const candidateModels = resolveHookModels(selectedModel);
    let lastError = 'AI hook generation timed out or gateway returned an error.';
    let bestValidItems: Record<string, unknown>[] = [];

    for (const [index, model] of candidateModels.entries()) {
      const text = await askAI(prompt, {
        model,
        temperature: 0.75,
        max_tokens: Math.max(2400, requestedQuantity * 900),
        useCreativePersona: false,
        priority: 'high',
        timeoutMs: index === 0 ? HOOK_MODEL_TIMEOUT_MS : HOOK_FALLBACK_TIMEOUT_MS,
      });

      if (!text) {
        lastError = `Model ${model} không trả về text.`;
        continue;
      }

      const parsed = parseJson(text);
      if (!parsed) {
        lastError = `Model ${model} trả về text nhưng không parse được JSON.`;
        continue;
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const validItems = dedupeHookVariations(arr.map((item: unknown, i: number) => {
        const normalized = normalizeHookOutput(item);
        const normalizedHook = (normalized.hook || {}) as Record<string, unknown>;
        const characterSpeech = readText(normalizedHook.characterSpeech);
        const voiceover = readText(normalizedHook.voiceover);
        const textOverlay = readText(normalizedHook.textOverlay, readText(normalizedHook.text));
        const voice = readText(normalizedHook.voice, voiceover || characterSpeech || textOverlay);
        return {
          id: `hook-${Date.now()}-${i}`,
          title: normalized.title || `Bien the ${i + 1}`,
          explanation: normalized.explanation || '',
          meta: normalized.meta || {},
          hook: {
            script: normalizedHook.script || '',
            textOverlay,
            visual: normalizedHook.visual || normalizedHook.script || '',
            text: readText(normalizedHook.text, textOverlay),
            characterSpeech,
            voiceover,
            voice,
            viTranslation: normalizedHook.viTranslation || '',
            viewerEmotion: normalizedHook.viewerEmotion || '',
            painpointImpact: normalizedHook.painpointImpact || '',
            whyTheyStopScrolling: normalizedHook.whyTheyStopScrolling || '',
          },
        };
      }).filter(item => isUsableHookVariation(item, readText(instruction), hook)));

      const data = validItems.slice(0, requestedQuantity);
      if (data.length > bestValidItems.length) {
        bestValidItems = data;
      }
      if (data.length >= requestedQuantity) {
        return NextResponse.json({ success: true, data, modelUsed: model });
      }

      lastError = `Model ${model} chỉ tạo được ${data.length}/${requestedQuantity} hook hợp lệ.`;
    }

    const allowLocalRefill = targetLanguage === 'English';
    const refillCount = allowLocalRefill ? Math.max(0, requestedQuantity - bestValidItems.length) : 0;
    const refillItems = refillCount > 0
      ? buildBetterFallbackHookVariations(hook, readText(instruction), refillCount, bestValidItems.length)
        .filter(item => isUsableHookVariation(item, readText(instruction), hook))
      : [];
    const data = dedupeHookVariations([...bestValidItems, ...refillItems]).slice(0, requestedQuantity);

    if (data.length > 0) {
      return NextResponse.json({
        success: true,
        data,
        modelUsed: bestValidItems.length > 0 ? 'partial-ai-with-local-refill' : 'local-refill',
        warning: `${lastError} Returned ${bestValidItems.length} clean AI hook(s) and ${Math.max(0, data.length - bestValidItems.length)} local refill hook(s).`,
        meta: {
          aiCount: bestValidItems.length,
          refillCount: Math.max(0, data.length - bestValidItems.length),
          localRefillSkippedForLanguage: !allowLocalRefill && bestValidItems.length < requestedQuantity,
          requestedQuantity,
        },
      });
    }

    return NextResponse.json({
      success: false,
      error: `${lastError} No usable hook variations were produced.`,
    }, { status: 502 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
