'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Play, PenTool, Sparkles, Plus, X, Wand2, Copy, Target, Loader2, ListOrdered, Upload, Check, RefreshCw, Eye, Trash2, Brain } from 'lucide-react';
import type { ScreenType, Hook, AppProject, FilterState, IdeaContent, GeneratedIdea } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';
import { authenticatedFetch } from '@/lib/authFetch';
import { buildHookFrameworkFallback } from '@/lib/hookFramework';

interface HookLibraryProps {
  setScreen: (s: ScreenType) => void;
  currentScreen: ScreenType;
  app?: AppProject | null;
  selectedModel?: AIModel;
}

interface HookIdea {
  id: string;
  title: string;
  explanation: string;
  hook: {
    durationSeconds?: number;
    script?: string;
    textOverlay?: string;
    visual: string;
    text: string;
    characterSpeech?: string;
    voiceover?: string;
    voice: string;
    imageUrl?: string;
    viTranslation?: string;
    viewerEmotion?: string;
    painpointImpact?: string;
    whyTheyStopScrolling?: string;
  };
  savedIdeaId?: string;
}

interface FullIdea {
  id?: string | number;
  title?: string;
  duration?: string;
  creativeType?: string;
  explanation?: string;
  meta?: IdeaContent['meta'] & Record<string, unknown>;
  framework?: Partial<IdeaContent['framework']>;
  hook?: Partial<IdeaContent['hook']>;
  body?: Partial<IdeaContent['body']>;
  cta?: Partial<IdeaContent['cta']>;
  savedIdeaId?: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const FULL_IDEA_SECTIONS = [
  { key: 'hook', label: '🎣 HOOK', bg: 'bg-red-50', border: 'border-red-100', title: 'text-red-500' },
  { key: 'body', label: '📖 BODY (10-25s)', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
  { key: 'cta', label: '🔥 CTA (3-5s)', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
] as const;

const MODIFY_HOOK_REQUEST_TIMEOUT_MS = 70000;
const IDEA_RUNTIME_GUIDANCE = 'Short social-first runtime';

export const HookLibrary: React.FC<HookLibraryProps> = ({ setScreen, currentScreen, app, selectedModel }) => {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selectedHook, setSelectedHook] = useState<Hook | null>(null);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [generatedIdeas, setGeneratedIdeas] = useState<HookIdea[]>([]);
  const [modifyLiveIdeas, setModifyLiveIdeas] = useState<HookIdea[]>([]);
  const [isViewingModifyHistory, setIsViewingModifyHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [quantity, setQuantity] = useState(3);
  // Hook-to-Ideas state
  const [fullIdeas, setFullIdeas] = useState<FullIdea[]>([]);
  const [fullIdeasLive, setFullIdeasLive] = useState<FullIdea[]>([]);
  const [isViewingFullIdeasHistory, setIsViewingFullIdeasHistory] = useState(false);
  const [fullIdeasLoading, setFullIdeasLoading] = useState(false);
  const [fullIdeasSaveStatus, setFullIdeasSaveStatus] = useState<SaveStatus>('idle');
  const [savedFullIdeasCount, setSavedFullIdeasCount] = useState(0);
  const [savedFullIdeasSessionId, setSavedFullIdeasSessionId] = useState<string | null>(null);
  const [fullIdeasQty, setFullIdeasQty] = useState(3);
  const [ideaDirection, setIdeaDirection] = useState('');
  const [expandedFullIdeaKeys, setExpandedFullIdeaKeys] = useState<Record<string, boolean>>({});
  const [modifiedHooksSaveStatus, setModifiedHooksSaveStatus] = useState<SaveStatus>('idle');
  const [savedModifiedHookCount, setSavedModifiedHookCount] = useState(0);
  const [savedModifiedHookSessionId, setSavedModifiedHookSessionId] = useState<string | null>(null);
  const [availableModifyHistoryCount, setAvailableModifyHistoryCount] = useState(0);
  const [loadingModifyHistory, setLoadingModifyHistory] = useState(false);
  const [availableFullIdeasHistoryCount, setAvailableFullIdeasHistoryCount] = useState(0);
  const [loadingFullIdeasHistory, setLoadingFullIdeasHistory] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingHookData, setEditingHookData] = useState<Partial<Hook> & { localVideoUrl?: string; localImageUrl?: string }>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingHookId, setDeletingHookId] = useState<string | null>(null);
  const [previewHook, setPreviewHook] = useState<Hook | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const pendingThumbRef = useRef<string | null>(null);
  const modifyResultsRef = useRef<HTMLDivElement>(null);
  const fullIdeasResultsRef = useRef<HTMLDivElement>(null);

  const loadHooks = useCallback(async () => {
    const data = await dbService.getHooks(app?.id);
    setHooks(data);
  }, [app?.id]);

  useEffect(() => { loadHooks(); }, [loadHooks]);
  useEffect(() => { setExpandedFullIdeaKeys({}); }, [selectedHook?.id, isViewingFullIdeasHistory]);

  const handleDeleteHook = async (id: string) => {
    if (deletingHookId) return;
    if (!window.confirm('Bạn có chắc muốn xóa hook này?')) return;
    setDeletingHookId(id);
    try {
      await dbService.deleteHook(id);
      setHooks(prev => prev.filter(h => h.id !== id));
    } catch (err) {
      console.error('Delete hook failed:', err);
      alert('Xóa hook thất bại.');
    } finally {
      setDeletingHookId(null);
    }
  };

  const startProgress = () => {
    setProgress(0);
    setProgressLabel('Đang phân tích hook gốc...');
    const steps = [
      { at: 5, label: 'Đang phân tích hook gốc...' },
      { at: 15, label: 'Đang xây dựng biến thể mới...' },
      { at: 35, label: 'Đang viết Visual chi tiết...' },
      { at: 55, label: 'Đang tạo Voice & Text...' },
      { at: 75, label: 'Đang hoàn thiện kết quả...' },
      { at: 90, label: 'Đang kiểm tra chất lượng...' },
    ];
    let current = 0;
    progressRef.current = setInterval(() => {
      current += Math.random() * 2.5 + 0.5;
      if (current > 95) current = 95;
      setProgress(Math.round(current));
      const step = [...steps].reverse().find(s => current >= s.at);
      if (step) setProgressLabel(step.label);
    }, 500);
  };

  const clearProgressInterval = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
  };

  const stopProgress = () => {
    clearProgressInterval();
    setProgress(100);
    setProgressLabel('Hoàn thành! ✨');
    setTimeout(() => { setProgress(0); setProgressLabel(''); }, 1500);
  };

  const stripVariantSuffix = (value: string) => {
    let next = value.trim();
    while (/\s*-\s*Biến thể\s*\d+\s*$/i.test(next)) {
      next = next.replace(/\s*-\s*Biến thể\s*\d+\s*$/i, '').trim();
    }
    return next;
  };

  const buildModifiedHookTitle = (sourceTitle: string, index: number) => {
    const baseTitle = stripVariantSuffix(sourceTitle) || sourceTitle.trim();
    return `${baseTitle} - Biến thể ${index + 1}`;
  };

  const normalizeDisplayedHookTitle = (value: string) => {
    const matches = [...value.matchAll(/-\s*Biến thể\s*(\d+)/gi)];
    if (matches.length <= 1) return value;
    const firstMatch = matches[0];
    const base = value.slice(0, firstMatch.index).trim();
    const lastVariant = matches[matches.length - 1]?.[1] || '1';
    return `${base} - Biến thể ${lastVariant}`;
  };

  const buildLocalModifiedHooks = (sourceHook: Hook, instruction: string, count: number, startIndex = 0): HookIdea[] =>
    Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      title: buildModifiedHookTitle(sourceHook.title, startIndex + i),
      explanation: `Áp dụng "${sourceHook.hook_concept || sourceHook.title}" kết hợp "${instruction}"`,
      hook: {
        script: `${sourceHook.visual_detail || 'Cảnh mở bằng hook gốc'}. Giữ DNA của hook "${stripVariantSuffix(sourceHook.title)}", nhưng đổi execution theo hướng: ${instruction}.`,
        visual: `${sourceHook.visual_detail || 'Cận cảnh'} + ${instruction}`,
        text: stripVariantSuffix(sourceHook.title),
        textOverlay: stripVariantSuffix(sourceHook.title),
        voice: `${stripVariantSuffix(sourceHook.title)} — biến thể ${startIndex + i + 1}. ${instruction}.`,
        viTranslation: `${stripVariantSuffix(sourceHook.title)} — biến thể ${startIndex + i + 1}. ${instruction}.`,
      },
    }));

  const compactModifyText = (value: string, limit = 72) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}...`;
  };

  const extractModifyInstructionHint = (instruction: string, fallback: string) => {
    const lines = instruction
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .filter(line => !/^kết hợp hook\b/i.test(line.toLowerCase()));

    return compactModifyText(lines[0] || fallback, 88);
  };

  const buildStructuredLocalModifiedHooks = (
    sourceHook: Hook,
    instruction: string,
    count: number,
    startIndex = 0,
  ): HookIdea[] => {
    const baseTitle = stripVariantSuffix(sourceHook.title);
    const concept = sourceHook.hook_concept || baseTitle;
    const painpoint = sourceHook.painpoint || 'the hidden blocker';
    const visualDetail = sourceHook.visual_detail || 'A close handheld opening that shows the blocker immediately.';
    const instructionHint = extractModifyInstructionHint(instruction, concept);
    const fallbackAngles = [
      {
        visual: 'Open on a real desk setup, then snap into a macro reveal on the exact blocker.',
        voice: 'This tiny move might explain the whole problem.',
        overlay: compactModifyText(baseTitle, 32) || 'Watch this first',
      },
      {
        visual: 'Keep the same object, but use a stop-start hand action so the blocker appears on the second beat.',
        voice: 'Same setup, but this gesture makes the blocker obvious.',
        overlay: 'The blocker is here',
      },
      {
        visual: 'Switch into a POV angle with tighter framing so the pain lands before the explanation starts.',
        voice: 'You miss this detail until the POV gets closer.',
        overlay: 'Look closer',
      },
      {
        visual: 'Split the first second into a compare frame so the wrong version and the clue appear together.',
        voice: 'The pain looks familiar, but this compare frame makes it click faster.',
        overlay: 'Same pain, new reveal',
      },
      {
        visual: 'Add one prop cue and a quicker first gesture so the opening feels urgent before the explanation lands.',
        voice: 'If this keeps happening, start with this check before anything else.',
        overlay: 'Start with this check',
      },
    ];

    return Array.from({ length: count }, (_, i) => {
      const angle = fallbackAngles[(startIndex + i) % fallbackAngles.length];
      return {
        id: crypto.randomUUID(),
        title: buildModifiedHookTitle(sourceHook.title, startIndex + i),
        explanation: `Giu DNA cua "${concept}", doi execution theo huong "${instructionHint}" va van bam dung pain point "${painpoint}".`,
        hook: {
          script: `${angle.visual} Start from: ${visualDetail}\n[VOICE] ${angle.voice}\n[TEXT OVERLAY] ${angle.overlay}`,
          visual: `${angle.visual} Start from: ${visualDetail}`,
          text: angle.overlay,
          textOverlay: angle.overlay,
          voice: angle.voice,
          viTranslation: `Van giu noi dau "${painpoint}", nhung mo theo huong "${instructionHint}".`,
        },
      };
    });
  };

  const handleCancel = () => {
    cancelRequestedRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    clearProgressInterval();
    setIsLoading(false);
    setFullIdeasLoading(false);
    setProgress(0);
    setProgressLabel('Đã hủy');
    setTimeout(() => setProgressLabel(''), 1500);
  };

  const handleGenerate = async () => {
    if (!selectedHook || !modifyPrompt) return;
    setIsLoading(true);
    setModifiedHooksSaveStatus('idle');
    setSavedModifiedHookCount(0);
    setSavedModifiedHookSessionId(null);
    setIsViewingModifyHistory(false);
    const controller = new AbortController();
    let requestTimedOut = false;
    const timeoutId = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, MODIFY_HOOK_REQUEST_TIMEOUT_MS);
    cancelRequestedRef.current = false;
    abortRef.current = controller;
    startProgress();
    try {
      const res = await authenticatedFetch('/api/generate-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hook: selectedHook,
          instruction: modifyPrompt,
          quantity,
          appName: app?.name || '',
          appCategory: app?.category || '',
          selectedModel: selectedModel || '',
        }),
        signal: controller.signal,
      });
      const result = await res.json();
      if (result?.fallback && !result.data?.length) {
        throw new Error('Backend đang trả fallback hook thay vì output AI sạch. Không lưu kết quả fallback.');
      }
      if (res.ok && result.success && result.data?.length > 0) {
        const generated = (result.data as HookIdea[]).slice(0, quantity);
        setGeneratedIdeas(generated);
        setModifyLiveIdeas(generated);
        await saveModifiedHooksToHistory(generated);
      } else {
        alert(result.error || 'Có lỗi khi tạo hook. Vui lòng thử lại.');
      }
    } catch (err) {
      if (requestTimedOut) {
        alert('Tạo hook bị timeout. Vui lòng thử lại.');
        return;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      console.error('Generate hooks failed:', err);
      alert(err instanceof Error && err.message ? err.message : 'Có lỗi khi tạo hook. Vui lòng thử lại.');
    } finally {
      window.clearTimeout(timeoutId);
      abortRef.current = null;
      if (!cancelRequestedRef.current) {
        stopProgress();
      }
      setIsLoading(false);
      cancelRequestedRef.current = false;
    }
  };

  const handleCopy = (idea: HookIdea) => {
    const scriptContent = idea.hook.script
      || [
        idea.hook.visual ? `[VISUAL] ${idea.hook.visual}` : '',
        idea.hook.characterSpeech ? `[NHAN VAT NOI] ${idea.hook.characterSpeech}` : '',
        idea.hook.voiceover ? `[VOICE VIDEO] ${idea.hook.voiceover}` : '',
        !idea.hook.characterSpeech && !idea.hook.voiceover && idea.hook.voice ? `[VOICE] ${idea.hook.voice}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    const text = `HOOK: ${idea.title}\nSCENARIO: ${idea.explanation}\n\n${scriptContent}\n\n[TEXT OVERLAY] ${idea.hook.textOverlay || idea.hook.text}`;
    navigator.clipboard.writeText(text);
  };

  const readText = (value: unknown, fallback = '') =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

  const readNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(',', '.')) : null;
  };

  const isRecordValue = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const looseFullIdeaKeys = [
    'title',
    'hook_text_overlay',
    'hookTextOverlay',
    'hook_primary',
    'hookPrimary',
    'hook_vo',
    'hookVoice',
    'hook_voiceover',
    'hookVoiceover',
    'visual_scene_1',
    'visualScene1',
    'visual_scene_2',
    'visualScene2',
    'visual_scene_3',
    'visualScene3',
    'script_vo',
    'scriptVo',
    'cta_text',
    'ctaText',
    'angle_name',
    'angleName',
    'angle_type',
    'angleType',
    'angle_desc',
    'angleDesc',
    'emotion_journey',
    'emotionJourney',
    'body_motivation_pattern',
    'bodyMotivationPattern',
  ] as const;

  const rawIdeaTextPattern = /hook_text_overlay|hook_vo|visual_scene_1|visual_scene_2|visual_scene_3|script_vo|cta_text|body_motivation_pattern/i;
  const rawStructuredIdeaPatterns = [
    /"?title"?\s*:/i,
    /"?duration"?\s*:/i,
    /"?creativeType"?\s*:/i,
    /"?framework"?\s*:/i,
    /"?hook"?\s*:\s*\{/i,
    /"?body"?\s*:\s*\{/i,
    /"?cta"?\s*:\s*\{/i,
  ];

  const unescapeLooseText = (value: string) =>
    value
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/^["'`]+|["'`,]+$/g, '')
      .trim();

  const findFirstLooseIdeaRecord = (value: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 5) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirstLooseIdeaRecord(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (!isRecordValue(value)) return null;
    const hasIdeaSignal = looseFullIdeaKeys.some(key => typeof value[key] === 'string')
      || isRecordValue(value.hook)
      || isRecordValue(value.body)
      || isRecordValue(value.cta);
    if (hasIdeaSignal) return value;
    for (const nested of Object.values(value)) {
      const found = findFirstLooseIdeaRecord(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };

  const extractLooseFieldsFromRecord = (record: Record<string, unknown>) => {
    const fields: Record<string, string> = {};
    looseFullIdeaKeys.forEach(key => {
      const text = readText(record[key]);
      if (text) fields[key] = text;
    });
    return fields;
  };

  const extractLooseFieldsFromText = (value: unknown) => {
    const text = readText(value);
    const fields: Record<string, string> = {};
    if (!text || (!rawIdeaTextPattern.test(text) && !/^\s*[\[{]/.test(text))) return fields;

    const jsonCandidates = [
      text,
      text.startsWith('{') || text.startsWith('[') ? '' : `{${text}}`,
      text.startsWith('{') || text.startsWith('[') ? '' : `{"${text}`,
    ].filter(Boolean);

    for (const candidate of jsonCandidates) {
      try {
        const parsed = JSON.parse(candidate);
        const record = findFirstLooseIdeaRecord(parsed);
        if (record) Object.assign(fields, extractLooseFieldsFromRecord(record));
      } catch {
        // Keep regex fallback below.
      }
    }

    const keyPattern = /"?([a-zA-Z][a-zA-Z0-9_]*?)"?\s*:\s*(?:"((?:\\.|[^"\\])*)"|([^,\n\r{}[\]]+))/g;
    let match: RegExpExecArray | null;
    while ((match = keyPattern.exec(text)) !== null) {
      const key = match[1] as typeof looseFullIdeaKeys[number];
      if (!looseFullIdeaKeys.includes(key)) continue;
      const rawValue = match[2] ?? match[3] ?? '';
      const nextValue = unescapeLooseText(rawValue);
      if (nextValue) fields[key] = nextValue;
    }

    return fields;
  };

  const collectLooseFieldsFromFullIdea = (idea: FullIdea) => {
    const rawIdea = idea as FullIdea & Record<string, unknown>;
    const fields: Record<string, string> = {};
    const mergeFields = (value: unknown) => Object.assign(fields, extractLooseFieldsFromText(value));

    Object.assign(fields, extractLooseFieldsFromRecord(rawIdea));
    [rawIdea.title, rawIdea.explanation, rawIdea.meta, rawIdea.hook, rawIdea.body, rawIdea.cta].forEach(value => {
      if (typeof value === 'string') mergeFields(value);
      if (isRecordValue(value)) {
        Object.assign(fields, extractLooseFieldsFromRecord(value));
        Object.values(value).forEach(mergeFields);
      }
    });

    return fields;
  };

  const looksLikeRawStructuredIdeaText = (value: unknown) => {
    const text = readText(value);
    if (!text) return false;
    const sample = text.slice(0, 1800);
    const markerCount = rawStructuredIdeaPatterns.filter(pattern => pattern.test(sample)).length;
    const startsLikePayload = /^\s*(?:\d+(?:[.,]\d+)?\s*[-\u2013\u2014\u2212]\s*\d+(?:[.,]\d+)?s?\s*:\s*)?[\[{]/.test(sample);
    return markerCount >= 3 || (startsLikePayload && markerCount >= 2);
  };

  const looksLikeRawIdeaText = (value: unknown) => {
    const text = readText(value);
    return text === '[' || text === '{' || rawIdeaTextPattern.test(text) || looksLikeRawStructuredIdeaText(text);
  };

  const cleanFullIdeaText = (value: unknown, fallback = '') => {
    const text = readText(value);
    if (!text || looksLikeRawIdeaText(text)) return fallback;
    return text
      .replace(/^\s*\[(?:VISUAL|VOICE VIDEO|VOICE|TEXT OVERLAY|CHARACTER SPEECH|NHAN VAT NOI)\]\s*/i, '')
      .replace(/^Sec\s+0\s*-\s*\d+\s*\(THE HOOK\s*[-—]\s*3 phases\)\s*:\s*/i, '')
      .trim() || fallback;
  };

  const stripReadableScriptPrefix = (value: string) =>
    value
      .replace(/^Kịch bản\s+\d+(?:\.\d+)?\s*:\s*/i, '')
      .replace(/^Kich ban\s+\d+(?:\.\d+)?\s*:\s*/i, '')
      .replace(/^Script\s+\d+(?:\.\d+)?\s*:\s*/i, '')
      .trim();

  const buildFullIdeaDisplayTitle = (
    idea: FullIdea,
    sourceHook: Hook,
    index: number,
    looseFields: Record<string, string>
  ) => {
    const rawIdea = idea as FullIdea & Record<string, unknown>;
    const meta = isRecordValue(rawIdea.meta) ? rawIdea.meta : {};
    const rawTitle = cleanFullIdeaText(
      rawIdea.title,
      cleanFullIdeaText(looseFields.title, cleanFullIdeaText(meta.hookPrimary, cleanFullIdeaText(looseFields.hook_text_overlay)))
    );
    const title = stripReadableScriptPrefix(rawTitle || stripVariantSuffix(sourceHook.title) || `Idea ${index + 1}`);
    const idText = readText(rawIdea.id);
    const idMatch = idText.match(/A(\d+)-I(\d+)/i);
    const label = idMatch
      ? `Kịch bản ${Number(idMatch[1]) + 1}.${Number(idMatch[2]) + 1}`
      : `Kịch bản ${index + 1}`;

    return `${label}: ${title}`;
  };

  const parseExplicitTimelineEnd = (value: unknown): number | null => {
    const text = readText(value);
    const endings = Array.from(text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|−)\s*(\d+(?:[.,]\d+)?)\s*s?/g))
      .map(match => Number(match[2].replace(',', '.')))
      .filter(number => Number.isFinite(number));
    if (endings.length === 0) return null;
    const maxEnd = Math.max(...endings);
    return maxEnd >= 3 && maxEnd <= 30 ? Math.round(maxEnd) : null;
  };

  const getFullIdeaHookDurationSeconds = (section?: Partial<IdeaContent['hook']>) => {
    const explicitDuration = parseExplicitTimelineEnd(readText(section?.visual, readText(section?.script)));
    if (explicitDuration) return explicitDuration;
    const rawDuration = readNumber((section as Record<string, unknown> | undefined)?.durationSeconds);
    if (rawDuration && rawDuration >= 3 && rawDuration <= 30 && Math.round(rawDuration) !== 6) return Math.round(rawDuration);
    return 5;
  };

  const extractHookPhases = (value: string) => {
    const cleaned = value
      .replace(/^Sec\s+0\s*-\s*\d+\s*\(THE HOOK\s*[-—]\s*3 phases\)\s*:\s*/i, '')
      .trim();
    const matches = Array.from(cleaned.matchAll(/Phase\s*([123])\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*?)(?=Phase\s*[123]\s*(?:\(|:)|$)/gi));
    return matches.map(match => ({
      phase: Number(match[1]),
      range: readText(match[2]),
      text: readText(match[3]),
    }));
  };

  const appendHookCopyToContextLine = (line: string, textOverlay: string, voiceover: string) => {
    const hasCopy = /text\s*(?:hiện|overlay|appears)|voiceover|vo\s*(?:bắt|begins|starts)|\|\s*voice/i.test(line);
    if (hasCopy) return line;
    const parts = [
      textOverlay ? `Text hiện: "${textOverlay}"` : '',
      voiceover ? `Voiceover: "${voiceover}"` : '',
    ].filter(Boolean);
    return parts.length ? `${line}${line ? ' ' : ''}${parts.join(' | ')}` : line;
  };

  const formatFullIdeaHookTimeline = (
    rawVisual: string,
    textOverlay: string,
    voiceover: string,
    durationSeconds: number
  ) => {
    const visual = cleanFullIdeaText(rawVisual);
    const existingTimeline = /^\s*\d+(?:[.,]\d+)?\s*(?:-|–|—|−)\s*\d+(?:[.,]\d+)?\s*s?\s*:/m.test(visual);
    if (existingTimeline) {
      const lines = visual.split('\n').map(line => line.trim()).filter(Boolean);
      const contextIndex = lines.findIndex(line => /(?:1[.,]5|2)\s*(?:-|–|—|−)\s*(?:3[.,]5|5)/.test(line));
      const targetIndex = contextIndex >= 0 ? contextIndex : Math.min(1, lines.length - 1);
      return lines.map((line, index) => (
        index === targetIndex ? appendHookCopyToContextLine(line, textOverlay, voiceover) : line
      )).join('\n');
    }

    const phases = extractHookPhases(visual);
    if (phases.length >= 2) {
      const fallbackRanges = durationSeconds === 8
        ? ['0-2s', '2-5s', '5-8s']
        : ['0-1.5s', '1.5-3.5s', `3.5-${durationSeconds}s`];
      return phases.slice(0, 3).map((phase, index) => {
        const line = phase.phase === 2
          ? appendHookCopyToContextLine(phase.text, textOverlay, voiceover)
          : phase.text;
        return `${phase.range || fallbackRanges[index] || fallbackRanges[fallbackRanges.length - 1]}: ${line}`;
      }).join('\n');
    }

    const ranges = durationSeconds === 8
      ? ['0-2s', '2-5s', '5-8s']
      : ['0-1.5s', '1.5-3.5s', `3.5-${durationSeconds}s`];
    return [
      `${ranges[0]}: ${visual || 'Open with the proven pain point in a concrete first frame.'}`,
      `${ranges[1]}: ${appendHookCopyToContextLine('', textOverlay, voiceover) || 'Add context with text overlay and conversational voiceover.'}`,
      `${ranges[2]}: Cut into the app/demo moment so the viewer needs to see the payoff.`,
    ].join('\n');
  };

  const getSectionCharacterSpeech = (section?: Record<string, unknown>) =>
    readText(section?.characterSpeech, readText(section?.character_speech, readText(section?.talentSpeech, readText(section?.talent_speech))));

  const getSectionVoiceover = (section?: Record<string, unknown>) =>
    readText(section?.voiceover, readText(section?.voiceOver, readText(section?.voice_over)));

  const getSectionLegacyVoice = (section?: Record<string, unknown>) => {
    const voice = readText(section?.voice);
    const characterSpeech = getSectionCharacterSpeech(section);
    const voiceover = getSectionVoiceover(section);
    return voice && voice !== characterSpeech && voice !== voiceover ? voice : '';
  };

  const estimateSectionDurationSeconds = (section?: Record<string, unknown>) => {
    const rawDuration = readNumber(section?.durationSeconds ?? section?.duration_seconds ?? section?.hookDurationSeconds ?? section?.hook_duration_seconds);
    if (rawDuration && rawDuration > 0) return Math.min(12, Math.max(6, Math.round(rawDuration)));

    const speech = [
      getSectionCharacterSpeech(section),
      getSectionVoiceover(section) || readText(section?.voice),
      readText(section?.textOverlay, readText(section?.text)),
    ].filter(Boolean).join(' ');
    const visual = readText(section?.visual, readText(section?.script));
    const timingText = speech || visual;
    const words = timingText.split(/\s+/).filter(Boolean).length;
    if (words === 0) return 8;
    return Math.min(12, Math.max(6, Math.ceil(speech ? 2 + words / 2.8 : 4 + words / 5.2)));
  };

  const buildIdeaSectionScript = (
    section?: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']>
  ) => {
    const rawSection = (section || {}) as Record<string, unknown>;
    const visual = readText(section?.visual);
    const characterSpeech = getSectionCharacterSpeech(rawSection);
    const voiceover = getSectionVoiceover(rawSection);
    const legacyVoice = getSectionLegacyVoice(rawSection);
    const textOverlay = readText(section?.textOverlay, readText(section?.text));
    const hasStructuredParts = Boolean(visual || characterSpeech || voiceover || legacyVoice || textOverlay);

    if (!hasStructuredParts) {
      return readText(section?.script);
    }

    return [
      visual ? `[VISUAL] ${visual}` : '',
      characterSpeech ? `[NHAN VAT NOI] ${characterSpeech}` : '',
      voiceover ? `[VOICE VIDEO] ${voiceover}` : '',
      legacyVoice ? `[VOICE] ${legacyVoice}` : '',
      textOverlay ? `[TEXT OVERLAY] ${textOverlay}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const normalizeFullIdeaForDisplay = (idea: FullIdea, sourceHook: Hook, index: number): FullIdea => {
    const rawIdea = idea as FullIdea & Record<string, unknown>;
    const rawMeta = isRecordValue(rawIdea.meta) ? rawIdea.meta : {};
    const rawFramework = isRecordValue(rawIdea.framework) ? rawIdea.framework : {};
    const rawHook = isRecordValue(rawIdea.hook) ? rawIdea.hook : {};
    const rawBody = isRecordValue(rawIdea.body) ? rawIdea.body : {};
    const rawCta = isRecordValue(rawIdea.cta) ? rawIdea.cta : {};
    const looseFields = collectLooseFieldsFromFullIdea(idea);

    const hookTextOverlay = cleanFullIdeaText(
      rawHook.textOverlay,
      cleanFullIdeaText(rawHook.text, cleanFullIdeaText(rawMeta.hookPrimary, cleanFullIdeaText(looseFields.hook_text_overlay, cleanFullIdeaText(looseFields.hookTextOverlay))))
    );
    const hookVoice = cleanFullIdeaText(
      rawHook.voiceover,
      cleanFullIdeaText(rawHook.voice, cleanFullIdeaText(looseFields.hook_vo, cleanFullIdeaText(looseFields.hookVoice, cleanFullIdeaText(looseFields.hook_voiceover, cleanFullIdeaText(looseFields.hookVoiceover)))))
    );
    const hookVisual = cleanFullIdeaText(
      looseFields.visual_scene_1,
      cleanFullIdeaText(looseFields.visualScene1, cleanFullIdeaText(rawHook.visual, cleanFullIdeaText(rawHook.script)))
    );
    const bodyVisual = cleanFullIdeaText(
      looseFields.visual_scene_2,
      cleanFullIdeaText(looseFields.visualScene2, cleanFullIdeaText(rawBody.visual, cleanFullIdeaText(rawBody.script)))
    );
    const scriptVoiceover = cleanFullIdeaText(
      looseFields.script_vo,
      cleanFullIdeaText(looseFields.scriptVo, cleanFullIdeaText(rawBody.voiceover, cleanFullIdeaText(rawBody.voice)))
    );
    const ctaText = cleanFullIdeaText(
      looseFields.cta_text,
      cleanFullIdeaText(looseFields.ctaText, cleanFullIdeaText(rawCta.textOverlay, cleanFullIdeaText(rawCta.text, cleanFullIdeaText(rawCta.voiceover, cleanFullIdeaText(rawCta.voice)))))
    );
    const ctaVisual = cleanFullIdeaText(
      looseFields.visual_scene_3,
      cleanFullIdeaText(looseFields.visualScene3, cleanFullIdeaText(rawCta.visual, cleanFullIdeaText(rawCta.script)))
    );
    const normalizedHookBase = {
      ...rawHook,
      visual: hookVisual,
      script: hookVisual,
      textOverlay: hookTextOverlay,
      text: hookTextOverlay,
      voiceover: hookVoice,
      voice: hookVoice,
    };
    const hookDuration = getFullIdeaHookDurationSeconds(normalizedHookBase);

    return {
      ...idea,
      title: buildFullIdeaDisplayTitle(idea, sourceHook, index, looseFields),
      duration: cleanFullIdeaText(rawIdea.duration, IDEA_RUNTIME_GUIDANCE),
      creativeType: cleanFullIdeaText(rawIdea.creativeType, cleanFullIdeaText(rawMeta.track, cleanFullIdeaText(sourceHook.creative_type, sourceHook.subtitle || 'Creative'))),
      explanation: cleanFullIdeaText(rawIdea.explanation),
      meta: {
        ...rawMeta,
        angleName: cleanFullIdeaText(rawMeta.angleName, cleanFullIdeaText(looseFields.angle_name, cleanFullIdeaText(looseFields.angleName, `Winning Hook: ${sourceHook.title}`))),
        angleType: cleanFullIdeaText(rawMeta.angleType, cleanFullIdeaText(looseFields.angle_type, cleanFullIdeaText(looseFields.angleType))),
        angleDesc: cleanFullIdeaText(rawMeta.angleDesc, cleanFullIdeaText(looseFields.angle_desc, cleanFullIdeaText(looseFields.angleDesc))),
        hookPrimary: hookTextOverlay || cleanFullIdeaText(rawMeta.hookPrimary),
        emotionJourney: cleanFullIdeaText(rawMeta.emotionJourney, cleanFullIdeaText(looseFields.emotion_journey, cleanFullIdeaText(looseFields.emotionJourney))),
        bodyMotivationPattern: cleanFullIdeaText(rawMeta.bodyMotivationPattern, cleanFullIdeaText(looseFields.body_motivation_pattern, cleanFullIdeaText(looseFields.bodyMotivationPattern))),
      },
      framework: {
        coreUser: cleanFullIdeaText(rawFramework.coreUser, sourceHook.core_user || 'General viewer'),
        painpoint: cleanFullIdeaText(rawFramework.painpoint, sourceHook.painpoint || 'General user friction'),
        emotion: cleanFullIdeaText(rawFramework.emotion, sourceHook.emotion || 'Curiosity'),
        psp: cleanFullIdeaText(rawFramework.psp, sourceHook.hook_concept || app?.name || 'Product solution'),
      },
      hook: {
        ...normalizedHookBase,
        durationSeconds: hookDuration,
        characterSpeech: cleanFullIdeaText(rawHook.characterSpeech),
        viTranslation: cleanFullIdeaText(rawHook.viTranslation),
        viewerProfile: cleanFullIdeaText(rawHook.viewerProfile),
        viewerEmotion: cleanFullIdeaText(rawHook.viewerEmotion),
        painpointImpact: cleanFullIdeaText(rawHook.painpointImpact),
        whyTheyStopScrolling: cleanFullIdeaText(rawHook.whyTheyStopScrolling),
      },
      body: {
        ...rawBody,
        visual: bodyVisual,
        script: bodyVisual,
        textOverlay: cleanFullIdeaText(rawBody.textOverlay, cleanFullIdeaText(rawBody.text)),
        text: cleanFullIdeaText(rawBody.text, cleanFullIdeaText(rawBody.textOverlay)),
        voiceover: scriptVoiceover,
        voice: scriptVoiceover,
        characterSpeech: cleanFullIdeaText(rawBody.characterSpeech),
        viTranslation: cleanFullIdeaText(rawBody.viTranslation),
      },
      cta: {
        ...rawCta,
        visual: ctaVisual,
        script: ctaVisual,
        textOverlay: ctaText,
        text: ctaText,
        voiceover: cleanFullIdeaText(rawCta.voiceover, cleanFullIdeaText(rawCta.voice, ctaText)),
        voice: cleanFullIdeaText(rawCta.voice, cleanFullIdeaText(rawCta.voiceover, ctaText)),
        characterSpeech: cleanFullIdeaText(rawCta.characterSpeech),
        endCard: cleanFullIdeaText(rawCta.endCard, ctaText),
        viTranslation: cleanFullIdeaText(rawCta.viTranslation),
      },
    };
  };

  const buildReadableFullIdeaSectionScript = (
    idea: FullIdea,
    sectionKey: 'hook' | 'body' | 'cta'
  ) => {
    const section = idea[sectionKey] || {};
    const rawSection = section as Record<string, unknown>;
    const visual = cleanFullIdeaText(section.visual, cleanFullIdeaText(section.script));
    const textOverlay = cleanFullIdeaText(section.textOverlay, cleanFullIdeaText(section.text));
    const voiceover = cleanFullIdeaText(getSectionVoiceover(rawSection), cleanFullIdeaText(section.voice));
    const characterSpeech = cleanFullIdeaText(getSectionCharacterSpeech(rawSection));

    if (sectionKey === 'hook') {
      return formatFullIdeaHookTimeline(
        visual,
        textOverlay || cleanFullIdeaText(idea.meta?.hookPrimary),
        voiceover || characterSpeech,
        getFullIdeaHookDurationSeconds(section as Partial<IdeaContent['hook']>)
      );
    }

    if (sectionKey === 'body') {
      return [
        `Diễn biến (Body): ${visual || cleanFullIdeaText(section.script) || 'Tiếp tục câu chuyện và show app/demo giải quyết đúng pain point.'}`,
        textOverlay ? `Text body: "${textOverlay}"` : '',
        characterSpeech ? `Lời nhân vật: "${characterSpeech}"` : '',
        voiceover ? `Voiceover chính: "${voiceover}"` : '',
      ].filter(Boolean).join('\n');
    }

    const ctaText = textOverlay || voiceover || cleanFullIdeaText((section as Partial<IdeaContent['cta']>).endCard);
    return [
      `Kêu gọi hành động (CTA): ${ctaText || 'Try it now'}`,
      visual ? `Visual CTA: ${visual}` : '',
      voiceover && voiceover !== ctaText ? `Voiceover CTA: "${voiceover}"` : '',
      cleanFullIdeaText((section as Partial<IdeaContent['cta']>).endCard) && cleanFullIdeaText((section as Partial<IdeaContent['cta']>).endCard) !== ctaText
        ? `Màn hình kết: ${cleanFullIdeaText((section as Partial<IdeaContent['cta']>).endCard)}`
        : '',
    ].filter(Boolean).join('\n');
  };

  const buildFullIdeaCopyText = (idea: FullIdea, sourceHook: Hook, index: number) => {
    const normalizedIdea = normalizeFullIdeaForDisplay(idea, sourceHook, index);
    const framework = normalizedIdea.framework || {};
    const meta = normalizedIdea.meta || {};
    const angleName = cleanFullIdeaText(meta.angleName, `Winning Hook: ${sourceHook.title}`);
    const angleType = cleanFullIdeaText(meta.angleType, normalizedIdea.creativeType || '');
    const angleDesc = cleanFullIdeaText(meta.angleDesc, normalizedIdea.explanation || '');
    const hookDuration = getFullIdeaHookDurationSeconds(normalizedIdea.hook);

    return [
      'TÌNH HUỐNG GỐC (PAIN POINT)',
      framework.painpoint || sourceHook.painpoint || '',
      '',
      `ANGLE: ${angleName}${angleType ? ` (${angleType})` : ''}`,
      angleDesc ? `Mục tiêu: ${angleDesc}` : '',
      '',
      normalizedIdea.title || `Kịch bản ${index + 1}`,
      '',
      `Hook (${hookDuration}s đầu):`,
      buildReadableFullIdeaSectionScript(normalizedIdea, 'hook'),
      '',
      buildReadableFullIdeaSectionScript(normalizedIdea, 'body'),
      '',
      buildReadableFullIdeaSectionScript(normalizedIdea, 'cta'),
      normalizedIdea.explanation ? `\nLý do hiệu quả: ${normalizedIdea.explanation}` : '',
    ].filter(line => String(line).trim()).join('\n');
  };

  const toggleFullIdeaDetails = (key: string) => {
    setExpandedFullIdeaKeys(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const mapHistoryIdeaToModifiedHook = useCallback((idea: GeneratedIdea): HookIdea => {
    const content = idea.content;
    return {
      id: idea.id,
      title: normalizeDisplayedHookTitle(readText(idea.title, readText(content.meta?.hookPrimary, 'Modified Hook'))),
      explanation: readText(content.explanation, 'Modified hook from history'),
      hook: {
        durationSeconds: readNumber(content.hook?.durationSeconds) || undefined,
        script: readText(content.hook?.script, readText(content.hook?.voice, readText(content.hook?.visual))),
        textOverlay: readText(content.hook?.textOverlay, readText(content.hook?.text)),
        visual: readText(content.hook?.visual),
        text: readText(content.hook?.text),
        characterSpeech: readText(content.hook?.characterSpeech),
        voiceover: readText(content.hook?.voiceover),
        voice: readText(content.hook?.voice),
        viTranslation: readText(content.hook?.viTranslation),
        viewerEmotion: readText(content.hook?.viewerEmotion),
        painpointImpact: readText(content.hook?.painpointImpact),
        whyTheyStopScrolling: readText(content.hook?.whyTheyStopScrolling),
      },
      savedIdeaId: idea.id,
    };
  }, []);

  const mapHistoryIdeaToFullIdea = (idea: GeneratedIdea, index = 0): FullIdea => {
    const content = idea.content;
    const mapped: FullIdea = {
      id: idea.id,
      title: readText(idea.title, 'Full Idea'),
      duration: readText(idea.duration),
      creativeType: readText(content.creativeType, 'Creative'),
      explanation: readText(content.explanation),
      meta: content.meta as FullIdea['meta'],
      framework: content.framework,
      hook: content.hook,
      body: content.body,
      cta: content.cta,
      savedIdeaId: idea.id,
    };
    return selectedHook ? normalizeFullIdeaForDisplay(mapped, selectedHook, index) : mapped;
  };

  const applyModifyHistoryIdeas = useCallback((ideas: GeneratedIdea[]) => {
    setGeneratedIdeas(ideas.map(mapHistoryIdeaToModifiedHook));
    setAvailableModifyHistoryCount(ideas.length);
    setSavedModifiedHookCount(ideas.length);
    setSavedModifiedHookSessionId(ideas[0]?.session_id || null);
    setModifiedHooksSaveStatus(ideas.length > 0 ? 'saved' : 'idle');
  }, [mapHistoryIdeaToModifiedHook]);

  const applyFullIdeaHistoryIdeas = (ideas: GeneratedIdea[]) => {
    setFullIdeas(ideas.map((idea, index) => mapHistoryIdeaToFullIdea(idea, index)));
    setAvailableFullIdeasHistoryCount(ideas.length);
    setSavedFullIdeasCount(ideas.length);
    setSavedFullIdeasSessionId(ideas[0]?.session_id || null);
    setFullIdeasSaveStatus(ideas.length > 0 ? 'saved' : 'idle');
  };

  const checkModifyHistoryAvailability = useCallback(async () => {
    if (!app?.id || !selectedHook) return;
    try {
      const ideas = await dbService.getIdeasForHook(app.id, selectedHook, 'modify');
      setAvailableModifyHistoryCount(ideas.length);
      setSavedModifiedHookSessionId(ideas[0]?.session_id || null);
    } catch (err) {
      console.error('Check modified hook history failed:', err);
      setAvailableModifyHistoryCount(0);
      setSavedModifiedHookSessionId(null);
    }
  }, [app?.id, selectedHook]);

  const checkFullIdeasHistoryAvailability = useCallback(async () => {
    if (!app?.id || !selectedHook) return;
    try {
      const ideas = await dbService.getIdeasForHook(app.id, selectedHook, 'full');
      setAvailableFullIdeasHistoryCount(ideas.length);
      setSavedFullIdeasSessionId(ideas[0]?.session_id || null);
    } catch (err) {
      console.error('Check full ideas history failed:', err);
      setAvailableFullIdeasHistoryCount(0);
      setSavedFullIdeasSessionId(null);
    }
  }, [app?.id, selectedHook]);

  const loadModifyHistoryForSelectedHook = useCallback(async () => {
    if (!app?.id || !selectedHook) return;
    setLoadingModifyHistory(true);
    try {
      const ideas = await dbService.getIdeasForHook(app.id, selectedHook, 'modify');
      applyModifyHistoryIdeas(ideas);
    } catch (err) {
      console.error('Load modified hook history failed:', err);
      applyModifyHistoryIdeas([]);
    } finally {
      setLoadingModifyHistory(false);
    }
  }, [app?.id, selectedHook, applyModifyHistoryIdeas]);

  const loadFullIdeasHistoryForSelectedHook = async () => {
    if (!app?.id || !selectedHook) return;
    setLoadingFullIdeasHistory(true);
    try {
      const ideas = await dbService.getIdeasForHook(app.id, selectedHook, 'full');
      applyFullIdeaHistoryIdeas(ideas);
    } catch (err) {
      console.error('Load full ideas history failed:', err);
      applyFullIdeaHistoryIdeas([]);
    } finally {
      setLoadingFullIdeasHistory(false);
    }
  };

  const handleOpenModifyHistory = useCallback(async () => {
    if (isViewingModifyHistory) {
      setGeneratedIdeas(modifyLiveIdeas);
      setIsViewingModifyHistory(false);
      return;
    }
    await loadModifyHistoryForSelectedHook();
    setIsViewingModifyHistory(true);
    window.requestAnimationFrame(() => {
      modifyResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [isViewingModifyHistory, loadModifyHistoryForSelectedHook, modifyLiveIdeas]);

  const handleOpenFullIdeasHistory = async () => {
    if (isViewingFullIdeasHistory) {
      setFullIdeas(fullIdeasLive);
      setIsViewingFullIdeasHistory(false);
      return;
    }
    await loadFullIdeasHistoryForSelectedHook();
    setIsViewingFullIdeasHistory(true);
    window.requestAnimationFrame(() => {
      fullIdeasResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    if (!app?.id || !selectedHook) return;

    if (currentScreen === 'f2.2.1') {
      checkModifyHistoryAvailability().catch(err => {
        console.error('Check hook modify history availability failed:', err);
      });
      return;
    }

    if (currentScreen === 'f2.2.2') {
      checkFullIdeasHistoryAvailability().catch(err => {
        console.error('Check full ideas history availability failed:', err);
      });
    }
  }, [app?.id, currentScreen, selectedHook, checkModifyHistoryAvailability, checkFullIdeasHistoryAvailability]);

  useEffect(() => {
    setIsViewingModifyHistory(false);
    setIsViewingFullIdeasHistory(false);
  }, [currentScreen, selectedHook?.id]);

  const buildHookFilterSnapshot = (hook: Hook): FilterState => {
    const framework = buildHookFrameworkFallback(hook, {
      appName: app?.name || '',
      appCategory: app?.category || '',
    });

    return {
      coreUser: framework.coreUser ? [framework.coreUser] : [],
      painPoint: framework.painpoint ? [framework.painpoint] : [],
      solution: framework.psp ? [framework.psp] : [],
      emotion: framework.emotion ? [framework.emotion] : [],
      videoStructure: ['Hook Library'],
      visualType: framework.creativeType ? [framework.creativeType] : [],
      targetMarket: [],
      angle: [framework.angle || `Winning Hook: ${hook.title}`],
    };
  };

  const buildStructuredLocalFullIdeas = (
    sourceHook: Hook,
    count: number,
    direction: string,
    startIndex = 0,
  ): FullIdea[] => {
    const baseTitle = stripVariantSuffix(sourceHook.title);
    const painpoint = sourceHook.painpoint || 'the user blocker';
    const coreUser = sourceHook.core_user || 'General viewer';
    const emotion = sourceHook.emotion || 'Curiosity';
    const psp = sourceHook.hook_concept || app?.name || 'Product solution';
    const visualBase = sourceHook.visual_detail || 'A social-first handheld setup that shows the problem clearly.';
    const directionHint = readText(direction, psp);
    const variants = [
      {
        creativeType: 'UGC',
        hookOverlay: 'Why this move matters',
        hookVoice: `Wait, why does this simple move expose ${painpoint}?`,
        bodyOverlay: 'See the clue faster',
        bodyVoice: `The reveal happens faster when the viewer sees the blocker before the explanation starts.`,
        ctaOverlay: `Try ${app?.name || 'this app'} now`,
        ctaVoice: `Open ${app?.name || 'the app'} and test this angle before you lock the creative.`,
      },
      {
        creativeType: 'POV',
        hookOverlay: 'The detail people miss',
        hookVoice: `Most people miss this detail in the first second.`,
        bodyOverlay: 'Show the blocker early',
        bodyVoice: `Use a tighter POV so the pain point lands immediately and the solution feels obvious.`,
        ctaOverlay: 'Build another version',
        ctaVoice: `Spin one more variant from this hook and compare which opener lands better.`,
      },
      {
        creativeType: 'Social Proof',
        hookOverlay: 'Same pain, new angle',
        hookVoice: `Same pain point, but this angle makes it click instantly.`,
        bodyOverlay: 'Make the contrast obvious',
        bodyVoice: `Frame the old friction and the new reveal in one quick contrast so the viewer gets the payoff fast.`,
        ctaOverlay: `Test in ${app?.name || 'app'}`,
        ctaVoice: `Turn this winning DNA into a new test inside ${app?.name || 'your workflow'}.`,
      },
    ];

    return Array.from({ length: count }, (_, index) => {
      const variant = variants[(startIndex + index) % variants.length];
      const displayIndex = startIndex + index + 1;
      return {
        title: `${baseTitle} - Full Idea ${displayIndex}`,
        duration: IDEA_RUNTIME_GUIDANCE,
        creativeType: variant.creativeType,
        explanation: `Expand winning hook DNA into a full brief that keeps the pain point "${painpoint}" and pushes direction "${directionHint}".`,
        framework: {
          coreUser,
          painpoint,
          emotion,
          psp,
        },
        hook: {
          script: `[VISUAL] ${visualBase} Reframe the opening so "${directionHint}" is visible immediately.\n[VOICE] ${variant.hookVoice}\n[TEXT OVERLAY] ${variant.hookOverlay}`,
          visual: `${visualBase} Reframe the opening so "${directionHint}" is visible immediately.`,
          text: variant.hookOverlay,
          textOverlay: variant.hookOverlay,
          voice: variant.hookVoice,
        },
        body: {
          script: `[VISUAL] Push into a closer demo of the same problem, then show how ${psp} changes the situation.\n[VOICE] ${variant.bodyVoice}\n[TEXT OVERLAY] ${variant.bodyOverlay}`,
          visual: `Push into a closer demo of the same problem, then show how ${psp} changes the situation.`,
          text: variant.bodyOverlay,
          textOverlay: variant.bodyOverlay,
          voice: variant.bodyVoice,
        },
        cta: {
          script: `[VISUAL] End on the app screen with the key action ready to tap.\n[VOICE] ${variant.ctaVoice}\n[TEXT OVERLAY] ${variant.ctaOverlay}`,
          visual: 'End on the app screen with the key action ready to tap.',
          voice: variant.ctaVoice,
          text: variant.ctaOverlay,
          textOverlay: variant.ctaOverlay,
          endCard: `${app?.name || 'App'} - ${psp}`,
        },
      };
    });
  };

  const normalizeFullIdeaContent = (idea: FullIdea, sourceHook: Hook): IdeaContent => {
    const normalizedIdea = normalizeFullIdeaForDisplay(idea, sourceHook, 0);
    const framework = normalizedIdea.framework || {};
    const hook = normalizedIdea.hook || {};
    const body = normalizedIdea.body || {};
    const cta = normalizedIdea.cta || {};
    const meta = normalizedIdea.meta || {};

    return {
      creativeType: readText(normalizedIdea.creativeType, sourceHook.creative_type || sourceHook.subtitle || 'UGC'),
      meta: {
        builderVersion: 'hook_library_full_idea_v1',
        pillar: readText(framework.painpoint, sourceHook.painpoint || 'Hook Library'),
        angleName: readText(meta.angleName, `Winning Hook: ${sourceHook.title}`),
        angleType: readText(meta.angleType),
        angleDesc: readText(meta.angleDesc),
        hookPrimary: readText(meta.hookPrimary, readText(hook.textOverlay, readText(hook.text))),
        emotionJourney: readText(meta.emotionJourney),
        bodyMotivationPattern: readText(meta.bodyMotivationPattern),
        visualRefNotes: sourceHook.visual_detail || undefined,
        sourceHookId: sourceHook.id,
        sourceHookTitle: sourceHook.title,
        sessionType: 'full-idea',
        track: 'hook-full-idea',
      },
      framework: {
        coreUser: readText(framework.coreUser, sourceHook.core_user || 'General viewer'),
        painpoint: readText(framework.painpoint, sourceHook.painpoint || 'General user friction'),
        emotion: readText(framework.emotion, sourceHook.emotion || 'Curiosity'),
        psp: readText(framework.psp, sourceHook.hook_concept || app?.name || 'Product solution'),
      },
      explanation: readText(normalizedIdea.explanation),
      hook: {
        durationSeconds: estimateSectionDurationSeconds(hook as Record<string, unknown>),
        script: readText(hook.script, readText(hook.visual)),
        textOverlay: readText(hook.textOverlay, readText(hook.text)),
        visual: readText(hook.visual, readText(hook.script)),
        text: readText(hook.text, readText(hook.textOverlay)),
        characterSpeech: getSectionCharacterSpeech(hook as Record<string, unknown>),
        voiceover: getSectionVoiceover(hook as Record<string, unknown>),
        voice: readText(hook.voice, getSectionVoiceover(hook as Record<string, unknown>) || getSectionCharacterSpeech(hook as Record<string, unknown>)),
        viTranslation: readText(hook.viTranslation),
        viewerProfile: readText(hook.viewerProfile),
        viewerEmotion: readText(hook.viewerEmotion),
        painpointImpact: readText(hook.painpointImpact),
        whyTheyStopScrolling: readText(hook.whyTheyStopScrolling),
      },
      body: {
        script: readText(body.script, readText(body.visual)),
        textOverlay: readText(body.textOverlay, readText(body.text)),
        visual: readText(body.visual, readText(body.script)),
        text: readText(body.text, readText(body.textOverlay)),
        characterSpeech: getSectionCharacterSpeech(body as Record<string, unknown>),
        voiceover: getSectionVoiceover(body as Record<string, unknown>),
        voice: readText(body.voice, getSectionVoiceover(body as Record<string, unknown>) || getSectionCharacterSpeech(body as Record<string, unknown>)),
        viTranslation: readText(body.viTranslation),
      },
      cta: {
        script: readText(cta.script, readText(cta.visual)),
        visual: readText(cta.visual, readText(cta.script)),
        characterSpeech: getSectionCharacterSpeech(cta as Record<string, unknown>),
        voiceover: getSectionVoiceover(cta as Record<string, unknown>),
        voice: readText(cta.voice, getSectionVoiceover(cta as Record<string, unknown>) || getSectionCharacterSpeech(cta as Record<string, unknown>)),
        text: readText(cta.text, readText(cta.textOverlay)),
        textOverlay: readText(cta.textOverlay, readText(cta.text)),
        endCard: readText(cta.endCard),
        viTranslation: readText(cta.viTranslation),
      },
    };
  };

  const normalizeModifiedHookContent = (idea: HookIdea, sourceHook: Hook): IdeaContent => {
    const hook = idea.hook || {};
    const framework = buildHookFrameworkFallback(sourceHook, {
      appName: app?.name || '',
      appCategory: app?.category || '',
    });
    return {
      creativeType: 'Modified Hook',
      meta: {
        builderVersion: 'hook_library_modify_history_v1',
        pillar: framework.painpoint || 'Hook Modify',
        angleName: `Modified Hook: ${sourceHook.title}`,
        hookPrimary: readText(hook.textOverlay, readText(hook.text, idea.title)),
        visualRefNotes: sourceHook.visual_detail || framework.angle || undefined,
        talentProfile: framework.coreUser || undefined,
        track: 'hook-modify',
        trackReason: readText(modifyPrompt, 'Generated from Hook Library Modify'),
        sourceHookId: sourceHook.id,
        sourceHookTitle: sourceHook.title,
        sessionType: 'modify-hook',
      },
      framework: {
        coreUser: framework.coreUser,
        painpoint: framework.painpoint,
        emotion: framework.emotion,
        psp: framework.psp,
      },
      explanation: readText(idea.explanation, `Modified hook generated from "${sourceHook.title}"`),
      hook: {
        durationSeconds: estimateSectionDurationSeconds(hook as Record<string, unknown>),
        script: readText(hook.script, readText(hook.visual)),
        textOverlay: readText(hook.textOverlay, readText(hook.text)),
        visual: readText(hook.visual, readText(hook.script)),
        text: readText(hook.text, readText(hook.textOverlay)),
        characterSpeech: getSectionCharacterSpeech(hook as Record<string, unknown>),
        voiceover: getSectionVoiceover(hook as Record<string, unknown>),
        voice: readText(hook.voice, getSectionVoiceover(hook as Record<string, unknown>) || getSectionCharacterSpeech(hook as Record<string, unknown>)),
        viTranslation: readText(hook.viTranslation),
        viewerEmotion: readText(hook.viewerEmotion),
        painpointImpact: readText(hook.painpointImpact),
        whyTheyStopScrolling: readText(hook.whyTheyStopScrolling),
      },
      body: {
        script: '',
        textOverlay: '',
        visual: '',
        text: '',
        voice: '',
        viTranslation: '',
      },
      cta: {
        script: '',
        visual: '',
        voice: '',
        text: '',
        textOverlay: '',
        endCard: '',
        viTranslation: '',
      },
    };
  };

  const saveModifiedHooksToHistory = async (ideas: HookIdea[]) => {
    if (!app?.id || !selectedHook || ideas.length === 0) return;

    setModifiedHooksSaveStatus('saving');
    setSavedModifiedHookCount(0);
    setSavedModifiedHookSessionId(null);

    const filtersSnapshot: FilterState = {
      ...buildHookFilterSnapshot(selectedHook),
      videoStructure: ['Modified Hook'],
      angle: [`Modified Hook: ${selectedHook.title}`],
    };
    const sessionId = crypto.randomUUID();

    try {
      const savedIdeas = await dbService.saveIdeas(
        app.id,
        ideas.map((idea, index) => ({
          title: normalizeDisplayedHookTitle(readText(idea.title, buildModifiedHookTitle(selectedHook.title, index))),
          duration: 'Hook only',
          content: normalizeModifiedHookContent(idea, selectedHook),
          filtersSnapshot,
        })),
        sessionId,
        filtersSnapshot
      );

      const savedCount = savedIdeas.length;
      setAvailableModifyHistoryCount(savedCount);
      setSavedModifiedHookCount(savedCount);
      setSavedModifiedHookSessionId(savedCount > 0 ? sessionId : null);
      const attachSavedIds = (list: HookIdea[]) => list.map((idea, index) => ({
        ...idea,
        savedIdeaId: savedIdeas[index]?.id,
      }));
      setGeneratedIdeas(attachSavedIds);
      setModifyLiveIdeas(attachSavedIds);
      setModifiedHooksSaveStatus(savedCount > 0 ? 'saved' : 'error');
    } catch (err) {
      console.error('Save modified hooks failed:', err);
      setModifiedHooksSaveStatus('error');
    }
  };

  const saveFullIdeasToDatabase = async (ideas: FullIdea[]) => {
    if (!app?.id || !selectedHook || ideas.length === 0) return ideas;

    setFullIdeasSaveStatus('saving');
    setSavedFullIdeasCount(0);
    setSavedFullIdeasSessionId(null);

    const filtersSnapshot = buildHookFilterSnapshot(selectedHook);
    const sessionId = crypto.randomUUID();
    const normalizedIdeas = ideas.map((idea, index) => normalizeFullIdeaForDisplay(idea, selectedHook, index));

    try {
      const savedIdeas = await dbService.saveIdeas(
        app.id,
        normalizedIdeas.map((idea, index) => ({
          title: readText(idea.title, `${selectedHook.title} - Full Idea ${index + 1}`),
          duration: readText(idea.duration, IDEA_RUNTIME_GUIDANCE),
          content: normalizeFullIdeaContent(idea, selectedHook),
          filtersSnapshot,
        })),
        sessionId,
        filtersSnapshot
      );

      const savedCount = savedIdeas.length;
      setAvailableFullIdeasHistoryCount(savedCount);
      setSavedFullIdeasCount(savedCount);
      setSavedFullIdeasSessionId(savedCount > 0 ? sessionId : null);
      setFullIdeasSaveStatus(savedCount > 0 ? 'saved' : 'error');

      return normalizedIdeas.map((idea, index) => ({
        ...idea,
        savedIdeaId: savedIdeas[index]?.id,
      }));
    } catch (err) {
      console.error('Save full ideas failed:', err);
      setFullIdeasSaveStatus('error');
      return normalizedIdeas;
    }
  };

  const openEditModal = (hook?: Hook) => {
    setAnalysisSuccess(false);
    // Reset pending file refs — important to prevent stale refs from previous modal session
    pendingFileRef.current = null;
    pendingThumbRef.current = null;
    if (hook) {
      setEditingHookData({
        ...hook,
        localVideoUrl: hook.video_url || undefined,
        localImageUrl: hook.image_url || undefined,
      });
    } else {
      setEditingHookData({ title: '', subtitle: 'Hook Mới', thumb: '✨', description: '', hook_concept: '', visual_detail: '' });
    }
    setIsEditModalOpen(true);
  };

  const handleSaveHook = async () => {
    if (!editingHookData.title) return;
    setIsSaving(true);
    try {
      let imageUrl = editingHookData.image_url || null;
      let videoUrl = editingHookData.video_url || null;

      // Upload via server API route (uses service role key, no RLS issues)
      if (pendingFileRef.current) {
        const formData = new FormData();
        formData.append('file', pendingFileRef.current);
        if (pendingFileRef.current.type.startsWith('video') && pendingThumbRef.current) {
          formData.append('thumbBase64', pendingThumbRef.current);
        }

        try {
          const uploadRes = await authenticatedFetch('/api/upload-hook-media', {
            method: 'POST',
            body: formData,
          });
          const uploadResult = await uploadRes.json();
          if (uploadRes.ok && uploadResult.success) {
            if (uploadResult.videoUrl) videoUrl = uploadResult.videoUrl;
            if (uploadResult.imageUrl) imageUrl = uploadResult.imageUrl;
          } else {
            console.error('Upload failed:', uploadResult.error);
          }
        } catch (uploadErr) {
          console.error('Upload request failed:', uploadErr);
        }

        pendingFileRef.current = null;
        pendingThumbRef.current = null;
      }

      if (editingHookData.id) {
        await dbService.updateHook(editingHookData.id, {
          title: editingHookData.title,
          subtitle: editingHookData.subtitle,
          description: editingHookData.description,
          hook_concept: editingHookData.hook_concept,
          visual_detail: editingHookData.visual_detail,
          core_user: editingHookData.core_user || null,
          painpoint: editingHookData.painpoint || null,
          emotion: editingHookData.emotion || null,
          creative_type: editingHookData.creative_type || null,
          image_url: imageUrl,
          video_url: videoUrl,
        });
      } else {
        if (!app?.id) { alert('Không tìm thấy app. Vui lòng quay lại.'); setIsSaving(false); return; }
        await dbService.addHook({
          app_id: app.id,
          title: editingHookData.title!,
          subtitle: editingHookData.subtitle || null,
          thumb: editingHookData.thumb || '✨',
          description: editingHookData.description || null,
          hook_concept: editingHookData.hook_concept || null,
          visual_detail: editingHookData.visual_detail || null,
          core_user: editingHookData.core_user || null,
          painpoint: editingHookData.painpoint || null,
          emotion: editingHookData.emotion || null,
          creative_type: editingHookData.creative_type || null,
          image_url: imageUrl,
          video_url: videoUrl,
        });
      }
      await loadHooks();
      setIsEditModalOpen(false);
    } catch (e: unknown) {
      console.error('Save hook error:', e);
    } finally { setIsSaving(false); }
  };

  const extractVideoAssets = (file: File): Promise<{ thumbnail: string; analysisImage: string }> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const cleanup = () => {
        if (video.src) URL.revokeObjectURL(video.src);
        video.remove();
      };

      const captureFrame = (time: number) => new Promise<string>((frameResolve) => {
        const handleSeeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            frameResolve('');
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frameResolve(canvas.toDataURL('image/jpeg', 0.78));
        };

        video.onseeked = handleSeeked;
        video.currentTime = Math.max(0, Math.min(time, Math.max(video.duration - 0.05, 0)));
      });

      video.onloadedmetadata = async () => {
        try {
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
          const capturePoints = [0.1, duration * 0.35, duration * 0.75];
          const frames: string[] = [];

          for (const point of capturePoints) {
            const frame = await captureFrame(point);
            if (frame) frames.push(frame);
          }

          const thumbnail = frames[0] || '';
          if (frames.length === 0) {
            resolve({ thumbnail: '', analysisImage: '' });
            cleanup();
            return;
          }

          const images = await Promise.all(frames.map(frame => new Promise<HTMLImageElement>((imgResolve, imgReject) => {
            const img = new Image();
            img.onload = () => imgResolve(img);
            img.onerror = () => imgReject(new Error('Frame load failed'));
            img.src = frame;
          })));

          const frameWidth = 360;
          const frameHeight = Math.round((images[0].naturalHeight / images[0].naturalWidth) * frameWidth);
          const headerHeight = 64;
          const gap = 16;
          const canvas = document.createElement('canvas');
          canvas.width = images.length * frameWidth + Math.max(0, images.length - 1) * gap;
          canvas.height = headerHeight + frameHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ thumbnail, analysisImage: thumbnail });
            cleanup();
            return;
          }

          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 22px Arial';
          ctx.fillText('Video analysis frames', 16, 28);
          ctx.fillStyle = '#475569';
          ctx.font = '16px Arial';
          ctx.fillText('Infer core user, painpoint, emotion, and creative type from these moments.', 16, 52);

          images.forEach((img, index) => {
            const x = index * (frameWidth + gap);
            ctx.drawImage(img, x, headerHeight, frameWidth, frameHeight);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
            ctx.fillRect(x + 10, headerHeight + 10, 90, 28);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 15px Arial';
            ctx.fillText(index === 0 ? 'Opening' : index === 1 ? 'Middle' : 'Later', x + 20, headerHeight + 29);
          });

          resolve({
            thumbnail,
            analysisImage: canvas.toDataURL('image/jpeg', 0.88),
          });
        } catch (error) {
          console.error('Extract video assets failed:', error);
          resolve({ thumbnail: '', analysisImage: '' });
        } finally {
          cleanup();
        }
      };

      video.onerror = () => {
        resolve({ thumbnail: '', analysisImage: '' });
        cleanup();
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const analyzeWithGemini = async (imageBase64: string, fileName: string) => {
    try {
      const res = await authenticatedFetch('/api/analyze-hook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          fileName,
          appName: app?.name || '',
          appCategory: app?.category || '',
        }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setEditingHookData(prev => ({
          ...prev,
          title: prev.title === fileName.replace(/\.[^/.]+$/, '') ? result.data.title : prev.title,
          subtitle: result.data.subtitle,
          description: result.data.description,
          hook_concept: result.data.hook_concept,
          visual_detail: result.data.visual_detail,
          core_user: result.data.core_user,
          painpoint: result.data.painpoint,
          emotion: result.data.emotion,
          creative_type: result.data.creative_type,
        }));
        setAnalysisSuccess(true);
      } else {
        // Fallback if AI fails
        setEditingHookData(prev => ({
          ...prev,
          subtitle: 'Hook',
          description: prev.description || `Hook từ "${fileName}"`,
        }));
        setAnalysisSuccess(true);
      }
    } catch (err) {
      console.error('AI analysis failed:', err);
      setEditingHookData(prev => ({ ...prev, subtitle: 'Hook' }));
      setAnalysisSuccess(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAnalyzing(true); setAnalysisSuccess(false);
    // Store file reference for upload on save
    pendingFileRef.current = file;
    setEditingHookData(prev => ({ ...prev, title: prev.title || file.name.replace(/\.[^/.]+$/, ''), subtitle: 'Đang phân tích bằng AI...' }));

    if (file.type.startsWith('video')) {
      const localUrl = URL.createObjectURL(file);
      const { thumbnail, analysisImage } = await extractVideoAssets(file);
      pendingThumbRef.current = thumbnail || null;
      setEditingHookData(prev => ({ ...prev, localVideoUrl: localUrl, localImageUrl: thumbnail || undefined }));

      // Send a contact sheet from multiple frames so the AI can infer strategy fields from the whole video.
      if (analysisImage || thumbnail) {
        await analyzeWithGemini(analysisImage || thumbnail, file.name);
      } else {
        setEditingHookData(prev => ({ ...prev, subtitle: 'Video Hook' }));
        setAnalysisSuccess(true);
        setIsAnalyzing(false);
      }
    } else if (file.type.startsWith('image')) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setEditingHookData(prev => ({ ...prev, localImageUrl: base64 }));
        // Send image to Gemini for analysis
        await analyzeWithGemini(base64, file.name);
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // === Hook Grid View (f2.2) ===
  if (currentScreen === 'f2.2') {
    return (
      <div className="p-6 sm:p-8 max-w-6xl mx-auto relative">
        <button onClick={() => setScreen('f2')} className="mb-4 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại</button>

        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">🎬 Hook Library</h1>
            <p className="text-gray-400 text-sm mt-1">Quản lý & phân tích các Winning Hook • {hooks.length} hook</p>
          </div>
          <button onClick={() => openEditModal()} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold hover:shadow-lg transition-all">
            <Plus size={18} /> Thêm Hook
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {hooks.map(hook => (
            <div key={hook.id} className="group bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl transition-all hover:-translate-y-1 relative">
              {/* Top actions */}
              <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setPreviewHook(hook)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-white hover:bg-black/70">
                  <Eye size={12} />
                </button>
                <button onClick={() => openEditModal(hook)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-white hover:bg-black/70">
                  <PenTool size={12} />
                </button>
                <button onClick={() => handleDeleteHook(hook.id)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-red-400 hover:bg-red-900/70 transition-colors">
                  {deletingHookId === hook.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>

              {/* Thumbnail */}
              <div className="aspect-[3/4] relative overflow-hidden">
                {hook.image_url ? (
                  <>
                    <img src={hook.image_url} alt={hook.title} className="w-full h-full object-cover" />
                    {hook.video_url && (
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <div className="w-12 h-12 bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center">
                          <Play className="text-white ml-0.5" size={20} fill="currentColor" />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex flex-col items-center justify-center">
                    <span className="text-5xl mb-3 drop-shadow-sm">{hook.thumb || '🎬'}</span>
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center">
                      <Play className="text-indigo-500 ml-0.5" size={16} fill="currentColor" />
                    </div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3.5">
                <h4 className="font-bold text-sm text-gray-800 mb-0.5 truncate">{hook.title}</h4>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-3">{hook.subtitle}</p>

                {hook.hook_concept && (
                  <p className="text-[11px] text-gray-500 mb-3 line-clamp-2 leading-relaxed">{hook.hook_concept}</p>
                )}

                <div className="flex gap-2">
                  <button onClick={() => {
                    setSelectedHook(hook);
                    setGeneratedIdeas([]);
                    setModifyLiveIdeas([]);
                    setIsViewingModifyHistory(false);
                    setModifyPrompt('');
                    setModifiedHooksSaveStatus('idle');
                    setSavedModifiedHookCount(0);
                    setSavedModifiedHookSessionId(null);
                    setAvailableModifyHistoryCount(0);
                    setScreen('f2.2.1');
                  }}
                    className="flex-1 text-xs py-2.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:shadow-md font-bold transition-all">
                    <Sparkles size={12} /> Modify
                  </button>
                  <button onClick={() => {
                    setSelectedHook(hook);
                    setFullIdeas([]);
                    setFullIdeasLive([]);
                    setIsViewingFullIdeasHistory(false);
                    setFullIdeasSaveStatus('idle');
                    setSavedFullIdeasCount(0);
                    setSavedFullIdeasSessionId(null);
                    setAvailableFullIdeasHistoryCount(0);
                    setIdeaDirection('');
                    setScreen('f2.2.2');
                  }}
                    className="flex-1 text-xs py-2.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:shadow-md font-bold transition-all">
                    <Brain size={12} /> Full Ideas
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Preview Modal */}
        {previewHook && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPreviewHook(null)}>
            <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{previewHook.thumb || '🎬'}</span>
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">{previewHook.title}</h2>
                      <p className="text-xs text-gray-400 uppercase font-semibold">{previewHook.subtitle}</p>
                    </div>
                  </div>
                  <button onClick={() => setPreviewHook(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
                </div>

                {(previewHook.image_url || previewHook.video_url) && (
                  <div className="rounded-xl overflow-hidden bg-gray-100 mb-4">
                    {previewHook.video_url ? (
                      <video src={previewHook.video_url} controls className="w-full max-h-80 object-contain" />
                    ) : (
                      <img src={previewHook.image_url!} alt={previewHook.title} className="w-full max-h-80 object-contain" />
                    )}
                  </div>
                )}

                {previewHook.description && (
                  <div className="mb-4">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Mô tả</label>
                    <p className="text-sm text-gray-700 mt-1">{previewHook.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {previewHook.hook_concept && (
                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                      <label className="text-[10px] font-bold text-indigo-500 uppercase">Hook Concept</label>
                      <p className="text-sm text-gray-700 mt-1">{previewHook.hook_concept}</p>
                    </div>
                  )}
                  {previewHook.visual_detail && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                      <label className="text-[10px] font-bold text-purple-500 uppercase">Visual Detail</label>
                      <p className="text-sm text-gray-700 mt-1">{previewHook.visual_detail}</p>
                    </div>
                  )}
                </div>

                <button onClick={() => {
                  setPreviewHook(null);
                  setSelectedHook(previewHook);
                  setGeneratedIdeas([]);
                  setModifyLiveIdeas([]);
                  setIsViewingModifyHistory(false);
                  setModifyPrompt('');
                  setModifiedHooksSaveStatus('idle');
                  setSavedModifiedHookCount(0);
                  setSavedModifiedHookSessionId(null);
                  setAvailableModifyHistoryCount(0);
                  setScreen('f2.2.1');
                }}
                  className="w-full mt-5 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:shadow-lg transition-all">
                  <Sparkles size={16} /> Tạo biến thể với AI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit / Create Modal */}
        {isEditModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsEditModalOpen(false)}>
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-800">{editingHookData.id ? '✏️ Chỉnh sửa Hook' : '✨ Thêm Hook Mới'}</h2>
                <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
              </div>

              <div className="p-6 space-y-5">
                {/* Upload & Analyze Section */}
                <div className={`rounded-xl p-5 border-2 border-dashed transition-colors ${analysisSuccess ? 'bg-emerald-50 border-emerald-200' : 'bg-indigo-50 border-indigo-200'}`}>
                  <div className="flex justify-between items-center mb-3">
                    <label className={`text-xs font-bold uppercase flex items-center gap-2 ${analysisSuccess ? 'text-emerald-600' : 'text-indigo-600'}`}>
                      {analysisSuccess ? <><Check size={14} /> Đã phân tích!</> : <><Upload size={14} /> Import & Phân Tích (AI)</>}
                    </label>
                    {analysisSuccess && (
                      <button onClick={() => fileInputRef.current?.click()} className="text-xs text-indigo-500 underline hover:text-indigo-700">Tải lại</button>
                    )}
                  </div>

                  <input ref={fileInputRef} type="file" accept="video/*,image/*" onChange={handleFileUpload} className="hidden" disabled={isAnalyzing} />

                  {!analysisSuccess && (
                    <button onClick={() => fileInputRef.current?.click()} disabled={isAnalyzing}
                      className={`flex items-center justify-center gap-3 w-full py-4 px-4 rounded-xl border border-indigo-200 text-indigo-600 font-medium bg-white hover:bg-indigo-50 transition-colors ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {isAnalyzing ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
                      <div className="text-left">
                        <p className="font-bold">{isAnalyzing ? 'Đang phân tích...' : 'Tải Video / Ảnh Hook'}</p>
                        <p className="text-[11px] text-gray-400 font-normal">AI sẽ tự động phân tích concept, visual, strategy</p>
                      </div>
                    </button>
                  )}

                  {/* Media Preview */}
                  {(editingHookData.localVideoUrl || editingHookData.localImageUrl) && (
                    <div className="mt-3 rounded-xl overflow-hidden bg-gray-900 flex items-center justify-center max-h-48 border border-gray-200">
                      {editingHookData.localVideoUrl ? (
                        <video src={editingHookData.localVideoUrl} controls className="h-full w-auto max-w-full max-h-48" />
                      ) : editingHookData.localImageUrl ? (
                        <img src={editingHookData.localImageUrl} alt="Preview" className="h-full w-auto max-w-full object-contain max-h-48" />
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Nhãn Hook *</label>
                  <input type="text" value={editingHookData.title || ''} onChange={e => setEditingHookData({ ...editingHookData, title: e.target.value })}
                    placeholder="VD: Pop-up Hết dung lượng, Unboxing iPhone..."
                    className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200 text-gray-800 font-medium" />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Mô tả</label>
                  <textarea value={editingHookData.description || ''} onChange={e => setEditingHookData({ ...editingHookData, description: e.target.value })}
                    placeholder="Mô tả ngắn gọn hook này..."
                    className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                </div>

                {/* Advanced Details */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 space-y-4">
                  <h4 className="font-bold text-gray-700 flex items-center gap-2"><PenTool size={14} className="text-indigo-500" /> Chi tiết nâng cao</h4>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Hook Concept</label>
                    <textarea value={editingHookData.hook_concept || ''} onChange={e => setEditingHookData({ ...editingHookData, hook_concept: e.target.value })}
                      placeholder="VD: Ngắt quãng thói quen lướt, Tạo cảm giác cấp bách..."
                      className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Chi tiết Visual</label>
                    <textarea value={editingHookData.visual_detail || ''} onChange={e => setEditingHookData({ ...editingHookData, visual_detail: e.target.value })}
                      placeholder="VD: Cận cảnh tay cầm điện thoại, màn hình hiện cảnh báo đỏ..."
                      className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                  </div>
                </div>

                {/* Framework Analysis */}
                <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 space-y-4">
                  <h4 className="font-bold text-amber-700 flex items-center gap-2"><Target size={14} className="text-amber-500" /> Framework Analysis</h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">👤 Core User</label>
                      <input type="text" value={editingHookData.core_user || ''} onChange={e => setEditingHookData({ ...editingHookData, core_user: e.target.value })}
                        placeholder="VD: Người già 45+, EN, lowtech"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">💔 Painpoint</label>
                      <input type="text" value={editingHookData.painpoint || ''} onChange={e => setEditingHookData({ ...editingHookData, painpoint: e.target.value })}
                        placeholder="VD: Điện thoại đầy bộ nhớ"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">😱 Emotion</label>
                      <input type="text" value={editingHookData.emotion || ''} onChange={e => setEditingHookData({ ...editingHookData, emotion: e.target.value })}
                        placeholder="VD: Sợ hãi + Lo lắng"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">🎬 Creative Type</label>
                      <input type="text" value={editingHookData.creative_type || ''} onChange={e => setEditingHookData({ ...editingHookData, creative_type: e.target.value })}
                        placeholder="VD: UGC Expert Apple, Hỏi Alexa"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                  </div>
                </div>

                {/* Emoji Thumb Picker */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Icon</label>
                  <div className="flex gap-2 flex-wrap">
                    {['🛑', '😫', '📱', '👀', '👴', '📦', '✅', '📰', '🔥', '💡', '🎯', '✨', '❤️', '⚡', '🧹', '🎬'].map(emoji => (
                      <button key={emoji} onClick={() => setEditingHookData({ ...editingHookData, thumb: emoji })}
                        className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${editingHookData.thumb === emoji ? 'bg-indigo-100 border-2 border-indigo-400 scale-110' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'}`}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button onClick={() => setIsEditModalOpen(false)} className="px-5 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Hủy</button>
                  <button onClick={handleSaveHook} disabled={isAnalyzing || isSaving || !editingHookData.title}
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 flex items-center gap-2 transition-all">
                    {(isAnalyzing || isSaving) && <Loader2 className="animate-spin" size={14} />}
                    {isSaving ? 'Đang lưu...' : isAnalyzing ? 'Đang phân tích...' : '✓ Lưu Hook'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // === Hook-to-Full-Ideas View (f2.2.2) ===
  if (currentScreen === 'f2.2.2' && selectedHook) {
    const handleGenerateFullIdeas = async () => {
      setFullIdeasLoading(true);
      setFullIdeas([]);
      setFullIdeasLive([]);
      setFullIdeasSaveStatus('idle');
      setSavedFullIdeasCount(0);
      setSavedFullIdeasSessionId(null);
      setIsViewingFullIdeasHistory(false);
      setExpandedFullIdeaKeys({});
      const controller = new AbortController();
      abortRef.current = controller;
      startProgress();
      try {
        const res = await authenticatedFetch('/api/generate-ideas-from-hook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hook: selectedHook,
              quantity: fullIdeasQty,
              duration: IDEA_RUNTIME_GUIDANCE,
              ideaDirection: ideaDirection || null,
              appKnowledge: app?.app_knowledge || null,
            previousIdeas: fullIdeasLive.slice(0, 6).map((idea, index) => (
              `${index + 1}. ${idea.title || 'Full Idea'} | hook="${readText(idea.hook?.textOverlay, readText(idea.hook?.voice, readText(idea.hook?.visual)))}" | body="${readText(idea.body?.textOverlay, readText(idea.body?.visual))}"`
            )).join('\n'),
            appName: app?.name || '',
            appCategory: app?.category || '',
            selectedModel: selectedModel || '',
          }),
          signal: controller.signal,
        });
        const result = await res.json();
        if (result?.meta?.warnings?.length) {
          console.warn('[generate-ideas-from-hook] warnings:', result.meta.warnings);
        }
        if ((result?.meta?.fallbackCount || 0) > 0) {
          throw new Error('Backend đang trả fallback ideas thay vì output AI sạch. Cần siết prompt/context rồi chạy lại.');
        }
        const resultData = Array.isArray(result?.data) ? (result.data as FullIdea[]) : [];
        if (res.ok && result.success && resultData.length > 0) {
          const generated = resultData.slice(0, fullIdeasQty);
          const saved = await saveFullIdeasToDatabase(generated);
          setFullIdeas(saved);
          setFullIdeasLive(saved);
          setExpandedFullIdeaKeys(saved.reduce<Record<string, boolean>>((acc, idea, index) => {
            const key = String(idea.savedIdeaId || idea.id || `${selectedHook?.id || 'full-idea'}-${index}`);
            acc[key] = true;
            return acc;
          }, {}));
          if (resultData.length < fullIdeasQty) {
            alert(`Chỉ tạo được ${resultData.length}/${fullIdeasQty} full ideas hợp lệ. Mình đã lưu ${saved.length} idea sạch vào DB; bấm tạo lại nếu cần đủ số lượng.`);
          }
        } else {
          alert(result.error || 'Có lỗi khi tạo ideas.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          if (err.message) {
            alert(err.message);
            return;
          }
          alert('Có lỗi khi tạo ideas. Vui lòng thử lại.');
        }
      } finally {
        stopProgress();
        setFullIdeasLoading(false);
      }
    };
    const frameworkView = buildHookFrameworkFallback(selectedHook, {
      appName: app?.name || '',
      appCategory: app?.category || '',
    });

    return (
      <div className="p-6 sm:p-8 max-w-[95%] mx-auto">
        <button onClick={() => setScreen('f2.2')} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại Thư Viện</button>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Panel */}
          <div className="lg:col-span-4 space-y-5">
            {/* Hook Card */}
            <div className="bg-white rounded-2xl overflow-hidden border-2 border-amber-200 shadow-sm">
              {selectedHook.image_url ? (
                <div className="h-48 bg-gray-100">
                  <img src={selectedHook.image_url} alt={selectedHook.title} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="h-32 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                  <span className="text-5xl">{selectedHook.thumb || '🎬'}</span>
                </div>
              )}
              <div className="p-5">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">🏆 Winning Hook — Framework Analysis</span>
                <h2 className="text-xl font-bold text-gray-800 mt-1">&quot;{selectedHook.title}&quot;</h2>
                {frameworkView.psp && (
                  <p className="text-sm text-gray-500 mt-2 italic border-l-2 border-amber-200 pl-3">{frameworkView.psp}</p>
                )}
              </div>
            </div>

            {/* Framework Analysis Display */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-200 space-y-3">
              <h3 className="font-bold text-amber-700 flex items-center gap-2 text-sm"><Target size={14} className="text-amber-500" /> Framework Analysis</h3>
              <div className="space-y-2">
                {frameworkView.coreUser && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-indigo-500 uppercase">👤 Core User</span>
                    <p className="text-sm text-gray-700 mt-0.5">{frameworkView.coreUser}</p>
                  </div>
                )}
                {frameworkView.painpoint && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-red-500 uppercase">💔 Painpoint</span>
                    <p className="text-sm text-gray-700 mt-0.5">{frameworkView.painpoint}</p>
                  </div>
                )}
                {frameworkView.emotion && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-orange-500 uppercase">😱 Emotion</span>
                    <p className="text-sm text-gray-700 mt-0.5">{frameworkView.emotion}</p>
                  </div>
                )}
                {frameworkView.creativeType && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-emerald-500 uppercase">🎬 Creative Type</span>
                    <p className="text-sm text-gray-700 mt-0.5">{frameworkView.creativeType}</p>
                  </div>
                )}
                {selectedHook.visual_detail && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-purple-500 uppercase">👁️ Visual</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.visual_detail}</p>
                  </div>
                )}
                {false && (
                  <p className="text-sm text-amber-600 italic">Chưa có framework data. Chỉnh sửa hook để thêm phân tích.</p>
                )}
              </div>
            </div>

            {/* Generate Controls */}
            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-700 flex items-center gap-2 text-sm"><Brain size={14} className="text-amber-500" /> Tạo Full Ideas từ Hook này</h3>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><ListOrdered size={10} /> Số lượng</label>
                  <div className="flex gap-1">
                    {[1, 3, 5].map(n => (
                      <button key={n} onClick={() => setFullIdeasQty(n)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${fullIdeasQty === n ? 'bg-amber-500 text-white' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100'}`}>
                        {n}
                      </button>
                    ))}
                    <input type="number" min={1} max={5} value={fullIdeasQty}
                      onChange={e => setFullIdeasQty(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                      className="w-12 py-2 rounded-lg text-xs font-bold text-center border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-200" />
                  </div>
                </div>
              </div>

              {/* Direction textarea */}
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><PenTool size={10} /> Mô tả hướng đi (tùy chọn)</label>
                <textarea value={ideaDirection} onChange={e => setIdeaDirection(e.target.value)}
                  className="w-full h-24 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm"
                  placeholder={`VD: Nhắm target phụ nữ 30-40, kết hợp nỗi sợ mất dữ liệu, phong cách UGC reaction...`} />
              </div>

              <button onClick={handleGenerateFullIdeas} disabled={fullIdeasLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 transition-all text-sm">
                {fullIdeasLoading ? <RefreshCw className="animate-spin" size={18} /> : <Brain size={18} />}
                {fullIdeasLoading ? 'Đang tạo Ideas...' : '🚀 Tạo Full Ideas'}
              </button>

              {fullIdeasLoading && progress > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-amber-600 font-medium flex items-center gap-2">
                      <Loader2 className="animate-spin" size={14} /> {progressLabel}
                    </span>
                    <span className="font-bold text-amber-700">{progress}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 via-orange-400 to-red-400 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }} />
                  </div>
                  <button onClick={handleCancel}
                    className="w-full py-2 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all flex items-center justify-center gap-2">
                    <X size={16} /> Hủy
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Full Ideas Results */}
          <div ref={fullIdeasResultsRef} className="lg:col-span-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wand2 className="text-amber-500" size={20} /> Full Ideas ({fullIdeas.length})</h3>
              <div className="flex items-center gap-2">
                {fullIdeasSaveStatus !== 'idle' && (
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                    fullIdeasSaveStatus === 'saved'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : fullIdeasSaveStatus === 'saving'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-red-200 bg-red-50 text-red-600'
                  }`}>
                    {fullIdeasSaveStatus === 'saved'
                      ? `Đã lưu DB (${savedFullIdeasCount})`
                      : fullIdeasSaveStatus === 'saving'
                        ? 'Đang lưu DB...'
                        : 'Lưu DB thất bại'}
                  </span>
                )}
                {savedFullIdeasSessionId && availableFullIdeasHistoryCount > 0 && (
                  <button
                    onClick={handleOpenFullIdeasHistory}
                    className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                  >
                    {isViewingFullIdeasHistory ? 'Ẩn History' : `Xem History (${availableFullIdeasHistoryCount})`}
                  </button>
                )}
              </div>
            </div>

            {(fullIdeas.length > 0 || loadingFullIdeasHistory || fullIdeasSaveStatus !== 'idle') && (
              <p className="mb-4 text-xs leading-relaxed text-gray-500">
                Full Ideas được lưu vào History theo Winning Hook này. Có thể bật/tắt `Xem History` để đổi giữa output hiện tại và các idea cũ đã lưu.
              </p>
            )}

            {loadingFullIdeasHistory ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-20 text-center">
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                </div>
                <p className="font-bold text-gray-500 mb-1">Đang tải Full Ideas đã tạo</p>
                <p className="text-sm text-gray-400 max-w-md mx-auto">History của hook này đang được đọc lại từ database.</p>
              </div>
            ) : fullIdeas.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {fullIdeas.map((idea, idx) => {
                  const normalizedIdea = normalizeFullIdeaForDisplay(idea, selectedHook, idx);
                  const detailKey = String(normalizedIdea.savedIdeaId || normalizedIdea.id || `${selectedHook?.id || 'full-idea'}-${idx}`);
                  const isDetailOpen = Boolean(expandedFullIdeaKeys[detailKey]);
                  const visibleSections = isDetailOpen
                    ? FULL_IDEA_SECTIONS
                    : FULL_IDEA_SECTIONS.filter(sec => sec.key === 'hook');
                  const copyText = buildFullIdeaCopyText(normalizedIdea, selectedHook, idx);

                  return (
                    <div key={detailKey} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
                      <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500 w-full" />
                      <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-lg text-gray-800 mb-1">{normalizedIdea.title || `Ý tưởng ${idx + 1}`}</h4>
                            <div className="flex gap-2 flex-wrap">
                              <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">{normalizedIdea.creativeType || 'Creative'}</span>
                              {normalizedIdea.meta?.angleType && (
                                <span className="text-xs px-2 py-0.5 bg-cyan-50 text-cyan-700 rounded font-medium">{normalizedIdea.meta.angleType}</span>
                              )}
                              {normalizedIdea.savedIdeaId && (
                                <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-medium">Đã lưu DB</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(copyText);
                            }}
                            className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Copy"
                          >
                            <Copy size={16} />
                          </button>
                        </div>

                        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
                          <p className="text-xs font-medium text-amber-700">
                            {isDetailOpen ? 'Showing hook, body, CTA, and explanation.' : 'Showing hook only. Open detail to inspect the full brief.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleFullIdeaDetails(detailKey)}
                            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                          >
                            {isDetailOpen ? 'Hide Detail' : 'Show Detail'}
                          </button>
                        </div>

                        {isDetailOpen && normalizedIdea.explanation && (
                          <p className="text-gray-400 italic text-sm mb-4 border-l-2 border-amber-200 pl-3">{normalizedIdea.explanation}</p>
                        )}

                        {visibleSections.map(sec => {
                          const secData = normalizedIdea[sec.key] || {};
                          const scriptContent = buildReadableFullIdeaSectionScript(normalizedIdea, sec.key);
                          const sectionLabel = sec.key === 'hook'
                            ? `${sec.label} (${getFullIdeaHookDurationSeconds(secData as Partial<IdeaContent['hook']>)}s)`
                            : sec.label;

                          return (
                            <div key={sec.key} className={`mb-4 ${sec.bg} rounded-xl p-4 border ${sec.border}`}>
                              <span className={`text-[10px] font-bold ${sec.title} uppercase tracking-widest flex items-center gap-1 mb-3`}>{sectionLabel}</span>
                              <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{scriptContent || '—'}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-20 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl flex items-center justify-center">
                  <Brain size={36} className="text-amber-300" />
                </div>
                <p className="font-bold text-gray-500 mb-1">Tạo Full Ideas từ Winning Hook</p>
                <p className="text-sm text-gray-400 max-w-md mx-auto">AI sẽ dùng framework đã phân tích sẵn từ hook để tạo full production briefs (Hook + Body + CTA) mới.</p>
                {availableFullIdeasHistoryCount > 0 && (
                  <p className="mt-3 text-xs text-amber-600 font-medium">
                    {`Hook này có ${availableFullIdeasHistoryCount} history đã lưu. Bấm "Xem History (${availableFullIdeasHistoryCount})" để xem lại hoặc ẩn đi.`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Modify View (f2.2.1) ===
  return (
    <div className="p-6 sm:p-8 max-w-[95%] mx-auto">
      <button onClick={() => setScreen('f2.2')} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại Thư Viện</button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Hook Info + Input */}
        <div className="lg:col-span-4 space-y-5">
          {/* Selected Hook Card */}
          <div className="bg-white rounded-2xl overflow-hidden border-2 border-indigo-200 shadow-sm">
            {selectedHook?.image_url ? (
              <div className="h-48 bg-gray-100">
                <img src={selectedHook.image_url} alt={selectedHook.title} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="h-32 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                <span className="text-5xl">{selectedHook?.thumb || '🎬'}</span>
              </div>
            )}
            <div className="p-5">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Hook Gốc (Winning)</span>
              <h2 className="text-xl font-bold text-gray-800 mt-1">&quot;{selectedHook?.title}&quot;</h2>
              {selectedHook?.hook_concept && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
                  <p className="text-gray-500"><span className="font-bold text-gray-700">Concept:</span> {selectedHook.hook_concept}</p>
                  {selectedHook.visual_detail && <p className="text-gray-500"><span className="font-bold text-gray-700">Visual:</span> {selectedHook.visual_detail}</p>}
                </div>
              )}
              {selectedHook?.description && (
                <p className="text-sm text-gray-500 mt-3 italic border-l-2 border-indigo-200 pl-3">{selectedHook.description}</p>
              )}
            </div>
          </div>

          {/* Generate Controls */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <div className="mb-4">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-2"><ListOrdered size={12} /> Số lượng biến thể</label>
              <div className="flex gap-2">
                {[1, 3, 5].map(n => (
                  <button key={n} onClick={() => setQuantity(n)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${quantity === n ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100'}`}>
                    {n}
                  </button>
                ))}
                <input type="number" min={1} max={20} value={quantity}
                  onChange={e => setQuantity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-16 py-2 rounded-xl text-sm font-bold text-center border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
            </div>
            <label className="block font-semibold text-gray-700 mb-2 text-sm">Ý tưởng / Bối cảnh mới</label>
            <textarea value={modifyPrompt} onChange={e => setModifyPrompt(e.target.value)}
              className="w-full h-32 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200"
              placeholder={`VD: Kết hợp hook "${selectedHook?.title}" với:\n- Nỗi sợ đột quỵ lúc ngủ\n- Target phụ nữ 30-40 tuổi\n- Phong cách UGC`} />

            {/* Smart Suggestions — auto-generated from hook analysis */}
            {selectedHook && (() => {
              const suggestions: { emoji: string; label: string; prompt: string; color: string }[] = [];
              // From hook framework data
              if (selectedHook.core_user) {
                suggestions.push({ emoji: '👤', label: `Target: ${selectedHook.core_user}`, prompt: `Target ${selectedHook.core_user}`, color: '#6366f1' });
                // Suggest a different target
                const altTargets = ['Phụ nữ 25-35, Social Media', 'Nam 18-25, Gamer', 'Người già 55+, lowtech', 'Gen Z, Lifestyle'];
                const current = selectedHook.core_user.toLowerCase();
                const alt = altTargets.find(t => !current.includes(t.split(',')[0].toLowerCase()));
                if (alt) suggestions.push({ emoji: '🔄', label: `Đổi target: ${alt}`, prompt: `Đổi target sang ${alt}`, color: '#8b5cf6' });
              }
              if (selectedHook.painpoint) {
                suggestions.push({ emoji: '💔', label: selectedHook.painpoint, prompt: `Nỗi đau: ${selectedHook.painpoint}`, color: '#ef4444' });
                // Suggest related painpoints
                suggestions.push({ emoji: '😰', label: 'Kết hợp nỗi sợ mất dữ liệu', prompt: 'Kết hợp thêm nỗi sợ mất dữ liệu quan trọng', color: '#f97316' });
              }
              if (selectedHook.emotion) {
                suggestions.push({ emoji: '😱', label: `Cảm xúc: ${selectedHook.emotion}`, prompt: `Cảm xúc chủ đạo: ${selectedHook.emotion}`, color: '#eab308' });
              }
              if (selectedHook.creative_type) {
                suggestions.push({ emoji: '🎬', label: selectedHook.creative_type, prompt: `Phong cách: ${selectedHook.creative_type}`, color: '#10b981' });
              }
              // Generic smart suggestions
              suggestions.push(
                { emoji: '📱', label: 'Phong cách UGC', prompt: 'Phong cách UGC (Người thật quay)', color: '#06b6d4' },
                { emoji: '🔥', label: 'Hook viral TikTok', prompt: 'Twist hook theo trend viral TikTok hiện tại', color: '#f43f5e' },
                { emoji: '⚡', label: 'Tăng urgency', prompt: 'Tăng cảm giác cấp bách, FOMO, phải hành động ngay', color: '#f59e0b' },
                { emoji: '🎯', label: 'A/B Test angle', prompt: 'Tạo biến thể A/B test với góc tiếp cận hoàn toàn khác', color: '#8b5cf6' },
              );

              return (
                <div className="mt-3 mb-1">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                    <Sparkles size={10} className="text-amber-500" /> Gợi ý nhanh từ phân tích
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s, i) => (
                      <button key={i}
                        onClick={() => setModifyPrompt(prev => prev ? `${prev}\n- ${s.prompt}` : `Kết hợp hook "${selectedHook.title}" với:\n- ${s.prompt}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all hover:scale-105 hover:shadow-sm"
                        style={{
                          borderColor: `${s.color}30`,
                          background: `${s.color}08`,
                          color: s.color,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${s.color}15`; e.currentTarget.style.borderColor = `${s.color}50`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${s.color}08`; e.currentTarget.style.borderColor = `${s.color}30`; }}
                      >
                        <span>{s.emoji}</span> {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <button onClick={handleGenerate} disabled={isLoading || !modifyPrompt}
              className="w-full mt-3 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-pink-500 to-orange-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 transition-all text-sm">
              {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {isLoading ? 'Đang Sáng Tạo...' : '🚀 Tạo Hook Biến Thể'}
            </button>

            {/* Progress bar */}
            {isLoading && progress > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-pink-600 font-medium flex items-center gap-2">
                    <Loader2 className="animate-spin" size={14} /> {progressLabel}
                  </span>
                  <span className="font-bold text-pink-700">{progress}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-pink-500 via-orange-400 to-amber-400 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Phân tích</span>
                  <span>Biến thể</span>
                  <span>Visual & Voice</span>
                  <span>Hoàn thiện</span>
                </div>
                <button onClick={handleCancel}
                  className="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2">
                  <X size={16} /> Hủy Tạo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Results */}
        <div ref={modifyResultsRef} className="lg:col-span-8 bg-white rounded-2xl p-6 border border-gray-200 min-h-[500px] overflow-y-auto shadow-sm">
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wand2 className="text-indigo-500" size={20} /> Kết Quả ({generatedIdeas.length})</h3>
            <div className="flex items-center gap-2">
              {modifiedHooksSaveStatus !== 'idle' && (
                <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                  modifiedHooksSaveStatus === 'saved'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : modifiedHooksSaveStatus === 'saving'
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-red-200 bg-red-50 text-red-600'
                }`}>
                  {modifiedHooksSaveStatus === 'saved'
                    ? `Đã lưu History (${savedModifiedHookCount})`
                    : modifiedHooksSaveStatus === 'saving'
                      ? 'Đang lưu DB...'
                      : 'Lưu DB thất bại'}
                </span>
              )}
                {savedModifiedHookSessionId && availableModifyHistoryCount > 0 && (
                  <button
                    onClick={handleOpenModifyHistory}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                  >
                    {isViewingModifyHistory ? 'Ẩn History' : `Xem History (${availableModifyHistoryCount})`}
                  </button>
                )}
            </div>
          </div>

          {(generatedIdeas.length > 0 || modifiedHooksSaveStatus !== 'idle') && (
            <p className="mb-4 text-xs leading-relaxed text-gray-500">
              <span className="font-bold text-gray-700">Hook-only:</span> Modify Hook được lưu vào History (bảng generated_ideas). Có thể bật/tắt `Xem History` để đổi giữa output hiện tại và output cũ; nó không tự thêm vào Hook Library.
            </p>
          )}

          {loadingModifyHistory ? (
            <div className="text-center py-20">
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              </div>
              <p className="font-bold text-gray-500 mb-1">Đang tải Hook history</p>
              <p className="text-sm text-gray-400">Các biến thể đã tạo trước đó của hook này đang được đọc lại từ database.</p>
            </div>
          ) : generatedIdeas.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {generatedIdeas.map((idea, idx) => {
                const hookContent = buildIdeaSectionScript(idea.hook)
                  || idea.hook.textOverlay
                  || idea.hook.text
                  || idea.explanation
                  || '';
                const textOverlay = idea.hook.textOverlay || idea.hook.text;
                const hookDuration = estimateSectionDurationSeconds(idea.hook as unknown as Record<string, unknown>);
                return (
                <div key={idx} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-sm transition-all group">
                  <div className="p-4">
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className="text-[11px] px-2 py-1 bg-gray-50 border border-gray-200 rounded-md text-gray-600">Modified Hook</span>
                      <span className="text-[11px] px-2 py-1 bg-gray-50 border border-gray-200 rounded-md text-gray-600">English Copy</span>
                      {idea.savedIdeaId && (
                        <span className="text-[11px] px-2 py-1 bg-emerald-50 border border-emerald-100 rounded-md text-emerald-700">Đã lưu History</span>
                      )}
                    </div>
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm text-gray-800">{idea.title || `Biến thể ${idx + 1}`}</h4>
                      </div>
                      <button onClick={() => handleCopy(idea)} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"><Copy size={14} /></button>
                    </div>
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
                      <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Hook ({hookDuration}s)</span>
                      <p className="mt-1 text-sm text-gray-900 font-semibold leading-relaxed whitespace-pre-line">
                        {hookContent || 'Hook sẽ hiển thị tại đây.'}
                      </p>
                    </div>

                    {idea.hook.viTranslation && (
                      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Bản dịch</span>
                        <p className="mt-1 text-xs text-gray-700 leading-relaxed whitespace-pre-line">{idea.hook.viTranslation}</p>
                      </div>
                    )}

                    {textOverlay && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                        <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Text overlay</span>
                        <p className="mt-1 text-xs text-gray-900 font-semibold leading-relaxed">{textOverlay}</p>
                      </div>
                    )}

                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-50 rounded-2xl flex items-center justify-center">
                <Wand2 size={32} className="text-gray-300" />
              </div>
              <p className="font-bold text-gray-500 mb-1">Nhập ý tưởng và bấm tạo</p>
              <p className="text-sm text-gray-400">Các biến thể Hook mới sẽ hiển thị tại đây</p>
              {availableModifyHistoryCount > 0 && (
                <p className="mt-3 text-xs text-indigo-600 font-medium">
                  {`Hook này có ${availableModifyHistoryCount} history đã lưu. Bấm "Xem History (${availableModifyHistoryCount})" để xem lại hoặc ẩn đi.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
