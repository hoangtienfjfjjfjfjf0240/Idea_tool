#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const useAiTranslations = args.has('--ai');
const sampleLimit = Number(readArg('--samples') || 8);
const rowLimit = Number(readArg('--limit') || 0);
const pageSize = Math.max(10, Math.min(500, Number(readArg('--page-size') || 200)));
const showMissing = args.has('--show-missing');

loadEnvFile('.env.local');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stats = {
  scanned: 0,
  changed: 0,
  updated: 0,
  failed: 0,
  stringFixes: 0,
  motionFixes: 0,
  translationFixes: 0,
  aiTranslations: 0,
  fallbackTranslations: 0,
  stillMissingTranslations: 0,
};

const rows = await loadIdeaRows();
const translationSources = new Map();
const firstPass = [];

for (const row of rows) {
  const result = normalizeIdeaRow(row, new Map());
  firstPass.push({ row, result });
  if (result.translationNeeded?.source) {
    translationSources.set(result.translationNeeded.sourceKey, result.translationNeeded.source);
  }
}

let aiTranslations = new Map();
if (useAiTranslations && translationSources.size > 0) {
  aiTranslations = await translateHookSources(Array.from(translationSources.entries()));
  stats.aiTranslations = aiTranslations.size;
}

for (const { row } of firstPass) {
  const result = normalizeIdeaRow(row, aiTranslations);
  stats.scanned += 1;

  if (!result.changed) {
    if (result.translationNeeded) {
      stats.stillMissingTranslations += 1;
      if (showMissing && stats.stillMissingTranslations <= sampleLimit) {
        console.log(formatMissing(row, result.translationNeeded));
      }
    }
    continue;
  }

  stats.changed += 1;
  stats.stringFixes += result.reasons.has('string-fix') ? 1 : 0;
  stats.motionFixes += result.reasons.has('motion-visual-fix') ? 1 : 0;
  stats.translationFixes += result.reasons.has('translation-fix') ? 1 : 0;
  stats.fallbackTranslations += result.usedFallbackTranslation ? 1 : 0;

  if (stats.changed <= sampleLimit) {
    console.log(formatSample(row, result));
  }

  if (applyChanges) {
    const { error } = await supabase
      .from('generated_ideas')
      .update({ content: result.content })
      .eq('id', row.id);

    if (error) {
      stats.failed += 1;
      console.error(`Update failed for ${row.id}: ${error.message}`);
    } else {
      stats.updated += 1;
    }
  }
}

console.log(JSON.stringify({
  mode: applyChanges ? 'apply' : 'dry-run',
  ai: useAiTranslations,
  ...stats,
}, null, 2));

function readArg(name) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

async function loadIdeaRows() {
  const loaded = [];
  for (let from = 0; ; from += pageSize) {
    if (rowLimit > 0 && loaded.length >= rowLimit) break;
    const to = rowLimit > 0
      ? Math.min(from + pageSize - 1, rowLimit - 1)
      : from + pageSize - 1;
    const { data, error } = await supabase
      .from('generated_ideas')
      .select('id,title,content,filters_snapshot,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw new Error(`Failed loading generated_ideas: ${error.message}`);
    if (!data || data.length === 0) break;
    loaded.push(...data);
    if (data.length < pageSize) break;
  }
  return loaded;
}

function normalizeIdeaRow(row, aiTranslations) {
  const content = cloneJson(row.content || {});
  const before = stableStringify(content);
  const reasons = new Set();
  const stringFixCount = fixStringsDeep(content);
  if (stringFixCount > 0) reasons.add('string-fix');

  let translationNeeded = null;
  let usedFallbackTranslation = false;
  const hook = asObject(content.hook);
  const spokenSource = getHookSpokenSource(hook);

  if (hook && spokenSource) {
    const sourceKey = normalizeCompareText(spokenSource);
    const current = cleanText(hook.hookVoiceVi || hook.hook_voice_vi || hook.viTranslation || hook.vi_translation || hook.vietnameseTranslation || hook.vietnamese_translation);
    const shouldReplace = !current || !looksVietnamese(current) || looksLikeOriginalCopy(current, spokenSource);
    if (shouldReplace) {
      const aiTranslation = cleanText(aiTranslations.get(sourceKey));
      const fallbackTranslation = aiTranslation || deriveVietnameseHookTranslation(spokenSource, content, row);
      if (fallbackTranslation && looksVietnamese(fallbackTranslation)) {
        hook.viTranslation = fallbackTranslation;
        hook.hookVoiceVi = fallbackTranslation;
        hook.hook_voice_vi = fallbackTranslation;
        reasons.add('translation-fix');
        usedFallbackTranslation = !aiTranslation;
      } else {
        translationNeeded = { sourceKey, source: spokenSource };
      }
    }
  }

  if (fixMotionGraphicVisual(row, content)) {
    reasons.add('motion-visual-fix');
  }

  const after = stableStringify(content);
  return {
    changed: before !== after,
    content,
    reasons,
    translationNeeded,
    usedFallbackTranslation,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeCompareText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function looksVietnamese(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) return true;
  const normalized = normalizeCompareText(text);
  const cues = normalized.match(/\b(?:toi|ban|minh|nguoi|khong|phong|nha|thiet|ke|noi|that|can|muon|nhung|dang|nhin|thay|choang|huyet|tim|nhip|suc|khoe|dien|thoai|anh|video|mien|phi|thu|ngay|kiem|tra|con|so|lo|lang|binh|tinh|camera|iphone|do|luong)\b/g) || [];
  return cues.length >= 2;
}

function looksEnglish(value) {
  const normalized = normalizeCompareText(value);
  const cues = normalized.match(/\b(?:i|im|my|me|you|your|the|this|that|with|without|because|every|again|just|why|what|when|where|how|does|did|was|were|from|into|while|before|after|thought|started|changed|checked|check|phone|heart|rate|blood|pressure|number|scary|calm|alone|nervous|show|real)\b/g) || [];
  return cues.length >= 2;
}

function looksLikeOriginalCopy(candidate, source) {
  const normalizedCandidate = normalizeCompareText(candidate);
  const normalizedSource = normalizeCompareText(source);
  if (!normalizedCandidate || !normalizedSource) return false;
  if (normalizedCandidate === normalizedSource) return true;
  return looksEnglish(candidate) && !looksVietnamese(candidate);
}

function getHookSpokenSource(hook) {
  if (!hook) return '';
  const spoken = [
    hook.characterSpeech,
    hook.character_speech,
    hook.talentSpeech,
    hook.talent_speech,
    hook.voiceover,
    hook.voiceOver,
    hook.voice_over,
  ].map(cleanText).filter(Boolean);
  if (spoken.length > 0) return spoken.join(' / ');
  return cleanText(hook.voice) || cleanText(hook.textOverlay || hook.text_overlay || hook.text);
}

function fixStringsDeep(value) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === 'string') {
        const next = fixVietnameseFallbackText(value[index]);
        if (next !== value[index]) {
          value[index] = next;
          count += 1;
        }
      } else {
        count += fixStringsDeep(value[index]);
      }
    }
    return count;
  }

  for (const key of Object.keys(value)) {
    if (typeof value[key] === 'string') {
      const next = fixVietnameseFallbackText(value[key]);
      if (next !== value[key]) {
        value[key] = next;
        count += 1;
      }
    } else {
      count += fixStringsDeep(value[key]);
    }
  }
  return count;
}

function fixVietnameseFallbackText(raw) {
  let text = raw;
  const replacements = [
    [/Theo phong cach UGC doi thuong,/g, 'Theo phong cách UGC đời thường,'],
    [/Theo goc POV\/screen-perspective,/g, 'Theo góc POV/screen-perspective,'],
    [/Theo phong cach Motion Graphic 2D:/g, 'Theo phong cách Motion Graphic 2D:'],
    [/Motion Graphic 2D thuan:/g, 'Motion Graphic 2D thuần:'],
    [/Trong khung 2D animation minh hoa,/g, 'Trong khung 2D animation minh họa,'],
    [/\bText hien\b/g, 'Text hiện'],
    [/\btypography lon\b/g, 'typography lớn'],
    [/\bchuyen dong\b/g, 'chuyển động'],
    [/\bKhong co\b/g, 'Không có'],
    [/\bnguoi that\b/g, 'người thật'],
    [/\bphong ghi hinh\b/g, 'phòng ghi hình'],
    [/\bva animated\b/g, 'và animated'],
    [/\bTheo phong cach\b/g, 'Theo phong cách'],
    [/\bdoi thuong\b/g, 'đời thường'],
    [/\bminh hoa\b/g, 'minh họa'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function getSelectedVisualType(row, content) {
  const filters = asObject(row.filters_snapshot);
  const values = Array.isArray(filters?.visualType) ? filters.visualType : [];
  const meta = asObject(content.meta);
  return [...values, meta?.visualType, content.creativeType].map(cleanText).filter(Boolean).join(' ');
}

function fixMotionGraphicVisual(row, content) {
  const visualType = normalizeCompareText(getSelectedVisualType(row, content));
  if (!/\bmotion\s*graphic\b/.test(visualType)) return false;

  const sections = ['hook', 'body', 'cta']
    .map(key => [key, asObject(content[key])])
    .filter(([, section]) => section);
  const visualText = sections.map(([, section]) => cleanText(section.visual || section.script)).join(' ');
  const normalized = normalizeCompareText(visualText);
  const offFormat = /\b(?:podcast|interview|talk show|host|guest|speaker\s*[12]|two people|2 people|two men|two women|living room|sofa|armchair|kitchen|ban bep|phong khach|ghe banh|micro|mic|nguoi dan ong|nguoi phu nu|hai nguoi|nhan vat|nguoi that|dien vien)\b/.test(normalized);
  if (!offFormat) return false;

  const metric = inferMetric(content, row);
  const hook = asObject(content.hook);
  const body = asObject(content.body);
  const cta = asObject(content.cta);

  if (hook) {
    hook.visual = `0-2.5s: Motion Graphic 2D thuần trên nền app UI/iPhone: typography lớn nhắc thẳng "${metric}", icon flat, waveform/chart line và data callout bật lên theo beat. Position anchor: iPhone ở giữa khung hình, headline nằm phía trên. Contact anchor: cursor/finger icon chạm vào vùng camera hoặc nút kiểm tra. Physical action anchor: con số/chỉ số phóng to rồi rung nhẹ để kéo mắt vào vấn đề.`;
    hook.script = hook.visual;
  }
  if (body) {
    body.visual = `2.5-5.5s: Motion Graphic 2D zoom vào màn hình app: luồng camera -> xử lý -> chart ${metric} chạy thành đường line rõ ràng, mũi tên và nhãn UI giải thích từng bước. Position anchor: app screen chiếm 70% khung hình. Contact anchor: finger/cursor icon giữ trên nút bắt đầu. Physical action anchor: chart fill từ trái sang phải, số đo đổi màu để tạo cảm giác đã kiểm tra xong.`;
    body.script = body.visual;
  }
  if (cta) {
    cta.visual = `5.5-8s: Motion Graphic 2D end beat: icon app, khung kết quả ${metric}, nút CTA và một checkmark chuyển động nhẹ. Position anchor: app icon bên trái, CTA bên phải. Contact anchor: cursor/finger icon chạm CTA. Physical action anchor: checkmark bật lên, chart thu nhỏ vào màn hình kết quả.`;
    cta.script = cta.visual;
  }
  return true;
}

function inferMetric(content, row) {
  const haystack = normalizeCompareText([
    row.title,
    content?.framework?.painpoint,
    content?.framework?.psp,
    content?.hook?.text,
    content?.hook?.textOverlay,
    content?.hook?.voice,
    content?.hook?.voiceover,
    content?.hook?.characterSpeech,
    content?.body?.voice,
    content?.cta?.voice,
  ].map(cleanText).join(' '));

  if (/\b(?:blood pressure|huyet ap)\b/.test(haystack)) return 'huyết áp';
  if (/\b(?:heart rate|nhip tim|cardiac|heart)\b/.test(haystack)) return 'nhịp tim';
  if (/\b(?:calorie|calo|kcal|food)\b/.test(haystack)) return 'calorie';
  if (/\b(?:interior|decor|noi that|phong|home design)\b/.test(haystack)) return 'thiết kế nội thất';
  if (/\b(?:storage|cleaner|dung luong|bo nho)\b/.test(haystack)) return 'dung lượng';
  if (/\b(?:battery|pin|sac)\b/.test(haystack)) return 'pin';
  return 'chỉ số cần kiểm tra';
}

function deriveVietnameseHookTranslation(source, content, row) {
  const sourceText = cleanText(source).replace(/\[CHARACTER SPEECH\]|\[VOICE VIDEO\]|\[VOICEOVER\]/gi, '').trim();
  const normalized = normalizeCompareText(sourceText);
  const exact = new Map([
    ['some heart issues start as something small you ignore', 'Một số vấn đề về tim bắt đầu từ dấu hiệu nhỏ mà bạn bỏ qua.'],
    ['he thought it was just being tired', 'Ông ấy tưởng đó chỉ là mệt.'],
    ['then his heart rate told a different story', 'Rồi nhịp tim của ông ấy cho thấy điều khác.'],
    ['i didnt want to guess', 'Tôi không muốn đoán mò.'],
    ['so i used my iphone camera', 'Vì vậy tôi dùng camera iPhone.'],
    ['heart rate can change everything', 'Nhịp tim có thể thay đổi toàn bộ cách bạn nhìn tình huống này.'],
    ['heart rate feels different tonight', 'Tối nay nhịp tim có cảm giác khác lạ.'],
    ['thats why i check mine every day now', 'Đó là lý do bây giờ tôi kiểm tra hằng ngày.'],
    ['this number can calm a scary moment', 'Con số này có thể làm dịu một khoảnh khắc đáng sợ.'],
    ['i was alone and got nervous', 'Tôi ở một mình và thấy lo.'],
    ['so i checked my heart rate right away', 'Nên tôi kiểm tra nhịp tim ngay.'],
    ['no way show me', 'Không thể nào, cho tôi xem đi.'],
    ['he told me his phone checked blood pressure', 'Ông ấy nói điện thoại của ông ấy kiểm tra được huyết áp.'],
    ['my friend said this was real', 'Bạn tôi nói chuyện này là thật.'],
    ['a swollen look tired eyes and dull skin can be easy to dismiss', 'Gương mặt sưng, mắt mệt và da xỉn màu rất dễ bị bỏ qua.'],
    ['it may be more than fatigue', 'Có thể đó không chỉ là mệt mỏi.'],
    ['pinterest can be inspiring but it can also trap you in styles that look great online and feel', 'Pinterest có thể truyền cảm hứng, nhưng cũng dễ khiến bạn mắc kẹt trong kiểu đẹp trên mạng mà không hợp phòng thật.'],
    ['but does it fit this room', 'Nhưng nó có hợp căn phòng này không?'],
    ['trend furniture can make a small room feel like storage', 'Đồ nội thất theo trend có thể khiến phòng nhỏ trông như kho.'],
    ['that trendy piece could ruin the room', 'Món đồ đang trend đó có thể phá hỏng cả căn phòng.'],
    ['my friend mentioned stroke and i got quiet', 'Bạn tôi nhắc đến đột quỵ, và tôi im lặng hẳn.'],
    ['show me how', 'Chỉ tôi cách làm đi.'],
    ['three taps can cut the clutter fast', 'Ba lần chạm có thể dọn bớt rác máy rất nhanh.'],
    ['you really going inside just to strap that thing on', 'Anh thật sự định vào trong chỉ để đeo cái đó à?'],
    ['man throw that dinosaur away let me show you something', 'Bỏ cái đồ cổ đó đi, để tôi chỉ anh cái này.'],
    ['i swear this thing is going to catch fire', 'Tôi thề là cái máy này sắp bốc cháy.'],
    ['honestly every time they scan a menu i swallow hidden junk files', 'Nói thật, mỗi lần họ quét menu, tôi lại nuốt thêm một đống file rác ẩn.'],
  ]);

  const translatedSegments = sourceText
    .split(/\s*\/\s*/)
    .map(segment => translateSegment(segment, exact))
    .filter(Boolean);
  if (translatedSegments.length > 0 && translatedSegments.every(looksVietnamese)) {
    return translatedSegments.join(' / ');
  }

  const metric = inferMetric(content, row);
  if (/\bheart\s*rate\b|\bnhip\s*tim\b/.test(normalized)) {
    if (/\btired\b/.test(normalized)) return 'Người trong hook tưởng chỉ là mệt, nhưng nhịp tim lại cho thấy điều khác.';
    if (/\balone|nervous|scary|calm\b/.test(normalized)) return 'Khi ở một mình và thấy lo, con số nhịp tim giúp người xem bình tĩnh hơn.';
    if (/\bcheck|checked|camera|iphone\b/.test(normalized)) return 'Hook nói thẳng về việc kiểm tra nhịp tim bằng camera iPhone.';
    return 'Hook nói thẳng về chỉ số nhịp tim và lý do cần kiểm tra ngay.';
  }
  if (/\bblood\s*pressure\b|\bhuyet\s*ap\b/.test(normalized)) {
    return 'Hook nói thẳng về việc kiểm tra huyết áp bằng iPhone trong tình huống này.';
  }
  if (/\bcalorie|kcal|food\b/.test(normalized)) {
    return 'Hook nói thẳng về việc kiểm tra calorie để người xem hiểu món ăn ngay.';
  }
  if (/\bphone|iphone|camera|app\b/.test(normalized)) {
    return `Hook nói thẳng rằng iPhone/app có thể giúp kiểm tra ${metric}.`;
  }
  return '';
}

function translateSegment(segment, exact) {
  const cleaned = cleanText(segment)
    .replace(/^speaker\s*1\s*:\s*/i, 'Người 1: ')
    .replace(/^speaker\s*2\s*:\s*/i, 'Người 2: ')
    .replace(/^host\s*:\s*/i, 'Host: ')
    .replace(/^phone\s*:\s*/i, 'Điện thoại: ')
    .replace(/^["']|["']$/g, '');
  if (!cleaned) return '';
  const labelMatch = cleaned.match(/^(Người\s*[12]|Host|Điện thoại):\s*(.+)$/i);
  const label = labelMatch ? `${labelMatch[1]}: ` : '';
  const body = labelMatch ? labelMatch[2] : cleaned;
  const normalized = normalizeCompareText(body)
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (exact.has(normalized)) return `${label}${exact.get(normalized)}`;
  if (looksVietnamese(body) && !looksEnglish(body)) return fixVietnameseFallbackText(cleaned);
  return '';
}

async function translateHookSources(entries) {
  const baseUrl = (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || process.env.AI_GATEWAY_API_KEY;
  if (!baseUrl || !apiKey) {
    console.warn('AI translation skipped: missing AI_BASE_URL or AI_API_KEY.');
    return new Map();
  }

  const url = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : baseUrl.endsWith('/v1')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;
  const model = process.env.BACKFILL_TRANSLATION_MODEL || 'openai/gpt-5.4-mini';
  const translations = new Map();

  for (let index = 0; index < entries.length; index += 25) {
    const batch = entries.slice(index, index + 25).map(([key, source]) => ({ key, source }));
    const prompt = `Translate hook voice/speech lines into natural Vietnamese for an internal ad-idea card.
Rules:
- Translate only meaning, do not add claims.
- Preserve Speaker 1 / Speaker 2 labels as "Người 1" / "Người 2".
- Return JSON only: {"translations":[{"key":"...","vi":"..."}]}

INPUT:
${JSON.stringify(batch)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 4096,
          stream: false,
          messages: [
            { role: 'system', content: 'You are a precise English-to-Vietnamese translator for short ad hook lines.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`AI translation batch failed: HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      const text = json?.choices?.[0]?.message?.content || '';
      const parsed = parseJson(text);
      const items = Array.isArray(parsed?.translations) ? parsed.translations : [];
      for (const item of items) {
        const key = cleanText(item?.key);
        const vi = cleanText(item?.vi);
        if (key && vi && looksVietnamese(vi) && !looksEnglish(vi)) {
          translations.set(key, vi);
        }
      }
    } catch (error) {
      console.warn(`AI translation batch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return translations;
}

function parseJson(text) {
  const cleaned = cleanText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function formatSample(row, result) {
  return [
    `- ${row.id} | ${row.title || '(untitled)'}`,
    `  reasons: ${Array.from(result.reasons).join(', ')}`,
  ].join('\n');
}

function formatMissing(row, missing) {
  return [
    `- missing ${row.id} | ${row.title || '(untitled)'}`,
    `  source: ${missing.source}`,
  ].join('\n');
}
