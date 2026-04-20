import { NextRequest, NextResponse } from 'next/server';
import { createPartFromUri, createUserContent, GoogleGenAI } from '@google/genai';
import { parseJsonLoose } from '@/lib/creativePromptSystem';

export const maxDuration = 300;

const AI_BASE_URL = process.env.AI_BASE_URL || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.AI_API_KEY || '';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || (AI_BASE_URL ? `${AI_BASE_URL.replace(/\/+$/, '')}/gemini` : '');
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

type ImportedTrendAnalysis = {
  title: string;
  summary: string;
  creativeType: string;
  angleType: string;
  emotionalDriver: string;
  hookPattern: string;
  bodyPattern: string;
  ctaPattern: string;
  visualStyle: string;
  audioStyle: string;
  textOverlayStyle: string;
  keyMoments: string[];
  filterHints: {
    emotion: string[];
    angle: string[];
    visualType: string[];
  };
};

function createGeminiClient() {
  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    apiVersion: GEMINI_API_VERSION,
    ...(GEMINI_BASE_URL
      ? {
          httpOptions: {
            baseUrl: GEMINI_BASE_URL,
          },
        }
      : {}),
  });
}

function normalizeText(value: unknown, fallback = ''): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function normalizeList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function isYouTubeUrl(url: URL) {
  return /(^|\.)youtube\.com$/i.test(url.hostname) || /(^|\.)youtu\.be$/i.test(url.hostname);
}

function isDirectVideoUrl(url: URL) {
  return /\.(mp4|mov|webm|avi|mpeg|mpg|wmv|3gp)(\?|#|$)/i.test(url.pathname);
}

function decodeCandidateUrl(raw: string) {
  return raw
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003D/g, '=')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .trim();
}

function toAbsoluteUrl(candidate: string, baseUrl: string) {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return '';
  }
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Không mở được trang video (${response.status}).`);
  }

  return response.text();
}

function extractVideoCandidates(html: string, baseUrl: string) {
  const rawCandidates = new Set<string>();
  const patterns = [
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/gi,
    /"downloadAddr":"([^"]+)"/gi,
    /"playAddr":"([^"]+)"/gi,
    /"playAddrH264":"([^"]+)"/gi,
    /"contentUrl":"([^"]+)"/gi,
    /https?:\/\/[^"'\\\s>]+?\.(?:mp4|mov|webm|avi|mpeg|mpg|wmv|3gp)(?:\?[^"'\\\s>]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      rawCandidates.add(decodeCandidateUrl(match[1] || match[0]));
    }
  }

  return [...rawCandidates]
    .map(candidate => toAbsoluteUrl(candidate, baseUrl))
    .filter(Boolean);
}

async function resolveVideoSource(inputUrl: string) {
  const parsedUrl = new URL(inputUrl);

  if (isYouTubeUrl(parsedUrl)) {
    return {
      mode: 'youtube' as const,
      sourceUrl: inputUrl,
      resolvedVideoUrl: inputUrl,
      sourceLabel: 'Public YouTube video',
    };
  }

  if (isDirectVideoUrl(parsedUrl)) {
    return {
      mode: 'download' as const,
      sourceUrl: inputUrl,
      resolvedVideoUrl: inputUrl,
      sourceLabel: 'Direct video URL',
    };
  }

  const html = await fetchHtml(inputUrl);
  const candidates = extractVideoCandidates(html, inputUrl);

  if (!candidates.length) {
    throw new Error(
      'Không resolve được video từ URL này. Trước mắt hỗ trợ direct MP4/WebM, YouTube public, hoặc trang có og:video/playAddr công khai.'
    );
  }

  return {
    mode: 'download' as const,
    sourceUrl: inputUrl,
    resolvedVideoUrl: candidates[0],
    sourceLabel: `Resolved video from ${parsedUrl.hostname}`,
  };
}

function guessMimeType(url: string, contentType: string | null) {
  const headerType = normalizeText(contentType).split(';')[0];
  if (headerType.startsWith('video/')) return headerType;

  const lowered = url.toLowerCase();
  if (lowered.includes('.webm')) return 'video/webm';
  if (lowered.includes('.mov')) return 'video/mov';
  if (lowered.includes('.avi')) return 'video/avi';
  if (lowered.includes('.wmv')) return 'video/wmv';
  if (lowered.includes('.mpeg') || lowered.includes('.mpg')) return 'video/mpeg';
  return 'video/mp4';
}

function fileStateName(file: { state?: string | { name?: string } | null }) {
  if (!file.state) return 'UNKNOWN';
  if (typeof file.state === 'string') return file.state;
  return normalizeText(file.state.name, 'UNKNOWN');
}

async function waitUntilFileActive(ai: GoogleGenAI, fileName: string) {
  let current = await ai.files.get({ name: fileName });

  for (let attempt = 0; attempt < 45; attempt++) {
    const state = fileStateName(current);
    if (state === 'ACTIVE') return current;
    if (state && state !== 'PROCESSING') {
      throw new Error(`Gemini chưa xử lý được video (${state}).`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    current = await ai.files.get({ name: fileName });
  }

  throw new Error('Gemini xử lý video quá lâu, hãy thử video ngắn hơn.');
}

async function uploadRemoteVideo(ai: GoogleGenAI, videoUrl: string) {
  const response = await fetch(videoUrl, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'video/*,*/*;q=0.8',
      referer: videoUrl,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Không tải được video nguồn (${response.status}).`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Video quá lớn để import trực tiếp. Giữ video dưới khoảng 120MB ở giai đoạn này.');
  }

  const mimeType = guessMimeType(videoUrl, response.headers.get('content-type'));
  if (!mimeType.startsWith('video/')) {
    throw new Error(`Nguồn này không trả về video hợp lệ (${mimeType || 'unknown'}).`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Video quá lớn để import trực tiếp. Giữ video dưới khoảng 120MB ở giai đoạn này.');
  }

  const uploaded = await ai.files.upload({
    file: new Blob([bytes], { type: mimeType }),
    config: {
      mimeType,
      displayName: `trend-import-${Date.now()}`,
    },
  });

  if (!uploaded.name) {
    throw new Error('Gemini không trả về file name sau khi upload video.');
  }

  const activeFile = await waitUntilFileActive(ai, uploaded.name);
  return { uploadedFile: activeFile, mimeType };
}

function buildAnalysisPrompt() {
  return `Bạn là Senior Creative Trend Analyst cho mobile app ads.

Nhiệm vụ:
- Đọc TOÀN BỘ video, gồm cả visual + audio/voice + text overlay.
- Trích ra cấu trúc có thể tái sử dụng cho tool generate idea.
- Tập trung vào: hook 0-3s, tiến trình body, payoff/CTA, camera style, audio style, text overlay style, emotion trigger.
- Không mô tả lan man. Output ngắn, thực dụng, dùng được để build lại idea khác.

Return JSON only, không markdown, theo schema:
{
  "title": "Tên ngắn của trend/video",
  "summary": "1-2 câu tóm tắt video",
  "creativeType": "UGC|POV|Reaction|ASMR|Split Screen|Demo|Social Proof|Interview|Other",
  "angleType": "Curiosity|Problem Reveal|Comparison|POV|Social Proof|Relief|Fear|Demo",
  "emotionalDriver": "Cảm xúc chính người xem bị kéo vào",
  "hookPattern": "Mô tả mẫu hook 0-3s",
  "bodyPattern": "Mô tả nhịp triển khai phần giữa",
  "ctaPattern": "Mô tả CTA/payoff cuối video",
  "visualStyle": "Handheld/close-up/street interview/... cụ thể",
  "audioStyle": "Voiceover/dialogue/music/sfx cụ thể",
  "textOverlayStyle": "Pattern text overlay/caption",
  "keyMoments": ["00:00 ...", "00:03 ...", "00:08 ..."],
  "filterHints": {
    "emotion": ["..."],
    "angle": ["..."],
    "visualType": ["..."]
  }
}

Rules:
- keyMoments: 3-6 mốc, có timestamp ngắn.
- filterHints chỉ chọn các gợi ý thực sự hữu ích để tái tạo cấu trúc.
- Không phân tích sản phẩm sai sự thật. Nếu video không rõ app/product thì tập trung vào format + structure.
- Nếu video thiên về TikTok trend hơn là ad, vẫn phải trích ra phần nào áp dụng được cho ad creative.`;
}

function normalizeImportedAnalysis(raw: unknown): ImportedTrendAnalysis {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hints = (item.filterHints && typeof item.filterHints === 'object' ? item.filterHints : {}) as Record<string, unknown>;

  return {
    title: normalizeText(item.title, 'Imported video structure'),
    summary: normalizeText(item.summary, 'Imported from video URL'),
    creativeType: normalizeText(item.creativeType, 'UGC'),
    angleType: normalizeText(item.angleType, 'Curiosity'),
    emotionalDriver: normalizeText(item.emotionalDriver, 'Curiosity'),
    hookPattern: normalizeText(item.hookPattern, 'Open with a strong, in-context visual hook.'),
    bodyPattern: normalizeText(item.bodyPattern, 'Escalate the problem, then reveal the workaround or solution.'),
    ctaPattern: normalizeText(item.ctaPattern, 'Close with a short payoff or CTA.'),
    visualStyle: normalizeText(item.visualStyle, 'Handheld, social-first visual treatment.'),
    audioStyle: normalizeText(item.audioStyle, 'Natural in-feed voice or sound design.'),
    textOverlayStyle: normalizeText(item.textOverlayStyle, 'Short, mobile-first text overlay.'),
    keyMoments: normalizeList(item.keyMoments, 6),
    filterHints: {
      emotion: normalizeList(hints.emotion, 4),
      angle: normalizeList(hints.angle, 4),
      visualType: normalizeList(hints.visualType, 4),
    },
  };
}

function buildStructureNotes(data: ImportedTrendAnalysis) {
  const notes = [
    `Imported video "${data.title}": ${data.summary}`,
    `Hook pattern: ${data.hookPattern}`,
    `Body structure: ${data.bodyPattern}`,
    `CTA pattern: ${data.ctaPattern}`,
    `Visual style: ${data.visualStyle}`,
    `Audio style: ${data.audioStyle}`,
    `Text overlay style: ${data.textOverlayStyle}`,
    `Emotion trigger: ${data.emotionalDriver}`,
    `Creative type: ${data.creativeType}; angle type: ${data.angleType}`,
    ...data.keyMoments.map(moment => `Key moment ${moment}`),
  ];

  return notes.filter(Boolean).slice(0, 10);
}

function buildSuggestedTopics(data: ImportedTrendAnalysis) {
  return [
    `${data.creativeType} | ${data.angleType}`,
    `Hook: ${data.hookPattern}`,
    `Visual: ${data.visualStyle}`,
    `Audio: ${data.audioStyle}`,
    `Emotion: ${data.emotionalDriver}`,
  ]
    .map(item => normalizeText(item))
    .filter(Boolean)
    .slice(0, 5);
}

export async function POST(request: NextRequest) {
  let aiFileName: string | null = null;

  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Thiếu GEMINI_API_KEY hoặc GOOGLE_API_KEY để phân tích full video bằng Gemini trực tiếp.' },
        { status: 500 }
      );
    }

    const { url } = await request.json();
    const inputUrl = normalizeText(url);

    if (!inputUrl) {
      return NextResponse.json({ error: 'URL video là bắt buộc.' }, { status: 400 });
    }

    const resolved = await resolveVideoSource(inputUrl);
    const ai = createGeminiClient();
    const prompt = buildAnalysisPrompt();

    const candidateModels = [...new Set([process.env.GEMINI_VIDEO_MODEL || 'gemini-3.1-pro-preview', 'gemini-2.5-pro'])];
    let parsed: ImportedTrendAnalysis | null = null;
    let modelUsed = '';
    let lastError = 'Gemini không trả về dữ liệu hợp lệ.';

    for (const model of candidateModels) {
      try {
        const response =
          resolved.mode === 'youtube'
            ? await ai.models.generateContent({
                model,
                contents: [
                  { fileData: { fileUri: resolved.resolvedVideoUrl } },
                  { text: prompt },
                ],
                config: { temperature: 0.2 },
              })
            : await (async () => {
                const { uploadedFile, mimeType } = await uploadRemoteVideo(ai, resolved.resolvedVideoUrl);
                aiFileName = uploadedFile.name || null;
                return ai.models.generateContent({
                  model,
                  contents: createUserContent([
                    createPartFromUri(uploadedFile.uri!, uploadedFile.mimeType || mimeType),
                    prompt,
                  ]),
                  config: { temperature: 0.2 },
                });
              })();

        const text = response.text || '';
        const raw = parseJsonLoose(text);
        if (!raw) {
          lastError = 'Gemini trả về text nhưng không parse được JSON.';
          continue;
        }

        parsed = normalizeImportedAnalysis(raw);
        modelUsed = model;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown Gemini error';
      }
    }

    if (!parsed) {
      return NextResponse.json({ error: lastError }, { status: 500 });
    }

    const structureNotes = buildStructureNotes(parsed);
    const suggestedTopics = buildSuggestedTopics(parsed);

    return NextResponse.json({
      success: true,
      data: {
        sourceUrl: inputUrl,
        sourceLabel: resolved.sourceLabel,
        resolvedVideoUrl: resolved.resolvedVideoUrl,
        title: parsed.title,
        summary: parsed.summary,
        creativeType: parsed.creativeType,
        angleType: parsed.angleType,
        emotionalDriver: parsed.emotionalDriver,
        hookPattern: parsed.hookPattern,
        bodyPattern: parsed.bodyPattern,
        ctaPattern: parsed.ctaPattern,
        visualStyle: parsed.visualStyle,
        audioStyle: parsed.audioStyle,
        textOverlayStyle: parsed.textOverlayStyle,
        keyMoments: parsed.keyMoments,
        filterHints: parsed.filterHints,
        structureNotes,
        suggestedTopics,
        promptBooster: structureNotes.join('\n'),
        modelUsed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[import-trending-video] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (GEMINI_API_KEY && aiFileName) {
      const cleanupClient = createGeminiClient();
      cleanupClient.files.delete({ name: aiFileName }).catch(() => {});
    }
  }
}
