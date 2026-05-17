'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Wand2, Loader2, Check, Target, Copy, ListOrdered, FileEdit, Filter, Users, Zap, Lightbulb, Layout, Settings2, Trash2, Pencil, ChevronRight, Save, Video, Globe, Sparkles, RotateCcw, Compass, AlertTriangle, Heart, Image, ExternalLink, ChevronDown, ChevronUp, TrendingUp, Link2, Hash } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, ScreenType, IdeaContent } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';
import { CATEGORY_SEEDS, GLOBAL_EMOTION_OPTIONS, GLOBAL_VISUAL_TYPES } from '@/lib/db';
import { buildIdeaFavoriteFingerprint, buildIdeaFavoriteKeys, hasFavoriteIdeaKey, loadFavoriteKeys, mergeFavoriteKeys, notifyFavoriteKeysChanged, saveFavoriteKeys } from '@/lib/favorites';
import { authenticatedFetch } from '@/lib/authFetch';
import { cleanupInvalidStrategyIdeas } from '@/lib/ideaCleanupClient';
import { isHookLibraryIdeaLike, isInvalidStrategyIdea } from '@/lib/ideaStructure';
import { formatHealthMetricConflictMessage, getHealthMetricConflict } from '@/lib/filterConsistency';
import { isPinnedHealthWebFunnelApp } from '@/lib/appDisplay';
import {
  buildStrategyCodeLookup,
  cleanStrategyValues,
  formatStrategyCodeForFilterGroups,
  formatStrategyValueGroup,
  getStrategyGroupCodeMapRows,
  type StrategyCodeFilterKey,
} from '@/lib/strategyCodes';

interface FilterGeneratorProps {
  app: AppProject;
  currentScreen: ScreenType;
  setScreen: (s: ScreenType) => void;
  selectedModel?: AIModel;
  prefillFilters?: Partial<FilterState> | null;
  onPrefillConsumed?: () => void;
  onAppKnowledgeUpdated?: (knowledge: string) => void;
}

interface CategoryConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  isCustom?: boolean;
}

interface ImportedTrendAnalysis {
  sourceUrl: string;
  sourceLabel?: string;
  resolvedVideoUrl?: string;
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
  filterHints?: {
    emotion?: string[];
    angle?: string[];
    visualType?: string[];
  };
  structureNotes: string[];
  suggestedTopics: string[];
  promptBooster: string;
  modelUsed?: string;
}

const IMPORTED_TREND_GENERIC_MARKERS = [
  'Imported video structure',
  'Imported from video URL',
  'Open with a strong, in-context visual hook.',
  'Escalate the problem, then reveal the workaround or solution.',
  'Close with a short payoff or CTA.',
  'Handheld, social-first visual treatment.',
  'Natural in-feed voice or sound design.',
  'Short, mobile-first text overlay.',
];
const UNSAVED_IDEA_BACKUP_PREFIX = 'idea-tool:unsaved-generated-ideas:';

type UnsavedIdeaBackup = {
  savedAt: number;
  ideas: GeneratedIdea[];
};

function getUnsavedIdeaBackupKey(appId: string) {
  return `${UNSAVED_IDEA_BACKUP_PREFIX}${appId}`;
}

function readUnsavedIdeaBackup(appId: string): UnsavedIdeaBackup | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getUnsavedIdeaBackupKey(appId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnsavedIdeaBackup> | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.ideas)) return null;
    return {
      savedAt: parsed.savedAt,
      ideas: parsed.ideas.filter((idea): idea is GeneratedIdea => (
        !!idea
        && typeof idea.id === 'string'
        && idea.id.startsWith('temp-')
        && typeof idea.app_id === 'string'
        && !!idea.content
      )),
    };
  } catch {
    return null;
  }
}

function writeUnsavedIdeaBackup(appId: string, ideas: GeneratedIdea[]) {
  if (typeof window === 'undefined') return;
  const unsavedIdeas = ideas.filter(idea => idea.app_id === appId && idea.id.startsWith('temp-'));

  try {
    if (unsavedIdeas.length === 0) {
      window.localStorage.removeItem(getUnsavedIdeaBackupKey(appId));
      return;
    }

    window.localStorage.setItem(
      getUnsavedIdeaBackupKey(appId),
      JSON.stringify({ savedAt: Date.now(), ideas: unsavedIdeas } satisfies UnsavedIdeaBackup)
    );
  } catch {
    // Ignore backup write failures; Supabase save remains the source of truth.
  }
}

function clearUnsavedIdeaBackup(appId: string) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getUnsavedIdeaBackupKey(appId));
  } catch {
    // Ignore cleanup failures.
  }
}

function normalizeCompareText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function shouldHidePspForApp(app: AppProject) {
  return isPinnedHealthWebFunnelApp(app);
}

function vietnamesePainpointCue(value: string) {
  const normalized = normalizeCompareText(value);
  if (/\b(?:chest|nguc|symptom|trieu chung|scare|panic|hoang)\b/.test(normalized)) {
    return 'lo lắng khi dấu hiệu ở ngực xuất hiện bất ngờ';
  }
  if (/\b(?:warning|sign|alert|understood|understand|canh bao|hieu)\b/.test(normalized)) {
    return 'không hiểu rõ các dấu hiệu cảnh báo sức khỏe tim';
  }
  if (/\b(?:pulse|heartbeat|heart rate|nhip tim|felt off|different)\b/.test(normalized)) {
    return 'nhịp tim thay đổi nhưng không biết ý nghĩa là gì';
  }
  if (/\b(?:night|late|search|learn|fact|knowledge|dem|tra cuu|kien thuc)\b/.test(normalized)) {
    return 'phải tra cứu kiến thức tim mạch trong lúc đang lo';
  }
  if (/\b(?:family|talk|question|answer|conversation|gia dinh|cau hoi)\b/.test(normalized)) {
    return 'không trả lời được những câu hỏi đơn giản về sức khỏe tim';
  }
  if (/\b(?:dizzy|dizziness|chong mat|regret|learning)\b/.test(normalized)) {
    return 'chóng mặt rồi mới nhận ra mình biết quá ít về sức khỏe tim';
  }
  if (/\b(?:blood|pressure|huyet ap)\b/.test(normalized)) {
    return 'muốn kiểm tra huyết áp nhưng cách cũ quá bất tiện';
  }
  if (/\b(?:bulky|device|monitor|old|traditional|messgerat|gerat|may do)\b/.test(normalized)) {
    return 'thiết bị theo dõi cũ cồng kềnh làm mỗi lần kiểm tra đều ngại';
  }
  return 'nỗi đau đã chọn vẫn chưa có cách xử lý rõ ràng';
}

function buildLocalizedFallbackAnglesFromPainpoints(painpoints: string[], outputLanguage: string) {
  if (outputLanguage === 'Vietnamese') {
    const seeds = painpoints.length > 0 ? painpoints : ['nỗi đau đã chọn'];
    return seeds.flatMap(pp => {
      const cue = vietnamesePainpointCue(pp);
      return [
        `Người xem ${cue} trong một khoảnh khắc đời thường`,
        `Tình huống ${cue} khiến cách cũ trở nên quá chậm`,
        `Góc nhìn ${cue} và cần một cách theo dõi rõ ràng hơn`,
      ];
    });
  }
  const seeds = painpoints.length > 0 ? painpoints : ['nỗi đau đã chọn'];

  if (outputLanguage === 'Vietnamese') {
    return seeds.flatMap(pp => [
      `${pp} nhưng người xem vẫn chưa biết bắt đầu xử lý từ đâu`,
      `${pp} và mỗi lần thử cách cũ lại càng mất thời gian hơn`,
      `${pp} khiến người xem cần một cách theo dõi rõ ràng hơn`,
    ]);
  }

  if (outputLanguage === 'Japanese') {
    return seeds.flatMap(pp => [
      `${pp}のせいで、大事な瞬間をまた逃しそう`,
      `${pp}が続いて、何から直せばいいかわからない`,
      `${pp}を後回しにしていたら、また困ることになった`,
    ]);
  }

  if (outputLanguage === 'Vietnamese') {
    return seeds.flatMap(pp => [
      `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
      `${pp} và mỗi lần thử lại càng rối hơn`,
      `${pp} dù đã xem nhiều cách khác nhau`,
    ]);
  }

  return seeds.flatMap(pp => [
    `I keep running into ${pp} at the worst time`,
    `${pp} is starting to cost me more than I expected`,
    `I thought I fixed ${pp}, but it came back again`,
  ]);
}

function hasGermanAngleCue(value: string) {
  const normalized = normalizeCompareText(value);
  return /\b(?:ich|mich|mir|mein|meine|beim|nach|warum|dachte|merkte|wollte|brauchte|nicht|ohne|aber|blutdruck|messen|messgeraet|gerat|wartezimmer|spaziergang|fruhstuck|reisen)\b/.test(normalized);
}

function hasSystemEnglishAngleCue(value: string) {
  const normalized = normalizeCompareText(value);
  return /\b(?:angle type|auto angle|required angle type|this angle must|must look visually different|choose one|operator angle request|app context)\b/.test(normalized);
}

function hasVietnameseAngleCue(value: string) {
  return /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(value)
    || /\b(?:toi|ban|nguoi|khong|nhung|van|can|muon|khi|luc|moi|cu|may|do|kiem|tra|theo|doi|nhip|tim|huyet|ap|suc|khoe|lo|lang|roi|ro|rang|tinh|huong|khoanh|khac|cuoc|song|du|da|chon|goc)\b/.test(normalizeCompareText(value));
}

function isInvalidGeneratedAngle(value: string) {
  return hasGermanAngleCue(value) || hasSystemEnglishAngleCue(value) || !hasVietnameseAngleCue(value);
}

function cleanAngleOptions(values: string[]) {
  return values
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => !isInvalidGeneratedAngle(value));
}

function sanitizeOptionValues(category: string, values: string[]) {
  if (category === 'visualType') return sanitizeVisualTypes(values);
  if (category === 'angle') return cleanAngleOptions(values);
  return values;
}

function isGenericImportedTrendAnalysis(analysis?: Partial<ImportedTrendAnalysis> | null) {
  if (!analysis) return true;

  const haystack = [
    analysis.title,
    analysis.summary,
    analysis.hookPattern,
    analysis.bodyPattern,
    analysis.ctaPattern,
    analysis.visualStyle,
    analysis.audioStyle,
    analysis.textOverlayStyle,
    analysis.promptBooster,
    ...(analysis.structureNotes || []),
  ].map(normalizeCompareText);
  const markerMatches = IMPORTED_TREND_GENERIC_MARKERS
    .map(normalizeCompareText)
    .filter(marker => haystack.some(value => value === marker || value.includes(marker))).length;
  const keyMoments = analysis.keyMoments || [];
  const hasSpecificMoments = keyMoments.length >= 2 && keyMoments.some(moment => normalizeCompareText(moment).length > 18);

  return markerMatches >= 4 || (markerMatches >= 2 && !hasSpecificMoments);
}

function getGeneratedIdeaDedupKey(item: GeneratedIdeaApiItem) {
  const parts = [
    item.title,
    item.meta?.hookPrimary,
    item.hook?.textOverlay,
    item.hook?.text_overlay,
    item.hook?.voice,
    item.hook?.visual,
    item.body?.textOverlay,
    item.body?.text_overlay,
  ];
  return normalizeCompareText(parts.filter(Boolean).join(' | ')).slice(0, 220);
}

function getGeneratedIdeaTitleCue(item: GeneratedIdeaApiItem, index: number) {
  const source = normalizeCompareText([
    item.meta?.referencePattern,
    item.meta?.firstFrameAsset,
    item.meta?.proofObject,
    item.hook?.visual,
    item.hook?.script,
    item.body?.visual,
    item.body?.script,
  ].filter(Boolean).join(' '));

  if (/\b(?:podcast|bac si|doctor|patient|benh nhan)\b/.test(source)) return 'Podcast bác sĩ';
  if (/\b(?:waiting|clinic|phong cho|phong kham)\b/.test(source)) return 'Phòng chờ khám';
  if (/\b(?:kitchen|breakfast|morning|bep|buoi sang)\b/.test(source)) return 'Bếp buổi sáng';
  if (/\b(?:living room|sofa|salon|phong khach)\b/.test(source)) return 'Phòng khách';
  if (/\b(?:bed|bedroom|night|phong ngu|canh giuong|ban dem)\b/.test(source)) return 'Cạnh giường';
  if (/\b(?:door|entrance|leave|leaving|ra ngoai|truoc khi ra)\b/.test(source)) return 'Trước khi ra ngoài';
  if (/\b(?:stairs|stair|cau thang)\b/.test(source)) return 'Sau cầu thang';
  if (/\b(?:iphone|screen|camera|app|man hinh)\b/.test(source)) return 'Màn hình iPhone';
  return `Cảnh ${index + 1}`;
}

function getUniqueGeneratedIdeaTitle(
  item: GeneratedIdeaApiItem,
  index: number,
  seenTitles: Map<string, number>
) {
  const rawTitle = (item.title || 'Ten kich ban').trim();
  const key = normalizeCompareText(rawTitle);
  const nextCount = (seenTitles.get(key) || 0) + 1;
  seenTitles.set(key, nextCount);

  if (nextCount === 1) return rawTitle;
  const cue = getGeneratedIdeaTitleCue(item, index);
  const cueKey = normalizeCompareText(cue);
  return cueKey && !key.includes(cueKey)
    ? `${rawTitle} - ${cue}`
    : `${rawTitle} - Biến thể ${nextCount}`;
}

function getIdeaBuilderVersion(item: GeneratedIdeaApiItem | GeneratedIdea) {
  return 'content' in item
    ? item.content?.meta?.builderVersion
    : item.meta?.builderVersion;
}

function isLocalFallbackIdea(item: GeneratedIdeaApiItem | GeneratedIdea) {
  const version = normalizeCompareText(getIdeaBuilderVersion(item));
  return version.includes('fallback') || version.includes('local backup') || version.includes('template');
}

function isVisibleStrategyIdea(idea: GeneratedIdea) {
  return !isLocalFallbackIdea(idea) && !isInvalidStrategyIdea(idea);
}

function isVisibleStrategyMapIdea(idea: GeneratedIdea) {
  return isVisibleStrategyIdea(idea) && !isHookLibraryIdeaLike(idea);
}

const IDEA_RUNTIME_GUIDANCE = 'Short social-first runtime';

const STRATEGY_CODE_OPTION_KEYS: Record<StrategyCodeFilterKey, keyof FilterState> = {
  coreUser: 'coreUser',
  solution: 'solution',
  emotion: 'emotion',
  visualType: 'visualType',
  painPoint: 'painPoint',
  angle: 'angle',
};

const STRATEGY_CODE_FALLBACK_SOURCE: Record<StrategyCodeFilterKey, string[]> = {
  coreUser: ['User 35+ US', 'Caregiver 45+', 'Busy parent'],
  solution: ['Blood Pressure Tracker', 'Track BP by camera', 'Family alerts'],
  emotion: GLOBAL_EMOTION_OPTIONS,
  visualType: ['UGC at home', 'Doctor demo', 'Morning routine'],
  painPoint: [
    'Co tien su BP cao nhung khong co may o nha',
    'Khong biet so do khi chong mat',
    'Quen do buoi sang',
  ],
  angle: ['Tu thuoc trong', 'Vo hoi may do dau?', 'Chi can mo app'],
};

type StrategyCodeWorkflowLevel = 'root' | 'coreUser' | 'psp' | 'emotion' | 'visual' | 'painPoint' | 'angle';

type StrategyCodeTreeNode = {
  id: string;
  label: string;
  level: StrategyCodeWorkflowLevel;
  children: StrategyCodeTreeNode[];
  ideas: GeneratedIdea[];
};

const STRATEGY_CODE_LEVEL_ORDER: StrategyCodeWorkflowLevel[] = ['root', 'coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'];

const STRATEGY_CODE_LEVEL_TO_PREFIX: Partial<Record<StrategyCodeWorkflowLevel, string>> = {
  coreUser: 'A',
  psp: 'B',
  emotion: 'C',
  visual: 'D',
  painPoint: 'E',
  angle: 'F',
};

type IdeaApiSection = {
  durationSeconds?: number;
  duration_seconds?: number | string;
  hookDurationSeconds?: number;
  hook_duration_seconds?: number | string;
  script?: string;
  visual?: string;
  characterSpeech?: string;
  character_speech?: string;
  talentSpeech?: string;
  talent_speech?: string;
  voiceover?: string;
  voiceOver?: string;
  voice_over?: string;
  voice?: string;
  text?: string;
  textOverlay?: string;
  text_overlay?: string;
  textOverlayViTranslation?: string;
  text_overlay_vi_translation?: string;
  textViTranslation?: string;
  text_vi_translation?: string;
  viTranslation?: string;
  vi_translation?: string;
  hookVoiceVi?: string;
  hook_voice_vi?: string;
  vietnameseTranslation?: string;
  vietnamese_translation?: string;
  endCard?: string;
  end_card?: string;
};

type GeneratedIdeaApiItem = {
  title?: string;
  duration?: string;
  creativeType?: string;
  meta?: IdeaContent['meta'];
  framework?: IdeaContent['framework'];
  explanation?: string;
  hook?: IdeaApiSection;
  body?: IdeaApiSection;
  cta?: IdeaApiSection;
};

type GenerateIdeasApiResponse = {
  success?: boolean;
  data?: GeneratedIdeaApiItem[];
  error?: string;
  meta?: {
    warnings?: string[];
    fallbackCount?: number;
  };
};

type SaveIdeasApiResponse = {
  success?: boolean;
  data?: GeneratedIdea[];
  count?: number;
  sessionId?: string;
  error?: string;
};

type IdeaSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function cleanStrategyAngleDisplayText(value: unknown) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStrategyAngleInstructionText(value: unknown) {
  let text = cleanStrategyAngleDisplayText(value)
    .replace(/^\s*F\d+\s*=\s*Angle:\s*/i, '')
    .replace(/^ANGLE\s+TYPE\s+([^:]+):\s*/i, '$1: ')
    .replace(/^GÃ³c\s+(\d+\/\d+)\s*-\s*angle_type\s+báº¯t buá»™c:\s*([^.]+)\.\s*/i, '$2: ')
    .replace(/^GÃ³c\s+([^:]+):\s*/i, '$1: ');

  text = text
    .replace(/\s*Pháº£i khÃ¡c rÃµ cÃ¡c gÃ³c cÃ²n láº¡i.*$/i, '')
    .replace(/\s*This angle must look visually different.*$/i, '')
    .replace(/\s*YÃªu cáº§u thÃªm:.*$/i, '')
    .replace(/\s*App:\s*.*$/i, '')
    .replace(/\s*Chá»n má»™t gÃ³c [^.]+\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function getStrategyAngleTypeFromText(...values: unknown[]) {
  const allowed = ['Comparison', 'Demo', 'Tutorial', 'Fact', 'POV', 'Social', 'Curiosity', 'Relief', 'Challenge', 'Trend', 'Fear'];
  const haystack = values.map(value => cleanStrategyAngleDisplayText(value)).join(' ');
  const normalizedHaystack = normalizeCompareText(haystack);
  return allowed.find(type => normalizedHaystack.includes(normalizeCompareText(type))) || '';
}

function isInstructionalStrategyAngleLabel(value: unknown) {
  const normalized = normalizeCompareText(value);
  return /\bangle type bat buoc\b/.test(normalized)
    || /\bthis angle must look visually different\b/.test(normalized)
    || /\bphai khac ro\b/.test(normalized)
    || /\bye?u cau them\b/.test(normalized)
    || /\bchon mot goc\b/.test(normalized)
    || /\bapp phone cleaner\b/.test(normalized);
}

function isGenericStrategyAngleLabel(value: unknown) {
  const normalized = normalizeCompareText(value);
  return !normalized
    || /^(?:comparison|demo|tutorial|fact|pov|social|curiosity|relief|challenge|trend|fear)$/.test(normalized)
    || /^goc \d+ \d+/.test(normalized);
}

function shortenStrategyAngleLabel(value: string, maxLength = 72) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function getStrategyCodeAngleLabel(
  source: GeneratedIdea | GeneratedIdeaApiItem,
  rawAngle: string,
  filters: Partial<FilterState>
) {
  const content = 'content' in source ? source.content : source;
  const meta = content?.meta || {};
  const metaName = stripStrategyAngleInstructionText(meta.angleName);
  const rawLabel = stripStrategyAngleInstructionText(rawAngle);
  const type = getStrategyAngleTypeFromText(meta.angleType, metaName, rawAngle);

  if (rawLabel && !isInstructionalStrategyAngleLabel(rawLabel) && !isGenericStrategyAngleLabel(rawLabel)) {
    return shortenStrategyAngleLabel(rawLabel);
  }

  if (metaName && !isInstructionalStrategyAngleLabel(metaName) && !isGenericStrategyAngleLabel(metaName)) {
    return shortenStrategyAngleLabel(type && !normalizeCompareText(metaName).includes(normalizeCompareText(type))
      ? `${type}: ${metaName}`
      : metaName);
  }

  const painPoint = cleanStrategyAngleDisplayText(filters.painPoint?.[0]);
  if (type && painPoint) return shortenStrategyAngleLabel(`${type}: ${painPoint}`);
  if (painPoint) return shortenStrategyAngleLabel(`Angle: ${painPoint}`);
  return type ? `${type} angle` : 'Angle';
}

function mergeStrategyCodeLabels(...groups: Array<Array<string | null | undefined> | undefined>) {
  return Array.from(new Set(groups
    .flatMap(group => group || [])
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)));
}

function normalizeStrategyCodeKeyPart(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function getStrategyCodeLabelKey(level: StrategyCodeWorkflowLevel, value: string) {
  const normalizedSearch = normalizeCompareText(value);
  if (level === 'visual') {
    if (/\b(?:3d|3 d|three d|cgi|render)\b/.test(normalizedSearch)) return 'visual:3d-animation';
    if (/\b(?:2d|2 d|two d|cartoon|vector|hoat hinh|minh hoa)\b/.test(normalizedSearch)) return 'visual:2d-animation';
    if (/\b(?:motion graphic|motion|kinetic typography|animated ui|infographic|data visual)\b/.test(normalizedSearch)) return 'visual:motion-graphic';
    if (/\bugc\b/.test(normalizedSearch)) return 'visual:ugc';
    if (/\bpov\b/.test(normalizedSearch)) return 'visual:pov';
  }
  return normalizeStrategyCodeKeyPart(value);
}

function normalizeStrategyCodeFilterSnapshot(raw: Partial<FilterState> | null | undefined): Partial<FilterState> {
  const out: Partial<FilterState> = {};
  if (!raw || typeof raw !== 'object') return out;

  Object.entries(raw).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    const clean = value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    if (clean.length > 0) {
      (out as Record<string, string[]>)[key] = clean;
    }
  });

  return out;
}

function getStrategyCodeStoredOptions(options: Record<string, string[]>) {
  return {
    root: [],
    coreUser: options.coreUser || [],
    psp: options.solution || [],
    emotion: options.emotion || [],
    visual: options.visualType || [],
    painPoint: options.painPoint || [],
    angle: options.angle || [],
  } satisfies Record<StrategyCodeWorkflowLevel, string[]>;
}

function buildStrategyCodeOptionValues(
  options: Record<string, string[]>,
  strategyMapHistory: GeneratedIdea[]
) {
  const values: Record<StrategyCodeWorkflowLevel, Set<string>> = {
    root: new Set<string>(),
    coreUser: new Set<string>(),
    psp: new Set<string>(),
    emotion: new Set<string>(),
    visual: new Set<string>(),
    painPoint: new Set<string>(),
    angle: new Set<string>(),
  };

  strategyMapHistory.forEach(idea => {
    const filters = normalizeStrategyCodeFilterSnapshot(idea.filters_snapshot);
    (filters.coreUser || []).forEach(value => values.coreUser.add(value));
    (filters.solution || []).forEach(value => values.psp.add(value));
    (filters.emotion || []).forEach(value => values.emotion.add(value));
    (filters.visualType || []).forEach(value => values.visual.add(value));
    (filters.painPoint || []).forEach(value => values.painPoint.add(value));
    (filters.angle || []).forEach(value => values.angle.add(value));
  });

  const stored = getStrategyCodeStoredOptions(options);
  return Object.fromEntries(STRATEGY_CODE_LEVEL_ORDER.map(level => {
    const fallback = level === 'psp'
      ? STRATEGY_CODE_FALLBACK_SOURCE.solution
      : level === 'visual'
        ? STRATEGY_CODE_FALLBACK_SOURCE.visualType
        : level === 'root'
          ? []
          : STRATEGY_CODE_FALLBACK_SOURCE[level as StrategyCodeFilterKey] || [];
    return [level, mergeStrategyCodeLabels(stored[level], Array.from(values[level]), fallback)];
  })) as Record<StrategyCodeWorkflowLevel, string[]>;
}

function buildStrategyCodeTree(appName: string, ideas: GeneratedIdea[]) {
  const root: StrategyCodeTreeNode = { id: 'root', label: appName, level: 'root', children: [], ideas: [] };
  const mkNode = (id: string, label: string, level: StrategyCodeWorkflowLevel): StrategyCodeTreeNode => ({
    id,
    label,
    level,
    children: [],
    ideas: [],
  });

  ideas.forEach(idea => {
    const filters = normalizeStrategyCodeFilterSnapshot(idea.filters_snapshot);
    const baseLevels: Array<{ label: string; level: StrategyCodeWorkflowLevel; key: string }> = [];
    const pushLevel = (level: StrategyCodeWorkflowLevel, values: string[] | undefined) => {
      if (!values?.length) return;
      baseLevels.push({ label: values.join(', '), level, key: values.join(',') });
    };

    pushLevel('coreUser', filters.coreUser);
    pushLevel('psp', filters.solution);
    pushLevel('emotion', filters.emotion);
    pushLevel('visual', filters.visualType);
    pushLevel('painPoint', filters.painPoint);

    let parent = root;
    let pathKey = '';
    baseLevels.forEach(levelInfo => {
      pathKey += `|${levelInfo.key}`;
      const nodeId = `${levelInfo.level}:${pathKey}`;
      let node = parent.children.find(child => child.id === nodeId);
      if (!node) {
        node = mkNode(nodeId, levelInfo.label, levelInfo.level);
        parent.children.push(node);
      }
      parent = node;
    });

    (filters.angle || []).forEach(angle => {
      const angleLabel = getStrategyCodeAngleLabel(idea, angle, filters);
      const anglePath = `${pathKey}|${normalizeStrategyCodeKeyPart(angleLabel || angle)}`;
      const nodeId = `angle:${anglePath}`;
      let angleNode = parent.children.find(child => child.id === nodeId);
      if (!angleNode) {
        angleNode = mkNode(nodeId, angleLabel, 'angle');
        parent.children.push(angleNode);
      }
      angleNode.ideas.push(idea);
    });
  });

  return root;
}

function flattenStrategyCodeTree(root: StrategyCodeTreeNode) {
  const registry = new Map<string, StrategyCodeTreeNode>();
  const parentById = new Map<string, string>();
  const flatNodes: StrategyCodeTreeNode[] = [];

  const walk = (node: StrategyCodeTreeNode, parentId = '') => {
    registry.set(node.id, node);
    flatNodes.push(node);
    if (parentId) parentById.set(node.id, parentId);
    node.children.forEach(child => walk(child, node.id));
  };
  walk(root);

  return { registry, parentById, flatNodes };
}

function buildStrategyCodeContext(
  optionValuesByLevel: Record<StrategyCodeWorkflowLevel, string[]>,
  flatNodes: StrategyCodeTreeNode[],
  parentById: Map<string, string>
) {
  const ownCodeById = new Map<string, string>();
  const pathCodeById = new Map<string, string>();
  const codeByLevelAndLabel = new Map<StrategyCodeWorkflowLevel, Map<string, string>>();
  const indexedNodes = flatNodes.map((node, index) => ({ node, index }));

  const registerLabelCode = (level: StrategyCodeWorkflowLevel, label: string) => {
    if (level === 'root') return;
    const prefix = STRATEGY_CODE_LEVEL_TO_PREFIX[level];
    if (!prefix) return;
    const key = getStrategyCodeLabelKey(level, label);
    if (!key) return;
    let levelMap = codeByLevelAndLabel.get(level);
    if (!levelMap) {
      levelMap = new Map<string, string>();
      codeByLevelAndLabel.set(level, levelMap);
    }
    if (!levelMap.has(key)) levelMap.set(key, `${prefix}${levelMap.size + 1}`);
  };

  STRATEGY_CODE_LEVEL_ORDER.forEach(level => {
    if (level === 'root') return;
    (optionValuesByLevel[level] || []).forEach(label => registerLabelCode(level, label));
  });

  indexedNodes
    .filter(({ node }) => node.level !== 'root')
    .sort((a, b) => {
      const levelDiff = STRATEGY_CODE_LEVEL_ORDER.indexOf(a.node.level) - STRATEGY_CODE_LEVEL_ORDER.indexOf(b.node.level);
      return levelDiff || a.index - b.index;
    })
    .forEach(({ node }) => registerLabelCode(node.level, node.label));

  flatNodes.forEach(node => {
    if (node.level === 'root') return;
    const key = getStrategyCodeLabelKey(node.level, node.label);
    const code = codeByLevelAndLabel.get(node.level)?.get(key);
    if (code) ownCodeById.set(node.id, code);
  });

  const resolve = (nodeId: string): string => {
    if (pathCodeById.has(nodeId)) return pathCodeById.get(nodeId) || '';
    if (nodeId === 'root') return '';
    const parentId = parentById.get(nodeId) || '';
    const code = `${parentId ? resolve(parentId) : ''}${ownCodeById.get(nodeId) || ''}`;
    pathCodeById.set(nodeId, code);
    return code;
  };

  flatNodes.forEach(node => resolve(node.id));
  return { pathCodeById };
}

function buildStrategyMapCodeByIdeaId(
  appName: string,
  options: Record<string, string[]>,
  strategyMapHistory: GeneratedIdea[],
  favoriteIdeas: GeneratedIdea[]
) {
  const optionValuesByLevel = buildStrategyCodeOptionValues(options, strategyMapHistory);
  const root = buildStrategyCodeTree(appName, favoriteIdeas);
  const { flatNodes, parentById } = flattenStrategyCodeTree(root);
  const { pathCodeById } = buildStrategyCodeContext(optionValuesByLevel, flatNodes, parentById);
  const codeByIdeaId = new Map<string, string>();

  flatNodes.forEach(node => {
    const code = pathCodeById.get(node.id) || '';
    if (!code) return;
    node.ideas.forEach(idea => {
      if (idea.id && !codeByIdeaId.has(idea.id)) codeByIdeaId.set(idea.id, code);
    });
  });

  return codeByIdeaId;
}

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  { id: 'coreUser', label: 'Đối tượng', icon: Users },
  { id: 'painPoint', label: 'Nỗi đau', icon: Zap },
  { id: 'solution', label: 'Tính năng / Giải pháp', icon: Lightbulb },
  { id: 'emotion', label: 'Cảm xúc (Viewer)', icon: Target },
  { id: 'visualType', label: 'Dạng Visual', icon: Video },
  { id: 'targetMarket', label: 'Thị trường mục tiêu', icon: Globe },
];

type CoreUserDimension = {
  id: string;
  label: string;
  placeholder: string;
  examples: string;
};

const CORE_USER_DIMENSIONS: CoreUserDimension[] = [
  {
    id: 'market',
    label: 'Quốc gia / Market',
    placeholder: 'VD: US, VN, AU, UK...',
    examples: 'US · VN · AU · UK',
  },
  {
    id: 'age',
    label: 'Độ tuổi',
    placeholder: 'VD: 55+, 25-45 Global...',
    examples: '55+',
  },
  {
    id: 'gender',
    label: 'Giới tính',
    placeholder: 'VD: Nữ, Nam, Gender-neutral...',
    examples: 'Nữ / Nam / Gender-neutral',
  },
  {
    id: 'language',
    label: 'Ngôn ngữ',
    placeholder: 'VD: English, Tiếng Việt...',
    examples: 'Tiếng Việt / English',
  },
];

const CORE_USER_DIMENSION_PREFIX = 'Core User';
const coreUserDimensionValue = (dimension: CoreUserDimension, value: string) =>
  `${CORE_USER_DIMENSION_PREFIX} - ${dimension.label}: ${value.trim()}`;

function getCoreUserDimension(item: string): string {
  const normalized = item.toLowerCase();
  const prefixed = CORE_USER_DIMENSIONS.find(dimension =>
    normalized.startsWith(`${CORE_USER_DIMENSION_PREFIX.toLowerCase()} - ${dimension.label.toLowerCase()}:`)
  );
  if (prefixed) return prefixed.id;
  if (/\b(?:55\+|35\+|25|45|tuổi|age|user\s*\d)/i.test(item)) return 'age';
  if (/\b(?:nữ|nam|female|male|gender|woman|women|man|men)\b/i.test(item)) return 'gender';
  if (/\b(?:english|tiếng|vietnamese|spanish|language|script|hook|cta)\b/i.test(item)) return 'language';
  return 'market';
}

function getCoreUserDisplayValue(item: string): string {
  const marker = ': ';
  return item.startsWith(`${CORE_USER_DIMENSION_PREFIX} - `) && item.includes(marker)
    ? item.slice(item.indexOf(marker) + marker.length)
    : item;
}

function isRecognizedCoreUserLanguageItem(item: string): boolean {
  if (getCoreUserDimension(item) !== 'language') return true;
  const value = normalizeCompareText(getCoreUserDisplayValue(item));
  return /\b(?:english|en|spanish|es|vietnamese|vi|viet nam|japanese|jp|korean|ko|german|de|french|fr|portuguese|pt|thai|indonesian|malay|italian|it|dutch|nl|polish|pl|turkish|tr|arabic|ar|hindi|hi|swedish|sv|norwegian|no|danish|da|tieng anh|tieng tay ban nha|tieng viet|tieng nhat|tieng han|tieng duc|tieng phap|tieng bo dao nha)\b/.test(value);
}

type AngleTypeLabel = 'Fact' | 'POV' | 'Comparison' | 'Demo' | 'Trend' | 'Social' | 'Curiosity' | 'Relief' | 'Tutorial' | 'Challenge' | 'Fear';

function normalizeAngleTypeLabel(value: string): AngleTypeLabel | null {
  const normalized = normalizeCompareText(value);
  if (/\bfact\b/.test(normalized)) return 'Fact';
  if (/\bpov\b/.test(normalized)) return 'POV';
  if (/\bcomparison\b|\bcompare\b|so sanh/.test(normalized)) return 'Comparison';
  if (/\bdemo\b|trinh dien/.test(normalized)) return 'Demo';
  if (/\btrend\b|viral/.test(normalized)) return 'Trend';
  if (/\bsocial\b|proof\b/.test(normalized)) return 'Social';
  if (/\bcuriosity\b|to mo/.test(normalized)) return 'Curiosity';
  if (/\brelief\b|an tam|nhe nhom/.test(normalized)) return 'Relief';
  if (/\btutorial\b|huong dan/.test(normalized)) return 'Tutorial';
  if (/\bchallenge\b|thu thach/.test(normalized)) return 'Challenge';
  if (/\bfear\b|shock\b|so hai/.test(normalized)) return 'Fear';
  return null;
}

function getAppCategoryKind(app: AppProject): 'health' | 'utility' | 'ai' | 'other' {
  const normalized = normalizeCompareText(`${app.category} ${app.name}`);
  if (/\bhealth\b|\bfitness\b|\btim\b|\bheart\b|\bblood\b|\bsuc khoe\b/.test(normalized)) return 'health';
  if (/\butility\b|\bcleaner\b|\bstorage\b|\bphone\b|\btool\b|\bclean\b/.test(normalized)) return 'utility';
  if (/\bai\b|\bphoto editor\b|\bavatar\b|\binterior\b|\bdesign\b|\bdecor\b|\broom\b|\bnha\b|\bphong\b/.test(normalized)) return 'ai';
  return 'other';
}

function getDefaultAngleTypePlan(app: AppProject, count: number): AngleTypeLabel[] {
  const kind = getAppCategoryKind(app);
  const base: AngleTypeLabel[] =
    kind === 'health' ? ['Fact', 'POV', 'Social', 'Curiosity', 'Relief'] :
    kind === 'utility' ? ['Comparison', 'Demo', 'Tutorial', 'Fact', 'POV'] :
    kind === 'ai' ? ['Trend', 'Demo', 'Challenge', 'Social', 'POV'] :
    ['Fact', 'POV', 'Comparison', 'Demo', 'Trend'];

  return Array.from({ length: count }, (_, index) => base[index % base.length]);
}

function parseAngleTypeLocks(angleRequest = '', count: number): Map<number, AngleTypeLabel> {
  const locks = new Map<number, AngleTypeLabel>();
  const normalized = normalizeCompareText(angleRequest);
  const pattern = /angle\s*(\d+)\D{0,32}(fact|pov|comparison|compare|demo|trend|social|curiosity|relief|tutorial|challenge|fear|shock)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized)) !== null) {
    const index = Number(match[1]) - 1;
    const type = normalizeAngleTypeLabel(match[2]);
    if (Number.isInteger(index) && index >= 0 && index < count && type) {
      locks.set(index, type);
    }
  }

  if (locks.size === 0 && /\b(?:bat buoc|required|force)\b/.test(normalized)) {
    const directType = normalizeAngleTypeLabel(normalized);
    if (directType) locks.set(0, directType);
  }

  return locks;
}

function buildStrategicAutoAngles(brief: CompactCreativeBrief | null, app: AppProject, fallbackAngles: string[], autoAngleCount: number): string[] {
  if (fallbackAngles.length > 0) {
    const defaultPlan = getDefaultAngleTypePlan(app, fallbackAngles.length);
    const hasRequiredType = fallbackAngles.some(angle => normalizeAngleTypeLabel(angle) === defaultPlan[0]);
    return fallbackAngles.map((angle, index) => {
      const detectedType = normalizeAngleTypeLabel(angle);
      const requiredType = detectedType || (!hasRequiredType && index === 0 ? defaultPlan[0] : defaultPlan[index]);
      return `Góc ${requiredType}: ${angle}. Phải khác rõ các góc còn lại về tình huống mở đầu và hành động đầu tiên.`;
    });
  }

  const requestedCount = Math.min(5, Math.max(1, brief?.requestedAngleCount || autoAngleCount || 0));
  if (requestedCount <= 0) return [];

  const defaultPlan = getDefaultAngleTypePlan(app, requestedCount);
  const locks = parseAngleTypeLocks(brief?.angleRequest || '', requestedCount);
  const used = new Set<AngleTypeLabel>();

  return Array.from({ length: requestedCount }, (_, index) => {
    const lockedType = locks.get(index);
    const plannedType = lockedType || defaultPlan.find(type => !used.has(type)) || defaultPlan[index % defaultPlan.length];
    used.add(plannedType);
    return `Góc ${index + 1}/${requestedCount} - angle_type bắt buộc: ${plannedType}. ` +
      `Chọn một góc ${plannedType} bám sát painpoint, không lặp với các góc khác. ` +
      `Yêu cầu thêm: ${brief?.angleRequest || 'AI chọn góc khác biệt mạnh nhất'}. App: ${app.name} / ${app.category}.`;
  });
}

function normalizeVisualTypeValue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('motion') || normalized.includes('graphic') || normalized.includes('data visual')) return 'Motion Graphic';
  if (normalized.includes('2d')) return '2D Animation';
  if (normalized.includes('3d')) return '3D Animation';
  if (normalized.includes('pov') || normalized.includes('screen recording') || normalized.includes('demo app')) return 'POV';
  if (normalized.includes('ugc') || normalized.includes('người thật') || normalized.includes('nguoi that')) return 'UGC';
  return GLOBAL_VISUAL_TYPES.includes(value) ? value : null;
}

function sanitizeVisualTypes(items: string[]) {
  const mapped = items.map(normalizeVisualTypeValue).filter((item): item is string => Boolean(item));
  return mapped.length ? [...new Set(mapped)] : [];
}

function mergeStrategySourceValues(...sources: unknown[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  sources.forEach(source => {
    const items = Array.isArray(source) ? source : [source];
    items.forEach(item => {
      const value = String(item || '').trim();
      const normalized = normalizeCompareText(value);
      if (!value || !normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(value);
    });
  });

  return values;
}

function getStrategySourceGroup(filters: Partial<FilterState>, key: StrategyCodeFilterKey) {
  const values = key === 'visualType'
    ? sanitizeVisualTypes(filters.visualType || [])
    : key === 'angle'
      ? cleanAngleOptions(filters.angle || [])
      : filters[key] || [];

  return formatStrategyValueGroup(values);
}

function buildStableStrategyCodeSource(
  optionValues: Record<string, string[]>,
  currentFilters: FilterState,
  angleValues: string[],
  historyFilters: Partial<FilterState>[]
) {
  const historyGroupsFor = (key: StrategyCodeFilterKey) =>
    historyFilters.map(filters => getStrategySourceGroup(filters, key)).filter(Boolean);

  const currentGroupFor = (key: StrategyCodeFilterKey) => getStrategySourceGroup(currentFilters, key);

  return {
    coreUser: mergeStrategySourceValues(
      optionValues.coreUser || [],
      historyGroupsFor('coreUser'),
      currentGroupFor('coreUser')
    ),
    solution: mergeStrategySourceValues(
      optionValues.solution || [],
      historyGroupsFor('solution'),
      currentGroupFor('solution')
    ),
    emotion: mergeStrategySourceValues(
      optionValues.emotion || [],
      historyGroupsFor('emotion'),
      currentGroupFor('emotion')
    ),
    visualType: mergeStrategySourceValues(
      GLOBAL_VISUAL_TYPES,
      sanitizeVisualTypes(optionValues.visualType || []),
      historyGroupsFor('visualType'),
      currentGroupFor('visualType')
    ),
    painPoint: mergeStrategySourceValues(
      optionValues.painPoint || [],
      historyGroupsFor('painPoint'),
      currentGroupFor('painPoint')
    ),
    angle: mergeStrategySourceValues(
      optionValues.angle || [],
      historyGroupsFor('angle'),
      angleValues,
      currentGroupFor('angle')
    ),
  } satisfies Partial<Record<StrategyCodeFilterKey, string[]>>;
}

type CompactCreativeBrief = {
  coreUser?: string;
  painPoint?: string;
  solution?: string;
  emotion?: string;
  visualType?: string;
  trend?: string;
  angleRequest?: string;
  market?: string;
  requestedAngleCount?: number;
  ideasPerAngle?: number;
};

type GenerationMode = 'quick' | 'builder';

const COMPACT_BRIEF_LABELS = [
  'Core User',
  'User',
  'Pain points?',
  'Painpoint',
  'Pain point',
  'Pain',
  'PSP',
  'Product Selling Point',
  'Solution',
  'Feature',
  'Emotion Trigger',
  'Emotion',
  'Visual Type',
  'Visual',
  'Trend',
  'Reference',
  'Angles?',
  'Market',
  'Thị trường',
  'Thi truong',
  'Output',
  'Quantity',
  'So luong',
  'Hãy tạo',
  'Hay tao',
  'Tao',
  'Create',
];

function extractCompactBriefSection(text: string, labelPattern: string): string {
  const stopLabels = COMPACT_BRIEF_LABELS.join('|');
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopLabels})\\s*[:：]?|$)`, 'i'));
  return match?.[1]?.trim() || '';
}

function parseCompactCreativeBrief(text: string): CompactCreativeBrief | null {
  const raw = text.trim();
  if (!raw) return null;
  const normalized = normalizeCompareText(raw);
  const looksLikeBrief = /\bcore user\b/.test(normalized)
    || /\bpsp\b/.test(normalized)
    || /\bproduct selling point\b/.test(normalized)
    || /\bsolution\b/.test(normalized)
    || /\bfeature\b/.test(normalized)
    || /\bpain points?\b/.test(normalized)
    || /\bemotion trigger\b/.test(normalized)
    || /\bvisual(?: type)?\b/.test(normalized)
    || /\btrend\b/.test(normalized)
    || /\btao\s+\d+\s+ideas?\b/.test(normalized)
    || /\bcreate\s+\d+\s+ideas?\b/.test(normalized)
    || /\bangles?\b/.test(normalized);
  if (!looksLikeBrief) return null;

  const coreUser = extractCompactBriefSection(raw, 'Core User|User');
  const painPoint = extractCompactBriefSection(raw, 'Pain points?|Painpoint|Pain point|Pain');
  const solution = extractCompactBriefSection(raw, 'PSP|Product Selling Point|Solution|Feature');
  const emotion = extractCompactBriefSection(raw, 'Emotion Trigger|Emotion');
  const visualType = extractCompactBriefSection(raw, 'Visual Type|Visual');
  const trend = extractCompactBriefSection(raw, 'Trend|Reference');
  const angleRequest = extractCompactBriefSection(raw, 'Angles?') || trend;
  const market = extractCompactBriefSection(raw, 'Market|Thị trường|Thi truong')
    || raw.match(/(?:Thị trường|Thi truong|Market)\s+([^\n.]+)/i)?.[1]?.trim()
    || '';
  const requestedAngleCount = Number(
    angleRequest.match(/(\d+)\s*angles?/i)?.[1]
      || raw.match(/(\d+)\s*angles?/i)?.[1]
      || normalized.match(/(\d+)\s*angles?/i)?.[1]
      || 0
  ) || undefined;
  const ideasPerAngle = Number(
    raw.match(/(\d+)\s*ideas?\s*(?:cho|per|mỗi|moi)?\s*(?:mỗi|moi|per)?\s*angles?/i)?.[1]
      || normalized.match(/(\d+)\s*ideas?\s*(?:cho|per|moi)?\s*(?:moi|per)?\s*angles?/i)?.[1]
      || normalized.match(/(?:tao|hay tao|create)\s*(\d+)\s*ideas?/i)?.[1]
      || raw.match(/(\d+)\s*ideas?/i)?.[1]
      || normalized.match(/(\d+)\s*ideas?/i)?.[1]
      || 0
  ) || undefined;

  return {
    coreUser: coreUser || undefined,
    painPoint: painPoint || undefined,
    solution: solution || undefined,
    emotion: emotion || undefined,
    visualType: visualType || undefined,
    trend: trend || undefined,
    angleRequest: angleRequest || undefined,
    market: market || undefined,
    requestedAngleCount,
    ideasPerAngle,
  };
}

function inferCompactSolution(app: AppProject, brief: CompactCreativeBrief | null): string {
  if (brief?.solution?.trim()) return brief.solution.trim();

  const haystack = normalizeCompareText([
    app.name,
    app.category,
    brief?.coreUser,
    brief?.painPoint,
    brief?.angleRequest,
  ].filter(Boolean).join(' '));

  if (/\b(?:home|house|room|interior|decor|design|furniture|nha|phong|thiet ke|noi that)\b/.test(haystack)) {
    return 'AI thiết kế lại nhà/phòng từ 1 ảnh -> có nhiều concept nhanh, giảm thời gian và chi phí thuê designer';
  }

  return `${app.name} tạo kết quả nhanh từ input của user -> lựa chọn gọn hơn, ít công sức hơn`;
}

function buildCompactGenerationFilters(
  currentFilters: FilterState,
  brief: CompactCreativeBrief | null,
  app: AppProject,
  preferBrief = false
): FilterState {
  const hidePsp = shouldHidePspForApp(app);

  if (!brief && !preferBrief) {
    return {
      ...currentFilters,
      solution: hidePsp ? [] : currentFilters.solution,
      visualType: sanitizeVisualTypes(currentFilters.visualType || []),
    } as FilterState;
  }

  const readFilter = (key: keyof FilterState, fallback: string) => {
    const current = currentFilters[key] || [];
    if (!preferBrief && current.length > 0) return current;
    return [fallback || current[0]].filter(Boolean) as string[];
  };
  const parsedVisualTypes = sanitizeVisualTypes([brief?.visualType || '']);
  const currentVisualTypes = sanitizeVisualTypes(currentFilters.visualType || []);

  const next = {
    ...currentFilters,
    coreUser: readFilter('coreUser', brief?.coreUser || 'General mobile app user'),
    painPoint: readFilter('painPoint', brief?.painPoint || brief?.angleRequest || brief?.trend || 'User wants a faster, clearer result'),
    emotion: readFilter('emotion', brief?.emotion || 'Curiosity'),
    targetMarket: readFilter('targetMarket', brief?.market || 'Global'),
    solution: hidePsp ? [] : readFilter('solution', inferCompactSolution(app, brief)),
    visualType: preferBrief
      ? (parsedVisualTypes.length ? parsedVisualTypes : (currentVisualTypes.length ? currentVisualTypes : ['UGC']))
      : (currentVisualTypes.length ? currentVisualTypes : (parsedVisualTypes.length ? parsedVisualTypes : ['UGC'])),
    angle: preferBrief
      ? [brief?.angleRequest || brief?.trend || ''].filter(Boolean) as string[]
      : currentFilters.angle,
  } as FilterState;

  return next;
}

function buildCompactAutoAngles(brief: CompactCreativeBrief | null, app: AppProject, fallbackAngles: string[], autoAngleCount: number): string[] {
  return buildStrategicAutoAngles(brief, app, fallbackAngles, autoAngleCount);
}

const CATEGORIES_STORAGE_KEY = (appId: string) => `idea_tool_categories_${appId}`;

type SeasonalVisualInsights = {
  costumes: string[];
  behaviors: string[];
  colors: string[];
  props: string[];
  moods: string[];
};
type SeasonConfig = {
  label: string;
  icon: string;
  months: string;
  events: string[];
  visualInsights: SeasonalVisualInsights;
};

type MonthVisualConfig = {
  id: string;
  label: string;
  season: string;
  events: string[];
  visualInsights: SeasonalVisualInsights;
};

type SeasonalVisualContext = {
  seasonKey: string;
  seasonLabel: string;
  seasonIcon: string;
  monthId: string | null;
  monthLabel: string | null;
  monthRange: string;
  events: string[];
  costumes: string[];
  behaviors: string[];
  colors: string[];
  props: string[];
  moods: string[];
  emphasis: string[];
};

const SEASONS: Record<string, SeasonConfig> = {
  spring: {
    label: 'Xuân',
    icon: '🌸',
    months: 'Mar – May',
    events: ['Easter', 'St Patrick', "Mother's Day", 'Earth Day', 'April Fools'],
    visualInsights: {
      costumes: ['Pastel outfits', 'Floral patterns', 'Easter bunny ears', 'Light layers', 'Rain jackets'],
      behaviors: ['Spring cleaning', 'Outdoor picnics', 'Gardening', 'Family gatherings', 'Window shopping'],
      colors: ['Pastel pink', 'Mint green', 'Lavender', 'Soft yellow', 'Sky blue'],
      props: ['Flowers', 'Easter eggs', 'Butterflies', 'Garden tools', 'Baskets'],
      moods: ['Renewal', 'Fresh start', 'Hope', 'Joy', 'Optimism'],
    },
  },
  summer: {
    label: 'Hè',
    icon: '☀️',
    months: 'Jun – Aug',
    events: ['Summer Sale', 'Independence Day (US)', 'Back to School', "Father's Day"],
    visualInsights: {
      costumes: ['Swimwear', 'Sunglasses', 'Tank tops', 'Shorts', 'Hats & caps'],
      behaviors: ['Beach trips', 'BBQ parties', 'Road trips', 'Late-night hangouts', 'Ice cream runs'],
      colors: ['Bright orange', 'Ocean blue', 'Coral', 'Lime green', 'Sunset gold'],
      props: ['Sunscreen', 'Pool floats', 'Surfboards', 'Popsicles', 'Camping gear'],
      moods: ['Freedom', 'Adventure', 'Relaxation', 'FOMO', 'Carefree'],
    },
  },
  autumn: {
    label: 'Thu',
    icon: '🍂',
    months: 'Sep – Nov',
    events: ['Halloween', 'Thanksgiving', 'Black Friday', 'Cyber Monday', 'Singles Day 11/11'],
    visualInsights: {
      costumes: ['Cozy sweaters', 'Scarves', 'Boots', 'Halloween costumes', 'Leather jackets'],
      behaviors: ['Pumpkin spice shopping', 'Binge-watching', 'Early holiday prep', 'Cozy nights in', 'Trick-or-treating'],
      colors: ['Burnt orange', 'Deep red', 'Golden yellow', 'Burgundy', 'Forest green'],
      props: ['Pumpkins', 'Fall leaves', 'Candles', 'Blankets', 'Mugs'],
      moods: ['Nostalgia', 'Cozy', 'Urgency (deals)', 'Excitement', 'Gratitude'],
    },
  },
  winter: {
    label: 'Đông',
    icon: '❄️',
    months: 'Dec – Feb',
    events: ['Christmas', 'New Year', "Valentine's Day", 'Lunar New Year', 'Super Bowl'],
    visualInsights: {
      costumes: ['Winter coats', 'Ugly sweaters', 'Beanies', 'Scarves & gloves', 'Formal party wear'],
      behaviors: ['Gift shopping', 'New Year resolutions', 'Indoor activities', 'Family dinners', 'Hot cocoa nights'],
      colors: ['Red & green', 'Silver & gold', 'Icy blue', 'White & cream', 'Deep purple'],
      props: ['Gift boxes', 'Christmas tree', 'Snowflakes', 'Fireworks', 'Heart decorations'],
      moods: ['Warmth', 'Generosity', 'Romance', 'Reflection', 'Celebration'],
    },
  },
};

const SEASON_MONTHS: MonthVisualConfig[] = [
  {
    id: 'mar',
    label: 'Tháng 3',
    season: 'spring',
    events: ['St Patrick', 'Spring Reset', 'Women\'s History Month'],
    visualInsights: {
      costumes: ['Light layers', 'Green accessories', 'Rain jackets', 'Casual cardigans'],
      behaviors: ['Spring cleaning', 'Outdoor coffee walks', 'Closet reset', 'First picnic plans'],
      colors: ['Mint green', 'Fresh white', 'Soft yellow', 'Sky blue'],
      props: ['Flowers', 'Reusable tote bags', 'Garden tools', 'Rain umbrellas'],
      moods: ['Fresh start', 'Optimism', 'Reset energy', 'Lightness'],
    },
  },
  {
    id: 'apr',
    label: 'Tháng 4',
    season: 'spring',
    events: ['Easter', 'Earth Day', 'April Fools'],
    visualInsights: {
      costumes: ['Pastel outfits', 'Floral patterns', 'Easter bunny ears', 'Light denim'],
      behaviors: ['Easter prep', 'Gardening', 'Eco-friendly swaps', 'Playful prank reactions'],
      colors: ['Pastel pink', 'Lavender', 'Mint green', 'Soft yellow'],
      props: ['Easter eggs', 'Flowers', 'Baskets', 'Reusable bottles'],
      moods: ['Playful', 'Renewal', 'Hope', 'Gentle joy'],
    },
  },
  {
    id: 'may',
    label: 'Tháng 5',
    season: 'spring',
    events: ["Mother's Day", 'Memorial Day (US)', 'Graduation Season'],
    visualInsights: {
      costumes: ['Floral dresses', 'Light blazers', 'Smart casual outfits', 'Soft cardigans'],
      behaviors: ['Family brunch', 'Gift planning', 'Graduation prep', 'Weekend shopping'],
      colors: ['Rose pink', 'Cream white', 'Sage green', 'Warm gold'],
      props: ['Bouquets', 'Greeting cards', 'Gift bags', 'Brunch tableware'],
      moods: ['Gratitude', 'Warmth', 'Pride', 'Family care'],
    },
  },
  {
    id: 'jun',
    label: 'Tháng 6',
    season: 'summer',
    events: ["Father's Day", 'Summer Sale', 'Pride Month'],
    visualInsights: {
      costumes: ['Tank tops', 'Shorts', 'Sunglasses', 'Light shirts'],
      behaviors: ['BBQ parties', 'Road trips', 'Outdoor workouts', 'Family hangouts'],
      colors: ['Ocean blue', 'Bright orange', 'Rainbow accents', 'Sunset gold'],
      props: ['Sunscreen', 'Cooler bags', 'Grill tools', 'Travel mugs'],
      moods: ['Freedom', 'Warm connection', 'Adventure', 'Carefree'],
    },
  },
  {
    id: 'jul',
    label: 'Tháng 7',
    season: 'summer',
    events: ['Independence Day (US)', 'Summer Sale', 'Beach Season'],
    visualInsights: {
      costumes: ['Swimwear', 'Sunglasses', 'Hats & caps', 'Red-white-blue accents'],
      behaviors: ['Beach trips', 'Pool parties', 'Fireworks watching', 'Ice cream runs'],
      colors: ['Bright orange', 'Ocean blue', 'Coral', 'Red & blue accents'],
      props: ['Pool floats', 'Popsicles', 'Beach towels', 'Firework sparklers'],
      moods: ['FOMO', 'Celebration', 'Fun', 'Vacation energy'],
    },
  },
  {
    id: 'aug',
    label: 'Tháng 8',
    season: 'summer',
    events: ['Back to School', 'End-of-Summer Sale', 'Late Summer Trips'],
    visualInsights: {
      costumes: ['Casual tees', 'Shorts', 'Caps', 'Backpack outfits'],
      behaviors: ['School shopping', 'Dorm prep', 'Last beach trip', 'Routine reset'],
      colors: ['Sunset gold', 'Lime green', 'Denim blue', 'Warm coral'],
      props: ['Backpacks', 'Notebooks', 'Camping gear', 'Travel suitcases'],
      moods: ['FOMO', 'Reset pressure', 'Adventure', 'Last chance urgency'],
    },
  },
  {
    id: 'sep',
    label: 'Tháng 9',
    season: 'autumn',
    events: ['Back to School', 'Fall Reset', 'Labor Day (US)'],
    visualInsights: {
      costumes: ['Light sweaters', 'Denim jackets', 'Sneakers', 'Workwear basics'],
      behaviors: ['Desk reset', 'Routine planning', 'Coffee runs', 'School commute'],
      colors: ['Golden yellow', 'Forest green', 'Warm beige', 'Deep red'],
      props: ['Notebooks', 'Coffee cups', 'Planners', 'Laptop bags'],
      moods: ['Fresh start', 'Focus', 'Productive', 'Grounded'],
    },
  },
  {
    id: 'oct',
    label: 'Tháng 10',
    season: 'autumn',
    events: ['Halloween', 'Fall Festival', 'Pumpkin Season'],
    visualInsights: {
      costumes: ['Halloween costumes', 'Cozy sweaters', 'Boots', 'Dark hoodies'],
      behaviors: ['Trick-or-treating', 'Pumpkin decorating', 'Binge-watching', 'Night walks'],
      colors: ['Burnt orange', 'Black accents', 'Deep purple', 'Burgundy'],
      props: ['Pumpkins', 'Candles', 'Candy bowls', 'Fall leaves'],
      moods: ['Mystery', 'Cozy suspense', 'Playful fear', 'Excitement'],
    },
  },
  {
    id: 'nov',
    label: 'Tháng 11',
    season: 'autumn',
    events: ['Thanksgiving', 'Black Friday', 'Cyber Monday', 'Singles Day 11/11'],
    visualInsights: {
      costumes: ['Cozy sweaters', 'Scarves', 'Boots', 'Home loungewear'],
      behaviors: ['Gift hunting', 'Deal comparison', 'Family dinners', 'Early holiday prep'],
      colors: ['Burgundy', 'Burnt orange', 'Warm brown', 'Golden yellow'],
      props: ['Shopping bags', 'Blankets', 'Mugs', 'Deal stickers'],
      moods: ['Urgency (deals)', 'Gratitude', 'Cozy', 'Smart saving'],
    },
  },
  {
    id: 'dec',
    label: 'Tháng 12',
    season: 'winter',
    events: ['Christmas', 'Year-End Sale', 'Holiday Travel'],
    visualInsights: {
      costumes: ['Winter coats', 'Ugly sweaters', 'Scarves & gloves', 'Holiday pajamas'],
      behaviors: ['Gift shopping', 'Holiday decorating', 'Family dinners', 'Travel packing'],
      colors: ['Red & green', 'Silver & gold', 'Icy blue', 'Warm white'],
      props: ['Gift boxes', 'Christmas tree', 'String lights', 'Suitcases'],
      moods: ['Warmth', 'Generosity', 'Celebration', 'Year-end pressure'],
    },
  },
  {
    id: 'jan',
    label: 'Tháng 1',
    season: 'winter',
    events: ['New Year', 'Lunar New Year Prep', 'Resolution Season'],
    visualInsights: {
      costumes: ['Winter coats', 'Formal party wear', 'Clean activewear', 'Beanies'],
      behaviors: ['New Year resolutions', 'Decluttering', 'Budget planning', 'Family prep'],
      colors: ['Silver & gold', 'Icy blue', 'White & cream', 'Lucky red accents'],
      props: ['Fireworks', 'Planners', 'Red envelopes', 'Fitness bottles'],
      moods: ['Reflection', 'Fresh ambition', 'Celebration', 'Discipline'],
    },
  },
  {
    id: 'feb',
    label: 'Tháng 2',
    season: 'winter',
    events: ["Valentine's Day", 'Super Bowl', 'Lunar New Year'],
    visualInsights: {
      costumes: ['Red outfits', 'Scarves & gloves', 'Smart casual date outfits', 'Team jerseys'],
      behaviors: ['Date planning', 'Party watching', 'Family visits', 'Gift wrapping'],
      colors: ['Red & pink', 'Gold accents', 'Icy blue', 'Deep purple'],
      props: ['Heart decorations', 'Gift boxes', 'Snack bowls', 'Red envelopes'],
      moods: ['Romance', 'Celebration', 'Family luck', 'Social energy'],
    },
  },
];

const CALENDAR_MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const uniqueSeasonItems = (items: string[]) => [...new Set(items.filter(Boolean))];

function loadCategories(appId: string): CategoryConfig[] {
  if (typeof window === 'undefined') return DEFAULT_CATEGORIES;
  try {
    const saved = localStorage.getItem(CATEGORIES_STORAGE_KEY(appId));
    if (!saved) return DEFAULT_CATEGORIES;
    const parsed = JSON.parse(saved) as { id: string; label: string; isCustom?: boolean }[];
    // Merge: keep default icons, add custom ones
    const defaultMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));
    const result: CategoryConfig[] = [];
    for (const item of parsed) {
      if (defaultMap.has(item.id)) {
        result.push(defaultMap.get(item.id)!);
        defaultMap.delete(item.id);
      } else {
        result.push({ id: item.id, label: item.label, icon: Hash, isCustom: true });
      }
    }
    // Add any remaining defaults not in saved
    for (const def of defaultMap.values()) result.push(def);
    return result;
  } catch { return DEFAULT_CATEGORIES; }
}

function saveCategories(appId: string, cats: CategoryConfig[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    CATEGORIES_STORAGE_KEY(appId),
    JSON.stringify(cats.map(c => ({ id: c.id, label: c.label, isCustom: c.isCustom || false })))
  );
}

const HISTORY_ALL_WEEKS = 'all';
const HISTORY_TODAY = 'today';
const HISTORY_THIS_WEEK = 'this-week';
const HISTORY_THIS_MONTH = 'this-month';
const HISTORY_DAY_PREFIX = 'day:';
const HISTORY_WEEK_PREFIX = 'week:';
const HISTORY_MONTH_PREFIX = 'month:';
const HISTORY_LOAD_LIMIT = 500;

function toHistoryDate(value?: string | Date | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfHistoryWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + offset);
  return start;
}

function getHistoryWeekKey(value?: string | Date | null) {
  const date = toHistoryDate(value);
  const start = startOfHistoryWeek(date);
  const year = start.getFullYear();
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getHistoryDayKey(value?: string | Date | null) {
  const date = toHistoryDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getHistoryMonthKey(value?: string | Date | null) {
  const date = toHistoryDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatHistoryDay(dayKey: string) {
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Ngày đã chọn';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatHistoryMonth(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Tháng đã chọn';
  return date.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
}

function getHistoryWeekRangeLabel(filterKey: string) {
  if (filterKey === HISTORY_ALL_WEEKS) return 'Tất cả lịch sử';
  if (filterKey === HISTORY_TODAY) return 'Hôm nay';
  if (filterKey === HISTORY_THIS_WEEK) return 'Tuần này';
  if (filterKey === HISTORY_THIS_MONTH) return 'Tháng này';
  if (filterKey.startsWith(HISTORY_DAY_PREFIX)) return `Ngày ${formatHistoryDay(filterKey.slice(HISTORY_DAY_PREFIX.length))}`;
  if (filterKey.startsWith(HISTORY_MONTH_PREFIX)) return `Tháng ${formatHistoryMonth(filterKey.slice(HISTORY_MONTH_PREFIX.length))}`;

  const rawWeekKey = filterKey.startsWith(HISTORY_WEEK_PREFIX)
    ? filterKey.slice(HISTORY_WEEK_PREFIX.length)
    : filterKey;
  const start = new Date(`${rawWeekKey}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 'Tuần đã chọn';
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const format = (date: Date) => date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const currentWeekKey = getHistoryWeekKey(new Date());
  return `${rawWeekKey === currentWeekKey ? 'Tuần này' : 'Tuần'} ${format(start)} - ${format(end)}`;
}

function matchesHistoryDateFilter(idea: GeneratedIdea, filterKey: string) {
  if (filterKey === HISTORY_ALL_WEEKS) return true;
  const createdAt = idea.created_at;
  if (filterKey === HISTORY_TODAY) return getHistoryDayKey(createdAt) === getHistoryDayKey(new Date());
  if (filterKey === HISTORY_THIS_WEEK) return getHistoryWeekKey(createdAt) === getHistoryWeekKey(new Date());
  if (filterKey === HISTORY_THIS_MONTH) return getHistoryMonthKey(createdAt) === getHistoryMonthKey(new Date());
  if (filterKey.startsWith(HISTORY_DAY_PREFIX)) return getHistoryDayKey(createdAt) === filterKey.slice(HISTORY_DAY_PREFIX.length);
  if (filterKey.startsWith(HISTORY_MONTH_PREFIX)) return getHistoryMonthKey(createdAt) === filterKey.slice(HISTORY_MONTH_PREFIX.length);
  if (filterKey.startsWith(HISTORY_WEEK_PREFIX)) return getHistoryWeekKey(createdAt) === filterKey.slice(HISTORY_WEEK_PREFIX.length);
  return getHistoryWeekKey(createdAt) === filterKey;
}

export const FilterGenerator: React.FC<FilterGeneratorProps> = ({ app, currentScreen, setScreen, selectedModel, prefillFilters, onPrefillConsumed, onAppKnowledgeUpdated }) => {
  const hidePspForCurrentApp = shouldHidePspForApp(app);
  const [categories, setCategories] = useState<CategoryConfig[]>(() => loadCategories(app.id));
  const [filters, setFilters] = useState<FilterState>({ coreUser: [], painPoint: [], solution: [], emotion: [], videoStructure: [], visualType: [], targetMarket: [], angle: [] });
  const [options, setOptions] = useState<Record<string, string[]>>({ coreUser: [], painPoint: [], solution: [], emotion: GLOBAL_EMOTION_OPTIONS, videoStructure: [], visualType: GLOBAL_VISUAL_TYPES, targetMarket: ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'] });
  const [strategyCodeOptions, setStrategyCodeOptions] = useState<Record<string, string[]>>({ coreUser: [], painPoint: [], solution: [], emotion: GLOBAL_EMOTION_OPTIONS, videoStructure: [], visualType: GLOBAL_VISUAL_TYPES, targetMarket: [] });
  const [newItem, setNewItem] = useState<{ cat: string | null; text: string }>({ cat: null, text: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadPromiseRef = useRef<Promise<GeneratedIdea[]> | null>(null);
  const [results, setResults] = useState<GeneratedIdea[]>([]);
  const [quantity, setQuantity] = useState(3);
  const [ideaDescription, setIdeaDescription] = useState('');
  const [generationMode] = useState<GenerationMode>('builder');
  const [systemRuleDraft, setSystemRuleDraft] = useState('');
  const [savingSystemRule, setSavingSystemRule] = useState(false);
  const [systemRuleMessage, setSystemRuleMessage] = useState('');
  const [editModeCat, setEditModeCat] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState<{ original: string; current: string } | null>(null);
  const [savedHistory, setSavedHistory] = useState<GeneratedIdea[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyWeekFilter, setHistoryWeekFilter] = useState(HISTORY_TODAY);
  const [editingIdea, setEditingIdea] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editBuffer, setEditBuffer] = useState<any>(null);
  const [refiningIdea, setRefiningIdea] = useState<string | null>(null);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<string | null>(null);
  // New feature states
  const [expandedIdeas, setExpandedIdeas] = useState<Set<string>>(new Set());
  const [favoriteIdeas, setFavoriteIdeas] = useState<Set<string>>(new Set());
  const [showFavoriteIdeas, setShowFavoriteIdeas] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);
  const [trendingInput, setTrendingInput] = useState('');
  const [importedTrendAnalyses, setImportedTrendAnalyses] = useState<ImportedTrendAnalysis[]>([]);
  const [isImportingTrend, setIsImportingTrend] = useState(false);
  const [trendImportError, setTrendImportError] = useState<string | null>(null);
  const [selectedSeasonInsights, setSelectedSeasonInsights] = useState<Set<string>>(new Set());
  const [selectedSeasonEvents, setSelectedSeasonEvents] = useState<Set<string>>(new Set());
  const [wizardStep, setWizardStep] = useState(0);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedSeasonMonth, setSelectedSeasonMonth] = useState<string | null>(null);
  const [autoAngleCount, setAutoAngleCount] = useState(3);
  const [generatingAngles, setGeneratingAngles] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [ideaSaveStatus, setIdeaSaveStatus] = useState<IdeaSaveStatus>('idle');
  const [ideaSaveMessage, setIdeaSaveMessage] = useState('');
  const usableImportedTrendAnalyses = useMemo(
    () => importedTrendAnalyses.filter(analysis => !isGenericImportedTrendAnalysis(analysis)),
    [importedTrendAnalyses]
  );

  useEffect(() => {
    let cancelled = false;
    setSystemRuleDraft('');
    setSystemRuleMessage('');

    dbService.getSystemRule(app.id)
      .then(rule => {
        if (!cancelled) setSystemRuleDraft(rule || '');
      })
      .catch(error => {
        console.warn('Load system rule failed:', error);
        if (!cancelled) setSystemRuleMessage('Không load được system_rule');
      });

    return () => {
      cancelled = true;
    };
  }, [app.id]);

  useEffect(() => {
    setOptions({
      coreUser: [],
      painPoint: [],
      solution: [],
      emotion: GLOBAL_EMOTION_OPTIONS,
      videoStructure: [],
      visualType: GLOBAL_VISUAL_TYPES,
      targetMarket: [],
    });
  }, [app.id]);

  useEffect(() => {
    if (!hidePspForCurrentApp) return;
    setFilters(prev => (prev.solution || []).length > 0 ? { ...prev, solution: [] } : prev);
  }, [hidePspForCurrentApp, app.id]);

  useEffect(() => {
    setImportedTrendAnalyses(prev => {
      const filtered = prev.filter(analysis => !isGenericImportedTrendAnalysis(analysis));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [app.id]);

  const mergeOptionSelections = (existing: Record<string, string[]>, nextFilters: Partial<FilterState>) => {
    const merged = { ...existing };
    Object.entries(nextFilters).forEach(([key, raw]) => {
      if (!Array.isArray(raw)) return;
      const values = raw
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());
      const safeValues = sanitizeOptionValues(key, values);
      if (safeValues.length === 0) return;
      if (key === 'visualType') {
        merged[key] = GLOBAL_VISUAL_TYPES;
        return;
      }
      merged[key] = [...new Set([...(sanitizeOptionValues(key, merged[key] || [])), ...safeValues])];
    });
    merged.visualType = GLOBAL_VISUAL_TYPES;
    return merged;
  };

  const appendTrendingTopics = (items: string[]) => {
    const normalized = items
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
    if (normalized.length === 0) return;

    setTrendingTopics(prev => [...new Set([...prev, ...normalized])]);
  };

  const handleSaveSystemRule = async () => {
    if (savingSystemRule) return;
    setSavingSystemRule(true);
    setSystemRuleMessage('');

    try {
      const saved = await dbService.saveSystemRule(app.id, systemRuleDraft);
      if (!saved) throw new Error('Could not save system_rule.');
      setSystemRuleMessage('Đã lưu system_rule');
    } catch (error) {
      setSystemRuleMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSavingSystemRule(false);
    }
  };

  const handleAddTrendingInput = async () => {
    const value = trendingInput.trim();
    if (!value || isImportingTrend) return;

    if (!/^https?:\/\//i.test(value)) {
      appendTrendingTopics([value]);
      setTrendingInput('');
      setTrendImportError(null);
      return;
    }

    setIsImportingTrend(true);
    setTrendImportError(null);

    try {
      const res = await authenticatedFetch('/api/import-trending-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const result = await res.json();

      if (!res.ok || !result.success || !result.data) {
        throw new Error(result.error || 'Không import được video từ URL này.');
      }

      const analysis = result.data as ImportedTrendAnalysis;
      if (isGenericImportedTrendAnalysis(analysis)) {
        throw new Error('Video import chỉ trả về template generic, không đưa vào prompt. Hãy thử video public ngắn hơn/direct MP4-WebM hoặc dán mô tả trend dạng text.');
      }

      setImportedTrendAnalyses(prev => [analysis, ...prev.filter(item => item.sourceUrl !== analysis.sourceUrl)]);
      setOptions(prev =>
        mergeOptionSelections(prev, {
          emotion: analysis.filterHints?.emotion || [],
          angle: analysis.filterHints?.angle || [],
          visualType: analysis.filterHints?.visualType || [],
        })
      );
      setTrendingInput('');
    } catch (error) {
      setTrendImportError(error instanceof Error ? error.message : 'Import URL video thất bại.');
    } finally {
      setIsImportingTrend(false);
    }
  };

  useEffect(() => {
    setCategories(loadCategories(app.id));
    historyLoadPromiseRef.current = null;
    setSavedHistory([]);
    setShowHistory(false);
    setHistoryWeekFilter(HISTORY_TODAY);
    setIdeaSaveStatus('idle');
    setIdeaSaveMessage('');
    loadOptions();
    loadHistory(true);
  }, [app.id]);

  // Auto-fill from Strategy Map → xuyên suốt
  useEffect(() => {
    if (prefillFilters) {
      const normalized = Object.fromEntries(
        Object.entries(prefillFilters)
          .map(([key, raw]) => {
            if (!Array.isArray(raw)) return [key, []] as const;
            const values = raw
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              .map(item => item.trim());
            return [key, key === 'visualType' ? sanitizeVisualTypes(values) : key === 'angle' ? cleanAngleOptions(values) : values] as const;
          })
          .filter(([, values]) => values.length > 0)
      ) as Partial<FilterState>;

      setFilters(prev => ({
        ...prev,
        ...normalized,
      } as FilterState));
      setOptions(prev => mergeOptionSelections(prev, normalized));
      setWizardStep(4);
      setValidationError(null);
      onPrefillConsumed?.();
    }
  }, [prefillFilters, onPrefillConsumed]);

  // Auto-load results from DB when entering results screen
  useEffect(() => {
    if (currentScreen === 'f2.1.2' && results.length === 0) {
      if (savedHistory.length > 0) {
        setResults(savedHistory);
        setShowHistory(true);
        return;
      }

      loadHistory().then(cleanIdeas => {
        setResults(cleanIdeas);
        setShowHistory(true);
      }).catch(error => {
        console.warn('Load result history failed:', error);
      });
    }
  }, [currentScreen]);

  const loadOptions = async () => {
    const fullOptions = await dbService.getFilterOptions(app);
    const safeFullOptions = {
      ...fullOptions,
      angle: cleanAngleOptions(fullOptions.angle || []),
    };
    const safeSelectedFilters = {
      ...(prefillFilters || filters),
      angle: cleanAngleOptions((prefillFilters || filters).angle || []),
    };
    setStrategyCodeOptions({ ...safeFullOptions, visualType: GLOBAL_VISUAL_TYPES });
    setOptions(prev => mergeOptionSelections({ ...safeFullOptions, visualType: GLOBAL_VISUAL_TYPES }, safeSelectedFilters));
    return;
    // Merge market presets with any DB options
    const marketPresets = ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'];
    const dbMarket = fullOptions.targetMarket || [];
    const mergedMarket = [...new Set([...marketPresets, ...dbMarket])];
    setOptions(prev => mergeOptionSelections({ ...fullOptions, targetMarket: mergedMarket }, prefillFilters || filters));
  };

  const cleanupHistoryInBackground = useCallback(() => {
    window.setTimeout(() => {
      cleanupInvalidStrategyIdeas(app.id).catch(error => {
        console.warn('Cleanup invalid strategy ideas failed:', error);
      });
    }, 0);
  }, [app.id]);

  const loadHistory = async (force = false) => {
    if (!force && savedHistory.length > 0) return savedHistory;
    if (historyLoadPromiseRef.current) return historyLoadPromiseRef.current;

    const request = (async () => {
      setHistoryLoading(true);
      const ideas = await dbService.getIdeas(app.id, { limit: HISTORY_LOAD_LIMIT });
      const cleanIdeas = ideas.filter(isVisibleStrategyIdea);
      const backup = readUnsavedIdeaBackup(app.id);
      const backupIdeas = (backup?.ideas || []).filter(isVisibleStrategyIdea);
      const cleanIdeaIds = new Set(cleanIdeas.map(idea => idea.id));
      const mergedIdeas = [
        ...backupIdeas.filter(idea => !cleanIdeaIds.has(idea.id)),
        ...cleanIdeas,
      ];
      if (backupIdeas.length > 0) {
        setIdeaSaveStatus('error');
        setIdeaSaveMessage(`Có ${backupIdeas.length} idea local chưa lưu Supabase`);
      } else if (ideaSaveStatus === 'error' && ideaSaveMessage.includes('local chưa lưu')) {
        setIdeaSaveStatus('idle');
        setIdeaSaveMessage('');
      }
      setSavedHistory(mergedIdeas);
      setFavoriteIdeas(prev => mergeFavoriteKeys(app.id, prev, mergedIdeas));
      cleanupHistoryInBackground();
      return mergedIdeas;
    })().finally(() => {
      historyLoadPromiseRef.current = null;
      setHistoryLoading(false);
    });

    historyLoadPromiseRef.current = request;
    return request;
  };

  useEffect(() => {
    if (savedHistory.length === 0) return;
    setHistoryWeekFilter(prev => {
      if (prev === HISTORY_ALL_WEEKS) return prev;
      if (savedHistory.some(idea => matchesHistoryDateFilter(idea, prev))) return prev;
      if (savedHistory.some(idea => matchesHistoryDateFilter(idea, HISTORY_TODAY))) return HISTORY_TODAY;
      if (savedHistory.some(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_WEEK))) return HISTORY_THIS_WEEK;
      if (savedHistory.some(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_MONTH))) return HISTORY_THIS_MONTH;
      return `${HISTORY_MONTH_PREFIX}${getHistoryMonthKey(savedHistory[0]?.created_at)}`;
    });
  }, [savedHistory]);

  const getIdeaFavoriteKey = useCallback((idea: GeneratedIdea) => buildIdeaFavoriteFingerprint(app.id, idea), [app.id]);
  const getAllIdeaFavoriteKeys = useCallback((idea: GeneratedIdea) => buildIdeaFavoriteKeys(app.id, idea), [app.id]);

  useEffect(() => {
    setFavoriteIdeas(loadFavoriteKeys(app.id));
    setShowFavoriteIdeas(false);
  }, [app.id]);

  useEffect(() => {
    if (savedHistory.length === 0) return;
    setFavoriteIdeas(prev => mergeFavoriteKeys(app.id, prev, savedHistory));
  }, [app.id, savedHistory]);

  useEffect(() => {
    writeUnsavedIdeaBackup(app.id, savedHistory);
  }, [app.id, savedHistory]);

  useEffect(() => {
    saveFavoriteKeys(app.id, favoriteIdeas);
    notifyFavoriteKeysChanged(app.id);
  }, [app.id, favoriteIdeas]);

  // === Category Management ===
  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    if (categories.some(c => c.id === id)) return;
    const newCat: CategoryConfig = { id, label: name, icon: Hash, isCustom: true };
    const updated = [...categories, newCat];
    setCategories(updated);
    saveCategories(app.id, updated);
    setOptions(prev => ({ ...prev, [id]: [] }));
    setFilters(prev => ({ ...prev, [id]: [] }));
    setNewCategoryName('');
    setShowAddCategory(false);
  };

  const handleDeleteCategory = (catId: string) => {
    const updated = categories.filter(c => c.id !== catId);
    setCategories(updated);
    saveCategories(app.id, updated);
    // Clean up options and filters for this category
    setOptions(prev => { const next = { ...prev }; delete next[catId]; return next; });
    setFilters(prev => { const next = { ...prev }; delete next[catId]; return next; });
    // Delete all DB options for this category
    const items = options[catId] || [];
    items.forEach(item => dbService.deleteFilterOptionByValue(app.id, catId, item));
    setEditModeCat(null);
    setConfirmDeleteCat(null);
  };

  const toggleFilter = (category: string, item: string) => {
    const normalizedItem = category === 'visualType' ? normalizeVisualTypeValue(item) || item : item;
    setFilters(prev => ({
      ...prev,
      [category]: category === 'visualType'
        ? ((prev[category] || []).includes(normalizedItem) ? [] : [normalizedItem])
        : (category === 'coreUser' && getCoreUserDimension(normalizedItem) === 'language')
          ? ((prev[category] || []).includes(normalizedItem)
            ? (prev[category] || []).filter(i => i !== normalizedItem)
            : [...(prev[category] || []).filter(i => getCoreUserDimension(i) !== 'language'), normalizedItem])
        : ((prev[category] || []).includes(normalizedItem) ? (prev[category] || []).filter(i => i !== normalizedItem) : [...(prev[category] || []), normalizedItem])
    }));
  };

  const handleAddItem = async (category: string) => {
    if (category === 'visualType') return;
    const value = newItem.text.trim();
    if (value) {
      if ((options[category] || []).includes(value)) {
        setNewItem({ cat: null, text: '' });
        return;
      }

      const saved = await dbService.addFilterOption(app.id, category, value);
      if (!saved) {
        alert('Lưu lựa chọn vào database thất bại. Vui lòng thử lại.');
        return;
      }

      setOptions(prev => ({ ...prev, [category]: [...(prev[category] || []), value] }));
      setNewItem({ cat: null, text: '' });
    }
  };

  const handleAddCoreUserItem = async (dimension: CoreUserDimension) => {
    const value = newItem.text.trim();
    if (!value) return;
    const storedValue = coreUserDimensionValue(dimension, value);
    if ((options.coreUser || []).includes(storedValue)) {
      setNewItem({ cat: null, text: '' });
      return;
    }

    const saved = await dbService.addFilterOption(app.id, 'coreUser', storedValue);
    if (!saved) {
      alert('Lưu lựa chọn vào database thất bại. Vui lòng thử lại.');
      return;
    }

    setOptions(prev => ({ ...prev, coreUser: [...(prev.coreUser || []), storedValue] }));
    setNewItem({ cat: null, text: '' });
  };

  const handleDeleteOption = async (category: string, item: string) => {
    if (category === 'emotion' && GLOBAL_EMOTION_OPTIONS.includes(item)) return;

    // Immediately update UI
    setOptions(prev => ({ ...prev, [category]: (prev[category] || []).filter(i => i !== item) }));
    if ((filters[category] || []).includes(item)) {
      setFilters(prev => ({ ...prev, [category]: (prev[category] || []).filter(i => i !== item) }));
    }
    // Persist deletion to DB
    const ok = await dbService.deleteFilterOptionByValue(app.id, category, item);
    console.log(`Delete filter option [${category}] "${item}":`, ok ? 'success' : 'failed');
  };

  const handleUpdateOption = async (category: string, oldItem: string, newItemText: string) => {
    if (category === 'emotion' && GLOBAL_EMOTION_OPTIONS.includes(oldItem)) {
      setEditingItemText(null);
      return;
    }

    const normalizedText = newItemText.trim();
    if (!normalizedText || normalizedText === oldItem) { setEditingItemText(null); return; }

    setOptions(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === oldItem ? normalizedText : i)) }));
    if ((filters[category] || []).includes(oldItem)) {
      setFilters(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === oldItem ? normalizedText : i)) }));
    }
    setEditingItemText(null);

    const ok = await dbService.updateFilterOptionByValue(app.id, category, oldItem, normalizedText);
    if (!ok) {
      setOptions(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === normalizedText ? oldItem : i)) }));
      setFilters(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === normalizedText ? oldItem : i)) }));
      alert('Lưu chỉnh sửa vào database thất bại. Vui lòng thử lại.');
    }
  };

  const startProgress = () => {
    setProgress(0);
    setProgressLabel('Đang phân tích bối cảnh...');
    const steps = [
      { at: 5, label: 'Đang phân tích bối cảnh...' },
      { at: 15, label: 'Đang xây dựng Hook Formula...' },
      { at: 30, label: 'Đang viết Visual chi tiết...' },
      { at: 50, label: 'Đang tạo Voice & Text...' },
      { at: 70, label: 'Đang hoàn thiện Body & CTA...' },
      { at: 85, label: 'Đang kiểm tra chất lượng...' },
      { at: 92, label: 'Đang chờ AI trả kết quả...' },
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

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
    setProgress(100);
    setProgressLabel('Hoàn thành! ✨');
    setTimeout(() => { setProgress(0); setProgressLabel(''); }, 1500);
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    stopProgress();
    setIsGenerating(false);
    setProgress(0);
    setProgressLabel('Đã hủy');
    setTimeout(() => setProgressLabel(''), 1500);
  };

  const getGenerationValidationMessage = (filtersToCheck: FilterState, plannedAngles: string[]): string => {
    if ((filtersToCheck.coreUser || []).length === 0) return 'Chưa chọn Core User.';
    const invalidCoreUserLanguage = (filtersToCheck.coreUser || []).find(item =>
      getCoreUserDimension(item) === 'language' && !isRecognizedCoreUserLanguageItem(item)
    );
    if (invalidCoreUserLanguage) {
      return `Ngôn ngữ Core User không hợp lệ: ${getCoreUserDisplayValue(invalidCoreUserLanguage)}. Hãy dùng ngôn ngữ chuẩn hoặc để trống để hệ thống lấy theo Quốc gia / Market.`;
    }
    if ((filtersToCheck.solution || []).length === 0) return 'Chưa chọn Tính năng / Giải pháp.';
    if ((filtersToCheck.emotion || []).length === 0) return 'Chưa chọn Emotion Trigger.';
    if (sanitizeVisualTypes(filtersToCheck.visualType || []).length === 0) return 'Chưa chọn Dạng Visual.';
    if ((filtersToCheck.painPoint || []).length === 0) return 'Chưa chọn Painpoint.';
    if (plannedAngles.length === 0) return 'Chưa có Angle. Hãy chọn angle hoặc đặt số lượng angle để AI tự chọn.';
    return '';
  };

  const strategyMapCodeByIdeaId = useMemo(() => {
    const strategyMapHistory = savedHistory.filter(isVisibleStrategyMapIdea);
    const favoriteStrategyMapHistory = strategyMapHistory.filter(idea => hasFavoriteIdeaKey(app.id, idea, favoriteIdeas));
    const currentWeekKey = getHistoryWeekKey(new Date());
    const currentWeekFavorites = favoriteStrategyMapHistory.filter(idea => getHistoryWeekKey(idea.created_at) === currentWeekKey);

    return {
      all: buildStrategyMapCodeByIdeaId(app.name, strategyCodeOptions, strategyMapHistory, favoriteStrategyMapHistory),
      currentWeek: buildStrategyMapCodeByIdeaId(app.name, strategyCodeOptions, strategyMapHistory, currentWeekFavorites),
    };
  }, [app.id, app.name, favoriteIdeas, savedHistory, strategyCodeOptions]);

  const buildGlobalStrategyCodeSource = useCallback((currentFilters: FilterState, currentAngles: string[]) => {
    const source = {} as Record<StrategyCodeFilterKey, string[]>;
    const strategyMapHistory = savedHistory.filter(isVisibleStrategyMapIdea);
    const favoriteStrategyMapHistory = strategyMapHistory.filter(idea => hasFavoriteIdeaKey(app.id, idea, favoriteIdeas));

    (Object.keys(STRATEGY_CODE_OPTION_KEYS) as StrategyCodeFilterKey[]).forEach(key => {
      const filterKey = STRATEGY_CODE_OPTION_KEYS[key];
      const values: string[] = [];
      const append = (items: unknown) => {
        cleanStrategyValues(items).forEach(value => {
          if (!values.includes(value)) values.push(value);
        });
      };
      const appendGroup = (items: unknown) => {
        const value = formatStrategyValueGroup(items);
        if (value && !values.includes(value)) values.push(value);
      };

      append(strategyCodeOptions[filterKey] || []);
      strategyMapHistory.forEach(idea => append(idea.filters_snapshot?.[filterKey]));
      append(currentFilters[filterKey]);
      append(STRATEGY_CODE_FALLBACK_SOURCE[key]);
      if (key === 'angle') {
        favoriteStrategyMapHistory.forEach(idea => {
          const ideaFilters = (idea.filters_snapshot || {}) as Partial<FilterState>;
          cleanStrategyValues(ideaFilters.angle).forEach(angle => {
            append([getStrategyCodeAngleLabel(idea, angle, ideaFilters)]);
          });
        });
        append(currentAngles);
        source[key] = values;
        return;
      }
      favoriteStrategyMapHistory.forEach(idea => appendGroup(idea.filters_snapshot?.[filterKey]));
      appendGroup(currentFilters[filterKey]);

      source[key] = values;
    });

    return source;
  }, [app.id, favoriteIdeas, savedHistory, strategyCodeOptions]);

  const getEffectiveStrategyCodeMeta = useCallback((idea: GeneratedIdea) => {
    const savedMeta = idea.content?.meta || {};
    const mapStrategyCode = getHistoryWeekKey(idea.created_at) === getHistoryWeekKey(new Date())
      ? strategyMapCodeByIdeaId.currentWeek.get(idea.id) || strategyMapCodeByIdeaId.all.get(idea.id) || ''
      : strategyMapCodeByIdeaId.all.get(idea.id) || '';
    const snapshot = idea.filters_snapshot;
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return {
        strategyCode: mapStrategyCode || String(savedMeta.strategyCode || ''),
        strategyCodeMap: Array.isArray(savedMeta.strategyCodeMap)
          ? savedMeta.strategyCodeMap.map(item => String(item || '').trim()).filter(Boolean)
          : [],
      };
    }

    const snapshotFilters = {
      coreUser: snapshot.coreUser || [],
      painPoint: snapshot.painPoint || [],
      solution: snapshot.solution || [],
      emotion: snapshot.emotion || [],
      videoStructure: snapshot.videoStructure || [],
      visualType: snapshot.visualType || [],
      targetMarket: snapshot.targetMarket || [],
      angle: snapshot.angle || [],
    } as FilterState;
    const angleValues = cleanStrategyValues(snapshotFilters.angle)
      .map(angle => getStrategyCodeAngleLabel(idea, angle, snapshotFilters));
    const codeFiltersSnapshot = {
      ...snapshotFilters,
      angle: angleValues,
    } as FilterState;
    const lookup = buildStrategyCodeLookup(buildGlobalStrategyCodeSource(snapshotFilters, angleValues));
    const strategyCode = mapStrategyCode
      || formatStrategyCodeForFilterGroups(codeFiltersSnapshot, lookup)
      || String(savedMeta.strategyCode || '');
    const strategyCodeMap = getStrategyGroupCodeMapRows(codeFiltersSnapshot, lookup);

    return {
      strategyCode,
      strategyCodeMap: strategyCodeMap.length > 0
        ? strategyCodeMap
        : Array.isArray(savedMeta.strategyCodeMap)
          ? savedMeta.strategyCodeMap.map(item => String(item || '').trim()).filter(Boolean)
          : [],
    };
  }, [buildGlobalStrategyCodeSource, strategyMapCodeByIdeaId]);

  const handleGenerate = async () => {
    const rawBrief = ideaDescription.trim();
    const compactBrief = parseCompactCreativeBrief(rawBrief);
    const isQuickBriefMode = Boolean(compactBrief && rawBrief);
    const useFastGeneratePath = true;
    const selectedAnglesFromCurrentFilters = Array.from(new Set((filters.angle || []).map(angle => angle.trim()).filter(Boolean)));
    const generationBaseFilters = buildCompactGenerationFilters(filters, compactBrief, app, isQuickBriefMode);
    const selectedAnglesFromGenerationFilters = Array.from(new Set((generationBaseFilters.angle || []).map(angle => angle.trim()).filter(Boolean)));
    const generatedAngleList = isQuickBriefMode
      ? selectedAnglesFromCurrentFilters.length > 0
        ? selectedAnglesFromCurrentFilters
        : buildCompactAutoAngles(compactBrief, app, [], compactBrief?.requestedAngleCount || autoAngleCount)
      : selectedAnglesFromGenerationFilters.length > 0
        ? selectedAnglesFromGenerationFilters
        : buildCompactAutoAngles(compactBrief, app, [], autoAngleCount);
    const anglesToGenerate: Array<string | null> = generatedAngleList.length > 0 ? generatedAngleList : [null];
    const effectiveQuantity = Math.min(10, Math.max(1, compactBrief?.ideasPerAngle || quantity));
    const validationAngleList = isQuickBriefMode && generatedAngleList.length === 0 ? ['Quick Brief angle'] : generatedAngleList;
    const validationFilters = hidePspForCurrentApp
      ? { ...generationBaseFilters, solution: [app.name] }
      : generationBaseFilters;
    const generationValidationMessage = getGenerationValidationMessage(validationFilters, validationAngleList);
    if (generationValidationMessage) {
      setValidationError(generationValidationMessage);
      setGenerationNotice(null);
      if (wizardStep >= 4) alert(generationValidationMessage);
      return;
    }
    const metricConflict = getHealthMetricConflict({
      solutionValues: generationBaseFilters.solution,
      angleValues: generatedAngleList,
      painPointValues: generationBaseFilters.painPoint,
    });

    if (metricConflict) {
      const conflictMessage = formatHealthMetricConflictMessage(metricConflict);
      setValidationError(conflictMessage);
      setGenerationNotice(null);
      if (wizardStep >= 4) alert(conflictMessage);
      return;
    }

    setValidationError(null);
    setIsGenerating(true);
    setGenerationNotice(null);
    setIdeaSaveStatus('idle');
    setIdeaSaveMessage('');
    const controller = new AbortController();
    abortRef.current = controller;
    startProgress();
    try {
      const previousIdeasSummary = savedHistory.slice(0, 6).map((idea, i) => {
        const c = idea.content;
        const hookSummary = c?.meta?.hookPrimary
          || c?.hook?.textOverlay
          || c?.hook?.voice
          || c?.hook?.visual
          || c?.hook?.script
          || '';
        return `${i + 1}. "${idea.title}" | type="${c?.creativeType || ''}" | pain="${c?.framework?.painpoint || ''}" | hook="${hookSummary}"`;
      }).join('\n');

      const maxIdeasPerAngleRequest = Math.min(8, Math.max(1, effectiveQuantity));
      const sanitizedFilters = {
        ...generationBaseFilters,
        visualType: sanitizeVisualTypes(generationBaseFilters.visualType || []),
      } as FilterState;
      const strategyAngleValues = anglesToGenerate
        .filter((angle): angle is string => typeof angle === 'string' && angle.trim().length > 0)
        .map(angle => angle.trim());
      const strategyHistoryFilters = savedHistory
        .filter(idea => idea.filters_snapshot)
        .slice()
        .sort((a, b) => {
          const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          return timeDiff || a.id.localeCompare(b.id);
        })
        .map(idea => idea.filters_snapshot as FilterState);
      const strategyCodeSource = buildStableStrategyCodeSource(
        options,
        sanitizedFilters,
        strategyAngleValues,
        strategyHistoryFilters
      );
      const generationTasks = anglesToGenerate.flatMap((angle, angleIndex) =>
        Array.from({ length: Math.ceil(effectiveQuantity / maxIdeasPerAngleRequest) }, (_, chunkIndex) => {
          const startIndex = chunkIndex * maxIdeasPerAngleRequest;
          return {
            selectedAngle: angle,
            angleIndex,
            startIndex,
            requestQuantity: Math.min(maxIdeasPerAngleRequest, effectiveQuantity - startIndex),
            filtersSnapshot: {
              ...sanitizedFilters,
              angle: angle ? [angle] : [],
            } as FilterState,
          };
        })
      );
      const totalRequestedIdeas = anglesToGenerate.length * effectiveQuantity;
      let allData: Array<{ item: GeneratedIdeaApiItem; filtersSnapshot: FilterState }> = [];
      const failedGenerationMessages: string[] = [];
      const getAttemptModel = () => selectedModel || '';
      const maxAttemptsPerAngle = useFastGeneratePath ? 2 : 1;
      const maxConcurrent = Math.min(3, generationTasks.length);
      const buildInRunIdeasSummary = () => {
        if (allData.length === 0) return '';

        return allData.slice(-12).map(({ item }, index) => {
          const hookSummary = item.meta?.hookPrimary
            || item.hook?.textOverlay
            || item.hook?.voice
            || item.hook?.visual
            || item.hook?.script
            || '';
          return `${index + 1}. "${item.title || 'Idea'}" | type="${item.creativeType || ''}" | pain="${item.framework?.painpoint || ''}" | hook="${hookSummary}"`;
        }).join('\n');
      };

      const requestAngleIdeas = async (task: { selectedAngle: string | null; angleIndex: number; startIndex: number; requestQuantity: number; filtersSnapshot: FilterState }) => {
        const collected: GeneratedIdeaApiItem[] = [];
        const collectedKeys = new Set<string>();
        const buildCollectedIdeasSummary = () => collected.map((item, index) => {
          const hookSummary = item.meta?.hookPrimary
            || item.hook?.textOverlay
            || item.hook?.voice
            || item.hook?.visual
            || item.hook?.script
            || '';
          return `${index + 1}. "${item.title || 'Idea'}" | type="${item.creativeType || ''}" | pain="${item.framework?.painpoint || ''}" | hook="${hookSummary}"`;
        }).join('\n');
        const collectUniqueItems = (items: GeneratedIdeaApiItem[]) => {
          let added = 0;
          const duplicateItems: GeneratedIdeaApiItem[] = [];
          for (const item of items) {
            const key = getGeneratedIdeaDedupKey(item);
            if (key && collectedKeys.has(key)) {
              duplicateItems.push(item);
              continue;
            }
            if (key) collectedKeys.add(key);
            collected.push(item);
            added += 1;
            if (collected.length >= task.requestQuantity) break;
          }
          if (useFastGeneratePath && collected.length < task.requestQuantity) {
            for (const item of duplicateItems) {
              collected.push(item);
              added += 1;
              if (collected.length >= task.requestQuantity) break;
            }
          }
          return added;
        };
        const mapCollectedResults = () => collected.slice(0, task.requestQuantity).map(item => ({
          item,
          filtersSnapshot: task.filtersSnapshot,
        }));

        const attemptRequest = async (attempt = 1) => {
          const missingQuantity = Math.max(1, task.requestQuantity - collected.length);
          const attemptModel = getAttemptModel();
          const retryModelLabel = '';
          const retryLabel = attempt > 1 ? ` (thử lại ${attempt}/${maxAttemptsPerAngle}${retryModelLabel})` : '';
          const rangeStart = task.startIndex + collected.length + 1;
          const rangeEnd = task.startIndex + collected.length + missingQuantity;
          setProgressLabel(`Đang tạo angle ${task.angleIndex + 1}/${anglesToGenerate.length}, idea ${rangeStart}-${rangeEnd}/${effectiveQuantity}${retryLabel}...`);

          try {
            const inRunIdeasSummary = buildInRunIdeasSummary();
            const collectedIdeasSummary = buildCollectedIdeasSummary();
            const previousIdeasForRequest = [
              previousIdeasSummary,
              inRunIdeasSummary ? `[IDEAS ALREADY GENERATED THIS RUN - DO NOT REPEAT]\n${inRunIdeasSummary}` : '',
              collectedIdeasSummary ? `[IDEAS ALREADY GENERATED FOR THIS ANGLE - DO NOT REPEAT]\n${collectedIdeasSummary}` : '',
            ].filter(Boolean).join('\n\n');

            const res = await authenticatedFetch('/api/generate-ideas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                appId: app.id,
                appName: app.name,
                appCategory: app.category,
                filters: task.filtersSnapshot,
                config: {
                  quantity: missingQuantity,
                  duration: IDEA_RUNTIME_GUIDANCE,
                  ideaDescription,
                  generationMode: useFastGeneratePath ? 'quick' : generationMode,
                  rawBrief: rawBrief || undefined,
                  visualType: sanitizeVisualTypes(task.filtersSnapshot.visualType || [])[0] || 'UGC',
                  seasonalVisualContext,
                  totalVariations: effectiveQuantity,
                  variationIndex: task.startIndex + collected.length + 1,
                  startIndex: task.startIndex + collected.length,
                  angleIndex: task.angleIndex + 1,
                  totalAngles: anglesToGenerate.length,
                  selectedAngle: task.selectedAngle,
                },
                previousIdeas: previousIdeasForRequest || null,
                selectedModel: attemptModel,
                trendingTopics: trendingTopics.length > 0 ? trendingTopics : null,
                trendingStructures: usableImportedTrendAnalyses.length > 0
                  ? usableImportedTrendAnalyses.map(item => item.promptBooster).filter(Boolean)
                  : null,
              }),
              signal: controller.signal,
            });

            const result = await res.json().catch(() => null) as GenerateIdeasApiResponse | null;
            const aiItems = res.ok && result?.success && Array.isArray(result.data) ? result.data : [];
            const cleanAiItems = aiItems.filter(item => !isLocalFallbackIdea(item));
            if (!res.ok || !result?.success || cleanAiItems.length === 0) {
              const warningDetail = result?.meta?.warnings?.filter(Boolean).slice(0, 2).join(' | ');
              const apiError = result?.error || `Angle ${task.angleIndex + 1} không có idea hợp lệ từ API.`;
              if (warningDetail) throw new Error(`${apiError} ${warningDetail}`);
              throw new Error(result?.error || `Angle ${task.angleIndex + 1} không có idea hợp lệ từ API.`);
            }

            if (result.meta?.warnings?.length) {
              console.warn(`[generate-ideas] Angle ${task.angleIndex + 1} warnings:`, result.meta.warnings);
            }
            if ((result.meta?.fallbackCount || 0) > 0) {
              console.warn(`[generate-ideas] Angle ${task.angleIndex + 1} used ${result.meta?.fallbackCount} fallback ideas.`);
            }

            const addedCount = collectUniqueItems(cleanAiItems);
            if (collected.length >= task.requestQuantity) {
              return mapCollectedResults();
            }

            if (attempt < maxAttemptsPerAngle) {
              if (addedCount === 0) {
                console.warn(`[generate-ideas] Angle ${task.angleIndex + 1} returned only duplicate ideas, refilling.`);
              }
              return attemptRequest(attempt + 1);
            }

            const partialMessage = `Angle ${task.angleIndex + 1} chi gom duoc ${collected.length}/${task.requestQuantity} idea hop le sau ${maxAttemptsPerAngle} luot refill.`;
            failedGenerationMessages.push(partialMessage);
            return mapCollectedResults();
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }

            console.warn(`[generate-ideas] Angle ${task.angleIndex + 1} request failed.`, error);
            if (attempt < maxAttemptsPerAngle) {
              return attemptRequest(attempt + 1);
            }

            if (collected.length > 0) {
              const partialMessage = `Angle ${task.angleIndex + 1} chi gom duoc ${collected.length}/${task.requestQuantity} idea hop le sau ${maxAttemptsPerAngle} luot refill.`;
              failedGenerationMessages.push(partialMessage);
              return mapCollectedResults();
            }

            throw error instanceof Error ? error : new Error(`Angle ${task.angleIndex + 1} request failed.`);
          }
        };

        return attemptRequest();
      };

      for (let start = 0; start < generationTasks.length; start += maxConcurrent) {
        const end = Math.min(start + maxConcurrent, generationTasks.length);
        const briefStart = start + 1;
        const briefEnd = end;
        setProgressLabel(`Đang tạo angle ${briefStart}-${briefEnd}/${generationTasks.length}...`);
        const settledChunk = await Promise.allSettled(
          generationTasks.slice(start, end).map(task => requestAngleIdeas(task))
        );

        const abortFailure = settledChunk.find(item =>
          item.status === 'rejected'
          && item.reason instanceof Error
          && item.reason.name === 'AbortError'
        );
        if (abortFailure?.status === 'rejected') {
          throw abortFailure.reason;
        }

        const chunkData: typeof allData = [];
        for (const item of settledChunk) {
          if (item.status === 'fulfilled') {
            chunkData.push(...item.value);
          } else {
            const message = item.reason instanceof Error
              ? item.reason.message
              : 'Request tạo idea bị lỗi.';
            failedGenerationMessages.push(message);
          }
        }

        allData = [...allData, ...chunkData];
        if (chunkData.length === 0 && settledChunk.length > 0) {
          console.warn('[generate-ideas] Chunk produced no usable ideas.', failedGenerationMessages.slice(-settledChunk.length));
        }
      }

      const result = { success: allData.length > 0, data: allData, error: allData.length === 0 ? 'Không có kết quả' : null };

      const missingIdeasCount = Math.max(0, totalRequestedIdeas - allData.length);
      const recentFailureMessages = Array.from(new Set(failedGenerationMessages.slice(-3))).filter(Boolean);
      const partialNotice = missingIdeasCount > 0
        ? `Đã tạo và lưu ${allData.length}/${totalRequestedIdeas} idea hợp lệ. Còn thiếu ${missingIdeasCount} idea vì API không trả đủ sau refill. ${recentFailureMessages.slice(-2).join(' | ')}`
        : null;

      if (allData.length === 0) {
        const message = `Không tạo được idea hợp lệ nào. ${recentFailureMessages.join(' | ')}`;
        setValidationError(message);
        alert(message);
        stopProgress();
        setIsGenerating(false);
        return;
      }

      let ideas: { title: string; duration: string; content: IdeaContent; filtersSnapshot: FilterState }[];

      if (result.success && result.data?.length > 0) {
        const seenDisplayTitles = new Map<string, number>();
        ideas = result.data.map(({ item, filtersSnapshot }, index) => {
          const angleValues = cleanStrategyValues(filtersSnapshot.angle)
            .map(angle => getStrategyCodeAngleLabel(item, angle, filtersSnapshot));
          const codeFiltersSnapshot = {
            ...filtersSnapshot,
            angle: angleValues,
          } as FilterState;
          const itemStrategyCodeLookup = buildStrategyCodeLookup({
            ...strategyCodeSource,
            angle: mergeStrategySourceValues(strategyCodeSource.angle, angleValues),
          });
          const strategyCode = formatStrategyCodeForFilterGroups(codeFiltersSnapshot, itemStrategyCodeLookup);
          const strategyCodeMap = getStrategyGroupCodeMapRows(codeFiltersSnapshot, itemStrategyCodeLookup);
          const displayTitle = getUniqueGeneratedIdeaTitle(item, index, seenDisplayTitles);

          return {
            title: displayTitle || `Ý tưởng: ${app.name}`,
            duration: item.duration || IDEA_RUNTIME_GUIDANCE,
            filtersSnapshot,
            content: {
              creativeType: item.creativeType || '',
              meta: {
                ...(item.meta || {}),
                generatedId: (item as Record<string, unknown>).id || (item.meta as Record<string, unknown> | undefined)?.generatedId,
                scriptTitle: displayTitle || item.title || (item.meta as Record<string, unknown> | undefined)?.scriptTitle,
                strategyCode,
                strategyCodes: strategyCode ? strategyCode.match(/[A-F]\d+/g) || [strategyCode] : [],
                strategyCodeMap,
              },
              framework: item.framework || { coreUser: '', painpoint: '', emotion: '', psp: '' },
              explanation: item.explanation || '',
              hook: {
              durationSeconds: getHookDurationSeconds(item.hook),
              script: item.hook?.script || item.hook?.visual || '',
              textOverlay: item.hook?.textOverlay || item.hook?.text_overlay || '',
              textOverlayViTranslation: item.hook?.textOverlayViTranslation || item.hook?.text_overlay_vi_translation || item.hook?.textViTranslation || item.hook?.text_vi_translation || '',
              visual: item.hook?.visual || item.hook?.script || '',
              text: item.hook?.textOverlay || item.hook?.text_overlay || item.hook?.text || '',
              characterSpeech: getSectionCharacterSpeech(item.hook),
              voiceover: getSectionVoiceover(item.hook),
              voice: item.hook?.voice || '',
              viTranslation: getSectionViTranslation(item.hook) || '',
            },
            body: {
              script: item.body?.script || item.body?.visual || '',
              textOverlay: item.body?.textOverlay || item.body?.text_overlay || '',
              textOverlayViTranslation: item.body?.textOverlayViTranslation || item.body?.text_overlay_vi_translation || item.body?.textViTranslation || item.body?.text_vi_translation || '',
              visual: item.body?.visual || item.body?.script || '',
              text: item.body?.textOverlay || item.body?.text_overlay || item.body?.text || '',
              characterSpeech: getSectionCharacterSpeech(item.body),
              voiceover: getSectionVoiceover(item.body),
              voice: item.body?.voice || '',
            },
            cta: {
              script: item.cta?.script || item.cta?.visual || '',
              visual: item.cta?.visual || item.cta?.script || '',
              characterSpeech: getSectionCharacterSpeech(item.cta),
              voiceover: getSectionVoiceover(item.cta),
              voice: item.cta?.voice || '',
              text: item.cta?.textOverlay || item.cta?.text_overlay || item.cta?.text || '',
              textOverlay: item.cta?.textOverlay || item.cta?.text_overlay || item.cta?.text || '',
              textOverlayViTranslation: item.cta?.textOverlayViTranslation || item.cta?.text_overlay_vi_translation || item.cta?.textViTranslation || item.cta?.text_vi_translation || '',
              endCard: item.cta?.endCard || item.cta?.end_card || '',
            },
          },
        };
        });
      } else {
        const message = result.error || 'API không trả idea hợp lệ.';
        setValidationError(message);
        alert(message);
        stopProgress();
        setIsGenerating(false);
        return;
      }

      const tempResults: GeneratedIdea[] = ideas.map((idea, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        app_id: app.id,
        title: idea.title,
        duration: idea.duration,
        content: idea.content,
        session_id: null,
        filters_snapshot: idea.filtersSnapshot,
        result: null,
        created_at: new Date().toISOString(),
      }));

      setShowHistory(false);
      setHistoryWeekFilter(HISTORY_TODAY);
      setResults(tempResults);
      setSavedHistory(prev => [...tempResults, ...prev]);
      writeUnsavedIdeaBackup(app.id, tempResults);
      setGenerationNotice(partialNotice);
      setIdeaSaveStatus('saving');
      setIdeaSaveMessage(`Đang lưu ${ideas.length} idea vào Supabase...`);
      stopProgress();
      setIsGenerating(false);
      if (currentScreen !== 'f2.1.2') setScreen('f2.1.2');

      const sessionId = crypto.randomUUID();
      let saved: GeneratedIdea[] = [];
      try {
        const saveResponse = await authenticatedFetch('/api/save-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: app.id,
            ideas,
            sessionId,
            filtersSnapshot: generationBaseFilters,
          }),
        });
        const saveResult = await saveResponse.json().catch(() => null) as SaveIdeasApiResponse | null;
        if (!saveResponse.ok || !saveResult?.success || !Array.isArray(saveResult.data) || saveResult.data.length === 0) {
          throw new Error(saveResult?.error || 'Không insert được generated_ideas.');
        }
        saved = saveResult.data;
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : 'Unknown save error';
        setIdeaSaveStatus('error');
        setIdeaSaveMessage(`Lưu Supabase lỗi: ${message}`);
        alert(`Tạo idea xong nhưng lưu database thất bại: ${message}. Kết quả tạm vẫn đang hiển thị, hãy copy trước khi refresh.`);
        return;
      }

      setIdeaSaveStatus('saved');
      setIdeaSaveMessage(`Đã lưu Supabase (${saved.length}/${ideas.length})`);

      const liveFavoriteKeys = loadFavoriteKeys(app.id);
      const savedWithFavoriteMeta = saved.map(idea => {
        if (!hasFavoriteIdeaKey(app.id, idea, liveFavoriteKeys)) return idea;
        const keys = buildIdeaFavoriteKeys(app.id, idea);
        return {
          ...idea,
          content: {
            ...idea.content,
            meta: {
              ...(idea.content?.meta || {}),
              isFavorite: true,
              favoriteKeys: keys,
              favoriteMarkedAt: new Date().toISOString(),
            },
          },
        };
      });

      const tempIds = new Set(tempResults.map(t => t.id));
      setResults(prev => [...savedWithFavoriteMeta, ...prev.filter(r => !tempIds.has(r.id))]);
      setSavedHistory(prev => [...savedWithFavoriteMeta, ...prev.filter(r => !tempIds.has(r.id))]);
      clearUnsavedIdeaBackup(app.id);
      savedWithFavoriteMeta
        .filter(idea => idea.content?.meta?.isFavorite)
        .forEach(idea => {
          void dbService.updateIdeaFavorite(app.id, idea, true, buildIdeaFavoriteKeys(app.id, idea));
        });

      void (async () => {
        try {
          const response = await authenticatedFetch('/api/learn-app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: app.id,
              appName: app.name,
              appCategory: app.category,
              sessionId,
              existingKnowledge: app.app_knowledge || '',
            }),
          });

          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'Background learning failed');
          }
          if (data.knowledge && onAppKnowledgeUpdated) {
            onAppKnowledgeUpdated(data.knowledge);
          }
        } catch (learnError) {
          console.warn('Background learning failed:', learnError);
        }
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error && err.message
        ? err.message
        : 'Có lỗi khi tạo ý tưởng. Vui lòng thử lại.';
      console.warn('[generate-ideas] handled client failure:', message);
      setValidationError(message);
      alert(message);
      stopProgress();
      setIsGenerating(false);
    }
  };


  /* Legacy copy helper retained during transition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = idea.content as any;
    const fw = c.framework;
    const meta = c.meta || {};
    const hookVisual = c.hook?.visual || c.hook?.script || '';
    const bodyVisual = c.body?.visual || c.body?.script || '';
    const ctaVisual = c.cta?.visual || c.cta?.script || '';
    const hookVariantsBlock = [meta?.hookPrimary, meta?.hookAlt1, meta?.hookAlt2].some(Boolean)
      ? `\n🧠 BIẾN THỂ HOOK\n[CHÍNH] ${meta?.hookPrimary || ''}\n[PHỤ 1] ${meta?.hookAlt1 || ''}\n[PHỤ 2] ${meta?.hookAlt2 || ''}\n`
      : '';
    const copyText = `TIÊU ĐỀ: ${idea.title}\n\n═══ KHUNG Ý TƯỞNG ═══\n👤 Người dùng chính: ${fw?.coreUser || ''}\n💔 Nỗi đau: ${fw?.painpoint || ''}\n😱 Cảm xúc: ${fw?.emotion || ''}\n💊 PSP: ${fw?.psp || ''}\n\nLÝ DO HIỆU QUẢ: ${c.explanation}\n\n═══ KỊCH BẢN VIDEO ═══\n\n🎣 HOOK\n[BỐI CẢNH] ${hookVisual}\n[LỜI THOẠI] ${c.hook?.voice || ''}\n[CHỮ TRÊN MÀN HÌNH] ${c.hook?.textOverlay || c.hook?.text || ''}\n\n📖 BODY\n[BỐI CẢNH] ${bodyVisual}\n[LỜI THOẠI] ${c.body?.voice || ''}\n[CHỮ TRÊN MÀN HÌNH] ${c.body?.textOverlay || c.body?.text || ''}\n\n🔥 CTA\n[BỐI CẢNH] ${ctaVisual}\n[LỜI THOẠI] ${c.cta?.voice || ''}\n[CHỮ TRÊN MÀN HÌNH] ${c.cta?.textOverlay || c.cta?.text || ''}\nMàn hình kết: ${c.cta?.endCard || ''}`;
    const finalCopyText = hookVariantsBlock
      ? copyText.replace('═══ KỊCH BẢN VIDEO ═══\n\n', `═══ KỊCH BẢN VIDEO ═══\n${hookVariantsBlock}\n`)
      : copyText;
    navigator.clipboard.writeText(finalCopyText);
  };

  */
  const getReadableScriptLabel = (idea: GeneratedIdea, fallbackIndex?: number) => {
    const content = idea.content as IdeaContent;
    const meta = (content.meta || {}) as NonNullable<IdeaContent['meta']> & Record<string, unknown>;
    const sourceId = String(meta.generatedId || meta.id || '');
    const scriptIndex = sourceId.match(/A(\d+)-I(\d+)/);
    const rawTitle = String(meta.scriptTitle || idea.title || 'Tên kịch bản');
    const title = rawTitle.replace(/^Kịch bản\s+\d+(?:\.\d+)?:\s*/i, '').trim() || rawTitle;

    if (scriptIndex) {
      return `Kịch bản ${Number(scriptIndex[1]) + 1}.${Number(scriptIndex[2]) + 1}: ${title}`;
    }

    if (typeof fallbackIndex === 'number') {
      return `Kịch bản ${fallbackIndex + 1}: ${title}`;
    }

    return `Kịch bản: ${title}`;
  };

  const handleCopy = (idea: GeneratedIdea) => {
    {
    const content = idea.content as IdeaContent;
    const framework = content.framework || {};
    const meta = (content.meta || {}) as NonNullable<IdeaContent['meta']> & Record<string, unknown>;
    const hookSpeech = getSectionSpokenLines(content.hook);
    const bodySpeech = getSectionSpokenLines(content.body);
    const ctaSpeech = getSectionSpokenLines(content.cta);
    const hookVisual = normalizeHookTimingLabel(cleanVisualForDisplay(content.hook?.visual || content.hook?.script || ''));
    const bodyVisual = cleanVisualForDisplay(content.body?.visual || content.body?.script || '');
    const ctaVisual = cleanVisualForDisplay(content.cta?.visual || content.cta?.script || '');
    const hookSpeechInline = visualContainsSpokenLine(hookVisual, hookSpeech.characterSpeech);
    const bodySpeechInline = visualContainsSpokenLine(bodyVisual, bodySpeech.characterSpeech);
    const ctaSpeechInline = visualContainsSpokenLine(ctaVisual, ctaSpeech.characterSpeech);
    const hookText = content.hook?.textOverlay || content.hook?.text || meta.hookPrimary || '';
    const hookVoiceVi = getSectionViTranslation(content.hook);
    const bodyText = content.body?.textOverlay || content.body?.text || '';
    const ctaText = content.cta?.textOverlay || content.cta?.text || content.cta?.voice || '';
    const angleName = String(meta.angleName || meta.referencePattern || 'Góc khai thác');
    const angleType = String(meta.angleType || content.creativeType || '');
    const angleDesc = String(meta.angleDesc || content.explanation || '');
    const scriptIndex = String(idea.id || '').match(/A(\d+)-I(\d+)/);
    const readableScriptLabel = getReadableScriptLabel(idea);
    const { strategyCode, strategyCodeMap } = getEffectiveStrategyCodeMeta(idea);
    const scriptLabel = scriptIndex
      ? `Kịch bản ${Number(scriptIndex[1]) + 1}.${Number(scriptIndex[2]) + 1}: ${idea.title}`
      : `Kịch bản: ${idea.title}`;
    void scriptLabel;
    const hookVariants = [
      meta.hookPrimary ? `[Chính] ${meta.hookPrimary}` : '',
      meta.hookAlt1 ? `[Phụ 1] ${meta.hookAlt1}` : '',
      meta.hookAlt2 ? `[Phụ 2] ${meta.hookAlt2}` : '',
    ].filter(Boolean).join('\n');
    const hookVisualIncludesCopy = /\btext\s+hien\b|\bvoiceover\b/.test(normalizeCompareText(hookVisual));
    const finalCtaText = ctaText || ctaSpeech.voiceover || content.cta?.endCard || '';
    const selectedInputLines = getResultInputChips(idea, content).map(chip => `${chip.label}: ${chip.value}`);
    const productionDetailLines = [
      { label: 'Scene family', value: meta.sceneFamily },
      { label: 'Character visual - ngoại hình', value: meta.characterVisual || meta.talentProfile },
      { label: 'Insight quốc gia', value: meta.countryVisualInsight || meta.marketInsight },
      { label: 'Bối cảnh hook', value: meta.hookContextInsight },
      { label: 'Góc camera hook', value: meta.cameraPlan },
      { label: 'Visual ref hook', value: meta.visualRefNotes },
      { label: 'Không làm', value: meta.dontDo },
    ]
      .map(item => {
        const value = cleanPreviewText(item.value);
        return value ? `${item.label}: ${value}` : '';
      })
      .filter(Boolean);

    const readableText = [
      'INPUT DA CHON',
      ...selectedInputLines,
      '',
      'TÌNH HUỐNG GỐC (PAIN POINT)',
      framework.painpoint || '',
      '',
      `ANGLE: ${angleName}${angleType ? ` (${angleType})` : ''}`,
      angleDesc ? `Mục tiêu: ${angleDesc}` : '',
      '',
      readableScriptLabel,
      strategyCode ? `Mã chiến lược: ${strategyCode}` : '',
      strategyCodeMap.length > 0 ? `Map: ${strategyCodeMap.join(' | ')}` : '',
      '',
      'Hook (5s đầu):',
      hookVisual || '',
      ...productionDetailLines,
      hookVoiceVi ? `[DỊCH HOOK VOICE] ${hookVoiceVi}` : '',
      hookText && !hookVisualIncludesCopy ? `Text hiện: "${hookText}"` : '',
      content.hook?.textOverlayViTranslation ? `Dịch text hiện: "${content.hook.textOverlayViTranslation}"` : '',
      hookSpeech.characterSpeech && !hookSpeechInline ? `Lời nhân vật: "${cleanSpeakerLabelsForDisplay(hookSpeech.characterSpeech)}"` : '',
      hookVariants ? `Biến thể hook:\n${hookVariants}` : '',
      '',
      bodyVisual ? `Diễn biến (Body): ${bodyVisual}` : 'Diễn biến (Body):',
      bodyText ? `Text body: "${bodyText}"` : '',
      bodySpeech.characterSpeech && !bodySpeechInline ? `Lời nhân vật: "${cleanSpeakerLabelsForDisplay(bodySpeech.characterSpeech)}"` : '',
      '',
      finalCtaText ? `Kêu gọi hành động (CTA): ${finalCtaText}` : 'Kêu gọi hành động (CTA):',
      ctaVisual ? `Visual CTA: ${ctaVisual}` : '',
      ctaSpeech.characterSpeech && !ctaSpeechInline ? `Lời nhân vật CTA: "${cleanSpeakerLabelsForDisplay(ctaSpeech.characterSpeech)}"` : '',
      content.cta?.endCard && content.cta.endCard !== finalCtaText ? `Màn hình kết: ${content.cta.endCard}` : '',
    ].filter(line => String(line).trim()).join('\n');

    navigator.clipboard.writeText(readableText);
    return;
    }

/*
    const content = idea.content as IdeaContent;
    const framework = content.framework;
    const meta = content.meta;
    const isBuilderIdea = isBuilderIdeaContent(content);
    const hookVisual = normalizeHookTimingLabel(content.hook?.visual || content.hook?.script || '');
    const bodyVisual = content.body?.visual || content.body?.script || '';
    const ctaVisual = content.cta?.visual || content.cta?.script || '';
    const hookSpeech = getSectionSpokenLines(content.hook);
    const bodySpeech = getSectionSpokenLines(content.body);
    const ctaSpeech = getSectionSpokenLines(content.cta);
    const primaryHook = meta?.hookPrimary || '';
    const buildCopySection = (
      label: string,
      visual: string,
      speech: { characterSpeech?: string; voiceover?: string; legacyVoice?: string },
      textOverlay: string,
      endCard = ''
    ) => [
      label,
      visual ? `[VISUAL] ${visual}` : '',
      speech.characterSpeech ? `[CHARACTER SPEECH] ${speech.characterSpeech}` : '',
      speech.voiceover ? `[VOICE VIDEO] ${speech.voiceover}` : '',
      speech.legacyVoice ? `[VOICE] ${speech.legacyVoice}` : '',
      textOverlay ? `[TEXT OVERLAY] ${textOverlay}` : '',
      endCard ? `End card: ${endCard}` : '',
    ].filter(Boolean);
    const sections = [
      `TITLE: ${idea.title}`,
      '═══ KHUNG Ý TƯỞNG ═══',
      `Người dùng chính: ${framework?.coreUser || ''}`,
      `Nỗi đau: ${framework?.painpoint || ''}`,
      `Cảm xúc: ${framework?.emotion || ''}`,
      `PSP: ${framework?.psp || ''}`,
      '',
      `LÝ DO HIỆU QUẢ: ${content.explanation || ''}`,
      '',
      '═══ KỊCH BẢN VIDEO ═══',
      ...(primaryHook
        ? [
            `HOOK: ${primaryHook}`,
            '',
          ]
        : []),
      ...buildCopySection(
        `HOOK (${isBuilderIdea ? 3 : getHookDurationSeconds(content.hook)}s)`,
        hookVisual,
        hookSpeech,
        content.hook?.textOverlay || content.hook?.text || '',
        ''
      ),
      '',
      ...buildCopySection(
        'BODY (10-25s)',
        bodyVisual,
        bodySpeech,
        content.body?.textOverlay || content.body?.text || '',
        ''
      ),
      '',
      ...buildCopySection(
        'CTA',
        ctaVisual,
        ctaSpeech,
        content.cta?.textOverlay || content.cta?.text || '',
        content.cta?.endCard || ''
      ),
    ];

    navigator.clipboard.writeText(sections.join('\n'));
*/
  };
  const cleanPreviewText = (value: unknown) => {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !normalized
      || /^(?:n\/a|na|none|null|empty|blank|no speech|no narrator|no voice|no talent|khong co|-)$/.test(normalized)
    ) {
      return '';
    }
    return text;
  };

  const cleanSpeakerLabelsForDisplay = (value: unknown) => cleanPreviewText(value)
    .replace(/\[\s*Speaker\s*([12])\s*\]\s*:?\s*/gi, '')
    .replace(/\bSpeaker\s*[12]\s*:\s*/gi, '')
    .replace(/\bSpeaker\s*[12]\b/gi, 'Nhân vật');

  const cleanVisualForDisplay = (value: unknown) => {
    if (typeof value !== 'string') return '';
    return value
      .replace(/^\s*\[(?:VOICE|VOICE VIDEO|VOICEOVER|DỊCH HOOK VOICE|DICH HOOK VOICE)\][^\r\n]*(?:\r?\n|$)/gim, '')
      .replace(/^\s*\[(?:TEXT OVERLAY)\][^\r\n]*(?:\r?\n|$)/gim, '')
      .replace(/\[(?:CHARACTER SPEECH)\]\s*/gi, '')
      .replace(/\[(?:TEXT OVERLAY)\][^[]*$/gim, '')
      .replace(/\[(?:VOICE|VOICE VIDEO|VOICEOVER|DỊCH HOOK VOICE|DICH HOOK VOICE)\][^[]*$/gim, '')
      .replace(/\bSpeaker\s*[12]\s*:/gi, '')
      .replace(/\bSpeaker\s*[12]\b/gi, 'Nhân vật')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const listFilterValues = (snapshot: FilterState | null | undefined, key: string, fallback: unknown = '') => {
    const values = Array.isArray(snapshot?.[key])
      ? (snapshot?.[key] || [])
      : [];
    const cleaned = values
      .map(value => cleanPreviewText(value))
      .filter(Boolean);
    const fallbackText = cleanPreviewText(fallback);
    return cleaned.length > 0 ? cleaned : (fallbackText ? [fallbackText] : []);
  };

  const getResultInputChips = (idea: GeneratedIdea, content: Partial<IdeaContent> | Record<string, unknown>) => {
    const framework = ((content as IdeaContent).framework || {}) as Partial<IdeaContent['framework']>;
    const meta = ((content as IdeaContent).meta || {}) as NonNullable<IdeaContent['meta']> & Record<string, unknown>;
    const snapshot = idea.filters_snapshot || null;
    const strategyCodeMapRows = getEffectiveStrategyCodeMeta(idea).strategyCodeMap
      .map(item => cleanPreviewText(item))
      .filter(Boolean);
    const mappedAngle = strategyCodeMapRows
      .find(row => /^\s*F\d+\s*=/.test(row))
      ?.replace(/^\s*F\d+\s*=\s*Angle:\s*/i, '');
    const angleFallback = Array.from(new Set([
      meta.angleName,
      meta.angleDesc,
      meta.referencePattern,
      meta.angleType,
      mappedAngle,
    ].map(value => cleanPreviewText(value)).filter(Boolean))).join(' - ');
    const chips = [
      { key: 'coreUser', label: 'Viewer', values: listFilterValues(snapshot, 'coreUser', framework.coreUser), className: 'bg-blue-50 text-blue-600' },
      { key: 'angle', label: 'Angle', values: listFilterValues(snapshot, 'angle', angleFallback), className: 'bg-teal-50 text-teal-600' },
      { key: 'emotion', label: 'Emotion', values: listFilterValues(snapshot, 'emotion', framework.emotion), className: 'bg-rose-50 text-rose-600' },
      { key: 'visualType', label: 'Visual', values: listFilterValues(snapshot, 'visualType', (content as IdeaContent).creativeType), className: 'bg-indigo-50 text-indigo-600' },
      { key: 'painPoint', label: 'Pain', values: listFilterValues(snapshot, 'painPoint', framework.painpoint), className: 'bg-red-50 text-red-600' },
      { key: 'solution', label: 'PSP', values: shouldHidePspForApp(app) ? [] : listFilterValues(snapshot, 'solution', framework.psp), className: 'bg-emerald-50 text-emerald-600' },
      { key: 'videoStructure', label: 'Structure', values: listFilterValues(snapshot, 'videoStructure'), className: 'bg-violet-50 text-violet-600' },
      { key: 'targetMarket', label: 'Market', values: listFilterValues(snapshot, 'targetMarket'), className: 'bg-sky-50 text-sky-600' },
    ];

    return chips
      .filter(chip => chip.values.length > 0)
      .map(chip => ({
        ...chip,
        value: chip.values.join(' + '),
      }));
  };

  const getSectionCharacterSpeech = (section: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']> | IdeaApiSection | Record<string, unknown> | undefined): string => {
    const raw = (section || {}) as Record<string, unknown> & IdeaApiSection;
    return cleanPreviewText(raw.characterSpeech ?? raw.character_speech ?? raw.talentSpeech ?? raw.talent_speech);
  };

  const getSectionVoiceover = (section: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']> | IdeaApiSection | Record<string, unknown> | undefined): string => {
    const raw = (section || {}) as Record<string, unknown> & IdeaApiSection;
    return cleanPreviewText(raw.voiceover ?? raw.voiceOver ?? raw.voice_over);
  };

  const getSectionLegacyVoice = (section: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']> | IdeaApiSection | Record<string, unknown> | undefined): string => {
    const raw = (section || {}) as Record<string, unknown>;
    const voice = cleanPreviewText(raw.voice);
    const characterSpeech = getSectionCharacterSpeech(raw);
    const voiceover = getSectionVoiceover(raw);
    return voice && voice !== characterSpeech && voice !== voiceover ? voice : '';
  };

  const isProbablyEnglishHookLine = (value: string) => {
    const normalized = normalizeCompareText(value);
    const englishTokens = normalized.match(/\b(?:i|im|my|me|you|your|the|this|that|with|without|because|every|again|just|why|what|when|where|how|does|did|was|were|from|into|while|before|after|thought|started|changed|checked|check|phone|heart|rate|blood|pressure|number|scary|calm|alone|nervous)\b/g) || [];
    const vietnameseTokens = normalized.match(/\b(?:toi|minh|ban|nguoi|khong|co|la|nay|do|voi|vi|luc|khi|da|kiem|tra|huyet|ap|nhip|tim|con|so|lo|lang|dang|so|binh|tinh|dien|thoai)\b/g) || [];
    return englishTokens.length >= 3 && englishTokens.length > vietnameseTokens.length;
  };

  const isProbablyUntranslatedHookLine = (value: string) => {
    const normalized = normalizeCompareText(value);
    const foreignTokens = normalized.match(/\b(?:speaker|perdeu|foto|viagem|memoria|cheia|camara|telemovel|espaco|proxima|duplicados|desfocados|lixo|limpa|quando|espera|travou|ficheiros|recupera|fotografar|sem|para|comecar|esta|estao|voce|uma|the|you|your|camera|storage|photo|video|clean|duplicate|blurred|trash|cuando|llena|viaje|espacio|siguiente|basura)\b/g) || [];
    const vietnameseTokens = normalized.match(/\b(?:toi|minh|ban|nguoi|anh|chi|ong|ba|khong|co|la|nay|do|voi|vi|luc|khi|da|kiem|tra|dien|thoai|ngay|mot|bo|lo|nho|day|don|dep|rac|chuyen|di)\b/g) || [];
    return foreignTokens.length >= 2 && foreignTokens.length > vietnameseTokens.length;
  };

  const isProbablyCorruptHookLine = (value: string) => {
    return /(?:\?{2,}|�|Ã|Ä|Æ|áº|á»|Ng\?\?i|ng\?\?i)/.test(value);
  };

  const hasVietnameseDiacritics = (value: string) => {
    return /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(value);
  };

  const isProbablyVietnameseHookLine = (value: string) => {
    return hasVietnameseDiacritics(value);
  };

  const isPainpointExplanationInsteadOfVoiceTranslation = (value: string) => {
    const normalized = normalizeCompareText(value);
    return /^(?:giu dung|van giu|cho thay|demo|keu goi|mo theo huong)\b/.test(normalized)
      || /\b(?:painpoint|pain point|noi dau)\b.*\b(?:angle|demo|giai quyet|nguoi xem|mo bang|tro nen cu the)\b/.test(normalized);
  };

  const getSectionViTranslation = (section: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']> | IdeaApiSection | Record<string, unknown> | undefined): string => {
    const raw = (section || {}) as Record<string, unknown> & IdeaApiSection;
    const candidates = [
      raw.hookVoiceVi,
      raw.hook_voice_vi,
      raw.viTranslation,
      raw.vi_translation,
      raw.vietnameseTranslation,
      raw.vietnamese_translation,
    ].map(value => cleanPreviewText(value)).filter(Boolean);

    const spokenSource = [
      getSectionCharacterSpeech(raw),
      getSectionVoiceover(raw),
      getSectionLegacyVoice(raw),
    ].filter(Boolean).join(' / ');

    for (const text of candidates) {
      if (spokenSource && normalizeCompareText(text) === normalizeCompareText(spokenSource)) continue;
      if (isProbablyCorruptHookLine(text)) continue;
      if (isProbablyEnglishHookLine(text)) continue;
      if (isProbablyUntranslatedHookLine(text)) continue;
      if (isPainpointExplanationInsteadOfVoiceTranslation(text)) continue;
      if (!isProbablyVietnameseHookLine(text)) continue;
      return text;
    }

    return '';
  };

  const getSectionSpokenLines = (section: Partial<IdeaContent['hook']> | Partial<IdeaContent['body']> | Partial<IdeaContent['cta']> | IdeaApiSection | Record<string, unknown> | undefined) => {
    const characterSpeech = getSectionCharacterSpeech(section);
    const voiceover = getSectionVoiceover(section);
    const legacyVoice = getSectionLegacyVoice(section);
    return {
      characterSpeech,
      voiceover: voiceover || (!characterSpeech ? legacyVoice : ''),
      legacyVoice: characterSpeech ? legacyVoice : '',
    };
  };

  const stripSpeechTimingForCompare = (value: string) => cleanPreviewText(value)
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*s\s*[-:]\s*[^:]{2,80}:\s*/i, '')
      .replace(/^\s*[^:]{2,80}:\s*/i, '')
      .replace(/^["']|["']$/g, '')
      .trim())
    .filter(Boolean)
    .join(' ');

  const visualContainsSpokenLine = (visual: string, speech: string) => {
    const speechText = stripSpeechTimingForCompare(speech);
    if (!speechText) return false;
    const normalizedVisual = normalizeCompareText(visual);
    const normalizedSpeech = normalizeCompareText(speechText);
    if (!normalizedVisual || !normalizedSpeech) return false;
    if (normalizedVisual.includes(normalizedSpeech)) return true;
    const speechTokens = normalizedSpeech.split(/\s+/).filter(Boolean);
    return speechTokens.length > 3 && speechTokens.slice(0, 8).every(token => normalizedVisual.includes(token));
  };

  const mergeRefinedSection = (
    originalSection: IdeaContent['hook'] | IdeaContent['body'] | IdeaContent['cta'] | undefined,
    refinedSection: IdeaApiSection | undefined,
    sectionKey: 'hook' | 'body' | 'cta'
  ) => {
    const originalRaw = (originalSection || {}) as Record<string, unknown>;
    if (!refinedSection) return originalSection;

    const refinedRaw = refinedSection as Record<string, unknown>;
    const pickText = (raw: Record<string, unknown>, keys: string[]) => {
      for (const key of keys) {
        const value = cleanPreviewText(raw[key]);
        if (value) return value;
      }
      return '';
    };

    const refinedVisual = pickText(refinedRaw, ['visual', 'script']);
    const originalVisual = pickText(originalRaw, ['visual', 'script']);
    const refinedTextOverlay = pickText(refinedRaw, ['textOverlay', 'text_overlay', 'text']);
    const refinedCharacterSpeech = getSectionCharacterSpeech(refinedRaw);
    const refinedVoiceover = getSectionVoiceover(refinedRaw);
    const refinedVoice = cleanPreviewText(refinedRaw.voice);
    const hasRefinedContent = Boolean(refinedVisual || refinedTextOverlay || refinedCharacterSpeech || refinedVoiceover || refinedVoice);

    const next: Record<string, unknown> = { ...originalRaw };
    Object.entries(refinedRaw).forEach(([key, value]) => {
      if (typeof value === 'string') {
        const cleaned = cleanPreviewText(value);
        if (cleaned) next[key] = cleaned;
        return;
      }
      if (value !== undefined && value !== null) next[key] = value;
    });

    const visual = refinedVisual || originalVisual;
    if (visual) {
      next.visual = visual;
      next.script = pickText(refinedRaw, ['script', 'visual']) || pickText(originalRaw, ['script', 'visual']) || visual;
    }

    const textOverlay = refinedTextOverlay || pickText(originalRaw, ['textOverlay', 'text']);
    if (textOverlay) {
      next.textOverlay = textOverlay;
      next.text = textOverlay;
    }

    const characterSpeech = refinedCharacterSpeech || pickText(originalRaw, ['characterSpeech', 'character_speech', 'talentSpeech', 'talent_speech']);
    if (characterSpeech) next.characterSpeech = characterSpeech;

    const voiceover = refinedVoiceover || pickText(originalRaw, ['voiceover', 'voiceOver', 'voice_over']);
    if (voiceover) next.voiceover = voiceover;

    const voice = refinedVoice || voiceover || characterSpeech || pickText(originalRaw, ['voice']);
    if (voice) next.voice = voice;

    const viTranslation = pickText(refinedRaw, ['viTranslation', 'vi_translation', 'vietnameseTranslation', 'vietnamese_translation', 'hookVoiceVi', 'hook_voice_vi'])
      || pickText(originalRaw, ['viTranslation', 'vi_translation']);
    if (viTranslation) next.viTranslation = viTranslation;

    if (sectionKey === 'hook') {
      next.durationSeconds = hasRefinedContent
        ? getHookDurationSeconds(next as IdeaApiSection)
        : getHookDurationSeconds(originalRaw as IdeaApiSection);
      ['viewerProfile', 'viewerEmotion', 'painpointImpact', 'whyTheyStopScrolling'].forEach(key => {
        const value = pickText(refinedRaw, [key]) || pickText(originalRaw, [key]);
        if (value) next[key] = value;
      });
      return next as IdeaContent['hook'];
    }

    if (sectionKey === 'cta') {
      const endCard = pickText(refinedRaw, ['endCard', 'end_card']) || pickText(originalRaw, ['endCard', 'end_card']);
      if (endCard) next.endCard = endCard;
      return next as IdeaContent['cta'];
    }

    return next as IdeaContent['body'];
  };

  const isBuilderIdeaContent = (content: unknown) => {
    const meta = ((content as IdeaContent | undefined)?.meta || {}) as Record<string, unknown>;
    return cleanPreviewText(meta.builderVersion).toLowerCase() === 'prompt_system_builder_html_v1';
  };

  const normalizeHookTimingLabel = (value: string) => value;

  const getHookDurationSeconds = (hook: Partial<IdeaContent['hook']> | IdeaApiSection | Record<string, unknown> | undefined): number => {
    const rawHook = (hook || {}) as Record<string, unknown> & IdeaApiSection;
    const rawTimingSource = String(rawHook.visual ?? rawHook.script ?? rawHook.textOverlay ?? rawHook.text ?? '');
    const timingSource = cleanPreviewText(rawTimingSource);
    const explicitRanges = Array.from(rawTimingSource.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*(\d+(?:[.,]\d+)?)\s*s?/gi))
      .map(match => Number(match[2].replace(',', '.')))
      .filter(value => Number.isFinite(value));
    const explicitDuration = explicitRanges.length ? Math.max(...explicitRanges) : NaN;
    if (Number.isFinite(explicitDuration) && explicitDuration >= 3 && explicitDuration <= 30) {
      return Math.round(explicitDuration);
    }
    if (
      /\b(?:sec\s*)?0\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*5\s*s?\b/i.test(rawTimingSource)
      || /\b0\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*1[.,]?5\s*s?\b/i.test(rawTimingSource)
      || /\b3[.,]?5\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*5\s*s?\b/i.test(rawTimingSource)
    ) {
      return 5;
    }
    if (/\b0\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*3(?:\s*\/\s*3)?\s*s?\b/i.test(timingSource)) {
      return 3;
    }
    const rawDuration = rawHook.durationSeconds ?? rawHook.duration_seconds ?? rawHook.hookDurationSeconds ?? rawHook.hook_duration_seconds;
    const parsedDuration = typeof rawDuration === 'number'
      ? rawDuration
      : typeof rawDuration === 'string'
        ? Number(rawDuration.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'))
        : NaN;
    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      return Math.min(12, Math.max(3, Math.round(parsedDuration)));
    }

    const characterSpeech = getSectionCharacterSpeech(rawHook);
    const voiceover = getSectionVoiceover(rawHook);
    const voice = cleanPreviewText(rawHook.voice);
    const textOverlay = cleanPreviewText(rawHook.textOverlay ?? rawHook.text_overlay ?? rawHook.text);
    const visual = cleanPreviewText(rawHook.visual ?? rawHook.script);
    const timingText = [characterSpeech, voiceover || voice, textOverlay].filter(Boolean).join(' ') || visual;
    const words = timingText.split(/\s+/).map(word => word.trim()).filter(Boolean).length;
    if (words === 0) return 8;
    const hasSpokenHook = Boolean(characterSpeech || voiceover || voice || textOverlay);
    return Math.min(12, Math.max(6, Math.ceil(hasSpokenHook ? 2 + words / 2.8 : 4 + words / 5.2)));
  };

  const toggleIdeaSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string
  ) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startEditIdea = (idea: GeneratedIdea) => {
    setEditingIdea(idea.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = idea.content as any;
    setEditBuffer({
      title: idea.title || '',
      explanation: c.explanation || '',
      hook: { durationSeconds: getHookDurationSeconds(c.hook), script: c.hook?.script || '', textOverlay: c.hook?.textOverlay || '', textOverlayViTranslation: c.hook?.textOverlayViTranslation || '', visual: c.hook?.visual || '', text: c.hook?.text || '', characterSpeech: getSectionCharacterSpeech(c.hook), voiceover: getSectionVoiceover(c.hook), voice: c.hook?.voice || '' },
      body: { script: c.body?.script || '', textOverlay: c.body?.textOverlay || '', textOverlayViTranslation: c.body?.textOverlayViTranslation || '', visual: c.body?.visual || '', text: c.body?.text || '', characterSpeech: getSectionCharacterSpeech(c.body), voiceover: getSectionVoiceover(c.body), voice: c.body?.voice || '' },
      cta: { script: c.cta?.script || '', visual: c.cta?.visual || '', characterSpeech: getSectionCharacterSpeech(c.cta), voiceover: getSectionVoiceover(c.cta), voice: c.cta?.voice || '', text: c.cta?.text || '', textOverlay: c.cta?.textOverlay || '', textOverlayViTranslation: c.cta?.textOverlayViTranslation || '', endCard: c.cta?.endCard || '' },
    });
  };

  const saveEditIdea = async (idea: GeneratedIdea) => {
    if (!editBuffer) return;
    const normalizeEditedSection = (section: Record<string, unknown>) => ({
      ...section,
      voice: cleanPreviewText(section.voice) || cleanPreviewText(section.voiceover) || cleanPreviewText(section.characterSpeech),
    });
    const newContent: IdeaContent = {
      ...idea.content,
      explanation: editBuffer.explanation,
      hook: { ...normalizeEditedSection(editBuffer.hook), durationSeconds: getHookDurationSeconds(editBuffer.hook) } as IdeaContent['hook'],
      body: normalizeEditedSection(editBuffer.body) as IdeaContent['body'],
      cta: normalizeEditedSection(editBuffer.cta) as IdeaContent['cta'],
    };
    await dbService.updateIdeaContent(idea.id, editBuffer.title, newContent);
    // Update local state
    const updater = (list: GeneratedIdea[]) => list.map(i => i.id === idea.id ? { ...i, title: editBuffer.title, content: newContent } : i);
    setResults(updater);
    setSavedHistory(updater);
    setEditingIdea(null);
    setEditBuffer(null);
  };

  const handleDeleteIdea = async (idea: GeneratedIdea, ideaKey: string) => {
    const ok = window.confirm(`Xóa idea "${idea.title}" khỏi lịch sử? Hành động này không hoàn tác.`);
    if (!ok) return;

    if (!idea.id.startsWith('temp-')) {
      const response = await authenticatedFetch('/api/delete-idea', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaId: idea.id, appId: app.id }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        alert(payload?.error || 'Xóa idea thất bại. Vui lòng thử lại.');
        return;
      }
    }

    const removeIdea = (list: GeneratedIdea[]) => list.filter(item => item.id !== idea.id);
    setResults(removeIdea);
    setSavedHistory(removeIdea);
    setFavoriteIdeas(prev => {
      const next = new Set(prev);
      getAllIdeaFavoriteKeys(idea).forEach(key => next.delete(key));
      return next;
    });
    setExpandedIdeas(prev => {
      const next = new Set(prev);
      next.delete(ideaKey);
      return next;
    });
    if (editingIdea === idea.id) {
      setEditingIdea(null);
      setEditBuffer(null);
    }
    if (refiningIdea === idea.id) {
      setRefiningIdea(null);
      setRefineInstruction('');
    }
  };

  const patchIdeaFavoriteMeta = useCallback((ideaId: string, isFavorite: boolean, favoriteKeys: string[]) => {
    const patch = (list: GeneratedIdea[]) => list.map(item => {
      if (item.id !== ideaId) return item;
      return {
        ...item,
        content: {
          ...item.content,
          meta: {
            ...(item.content?.meta || {}),
            isFavorite,
            favoriteKeys: isFavorite ? favoriteKeys : [],
            favoriteMarkedAt: isFavorite ? new Date().toISOString() : null,
          },
        },
      };
    });

    setResults(patch);
    setSavedHistory(patch);
  }, []);

  const handleToggleFavoriteIdea = useCallback((idea: GeneratedIdea, currentlyFavorite: boolean, ideaFavoriteKeys: string[]) => {
    const nextFavorite = !currentlyFavorite;
    const keys = ideaFavoriteKeys.length > 0 ? ideaFavoriteKeys : getAllIdeaFavoriteKeys(idea);

    setFavoriteIdeas(prev => {
      const next = new Set(prev);
      keys.forEach(key => {
        if (nextFavorite) next.add(key);
        else next.delete(key);
      });
      return next;
    });

    patchIdeaFavoriteMeta(idea.id, nextFavorite, keys);
    if (idea.id.startsWith('temp-')) return;

    void dbService.updateIdeaFavorite(app.id, idea, nextFavorite, keys).then(saved => {
      if (!saved) {
        console.warn('Favorite idea DB update failed:', idea.id);
      }
    });
  }, [app.id, getAllIdeaFavoriteKeys, patchIdeaFavoriteMeta]);

  const historyWeekOptions = useMemo(() => {
    const dayCounts = new Map<string, number>();
    const weekCounts = new Map<string, number>();
    const monthCounts = new Map<string, number>();
    savedHistory.forEach(idea => {
      const dayKey = getHistoryDayKey(idea.created_at);
      const weekKey = getHistoryWeekKey(idea.created_at);
      const monthKey = getHistoryMonthKey(idea.created_at);
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
      weekCounts.set(weekKey, (weekCounts.get(weekKey) || 0) + 1);
      monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
    });

    const fixedOptions = [
      {
        key: HISTORY_TODAY,
        count: savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_TODAY)).length,
        label: `Hôm nay (${savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_TODAY)).length})`,
      },
      {
        key: HISTORY_THIS_WEEK,
        count: savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_WEEK)).length,
        label: `Tuần này (${savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_WEEK)).length})`,
      },
      {
        key: HISTORY_THIS_MONTH,
        count: savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_MONTH)).length,
        label: `Tháng này (${savedHistory.filter(idea => matchesHistoryDateFilter(idea, HISTORY_THIS_MONTH)).length})`,
      },
    ];

    const monthOptions = Array.from(monthCounts.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, count]) => ({
        key: `${HISTORY_MONTH_PREFIX}${key}`,
        count,
        label: `Tháng ${formatHistoryMonth(key)} (${count})`,
      }));

    const weekOptions = Array.from(weekCounts.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, count]) => ({
        key: `${HISTORY_WEEK_PREFIX}${key}`,
        count,
        label: `${getHistoryWeekRangeLabel(`${HISTORY_WEEK_PREFIX}${key}`)} (${count})`,
      }));

    const dayOptions = Array.from(dayCounts.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, count]) => ({
        key: `${HISTORY_DAY_PREFIX}${key}`,
        count,
        label: `Ngày ${formatHistoryDay(key)} (${count})`,
      }));

    return [...fixedOptions, ...monthOptions, ...weekOptions, ...dayOptions];
  }, [savedHistory]);

  const filteredHistory = useMemo(() => {
    if (historyWeekFilter === HISTORY_ALL_WEEKS) return savedHistory;
    return savedHistory.filter(idea => matchesHistoryDateFilter(idea, historyWeekFilter));
  }, [historyWeekFilter, savedHistory]);

  const historyCount = savedHistory.length;
  const filteredHistoryCount = filteredHistory.length;
  const favoriteCount = useMemo(() => {
    const favoriteSource = showHistory ? filteredHistory : (results.length > 0 ? results : savedHistory);
    const keys = new Set(
      favoriteSource
        .filter(idea => hasFavoriteIdeaKey(app.id, idea, favoriteIdeas))
        .map(getIdeaFavoriteKey)
    );
    return keys.size;
  }, [app.id, favoriteIdeas, filteredHistory, getIdeaFavoriteKey, results, savedHistory, showHistory]);

  useEffect(() => {
    if (favoriteCount === 0 && showFavoriteIdeas) {
      setShowFavoriteIdeas(false);
    }
  }, [favoriteCount, showFavoriteIdeas]);

  const visibleResults = useMemo(() => {
    const source = showHistory ? filteredHistory : results;
    if (!showFavoriteIdeas) return source;
    return source.filter(idea => hasFavoriteIdeaKey(app.id, idea, favoriteIdeas));
  }, [app.id, favoriteIdeas, filteredHistory, results, showFavoriteIdeas, showHistory]);
  const unsavedLocalIdeas = useMemo(
    () => savedHistory.filter(idea => idea.app_id === app.id && idea.id.startsWith('temp-')),
    [app.id, savedHistory]
  );

  const retrySaveUnsavedIdeas = async () => {
    if (unsavedLocalIdeas.length === 0 || ideaSaveStatus === 'saving') return;

    setIdeaSaveStatus('saving');
    setIdeaSaveMessage(`Đang lưu lại ${unsavedLocalIdeas.length} idea vào Supabase...`);
    const sessionId = crypto.randomUUID();
    const ideasToSave = unsavedLocalIdeas.map(idea => ({
      title: idea.title || 'Idea',
      duration: idea.duration || IDEA_RUNTIME_GUIDANCE,
      content: idea.content,
      filtersSnapshot: idea.filters_snapshot || {},
    }));

    try {
      const saveResponse = await authenticatedFetch('/api/save-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          ideas: ideasToSave,
          sessionId,
          filtersSnapshot: {},
        }),
      });
      const saveResult = await saveResponse.json().catch(() => null) as SaveIdeasApiResponse | null;
      if (!saveResponse.ok || !saveResult?.success || !Array.isArray(saveResult.data) || saveResult.data.length === 0) {
        throw new Error(saveResult?.error || 'Không insert được generated_ideas.');
      }

      const liveFavoriteKeys = loadFavoriteKeys(app.id);
      const savedWithFavoriteMeta = saveResult.data.map(idea => {
        if (!hasFavoriteIdeaKey(app.id, idea, liveFavoriteKeys)) return idea;
        const keys = buildIdeaFavoriteKeys(app.id, idea);
        return {
          ...idea,
          content: {
            ...idea.content,
            meta: {
              ...(idea.content?.meta || {}),
              isFavorite: true,
              favoriteKeys: keys,
              favoriteMarkedAt: new Date().toISOString(),
            },
          },
        };
      });
      const tempIds = new Set(unsavedLocalIdeas.map(idea => idea.id));
      setResults(prev => [...savedWithFavoriteMeta, ...prev.filter(idea => !tempIds.has(idea.id))]);
      setSavedHistory(prev => [...savedWithFavoriteMeta, ...prev.filter(idea => !tempIds.has(idea.id))]);
      clearUnsavedIdeaBackup(app.id);
      setIdeaSaveStatus('saved');
      setIdeaSaveMessage(`Đã lưu Supabase (${savedWithFavoriteMeta.length}/${unsavedLocalIdeas.length})`);

      savedWithFavoriteMeta
        .filter(idea => idea.content?.meta?.isFavorite)
        .forEach(idea => {
          void dbService.updateIdeaFavorite(app.id, idea, true, buildIdeaFavoriteKeys(app.id, idea));
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown save error';
      setIdeaSaveStatus('error');
      setIdeaSaveMessage(`Lưu Supabase lỗi: ${message}`);
      alert(`Lưu lại Supabase thất bại: ${message}`);
    }
  };

  const seasonalVisualContext = useMemo<SeasonalVisualContext | null>(() => {
    const activeMonth = selectedSeasonMonth ? SEASON_MONTHS.find(month => month.id === selectedSeasonMonth) : null;
    const seasonKey = activeMonth?.season || selectedSeason;
    if (!seasonKey) return null;

    const season = SEASONS[seasonKey];
    if (!season) return null;

    const sourceVisual = activeMonth?.visualInsights || season.visualInsights;
    const pick = (items: string[]) => {
      const cleanItems = uniqueSeasonItems(items);
      if (selectedSeasonInsights.size === 0) return cleanItems;
      const focused = cleanItems.filter(item => selectedSeasonInsights.has(item));
      return focused.length > 0 ? focused : cleanItems;
    };

    return {
      seasonKey,
      seasonLabel: season.label,
      seasonIcon: season.icon,
      monthId: activeMonth?.id || null,
      monthLabel: activeMonth?.label || null,
      monthRange: season.months,
      events: (activeMonth?.events?.length ? activeMonth.events : season.events).filter(event => selectedSeasonEvents.has(event)),
      costumes: pick(sourceVisual.costumes),
      behaviors: pick(sourceVisual.behaviors),
      colors: pick(sourceVisual.colors),
      props: pick(sourceVisual.props),
      moods: pick(sourceVisual.moods),
      emphasis: Array.from(selectedSeasonInsights),
    };
  }, [selectedSeason, selectedSeasonMonth, selectedSeasonInsights, selectedSeasonEvents]);

  const selectedAngleCount = Math.max(1, Array.from(new Set((filters.angle || []).map(angle => angle.trim()).filter(Boolean))).length || autoAngleCount);
  const totalIdeasToGenerate = selectedAngleCount * quantity;

  const WIZARD_STEPS = [
    hidePspForCurrentApp
      ? { label: 'Core User', icon: Users, categories: ['coreUser'], required: ['coreUser'] }
      : { label: 'Core User & PSP', icon: Users, categories: ['coreUser', 'solution'], required: ['coreUser', 'solution'] },
    { label: 'Emotion & Visual', icon: Target, categories: ['emotion', 'visualType'], required: ['emotion', 'visualType'] },
    { label: 'Painpoint', icon: Zap, categories: ['painPoint'], required: ['painPoint'] },
    { label: 'Angle', icon: Compass, categories: ['angle'], required: [] },
    { label: 'Cấu hình & Tạo', icon: Settings2, categories: [], required: [] },
  ];

  // === Validation: check if current step has required selections ===
  const isStepValid = (stepIndex: number): boolean => {
    const step = WIZARD_STEPS[stepIndex];
    if (stepIndex === 0) {
      return (filters.coreUser || []).length > 0 && (hidePspForCurrentApp || (filters.solution || []).length > 0);
    }
    if (stepIndex === 3) {
      return (filters.angle || []).length > 0 || autoAngleCount > 0;
    }
    if (!step?.required || step.required.length === 0) return true;
    return step.required.every(cat => (filters[cat] || []).length > 0);
  };

  const getStepValidationMessage = (stepIndex: number): string => {
    const step = WIZARD_STEPS[stepIndex];
    if (stepIndex === 0) {
      if ((filters.coreUser || []).length === 0) return 'Vui long chon it nhat 1 Core User';
      if (hidePspForCurrentApp) return '';
      if ((filters.solution || []).length === 0) return 'Vui long chon Tinh nang / Giai phap';
      return '';
    }
    if (stepIndex === 3) {
      return (filters.angle || []).length > 0 || autoAngleCount > 0
        ? ''
        : 'Vui long chon Angle hoac de AI tu chon so luong angle';
    }
    if (!step?.required) return '';
    const missing = step.required.filter(cat => (filters[cat] || []).length === 0);
    if (missing.length === 0) return '';
    const labelMap: Record<string, string> = {
      coreUser: 'Đối tượng',
      solution: 'Tính năng / Giải pháp',
      emotion: 'Cảm xúc',
      visualType: 'Dạng Visual',
      painPoint: 'Nỗi đau',
      angle: 'Angle',
      targetMarket: 'Thị trường',
    };
    return `Vui lòng chọn: ${missing.map(m => labelMap[m] || m).join(', ')}`;
  };

  const handleNextStep = () => {
    if (!isStepValid(wizardStep)) {
      setValidationError(getStepValidationMessage(wizardStep));
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    setValidationError(null);
    setWizardStep(wizardStep + 1);
  };

  const handleJumpToStep = (targetStep: number) => {
    if (targetStep <= wizardStep) {
      setWizardStep(targetStep);
      setValidationError(null);
      return;
    }

    for (let index = 0; index < targetStep; index += 1) {
      if (!isStepValid(index)) {
        setWizardStep(index);
        setValidationError(getStepValidationMessage(index));
        setTimeout(() => setValidationError(null), 3000);
        return;
      }
    }

    setWizardStep(targetStep);
    setValidationError(null);
  };

  // === Auto-generate angles from selected painpoints ===
  const generateAnglesFromPainpoints = async () => {
    const selectedPainpoints = filters.painPoint || [];
    if (selectedPainpoints.length === 0) return;

    const outputLanguage = 'Vietnamese';
    setGeneratingAngles(true);
    setFilters(prev => ({ ...prev, angle: cleanAngleOptions(prev.angle || []) }));
    try {
      const res = await authenticatedFetch('/api/generate-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate-angles',
          appName: app.name,
          appCategory: app.category,
          painpoints: selectedPainpoints,
          coreUsers: filters.coreUser || [],
          emotions: filters.emotion || [],
          targetMarkets: filters.targetMarket || [],
          outputLanguage,
          selectedModel: selectedModel || '',
        }),
      });
      const result = await res.json();
      if (res.ok && result.success && result.angles?.length > 0) {
        // Add generated angles to options
        const newAngles = cleanAngleOptions(result.angles as string[]);
        if (newAngles.length === 0) {
          throw new Error('Generated angles were not Vietnamese-safe.');
        }
        setOptions(prev => {
          const existing = cleanAngleOptions(prev.angle || []);
          const merged = [...new Set([...existing, ...newAngles])];
          return { ...prev, angle: merged };
        });
      } else {
        // Fallback: generate angles locally from painpoints
        const fallbackAngles = cleanAngleOptions(buildLocalizedFallbackAnglesFromPainpoints(selectedPainpoints, outputLanguage));
        setOptions(prev => {
          const existing = cleanAngleOptions(prev.angle || []);
          const merged = [...new Set([...existing, ...fallbackAngles])];
          return { ...prev, angle: merged };
        });
      }
    } catch {
      // Fallback on error
      const fallbackAngles = cleanAngleOptions(buildLocalizedFallbackAnglesFromPainpoints(filters.painPoint || [], outputLanguage));
      setOptions(prev => {
        const existing = cleanAngleOptions(prev.angle || []);
        const merged = [...new Set([...existing, ...fallbackAngles])];
        return { ...prev, angle: merged };
      });
    } finally {
      setGeneratingAngles(false);
    }
  };

  const LEGACY_STEPS = [
    { id: 'f2.1' as ScreenType, label: 'Bộ lọc', icon: Filter },
    { id: 'f2.1.1' as ScreenType, label: 'Cấu hình', icon: Settings2 },
    { id: 'f2.1.2' as ScreenType, label: 'Kết quả', icon: Wand2 },
  ];
  const currentStepIdx = LEGACY_STEPS.findIndex(s => s.id === currentScreen);

  // === RENDER: Filter Card for a category ===
  const renderFilterCard = (cat: CategoryConfig) => {
    const Icon = cat.icon;
    const filterItems = (cat.id === 'visualType' ? GLOBAL_VISUAL_TYPES : sanitizeOptionValues(cat.id, options[cat.id] || [])) as string[];
    const isEditMode = editModeCat === cat.id;
    const isLockedVisualType = cat.id === 'visualType';

    if (cat.id === 'coreUser') {
      const groupedItems = CORE_USER_DIMENSIONS.reduce<Record<string, string[]>>((acc, dimension) => {
        acc[dimension.id] = [];
        return acc;
      }, {});
      filterItems.forEach(item => {
        const dimensionId = getCoreUserDimension(item);
        groupedItems[dimensionId] = [...(groupedItems[dimensionId] || []), item];
      });

      return (
        <div key={cat.id} className={`bg-white rounded-2xl border overflow-hidden flex flex-col transition-all shadow-sm md:col-span-2 ${isEditMode ? 'border-teal-500 ring-2 ring-teal-100' : 'border-gray-200'}`}>
          <div className={`px-4 py-3 border-b flex justify-between items-center ${isEditMode ? 'bg-teal-50 border-teal-200' : 'border-gray-100'}`}>
            <h3 className="font-bold text-sm flex items-center gap-2 text-gray-700">
              <Icon size={16} className={isEditMode ? 'text-teal-600' : 'text-gray-400'} />
              Core User
              <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">chọn ít nhất 1</span>
            </h3>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${(filters.coreUser || []).length > 0 ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-400'}`}>
                {(filters.coreUser || []).length}
              </span>
              {(filters.coreUser || []).length > 0 && (
                <button onClick={() => setFilters(prev => ({ ...prev, coreUser: [] }))}
                  title="Xóa tất cả đã chọn"
                  className="p-1.5 rounded-lg transition-colors hover:bg-red-50 text-gray-300 hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              )}
              <button onClick={() => { setEditModeCat(isEditMode ? null : cat.id); setNewItem({ cat: null, text: '' }); }}
                className={`p-1.5 rounded-lg transition-colors ${isEditMode ? 'bg-teal-100 text-teal-700' : 'hover:bg-gray-100 text-gray-400'}`}>
                {isEditMode ? <Check size={14} /> : <Settings2 size={14} />}
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-teal-100 bg-teal-50/70">
            <div className="text-xs font-extrabold uppercase tracking-wide text-teal-700">Nhóm 1 - Luôn ảnh hưởng creative</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 p-3">
            {CORE_USER_DIMENSIONS.map(dimension => {
              const dimensionItems = groupedItems[dimension.id] || [];
              const inputKey = `coreUser:${dimension.id}`;
              return (
                <div key={dimension.id} className="min-h-[230px] rounded-xl border border-teal-200 bg-teal-50/60 flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-teal-700 text-white">
                    <div className="text-sm font-extrabold">{dimension.label}</div>
                    <div className="text-[11px] font-semibold opacity-90">{dimension.examples}</div>
                  </div>
                  <div className="flex-1 p-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {dimensionItems.map(item => {
                        const selected = (filters.coreUser || []).includes(item);
                        return (
                          <div key={item} className="flex items-center gap-1">
                            <button onClick={() => toggleFilter('coreUser', item)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold text-left transition-all ${selected ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 shadow-sm' : 'bg-white border border-teal-100 text-gray-700 hover:border-teal-300'}`}>
                              {getCoreUserDisplayValue(item)}
                            </button>
                            {isEditMode && (
                              <button onClick={() => handleDeleteOption('coreUser', item)}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {dimensionItems.length === 0 && <div className="text-xs text-teal-700/70 italic">User tự điền lựa chọn.</div>}
                    </div>
                  </div>
                  <div className="border-t border-teal-100 p-2">
                    {newItem.cat === inputKey ? (
                      <div className="flex gap-1.5">
                        <input autoFocus className="min-w-0 flex-1 text-xs py-1.5 px-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 border-teal-200"
                          value={newItem.text}
                          onChange={e => setNewItem({ ...newItem, text: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && handleAddCoreUserItem(dimension)}
                          placeholder={dimension.placeholder} />
                        <button onClick={() => handleAddCoreUserItem(dimension)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check size={13} /></button>
                        <button onClick={() => setNewItem({ cat: null, text: '' })} className="p-1.5 bg-white text-gray-400 rounded-lg hover:bg-gray-100"><X size={13} /></button>
                      </div>
                    ) : (
                      <button onClick={() => setNewItem({ cat: inputKey, text: '' })} className="w-full text-[11px] font-extrabold flex items-center justify-center gap-1 py-2 rounded-lg text-teal-700 hover:bg-white transition-colors">
                        <Plus size={13} /> THÊM LỰA CHỌN
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div key={cat.id} className={`bg-white rounded-2xl border overflow-hidden flex flex-col transition-all shadow-sm ${isEditMode ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
        <div className={`px-4 py-3 border-b flex justify-between items-center ${isEditMode ? 'bg-indigo-50 border-indigo-200' : 'border-gray-100'}`}>
          <h3 className="font-bold text-sm flex items-center gap-2 text-gray-700">
            <Icon size={16} className={isEditMode ? 'text-indigo-500' : 'text-gray-400'} />
            {cat.label}
            {cat.isCustom && <span className="text-[9px] text-gray-300 font-normal bg-gray-50 px-1.5 py-0.5 rounded">tùy chọn</span>}
          </h3>
          <div className="flex items-center gap-1.5">
            {!isEditMode && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${(filters[cat.id] || []).length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                {(filters[cat.id] || []).length}
              </span>
            )}
            {!isEditMode && (filters[cat.id] || []).length > 0 && (
              <button onClick={() => setFilters(prev => ({ ...prev, [cat.id]: [] }))}
                title="Xóa tất cả đã chọn"
                className="p-1.5 rounded-lg transition-colors hover:bg-red-50 text-gray-300 hover:text-red-400">
                <Trash2 size={13} />
              </button>
            )}
            {!isLockedVisualType && (
              <button onClick={() => { setEditModeCat(isEditMode ? null : cat.id); setEditingItemText(null); setConfirmDeleteCat(null); }}
                className={`p-1.5 rounded-lg transition-colors ${isEditMode ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}>
                {isEditMode ? <Check size={14} /> : <Settings2 size={14} />}
              </button>
            )}
            {isEditMode && (
              confirmDeleteCat === cat.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => handleDeleteCategory(cat.id)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">Xóa</button>
                  <button onClick={() => setConfirmDeleteCat(null)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors">Hủy</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteCat(cat.id)} className="p-1.5 rounded-lg transition-colors text-red-400 hover:bg-red-50 hover:text-red-600" title={`Xóa bộ lọc ${cat.label}`}>
                  <Trash2 size={13} />
                </button>
              )
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-[200px] max-h-[350px]">
          {isEditMode ? (
            <div className="space-y-1.5">
              {filterItems.map(item => {
                const isGlobalEmotionItem = cat.id === 'emotion' && GLOBAL_EMOTION_OPTIONS.includes(item);
                return (
                <div key={item} className="flex items-center gap-1.5 group">
                  {editingItemText?.original === item && !isGlobalEmotionItem ? (
                    <div className="flex-1 flex gap-1">
                      <input autoFocus className="flex-1 text-sm py-1.5 px-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200"
                        value={editingItemText.current}
                        onChange={e => setEditingItemText({ ...editingItemText, current: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && handleUpdateOption(cat.id, item, editingItemText.current)}
                        onBlur={() => handleUpdateOption(cat.id, item, editingItemText.current)} />
                      <button onClick={() => handleUpdateOption(cat.id, item, editingItemText.current)} className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded"><Check size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <div onClick={() => !isGlobalEmotionItem && setEditingItemText({ original: item, current: item })}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm bg-gray-50 border border-transparent transition-all text-gray-700 flex justify-between items-center ${isGlobalEmotionItem ? 'cursor-default' : 'hover:border-indigo-200 hover:bg-indigo-50/50 cursor-text'}`}>
                        {item}
                        {!isGlobalEmotionItem && <Pencil size={11} className="opacity-0 group-hover:opacity-100 text-gray-400" />}
                      </div>
                      {!isGlobalEmotionItem && (
                        <button onClick={() => handleDeleteOption(cat.id, item)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filterItems.map(item => (
                <button key={item} onClick={() => toggleFilter(cat.id, item)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium text-left transition-all ${(filters[cat.id] || []).includes(item) ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 shadow-sm' : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300'
                    }`}>
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-2.5 border-t border-gray-100">
          {isLockedVisualType ? (
            <div className="text-center text-[11px] font-semibold text-gray-400 py-2">
              5 format cố định theo Creative Framework
            </div>
          ) : newItem.cat === cat.id ? (
            <div className="flex gap-1.5">
              <input autoFocus className="flex-1 text-sm py-1.5 px-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200"
                value={newItem.text} onChange={e => setNewItem({ ...newItem, text: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleAddItem(cat.id)} placeholder="Thêm mới..." />
              <button onClick={() => handleAddItem(cat.id)} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check size={14} /></button>
              <button onClick={() => setNewItem({ cat: null, text: '' })} className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-100"><X size={14} /></button>
            </div>
          ) : isEditMode ? (
            <div className="flex gap-1.5">
              <button onClick={() => setNewItem({ cat: cat.id, text: '' })} className="flex-1 text-xs font-bold flex items-center justify-center gap-1 py-2 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors">
                <Plus size={14} /> THÊM
              </button>
              <button onClick={async () => {
                const resetValues = cat.id === 'emotion' ? GLOBAL_EMOTION_OPTIONS : [];
                for (const item of filterItems) {
                  if (cat.id === 'emotion' && GLOBAL_EMOTION_OPTIONS.includes(item)) continue;
                  await dbService.deleteFilterOptionByValue(app.id, cat.id, item);
                }
                setOptions(prev => ({ ...prev, [cat.id]: resetValues }));
                setFilters(prev => ({ ...prev, [cat.id]: [] }));
                return;
                const seeds = CATEGORY_SEEDS[app.category] || CATEGORY_SEEDS['Tổng hợp'];
                const seedValues = cat.id === 'visualType' ? GLOBAL_VISUAL_TYPES : (seeds[cat.id as keyof typeof seeds] || []);
                for (const item of filterItems) { await dbService.deleteFilterOptionByValue(app.id, cat.id, item); }
                setOptions(prev => ({ ...prev, [cat.id]: seedValues as string[] }));
                setFilters(prev => ({ ...prev, [cat.id]: [] }));
              }} className="flex-1 text-xs font-bold flex items-center justify-center gap-1 py-2 rounded-lg text-amber-500 hover:bg-amber-50 transition-colors">
                <RotateCcw size={13} /> RESET
              </button>
            </div>
          ) : (
            <button onClick={() => setNewItem({ cat: cat.id, text: '' })} className="w-full text-xs font-bold flex items-center justify-center gap-1 py-2 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors">
              <Plus size={14} /> THÊM TÙY CHỌN
            </button>
          )}
        </div>
      </div>
    );
  };

  // === RENDER: Wizard Step Content ===
  const renderQuickBriefContent = () => {
    const quickBrief = parseCompactCreativeBrief(ideaDescription);
    const detectedQuantity = quickBrief?.ideasPerAngle;
    const quickBriefChips = [
      quickBrief?.coreUser ? `Core user: ${quickBrief.coreUser}` : '',
      quickBrief?.painPoint ? `Pain: ${quickBrief.painPoint}` : '',
      quickBrief?.solution ? `PSP: ${quickBrief.solution}` : '',
      quickBrief?.emotion ? `Emotion: ${quickBrief.emotion}` : '',
      quickBrief?.visualType ? `Visual: ${quickBrief.visualType}` : '',
      quickBrief?.trend ? `Trend: ${quickBrief.trend}` : '',
      detectedQuantity ? `${detectedQuantity} idea` : '',
    ].filter(Boolean);

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><Filter size={14} /> Bối cảnh từ brief</h3>
          <div className="flex flex-wrap gap-2">
            {quickBriefChips.length > 0 ? quickBriefChips.map(item => (
              <span key={item} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200">
                {item}
              </span>
            )) : (
              <span className="text-gray-400 italic text-sm">Chưa có brief. Paste brief bên dưới để AI tự đọc bối cảnh.</span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Settings2 size={14} /> Rule cố định / System Prompt
              </h3>
              <p className="mt-1 text-xs text-gray-400">Lưu một lần cho app. Mỗi lần tạo idea, Quick Brief sẽ dùng phần này như lớp luật cố định.</p>
            </div>
            <button
              type="button"
              onClick={() => { void handleSaveSystemRule(); }}
              disabled={savingSystemRule}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              {savingSystemRule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {savingSystemRule ? 'Đang lưu...' : 'Lưu Rule'}
            </button>
          </div>
          <textarea
            value={systemRuleDraft}
            onChange={(e) => setSystemRuleDraft(e.target.value)}
            placeholder="Dán framework/rule cố định ở đây: schema output, luật hook, pacing, language, compliance, style guardrails..."
            className="w-full h-36 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          {systemRuleMessage && (
            <p className={`mt-2 text-xs font-semibold ${systemRuleMessage === 'Saved' ? 'text-emerald-600' : 'text-red-500'}`}>
              {systemRuleMessage}
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-gray-500">
            <FileEdit size={14} /> Mô tả ý tưởng - brief chính
          </label>
          <p className="mb-3 text-xs text-gray-400">
            Paste một brief ngắn như chat. Backend giữ nguyên rawBrief làm nguồn chính, chip chỉ là metadata phụ.
          </p>
          <textarea
            value={ideaDescription}
            onChange={(e) => setIdeaDescription(e.target.value)}
            placeholder={`Core user: 25-40, likes home decor but does not know which style fits
Pain: wants to decorate fast and improve the living space
PSP: AI redecorate from one room photo
Emotion: Curiosity + Social Proof
Visual: 3D Animation
Trend: Aha moment
Tao 3 idea`}
            className="w-full h-64 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {quickBrief?.coreUser && <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-600">User: {quickBrief.coreUser}</span>}
            {quickBrief?.painPoint && <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-600">Pain: {quickBrief.painPoint}</span>}
            {quickBrief?.solution && <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-600">PSP: {quickBrief.solution}</span>}
            {quickBrief?.visualType && <span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-600">Visual: {quickBrief.visualType}</span>}
            {detectedQuantity && <span className="rounded-full bg-orange-50 px-2.5 py-1 font-semibold text-orange-600">Quantity: {detectedQuantity}</span>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <label className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-gray-400">
            <ListOrdered size={14} /> Số lượng idea
          </label>
          <input
            type="number"
            min="1"
            max="10"
            value={quantity}
            onChange={(e) => setQuantity(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-full rounded-xl border border-gray-200 py-2 text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <p className="mt-2 text-center text-xs text-gray-400">
            Chỉ dùng khi brief không ghi rõ cần tạo bao nhiêu idea.
          </p>
        </div>

        {validationError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-600 animate-in fade-in duration-200">
            <AlertTriangle size={14} />
            <span>{validationError}</span>
          </div>
        )}

        <button onClick={handleGenerate} disabled={isGenerating}
          className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${isGenerating ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-pink-500 to-orange-500 hover:shadow-orange-200 text-white hover:scale-[1.01]'
            }`}>
          {isGenerating ? <Loader2 className="animate-spin" size={22} /> : <Wand2 size={22} />}
          {isGenerating ? 'Đang Sáng Tạo & Lưu...' : 'BẮT ĐẦU TẠO IDEA'}
        </button>

        {isGenerating && progress > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-indigo-600 font-medium flex items-center gap-2">
                <Loader2 className="animate-spin" size={14} /> {progressLabel}
              </span>
              <span className="font-bold text-indigo-700">{progress}%</span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }} />
            </div>
            <button onClick={handleCancel}
              className="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2">
              <X size={16} /> Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderWizardContent = () => {
    const step = WIZARD_STEPS[wizardStep];
    // Angle step uses a special category 'angle' not in default categories list
    const stepCats = step.categories
      .map(catId => {
        const found = categories.find(c => c.id === catId);
        if (found) return found;
        // Inject angle category if not in default list
        if (catId === 'angle') return { id: 'angle', label: 'Angle (Góc tiếp cận)', icon: Compass } as CategoryConfig;
        return null;
      })
      .filter(Boolean) as CategoryConfig[];

    // Step 5 = Config + Generate
    if (wizardStep === 4) {
      return (
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Selected filters summary */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><Filter size={14} /> Bối cảnh đã chọn</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(filters).flatMap(([key, items]) =>
                hidePspForCurrentApp && key === 'solution' ? [] :
                (items as string[]).map(item => (
                  <button key={`${key}-${item}`} onClick={() => toggleFilter(key, item)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors group cursor-pointer">
                    {key === 'coreUser' ? getCoreUserDisplayValue(item) : item} <X size={12} className="opacity-50 group-hover:opacity-100" />
                  </button>
                ))
              )}
              {Object.values(filters).flat().length === 0 && <span className="text-gray-400 italic text-sm">Chưa chọn bối cảnh nào (AI sẽ tự do sáng tạo)</span>}
            </div>
          </div>

          <details className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                  <Settings2 size={14} /> System Rule riêng
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  Nhập framework/rule một lần. Khi generate, backend đọc theo app id và chỉ gửi prompt ngắn cho AI.
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${systemRuleDraft.trim() ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                {systemRuleDraft.trim() ? 'Đã có rule' : 'Chưa có rule'}
              </span>
            </summary>
            <div className="mt-4 space-y-3">
              <textarea
                value={systemRuleDraft}
                onChange={(e) => setSystemRuleDraft(e.target.value)}
                placeholder="Dán framework/rule cốt lõi: hook rules, pacing, language, compliance, output schema notes..."
                className="w-full h-32 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  {systemRuleDraft.trim().length.toLocaleString('vi-VN')} ký tự. Backend sẽ rút gọn phần cốt lõi khi gọi AI.
                </p>
                <button
                  type="button"
                  onClick={() => { void handleSaveSystemRule(); }}
                  disabled={savingSystemRule}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {savingSystemRule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {savingSystemRule ? 'Đang lưu...' : 'Lưu Rule'}
                </button>
              </div>
              {systemRuleMessage && (
                <p className={`text-xs font-semibold ${systemRuleMessage.includes('lưu') || systemRuleMessage.includes('Saved') || systemRuleMessage.includes('luu') ? 'text-emerald-600' : 'text-red-500'}`}>
                  {systemRuleMessage}
                </p>
              )}
            </div>
          </details>

          {/* Seasonal Events */}
          <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-200 p-5">
            <h3 className="text-xs font-bold text-violet-600 uppercase mb-3 flex items-center gap-2">📅 Sự kiện theo tháng</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-12 gap-2 mb-4">
              {CALENDAR_MONTH_ORDER
                .map(monthId => SEASON_MONTHS.find(month => month.id === monthId))
                .filter((month): month is MonthVisualConfig => Boolean(month))
                .map(month => {
                  const isActive = selectedSeasonMonth === month.id;
                  return (
                    <button key={month.id} onClick={() => {
                      if (isActive) {
                        setSelectedSeason(null);
                        setSelectedSeasonMonth(null);
                      } else {
                        setSelectedSeason(month.season);
                        setSelectedSeasonMonth(month.id);
                      }
                      setSelectedSeasonInsights(new Set());
                      setSelectedSeasonEvents(new Set());
                    }}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold transition-all ${isActive
                        ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:bg-violet-50'
                        }`}>
                      {month.label.replace('Tháng ', 'T')}
                    </button>
                  );
                })}
            </div>

            {seasonalVisualContext && (
              <div className="space-y-2 animate-in fade-in duration-200">
                {(() => {
                  const activeMonth = selectedSeasonMonth ? SEASON_MONTHS.find(month => month.id === selectedSeasonMonth) : null;
                  const availableEvents = activeMonth?.events || [];
                  return (
                    <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Mùa tự nhận</span>
                  <span className="text-xs font-bold text-violet-700">
                    {seasonalVisualContext.seasonIcon} {seasonalVisualContext.seasonLabel}
                    {seasonalVisualContext.monthLabel ? ` / ${seasonalVisualContext.monthLabel}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">🎉 Sự kiện tùy chọn</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedSeasonEvents(new Set())}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${selectedSeasonEvents.size === 0
                        ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:bg-violet-50'
                        }`}
                    >
                      Không chọn sự kiện
                    </button>
                    {availableEvents.map(event => {
                      const isSelected = selectedSeasonEvents.has(event);
                      return (
                        <button
                          key={event}
                          type="button"
                          onClick={() => setSelectedSeasonEvents(prev => {
                            const next = new Set(prev);
                            if (next.has(event)) next.delete(event);
                            else next.add(event);
                            return next;
                          })}
                          className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${isSelected
                            ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                            : 'bg-white text-violet-600 border-violet-200 hover:bg-violet-50 hover:border-violet-300'
                            }`}
                        >
                          🎉 {event}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {selectedSeasonEvents.size === 0 ? 'Không chọn sự kiện nào: AI chỉ dùng tháng/mùa, không ép event cụ thể.' : `Đang áp dụng: ${Array.from(selectedSeasonEvents).join(', ')}`}
                  </p>
                </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Import Trending */}
          <div className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-2xl border border-rose-200 p-5">
            <h3 className="text-xs font-bold text-rose-600 uppercase mb-3 flex items-center gap-2"><TrendingUp size={14} /> Import Trending</h3>
            <div className="flex gap-2 mb-3">
              <input value={trendingInput} onChange={e => setTrendingInput(e.target.value)}
                placeholder="Nhập trend, direct video URL, YouTube hoặc TikTok URL..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && trendingInput.trim()) {
                    void handleAddTrendingInput();
                  }
                }}
                className="flex-1 text-sm py-2.5 px-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200 bg-white" />
              <button onClick={() => { void handleAddTrendingInput(); }}
                disabled={isImportingTrend || !trendingInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-bold text-sm hover:shadow-lg transition-all flex items-center gap-1">
                {isImportingTrend ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {isImportingTrend ? 'Đang đọc video...' : 'Thêm'}
              </button>
            </div>
            {trendImportError && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {trendImportError}
              </div>
            )}
            {usableImportedTrendAnalyses.length > 0 && (
              <div className="mb-3 space-y-2">
                {usableImportedTrendAnalyses.map((analysis) => {
                  const analysisTags = Array.from(new Set([
                    analysis.creativeType,
                    analysis.angleType,
                    analysis.emotionalDriver,
                  ].map(label => String(label || '').trim()).filter(Boolean)));

                  return (
                  <div key={analysis.sourceUrl} className="rounded-xl border border-rose-200 bg-white p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-800">{analysis.title}</p>
                        <p className="truncate text-[11px] text-gray-400">
                          {analysis.sourceLabel || analysis.sourceUrl}
                          {analysis.modelUsed ? ` • ${analysis.modelUsed}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setImportedTrendAnalyses(prev => prev.filter(item => item.sourceUrl !== analysis.sourceUrl))}
                        className="text-gray-400 transition-colors hover:text-red-500"
                        title="Remove imported video"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <p className="mb-2 text-xs leading-relaxed text-gray-600">{analysis.summary}</p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {analysisTags.map((label) => (
                        <span key={label} className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                          {label}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {analysis.structureNotes.slice(0, 4).map((note) => (
                        <p key={note} className="text-[11px] leading-relaxed text-gray-500">
                          • {note}
                        </p>
                      ))}
                    </div>
                    {analysis.keyMoments?.length > 0 && (
                      <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2">
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-rose-500">Key moments</p>
                        <div className="space-y-1">
                          {analysis.keyMoments.slice(0, 4).map(moment => (
                            <p key={moment} className="text-[11px] leading-relaxed text-gray-600">• {moment}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            {trendingTopics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {trendingTopics.map((topic, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-white text-rose-600 border border-rose-200 font-medium group">
                    {topic.startsWith('http') ? <Link2 size={10} /> : <TrendingUp size={10} />}
                    {topic.length > 40 ? topic.substring(0, 40) + '...' : topic}
                    <button onClick={() => setTrendingTopics(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 transition-colors"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
            {trendingTopics.length === 0 && usableImportedTrendAnalyses.length === 0 && (
              <p className="text-xs text-gray-400 italic">Nhập trend text hoặc URL video để import luôn hook/body/CTA structure vào prompt.</p>
            )}
          </div>

          {/* Quantity */}
          <div className="grid grid-cols-1 gap-5">
            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><ListOrdered size={14} /> Số lượng mỗi angle</label>
              <input type="number" min="1" max="10" value={quantity}
                onChange={(e) => setQuantity(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full text-center text-xl font-bold py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
              <p className="mt-2 text-xs text-gray-400 text-center">
                {selectedAngleCount > 1
                  ? `${selectedAngleCount} angle × ${quantity} idea = ${totalIdeasToGenerate} idea`
                  : `${quantity} idea sẽ được tạo`}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2"><FileEdit size={14} /> Mô tả ý tưởng / Quick Brief</label>
            <p className="text-xs text-gray-400 mb-3">Có thể nhập directive ngắn như cũ, hoặc paste brief đủ Core user, Pain, PSP, Emotion, Visual, Trend, số lượng idea.</p>
            <textarea value={ideaDescription} onChange={(e) => setIdeaDescription(e.target.value)}
              placeholder="VD: Hook 6s tò mò... hoặc Core user: ... / Pain: ... / PSP: ... / Visual: ... / Tạo 3 idea"
              className="w-full h-28 resize-none py-3 px-4 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
          </div>

          {validationError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-600 animate-in fade-in duration-200">
              <AlertTriangle size={14} />
              <span>{validationError}</span>
            </div>
          )}

          {/* Generate Button */}
          <button onClick={handleGenerate} disabled={isGenerating}
            className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${isGenerating ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-pink-500 to-orange-500 hover:shadow-orange-200 text-white hover:scale-[1.01]'
              }`}>
            {isGenerating ? <Loader2 className="animate-spin" size={22} /> : <Wand2 size={22} />}
            {isGenerating ? 'Đang Sáng Tạo & Lưu...' : 'BẮT ĐẦU TẠO IDEA'}
          </button>

          {/* Progress bar */}
          {isGenerating && progress > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-indigo-600 font-medium flex items-center gap-2">
                  <Loader2 className="animate-spin" size={14} /> {progressLabel}
                </span>
                <span className="font-bold text-indigo-700">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }} />
              </div>
              <button onClick={handleCancel}
                className="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2">
                <X size={16} /> Hủy Tạo
              </button>
            </div>
          )}
        </div>
      );
    }

    // Steps 1-4: show filter cards for this step
    // Special: Angle step (step 3) has auto-generate button
    return (
      <div className="space-y-5">
        {wizardStep === 3 && (
          <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-2xl border border-teal-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-teal-800 flex items-center gap-2">
                  <Compass size={18} /> Angle — Góc tiếp cận
                </h3>
                <p className="text-xs text-teal-600 mt-1">
                  Chọn angle hoặc bấm &quot;Gen Angle&quot; để AI tự tạo từ painpoint đã chọn
                </p>
              </div>
              <button
                onClick={generateAnglesFromPainpoints}
                disabled={generatingAngles || (filters.painPoint || []).length === 0}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${generatingAngles
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-teal-200 hover:scale-105'
                  }`}
              >
                {generatingAngles ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {generatingAngles ? 'Đang tạo...' : 'Gen Angle từ Painpoint'}
              </button>
            </div>
            <div className="mb-3 rounded-xl border border-teal-100 bg-white/75 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-teal-700">AI tự chọn angle nếu không chọn chip</div>
                  <p className="mt-1 text-xs text-teal-600">
                    Health luôn có Fact. Utility luôn có Comparison/Demo. AI luôn có Trend. Mỗi angle phải có angle_type khác nhau.
                  </p>
                </div>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={autoAngleCount}
                  onChange={(event) => setAutoAngleCount(Math.min(5, Math.max(1, parseInt(event.target.value, 10) || 1)))}
                  className="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-center text-lg font-bold text-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-200 sm:w-24"
                />
              </div>
            </div>
            {(filters.painPoint || []).length === 0 && (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2 text-xs font-medium border border-amber-200">
                <AlertTriangle size={14} />
                Quay lại bước 3 để chọn Painpoint trước khi tạo Angle
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {stepCats.map(cat => renderFilterCard(cat))}
        </div>
      </div>
    );
  };

  // (Config screen merged into wizard step 4 above)

  // === RENDER: Results ===
  const renderResult = () => (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 w-full shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-gray-100">
        <div>
          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Wand2 className="text-indigo-500" size={24} /> Kết Quả ({visibleResults.length})
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            {showHistory ? `Lịch sử ${getHistoryWeekRangeLabel(historyWeekFilter)}` : 'Ý tưởng theo bối cảnh đã chọn'}
            {showFavoriteIdeas ? ' • Đang lọc các idea đã thả tim' : ''}
            {ideaSaveStatus !== 'idle' && (
              <>
                {' • '}
                <span className={`font-medium ${
                  ideaSaveStatus === 'saved'
                    ? 'text-emerald-500'
                    : ideaSaveStatus === 'saving'
                      ? 'text-amber-500'
                      : 'text-red-500'
                }`}>
                  {ideaSaveMessage || (
                    ideaSaveStatus === 'saved'
                      ? 'Đã lưu Supabase ✓'
                      : ideaSaveStatus === 'saving'
                        ? 'Đang lưu Supabase...'
                        : 'Lưu Supabase lỗi'
                  )}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {historyCount > 0 && (
            <>
              <select
                value={historyWeekFilter}
                onChange={event => {
                  setHistoryWeekFilter(event.target.value);
                  setShowHistory(true);
                }}
                className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                title="Lọc lịch sử theo ngày, tuần hoặc tháng"
              >
                <option value={HISTORY_ALL_WEEKS}>Tất cả lịch sử ({historyCount})</option>
                {historyWeekOptions.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            <button
              onClick={async () => {
                if (showHistory) {
                  setShowHistory(false);
                  return;
                }
                if (savedHistory.length === 0) await loadHistory();
                setShowHistory(true);
              }}
              disabled={historyLoading}
              className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 disabled:cursor-wait disabled:opacity-60">
              {historyLoading ? 'Đang tải...' : showHistory ? 'Ẩn Lịch sử' : `📜 Lịch sử (${filteredHistoryCount}/${historyCount})`}
            </button>
            </>
          )}
          {favoriteCount > 0 && (
            <button
              onClick={() => setShowFavoriteIdeas(prev => !prev)}
              className={`text-sm flex items-center gap-2 px-4 py-2 border rounded-xl transition-colors ${
                showFavoriteIdeas
                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Heart size={14} fill={showFavoriteIdeas ? 'currentColor' : 'none'} />
              {showFavoriteIdeas ? 'Hiện tất cả' : `Đã thả tim (${favoriteCount})`}
            </button>
          )}
          {unsavedLocalIdeas.length > 0 && (
            <button
              onClick={retrySaveUnsavedIdeas}
              disabled={ideaSaveStatus === 'saving'}
              className="text-sm flex items-center gap-2 px-4 py-2 border border-amber-200 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 disabled:cursor-wait disabled:opacity-60"
            >
              {ideaSaveStatus === 'saving' ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Lưu lại Supabase ({unsavedLocalIdeas.length})
            </button>
          )}
          <button onClick={() => setScreen('f2.1.1')} className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600"><ArrowLeft size={14} /> Cấu hình</button>
          <button onClick={handleGenerate} disabled={isGenerating} className="text-sm flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600">
            {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Tạo thêm
          </button>
        </div>
      </div>

      {generationNotice && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{generationNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setGenerationNotice(null)}
            className="rounded-lg p-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
            title="Đóng thông báo"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {visibleResults.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {visibleResults.map((idea, idx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const c = idea.content as any;
            const isEditing = editingIdea === idea.id;
            const ideaKey = getIdeaFavoriteKey(idea) || idea.id || `idea-${idx}`;
            const isExpanded = expandedIdeas.has(ideaKey);
            const ideaFavoriteKeys = getAllIdeaFavoriteKeys(idea);
            const isFavorite = hasFavoriteIdeaKey(app.id, idea, favoriteIdeas);
            const hookData = isEditing ? editBuffer?.hook || {} : c?.hook || {};
            const isBuilderIdea = isBuilderIdeaContent(c);
            const hookVisual = normalizeHookTimingLabel(cleanVisualForDisplay(hookData?.visual || hookData?.script || ''));
            const hookDuration = isBuilderIdea ? 3 : getHookDurationSeconds(hookData);
            const hookSpeech = getSectionSpokenLines(hookData);
            const hookText = hookData?.textOverlay || hookData?.text || '';
            const hookVoiceVi = getSectionViTranslation(hookData);
            const hookSpeechInline = visualContainsSpokenLine(hookVisual, hookSpeech.characterSpeech);
            const primaryHook = c?.meta?.hookPrimary || '';
            const hookPreviewIncludesCopy = /\btext\s+hien\b|\bvoiceover\b/.test(normalizeCompareText(hookVisual));
            const showPrimaryHookLine = cleanPreviewText(primaryHook).toLowerCase() !== cleanPreviewText(hookText).toLowerCase();
            const scriptDisplayLabel = getReadableScriptLabel(idea, idx);
            const { strategyCode } = getEffectiveStrategyCodeMeta(idea);
            const selectedInputChips = getResultInputChips(idea, c || {});
            const meta = (c?.meta || {}) as Record<string, unknown>;
            const productionDetails = [
              { label: 'Scene family', value: meta.sceneFamily },
              { label: 'Character visual - ngoại hình', value: meta.characterVisual || meta.talentProfile },
              { label: 'Insight quốc gia', value: meta.countryVisualInsight || meta.marketInsight },
              { label: 'Bối cảnh hook', value: meta.hookContextInsight },
              { label: 'Góc camera hook', value: meta.cameraPlan },
              { label: 'Visual ref hook', value: meta.visualRefNotes },
              { label: 'Không làm', value: meta.dontDo },
            ]
              .map(item => ({ ...item, value: cleanPreviewText(item.value) }))
              .filter(item => item.value);
            return (
              <div key={ideaKey} className="h-full bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input value={editBuffer?.title || ''} onChange={e => setEditBuffer({ ...editBuffer, title: e.target.value })}
                          className="font-bold text-base text-gray-800 mb-1 w-full border-b-2 border-indigo-300 focus:outline-none bg-transparent" />
                      ) : (
                        <h4 className="font-bold text-base text-gray-900 leading-snug mb-1">{scriptDisplayLabel}</h4>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[11px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md">{new Date(idea.created_at).toLocaleDateString('vi-VN')}</span>
                        {strategyCode && <span className="text-[11px] px-2 py-0.5 bg-slate-900 text-white rounded-md font-bold">{strategyCode}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEditIdea(idea)} className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="Lưu">
                            <Save size={16} />
                          </button>
                          <button onClick={() => { setEditingIdea(null); setEditBuffer(null); }} className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-colors" title="Hủy">
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setRefiningIdea(refiningIdea === idea.id ? null : idea.id); setRefineInstruction(''); }} className={`p-2 rounded-lg transition-colors ${refiningIdea === idea.id ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'}`} title="AI Refine">
                            <Sparkles size={16} />
                          </button>
                          <button onClick={() => startEditIdea(idea)} className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" title="Chỉnh sửa thủ công">
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => handleCopy(idea)} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="Copy">
                            <Copy size={16} />
                          </button>
                          <button onClick={() => handleDeleteIdea(idea, ideaKey)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa idea">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {selectedInputChips.length > 0 && (
                    <div className="mb-3 h-[116px] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/70 p-2.5">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Input config</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedInputChips.map(chip => (
                          <span
                            key={`${ideaKey}-${chip.key}`}
                            title={chip.value}
                            className={`inline-block max-w-full truncate rounded-md px-2 py-1 text-[11px] font-medium leading-snug ${chip.className}`}
                          >
                            <span className="font-bold">{chip.label}:</span> {chip.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mb-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleFavoriteIdea(idea, isFavorite, ideaFavoriteKeys)}
                      className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${isFavorite ? 'border-rose-200 bg-rose-50 text-rose-500' : 'border-gray-200 text-gray-400 hover:text-rose-500 hover:bg-rose-50'}`}
                      title={isFavorite ? 'Bỏ khỏi danh sách đã chọn' : 'Đánh dấu đã chọn'}
                    >
                      <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(idea)}
                      className="h-8 w-8 rounded-md border border-gray-200 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 flex items-center justify-center transition-colors"
                      title="Copy"
                    >
                      <Copy size={14} />
                    </button>
                  </div>

                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 mb-2">
                    <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1 mb-3">Hook ({hookDuration}s)</span>
                    {isEditing ? (
                      <div className="space-y-3">
                        <textarea value={hookData?.visual || hookData?.script || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, visual: e.target.value, script: e.target.value } })}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-200 resize-none h-24 bg-white"
                          placeholder="Mô tả cảnh quay / hành động / camera" />
                        <textarea value={hookData?.characterSpeech || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, characterSpeech: e.target.value, voice: hookData?.voiceover || e.target.value } })}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-200 resize-none h-20 bg-white"
                          placeholder="Nhân vật nói trực tiếp trước camera" />
                        <textarea value={hookData?.voiceover || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, voiceover: e.target.value, voice: e.target.value || hookData?.characterSpeech || '' } })}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-200 resize-none h-20 bg-white"
                          placeholder="Voice video / narrator ngoài khung hình" />
                        <input value={hookData?.textOverlay || hookData?.text || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, textOverlay: e.target.value, text: e.target.value } })}
                          className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-red-200 bg-white" />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-red-100 bg-white/70 px-4 py-3 text-sm leading-6 text-gray-700">
                        <p className="whitespace-pre-line">{hookVisual || 'Hook visual will appear here.'}</p>
                        {productionDetails.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {productionDetails.map(item => (
                              <p key={item.label} className="text-sm leading-6 text-gray-700">
                                <span className="font-bold text-red-700">[{item.label}]</span> {item.value}
                              </p>
                            ))}
                          </div>
                        )}
                        {hookSpeech.characterSpeech && !hookSpeechInline && <p className="mt-1 text-gray-800 whitespace-pre-line">Lời nhân vật: {cleanSpeakerLabelsForDisplay(hookSpeech.characterSpeech)}</p>}
                        {hookVoiceVi && <p className="mt-1 text-gray-800 whitespace-pre-line">[DỊCH HOOK VOICE] {hookVoiceVi}</p>}
                        {hookText && !hookPreviewIncludesCopy && <p className="text-gray-800">[TEXT OVERLAY] {hookText}</p>}
                        {hookData?.textOverlayViTranslation && <p className="text-gray-800">[DỊCH TEXT OVERLAY] {hookData.textOverlayViTranslation}</p>}
                        {primaryHook && showPrimaryHookLine && <p className="mt-2 font-semibold text-gray-900">+ {primaryHook}</p>}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => toggleIdeaSet(setExpandedIdeas, ideaKey)}
                      className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 mb-2 flex items-center gap-1"
                    >
                      {isExpanded ? 'Hide details' : 'More details'}
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}

                  {(isExpanded || isEditing || refiningIdea === idea.id) && (
                    <div className="mt-2">
                  {/* AI Refine Panel */}
                  {refiningIdea === idea.id && !isEditing && (
                    <div className="mb-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-200 animate-in slide-in-from-top duration-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={16} className="text-purple-500" />
                        <span className="text-sm font-bold text-purple-700">AI Refine — Chỉnh sửa bằng AI</span>
                      </div>
                      <textarea value={refineInstruction} onChange={e => setRefineInstruction(e.target.value)}
                        placeholder='VD: "Đổi nhân vật thành cặp vợ chồng 50 tuổi, thêm hài hước", "Đổi emotion sang FOMO", "Tăng độ trực diện của hook"...'
                        className="w-full h-20 resize-none text-sm border border-purple-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white mb-3" />
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!refineInstruction.trim() || isRefining) return;
                          setIsRefining(true);
                          try {
                            const res = await authenticatedFetch('/api/generate-ideas', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                mode: 'refine',
                                originalIdea: idea.content,
                                instruction: refineInstruction,
                                appName: app.name,
                                appCategory: app.category,
                                selectedModel: selectedModel || '',
                              }),
                            });
                            const result = await res.json();
                            if (res.ok && result.success && result.data) {
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const refined = result.data as any;
                              const originalMeta = ((idea.content.meta || {}) as Record<string, unknown>);
                              const refinedMeta = ((refined.meta || {}) as Record<string, unknown>);
                              const lockedMeta = Object.fromEntries(
                                ['strategyCode', 'strategyCodes', 'strategyCodeMap', 'isFavorite', 'favoriteKeys', 'favoriteMarkedAt', 'sourceHookId', 'sourceHookTitle', 'sessionType']
                                  .filter(key => originalMeta[key] !== undefined && originalMeta[key] !== null && originalMeta[key] !== '')
                                  .map(key => [key, originalMeta[key]])
                              );
                              const newContent = {
                                ...idea.content,
                                meta: { ...originalMeta, ...refinedMeta, ...lockedMeta },
                                framework: { ...(idea.content.framework || {}), ...(refined.framework || {}) },
                                explanation: refined.explanation || idea.content.explanation,
                                hook: mergeRefinedSection(idea.content.hook, refined.hook, 'hook') as IdeaContent['hook'],
                                body: mergeRefinedSection(idea.content.body, refined.body, 'body') as IdeaContent['body'],
                                cta: mergeRefinedSection(idea.content.cta, refined.cta, 'cta') as IdeaContent['cta'],
                              };
                              const newTitle = refined.title || idea.title || '';
                               await dbService.updateIdeaContent(idea.id, newTitle, newContent);
                               const updater = (list: GeneratedIdea[]) => list.map(i => i.id === idea.id ? { ...i, title: newTitle, content: newContent } : i);
                               setResults(updater);
                               setSavedHistory(updater);
                               setRefiningIdea(null);
                              setRefineInstruction('');
                            } else {
                              alert(result.error || 'AI Refine thất bại. Thử lại.');
                            }
                          } catch (err) {
                            console.error('Refine error:', err);
                            alert('Có lỗi khi refine. Thử lại.');
                          } finally {
                            setIsRefining(false);
                          }
                        }} disabled={isRefining || !refineInstruction.trim()}
                          className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                          {isRefining ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {isRefining ? 'Đang refine...' : 'Refine Idea'}
                        </button>
                        <button onClick={() => { setRefiningIdea(null); setRefineInstruction(''); }}
                          className="px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
                          Hủy
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Body + CTA shown only when the card is expanded, being edited, or refined. */}
                  {[{ key: 'body', label: '📖 BODY (10-25s)', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
                  { key: 'cta', label: '🔥 CTA', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
                  ].map(sec => {
                    const secData = isEditing ? editBuffer?.[sec.key] : (c?.[sec.key] || {});
                    const visualContent = cleanVisualForDisplay(secData?.visual || secData?.script || '');
                    const spokenLines = getSectionSpokenLines(secData);
                    const characterSpeechInline = visualContainsSpokenLine(visualContent, spokenLines.characterSpeech);
                    const textOverlay = secData?.textOverlay || secData?.text || '';
                    const textOverlayViTranslation = secData?.textOverlayViTranslation || '';
                    const endCard = sec.key === 'cta' ? (secData?.endCard || '') : '';
                    return (
                      <div key={sec.key} className={`mb-3 ${sec.bg} rounded-xl p-4 border ${sec.border}`}>
                        <span className={`text-[10px] font-bold ${sec.title} uppercase tracking-widest flex items-center gap-1 mb-3`}>{sec.label}</span>

                        {isEditing ? (
                          <div className="space-y-3">
                            <textarea value={secData?.visual || secData?.script || ''}
                              onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], visual: e.target.value, script: e.target.value } })}
                              className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-28 bg-white"
                              placeholder="Mô tả cảnh quay / thao tác / diễn biến" />
                            <textarea value={secData?.characterSpeech || ''}
                              onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], characterSpeech: e.target.value, voice: secData?.voiceover || e.target.value } })}
                              className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-20 bg-white"
                              placeholder="Nhân vật nói trực tiếp trước camera" />
                            <textarea value={secData?.voiceover || ''}
                              onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], voiceover: e.target.value, voice: e.target.value || secData?.characterSpeech || '' } })}
                              className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-20 bg-white"
                              placeholder="Voice video / narrator ngoài khung hình" />
                            <input value={secData?.textOverlay || secData?.text || ''}
                              onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], textOverlay: e.target.value, text: e.target.value } })}
                              className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-200 bg-white" />
                            {sec.key === 'cta' && (
                              <input value={secData?.endCard || ''}
                                onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], endCard: e.target.value } })}
                                className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-200 bg-white"
                                placeholder="End card / tagline" />
                            )}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-white/70 bg-white/70 px-4 py-3 text-sm leading-6 text-gray-700">
                            <p className="whitespace-pre-line">[VISUAL] {visualContent || '-'}</p>
                            {spokenLines.characterSpeech && !characterSpeechInline && <p className="mt-1 text-gray-800 whitespace-pre-line">Lời nhân vật: {cleanSpeakerLabelsForDisplay(spokenLines.characterSpeech)}</p>}
                            {textOverlay && <p className="text-gray-800">[TEXT OVERLAY] {textOverlay}</p>}
                            {textOverlayViTranslation && <p className="text-gray-800">[DỊCH TEXT OVERLAY] {textOverlayViTranslation}</p>}
                            {textOverlay && <p className="mt-2 font-semibold text-gray-900">+ {textOverlay}</p>}
                            {sec.key === 'cta' && endCard && <p className="mt-2 text-xs text-gray-500">+ {endCard}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-400">
          <Wand2 size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="font-bold text-gray-500">
            {showFavoriteIdeas
              ? 'Chưa có idea nào được thả tim'
              : showHistory
                ? `Chưa có ý tưởng trong ${getHistoryWeekRangeLabel(historyWeekFilter).toLowerCase()}`
                : 'Chưa có ý tưởng nào'}
          </p>
          <p className="text-sm">
            {showFavoriteIdeas
              ? 'Tắt bộ lọc "Đã thả tim" hoặc thả tim ở các card để gom các idea đã chọn.'
              : showHistory
                ? 'Chọn ngày/tháng khác hoặc chọn "Tất cả lịch sử" để xem thêm.'
                : 'Bấm "Tạo thêm" để bắt đầu.'}
          </p>
        </div>
      )}
    </div>
  );


  // Results screen uses existing ScreenType routing
  if (currentScreen === 'f2.1.2') {
    return (
      <div className="p-6 sm:p-8 mx-auto transition-all duration-300 w-full max-w-[95%]">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setScreen('f2')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"><ArrowLeft /></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-800">Tạo Ý Tưởng <span className="text-gray-400 font-normal text-sm">/ {app.name}</span></h1>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          {renderResult()}
        </div>
      </div>
    );
  }

  // ===== WIZARD LAYOUT =====
  return (
    <div className="p-6 sm:p-8 mx-auto transition-all duration-300 w-full max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setScreen('f2')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"><ArrowLeft /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">Tạo Ý Tưởng <span className="text-gray-400 font-normal text-sm">/ {app.name}</span></h1>
        </div>
      </div>

      {/* ===== PROGRESS BAR ===== */}
      <div className="mb-8">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          {WIZARD_STEPS.map((step, i) => {
            const StepIcon = step.icon;
            const isActive = wizardStep === i;
            const isDone = wizardStep > i;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div className={`flex-1 h-0.5 mx-2 rounded-full transition-all duration-500 ${isDone ? 'bg-indigo-500' : 'bg-gray-200'
                    }`} />
                )}
                <button
                  onClick={() => handleJumpToStep(i)}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isActive
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-200 scale-110'
                    : isDone
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200'
                    }`}>
                    {isDone ? <Check size={18} /> : <StepIcon size={18} />}
                  </div>
                  <span className={`text-[11px] font-semibold transition-colors ${isActive ? 'text-indigo-600' : isDone ? 'text-indigo-500' : 'text-gray-400'
                    }`}>
                    {step.label}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ===== STEP CONTENT ===== */}
      <div className="min-h-[400px] animate-in fade-in duration-300" key={wizardStep}>
        {renderWizardContent()}
      </div>

      {/* ===== BOTTOM NAV ===== */}
      {wizardStep < 4 && (
        <div className="fixed bottom-6 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto bg-white/90 backdrop-blur-xl border border-gray-200 rounded-2xl p-3 pl-6 flex flex-col gap-2 max-w-2xl w-full shadow-xl">
            {/* Validation Error */}
            {validationError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-2 text-xs font-bold border border-red-200 animate-in shake duration-300">
                <AlertTriangle size={14} />
                {validationError}
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Đã chọn</span>
                <span className="font-bold text-indigo-600">{Object.values(filters).flat().length} <span className="text-xs text-gray-400 font-normal">yếu tố</span></span>
              </div>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex-1 overflow-x-auto flex gap-1.5" style={{ scrollbarWidth: 'none' }}>
                {Object.values(filters).flat().slice(0, 4).map((f, i) => (
                  <span key={i} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded whitespace-nowrap">{f}</span>
                ))}
                {Object.values(filters).flat().length > 4 && <span className="text-xs text-gray-400 self-center">+{Object.values(filters).flat().length - 4}</span>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {wizardStep > 0 && (
                  <button onClick={() => { setWizardStep(wizardStep - 1); setValidationError(null); }}
                    className="border border-gray-200 text-gray-500 rounded-full px-5 py-2.5 text-sm font-bold flex items-center gap-2 hover:bg-gray-50 transition-all">
                    <ArrowLeft size={16} /> Back
                  </button>
                )}
                <button onClick={handleNextStep}
                  className={`rounded-full px-6 py-2.5 text-sm font-bold flex items-center gap-2 transition-all ${isStepValid(wizardStep)
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}>
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
