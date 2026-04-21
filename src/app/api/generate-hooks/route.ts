import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildHookOutputSpec,
  normalizeHookOutput,
  parseJsonLoose,
} from '@/lib/creativePromptSystem';

export const maxDuration = 60;

const MAX_HOOK_VARIATIONS = 20;
const HOOK_MODEL_TIMEOUT_MS = 30000;
const HOOK_FALLBACK_TIMEOUT_MS = 20000;
const FAST_HOOK_MODELS = ['gemini/gemini-2.5-flash', 'gemini/gemini-2.0-flash'];

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

function buildFallbackHookVariations(hook: Record<string, unknown>, instruction: string, quantity: number) {
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
  const instructionHint = compactText(readText(instruction, concept), 88);
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
    const displayIndex = index + 1;

    return {
      id: `hook-fallback-${Date.now()}-${index}`,
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

function resolveHookModels(selected?: string): string[] {
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

  // Modify Hook is hook-only and interactive. Gemini Pro is too slow here, so
  // Gemini selections use Flash while OpenAI selections are respected.
  const primary = resolved?.startsWith('openai/') ? resolved : FAST_HOOK_MODELS[0];
  return Array.from(new Set([primary, ...FAST_HOOK_MODELS]));
}

export async function POST(request: NextRequest) {
  try {
    const { hook, instruction, quantity = 3, appName, appCategory, selectedModel } = await request.json();
    const requestedQuantity = Math.min(toPositiveInt(quantity, 3), MAX_HOOK_VARIATIONS);
    const targetLanguage = 'English';

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

## USER MODIFY BRIEF
"${instruction}"

## TASK
Create exactly ${requestedQuantity} hook-only variations.
- Keep the winning DNA and same problem/emotion target.
- Change the visual execution enough that each variation is distinct.
- Preserve the interaction pattern and number of people when possible.
- Each variation should differ from the original on at least 3 of these axes: situation, character, setting, blocker, mood.
- Strategy/explanation fields can be Vietnamese; hook voice/textOverlay must be ${targetLanguage}.
- Output compact JSON only. No markdown fences. No full Body or CTA.

${buildHookOutputSpec({ quantity: requestedQuantity, language: targetLanguage })}`;

    let text: string | null = null;
    let modelUsed = '';
    const candidateModels = resolveHookModels(selectedModel);
    for (const [index, model] of candidateModels.entries()) {
      text = await askAI(prompt, {
        model,
        temperature: 0.75,
        max_tokens: Math.max(2400, requestedQuantity * 900),
        useCreativePersona: false,
        priority: 'high',
        timeoutMs: index === 0 ? HOOK_MODEL_TIMEOUT_MS : HOOK_FALLBACK_TIMEOUT_MS,
      });
      if (text) {
        modelUsed = model;
        break;
      }
    }

    if (!text) {
      console.warn('[generate-hooks] AI unavailable; returning structured fallback hooks.');
      return NextResponse.json({
        success: true,
        data: buildFallbackHookVariations(hook, instruction, requestedQuantity),
        fallback: true,
        error: 'AI hook generation timed out or gateway returned an error.',
      });
    }

    const parsed = parseJson(text);
    if (!parsed) {
      console.warn('[generate-hooks] Failed to parse AI output; returning structured fallback hooks.');
      return NextResponse.json({
        success: true,
        data: buildFallbackHookVariations(hook, instruction, requestedQuantity),
        fallback: true,
        error: 'Failed to parse AI hook response.',
      });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const data = arr.slice(0, requestedQuantity).map((item: unknown, i: number) => {
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

    return NextResponse.json({ success: true, data, modelUsed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
