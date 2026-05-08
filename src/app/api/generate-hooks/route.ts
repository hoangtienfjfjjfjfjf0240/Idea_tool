import { NextRequest, NextResponse } from 'next/server';
import { askAI, getLastAIErrorMessage } from '@/lib/aiClient';
import {
  normalizeHookOutput,
  parseJsonLoose,
} from '@/lib/creativePromptSystem';
import { guardApiRequest } from '@/lib/apiGuards';
import { detectTargetLanguageFromMarkets } from '@/lib/filterConsistency';
import { enrichHookWithFramework } from '@/lib/hookFramework';

export const maxDuration = 60;

const MAX_HOOK_VARIATIONS = 20;
const HOOK_ROUTE_BUDGET_MS = 54000;
const HOOK_MODEL_TIMEOUT_MS = 50000;
const HOOK_QUEUE_TIMEOUT_MS = 2000;
const MIN_HOOK_MODEL_TIME_MS = 10000;
const GEMINI3_HOOK_MODEL = 'gemini/gemini-3-pro-preview';

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
  const fallbackAnchors = 'Position anchor: lock the main subject/object in a clear left/right or center frame. Contact anchor: show the exact hand/finger/cursor interaction with the object or UI. Physical action anchor: show the visible tap, press, lift, error, reveal, or screen-change action.';
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
        script: `${angle}. Start from: ${visualDetail}. Keep the original pain point "${painpoint}" and make "${instructionHint || baseTitle}" visible in the first second. ${fallbackAnchors}`,
        visual: `${angle}. Start from: ${visualDetail}. Keep "${instructionHint || baseTitle}" visible in the first second. ${fallbackAnchors}`,
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
  const fallbackAnchors = 'Position anchor: lock the main subject/object in a clear left/right or center frame. Contact anchor: show the exact hand/finger/cursor interaction with the object or UI. Physical action anchor: show the visible tap, press, lift, error, reveal, or screen-change action.';
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
        script: `[VISUAL] ${pattern.visualLead} Reference visual DNA: ${visualDetail}. Keep the original pain point "${painpoint}" but push the direction "${instructionHint || baseTitle}" through a clearly different opening action. ${fallbackAnchors}\n[VOICE] ${pattern.voice}\n[TEXT OVERLAY] ${pattern.overlay}`,
        visual: `${pattern.visualLead} Reference visual DNA: ${visualDetail}. Keep "${instructionHint || baseTitle}" visible in the first second through a different opening action. ${fallbackAnchors}`,
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

function resolveHookModels(): string[] {
  return [GEMINI3_HOOK_MODEL];
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'generate-hooks', max: 60, windowMs: 5 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const {
      hook: rawHook,
      instruction,
      quantity = 3,
      appName,
      appCategory,
      selectedModel,
      targetMarket,
      previousHooks,
    } = await request.json();
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
    const previousHooksBlock = readText(previousHooks)
      ? `\nPreviously generated hooks to avoid repeating:\n${readText(previousHooks)}\n`
      : '';

    const prompt = `Use the analyzed hook insight and the user's extra brief to create ${requestedQuantity} modified hook variations.
Return JSON array only. No markdown. No explanation outside JSON.

Analyzed hook:
- App: ${appName || 'N/A'}
- Category: ${appCategory || 'N/A'}
- Title: ${readText(hook.title, 'N/A')}
- Format: ${readText(hook.creative_type, readText(hook.subtitle, 'N/A'))}
- Description: ${readText(hook.description, 'N/A')}
- Hook concept: ${readText(hook.hook_concept, 'N/A')}
- Visual analysis: ${readText(hook.visual_detail, 'N/A')}
- Core user: ${readText(hook.core_user, 'N/A')}
- Painpoint: ${readText(hook.painpoint, 'N/A')}
- Emotion: ${readText(hook.emotion, 'N/A')}
- Target/localization: ${targetMarketValues.join(', ') || 'same as hook'}

User extra brief:
${readText(instruction, 'No extra brief')}
${previousHooksBlock}

Rules:
- Treat the analyzed hook as the reference hook DNA.
- Keep the same hook mechanism, viewer emotion, core painpoint, and creative pattern from the reference hook.
- Modify it into similar hooks in different but related contexts, settings, people, and situations.
- Combine the user's extra brief as the new direction layered on top of the reference hook. Do not replace the reference hook with an unrelated idea.
- Each variation must answer: "same kind of hook, but in what new scenario?"
- Make each variation visually different from the reference hook and from the other variations.
- Vietnamese for title, explanation, hook.visual, hook.textOverlay, viTranslation.
- ${targetLanguage} only for hook.characterSpeech, hook.voiceover, hook.voice.
- If an on-camera person speaks, fill hook.characterSpeech as "0-3s - speaker: line" and leave hook.voiceover empty.
- If no on-camera person speaks, use hook.voiceover and leave hook.characterSpeech empty.
- Do not put voice/text labels inside hook.visual.

Schema:
[
  {
    "title": "Tên hook tiếng Việt",
    "explanation": "Vì sao biến thể này khác và dùng được",
    "meta": {
      "hookPrimary": "Hook text tiếng Việt",
      "hookAlt1": "Alt hook tiếng Việt",
      "hookAlt2": "Alt hook tiếng Việt"
    },
    "hook": {
      "durationSeconds": 3,
      "visual": "Mô tả cảnh hook bằng tiếng Việt, cụ thể bối cảnh mới/tình huống mới/ai/ở đâu/làm gì/camera nhìn gì",
      "textOverlay": "Text trên màn hình tiếng Việt",
      "characterSpeech": "",
      "voiceover": "Câu voice nếu có",
      "voice": "Giống characterSpeech hoặc voiceover",
      "viTranslation": "Dịch tiếng Việt của câu nói/voice"
    }
  }
]`;

    const candidateModels = resolveHookModels();
    const routeStartedAt = Date.now();
    let lastError = 'AI hook generation timed out or gateway returned an error.';
    let bestValidItems: Record<string, unknown>[] = [];
    console.log('[generate-hooks] request', {
      requestedQuantity,
      targetLanguage,
      modelCount: candidateModels.length,
      selectedModel: selectedModel || '',
      forcedModel: GEMINI3_HOOK_MODEL,
    });

    for (const model of candidateModels) {
      const remainingMs = HOOK_ROUTE_BUDGET_MS - (Date.now() - routeStartedAt);
      if (remainingMs < MIN_HOOK_MODEL_TIME_MS) {
        lastError = `${lastError} Route time budget ended before trying ${model}.`;
        break;
      }
      const modelTimeoutMs = Math.min(HOOK_MODEL_TIMEOUT_MS, remainingMs);
      const text = await askAI(prompt, {
        model,
        temperature: 0.55,
        max_tokens: Math.max(1200, requestedQuantity * 520),
        useCreativePersona: false,
        priority: 'high',
        timeoutMs: modelTimeoutMs,
        queueTimeoutMs: HOOK_QUEUE_TIMEOUT_MS,
      });

      if (!text) {
        const aiError = getLastAIErrorMessage();
        lastError = `Model ${model} không trả về text${aiError ? `: ${aiError}` : ''}.`;
        console.warn('[generate-hooks] empty AI response', { model, lastError });
        continue;
      }

      const parsed = parseJson(text);
      if (!parsed) {
        lastError = `Model ${model} trả về text nhưng không parse được JSON.`;
        console.warn('[generate-hooks] parse failed', { model, sample: text.substring(0, 220) });
        continue;
      }

      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const validItems = arr.map((item: unknown, i: number) => {
        const normalized = normalizeHookOutput(item);
        const normalizedHook = (normalized.hook || {}) as Record<string, unknown>;
        const characterSpeech = readText(normalizedHook.characterSpeech);
        const voiceover = readText(normalizedHook.voiceover);
        const textOverlay = readText(normalizedHook.textOverlay, readText(normalizedHook.text));
        const voice = readText(normalizedHook.voice, voiceover || characterSpeech);
        return {
          id: `hook-${Date.now()}-${i}`,
          title: readText(normalized.title, `Biến thể hook ${i + 1}`),
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
      }).filter(item => {
        const hookSection = item.hook as Record<string, unknown>;
        return Boolean(
          readText(item.title)
          || readText(hookSection.visual)
          || readText(hookSection.textOverlay)
          || readText(hookSection.characterSpeech)
          || readText(hookSection.voiceover)
          || readText(hookSection.voice)
        );
      });

      const data = validItems.slice(0, requestedQuantity);
      if (data.length > bestValidItems.length) {
        bestValidItems = data;
      }
      if (data.length >= requestedQuantity) {
        console.log('[generate-hooks] success', { model, count: data.length });
        return NextResponse.json({ success: true, data, modelUsed: model });
      }

      if (data.length > 0) {
        console.log('[generate-hooks] partial success', { model, count: data.length, requestedQuantity });
        return NextResponse.json({
          success: true,
          data,
          modelUsed: model,
          warning: `Gemini 3 returned ${data.length}/${requestedQuantity} usable hooks.`,
          meta: { requestedQuantity, aiCount: data.length },
        });
      }

      lastError = `Model ${model} không tạo được hook có nội dung.`;
      console.warn('[generate-hooks] no usable hooks', { model, requestedQuantity });
    }

    console.warn('[generate-hooks] failed', { lastError, requestedQuantity, bestValidCount: bestValidItems.length });
    return NextResponse.json({
      success: false,
      error: `${lastError} No usable hook variations were produced.`,
    }, { status: 502 });
  } catch (err) {
    console.error('[generate-hooks] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
