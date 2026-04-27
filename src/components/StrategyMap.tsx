'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, Loader2, Sparkles, Copy, ChevronDown, Calendar, Plus, Link2, X, ZoomIn, ZoomOut, Scan, Minimize2, EyeOff, Search } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, StrategyMapState, StrategyMapCustomNodeState, StrategyWorkflowLevel } from '@/types/database';
import { addFilterOption, getFilterOptions, getIdeaSessions, getIdeasByIds, getStrategyMapState, isHookLibraryIdea, saveStrategyMapState, updateIdeaResult, type IdeaSession } from '@/lib/db';
import { authenticatedFetch } from '@/lib/authFetch';

type ResultType = 'win' | 'failed' | 'monitoring' | null;

interface TreeNode {
  id: string;
  label: string;
  level: 'root' | 'coreUser' | 'psp' | 'emotion' | 'visual' | 'painPoint' | 'angle';
  filters?: Partial<FilterState>;
  children: TreeNode[];
  ideas: GeneratedIdea[];
  ideaCount: number;
  wins: number;
  fails: number;
  monitoring: number;
}

// ===== Layout constants =====
const NODE_W = 220;
const NODE_H = 74;
const ROW_GAP = 42;
const LEVEL_LABEL_W = 170;
const VIEWPORT_HEIGHT = 720;
const WORKFLOW_MIN_CANVAS_WIDTH = 980;
const FIT_PADDING = 48;
const NODE_CLEARANCE = NODE_W + 24;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.8;
const FIT_VIEW_EDIT_MAX = 1.35;
const READABLE_VIEW_MIN_SCALE = 0.68;
const STRATEGY_MAP_LOCAL_BACKUP_PREFIX = 'idea_tool_strategy_map_backup:';

type WorkflowLevel = StrategyWorkflowLevel;

interface CustomWorkflowNode extends StrategyMapCustomNodeState {
  ideaCount: number;
  wins: number;
  fails: number;
  monitoring: number;
  custom: true;
}

type WorkflowNode = TreeNode | CustomWorkflowNode;

interface CustomWorkflowEdge {
  fromId: string;
  toId: string;
}

interface DragConnection {
  fromId: string;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
}

interface PendingNodePicker {
  fromId: string;
  level: WorkflowLevel;
  x: number;
  y: number;
}

interface PendingCustomNodeEditor {
  fromId: string;
  level: WorkflowLevel;
  x: number;
  y: number;
  draftLabel: string;
}

interface ManualNodePosition {
  x: number;
  y: number;
}

function isCustomWorkflowNodeId(nodeId: string) {
  return nodeId.startsWith('custom:');
}

function filterCustomManualNodePositions(positions?: Record<string, ManualNodePosition> | null): Record<string, ManualNodePosition> {
  if (!positions) return {};

  return Object.fromEntries(
    Object.entries(positions)
      .filter(([nodeId]) => isCustomWorkflowNodeId(nodeId))
      .map(([nodeId, position]) => [nodeId, { x: position.x, y: position.y }])
  );
}

interface FlatNode { node: WorkflowNode; absX: number; absY: number }
interface FlatLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  parentLevel: WorkflowLevel;
  childLevel: WorkflowLevel;
  parentId: string;
  childId: string;
  custom?: boolean;
}

type BranchGenerationStatus = 'generated' | 'ungenerated' | 'partial';

function removeHookLibrarySessions(sessions: IdeaSession[]): IdeaSession[] {
  return sessions
    .map(session => {
      const ideas = session.ideas.filter(idea => !isHookLibraryIdea(idea));
      if (ideas.length === 0) return null;
      return {
        ...session,
        ideas,
        ideaCount: ideas.length,
        createdAt: ideas[0]?.created_at || session.createdAt,
      };
    })
    .filter((session): session is IdeaSession => Boolean(session));
}

const BRANCH_STATUS_THEME: Record<BranchGenerationStatus, {
  label: string;
  icon: string;
  chipClassName: string;
  overlay: string;
  line: string;
  lineDash?: string;
}> = {
  generated: {
    label: 'Đã gen',
    icon: '✓',
    chipClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    overlay: 'rgba(16, 185, 129, 0.08)',
    line: '#10b981',
  },
  ungenerated: {
    label: 'Chưa gen',
    icon: '○',
    chipClassName: 'bg-slate-50 text-slate-500 border-slate-200',
    overlay: 'rgba(148, 163, 184, 0.10)',
    line: '#94a3b8',
    lineDash: '7 6',
  },
  partial: {
    label: 'Gen một phần',
    icon: '◐',
    chipClassName: 'bg-amber-50 text-amber-700 border-amber-200',
    overlay: 'rgba(245, 158, 11, 0.10)',
    line: '#f59e0b',
    lineDash: '10 6',
  },
};

type StrategyMapLocalBackup = {
  savedAt: number;
  state: StrategyMapState;
};

function getStrategyMapLocalBackupKey(appId: string, weekKey: string) {
  return `${STRATEGY_MAP_LOCAL_BACKUP_PREFIX}${appId}:${weekKey}`;
}

function readStrategyMapLocalBackup(appId: string, weekKey: string): StrategyMapLocalBackup | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getStrategyMapLocalBackupKey(appId, weekKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StrategyMapLocalBackup> | null;
    if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.savedAt !== 'number') return null;
    return {
      savedAt: parsed.savedAt,
      state: {
        ...parsed.state,
        savedAt: parsed.savedAt,
      },
    };
  } catch {
    return null;
  }
}

function writeStrategyMapLocalBackup(appId: string, weekKey: string, state: StrategyMapState, savedAt: number) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      getStrategyMapLocalBackupKey(appId, weekKey),
      JSON.stringify({
        savedAt,
        state: {
          ...state,
          savedAt,
        },
      } satisfies StrategyMapLocalBackup)
    );
  } catch {
    // Ignore local backup write failures.
  }
}

const LEVEL_COLORS: Record<string, { bg: string; border: string; accent: string; gradient: string; icon: string; label: string; textBg: string }> = {
  root: { bg: '#f8fafc', border: '#94a3b8', accent: '#64748b', gradient: 'linear-gradient(135deg, #64748b, #475569)', icon: '🎯', label: 'App', textBg: '#f1f5f9' },
  coreUser: { bg: '#eff6ff', border: '#93c5fd', accent: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', icon: '👤', label: 'Đối tượng', textBg: '#dbeafe' },
  psp: { bg: '#ecfdf5', border: '#6ee7b7', accent: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #059669)', icon: '💊', label: 'PSP', textBg: '#d1fae5' },
  emotion: { bg: '#f5f3ff', border: '#c4b5fd', accent: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', icon: '💜', label: 'Cảm xúc', textBg: '#ede9fe' },
  visual: { bg: '#fffbeb', border: '#fcd34d', accent: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', icon: '🎨', label: 'Visual/Theme', textBg: '#fef3c7' },
  painPoint: { bg: '#fff1f2', border: '#fda4af', accent: '#f43f5e', gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)', icon: '🔥', label: 'Nỗi đau', textBg: '#ffe4e6' },
  angle: { bg: '#f0fdfa', border: '#5eead4', accent: '#14b8a6', gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)', icon: '🧭', label: 'Angle', textBg: '#ccfbf1' },
};

const LEVEL_ORDER: WorkflowLevel[] = ['root', 'coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'];
const LEVEL_AXIS_LABELS: Record<WorkflowLevel, string> = {
  root: 'ROOT',
  coreUser: 'CORE USER',
  psp: 'PSP',
  emotion: 'EMOTION',
  visual: 'VISUAL',
  painPoint: 'PAINPOINT',
  angle: 'ANGLE',
};

const BRANCH_FILTER_FIELDS: Array<{ key: keyof FilterState; label: string; level: WorkflowLevel }> = [
  { key: 'coreUser', label: 'Core user', level: 'coreUser' },
  { key: 'solution', label: 'PSP', level: 'psp' },
  { key: 'emotion', label: 'Emotion', level: 'emotion' },
  { key: 'visualType', label: 'Visual', level: 'visual' },
  { key: 'painPoint', label: 'Painpoint', level: 'painPoint' },
  { key: 'angle', label: 'Angle', level: 'angle' },
];

const FALLBACK_OPTIONS: Record<WorkflowLevel, string[]> = {
  root: [],
  coreUser: ['User 35+ US', 'Caregiver 45+', 'Busy parent'],
  psp: ['Blood Pressure Tracker', 'Track BP by camera', 'Family alerts'],
  emotion: ['Fear / Urgency', 'Trust gap', 'Relief'],
  visual: ['UGC at home', 'Doctor demo', 'Morning routine'],
  painPoint: ['Có tiền sử BP cao nhưng không có máy ở nhà', 'Không biết số đo khi chóng mặt', 'Quên đo buổi sáng'],
  angle: ['Tủ thuốc trống', 'Vợ hỏi máy đo đâu?', 'Chỉ cần mở app'],
};

const LEVEL_TO_FILTER_KEY: Partial<Record<WorkflowLevel, keyof FilterState>> = {
  coreUser: 'coreUser',
  psp: 'solution',
  emotion: 'emotion',
  visual: 'visualType',
  painPoint: 'painPoint',
  angle: 'angle',
};

const LEVEL_TO_OPTION_CATEGORY: Partial<Record<WorkflowLevel, string>> = {
  coreUser: 'coreUser',
  psp: 'solution',
  emotion: 'emotion',
  visual: 'visualType',
  painPoint: 'painPoint',
  angle: 'angle',
};

function createEmptyWorkflowOptionValues(): Record<WorkflowLevel, string[]> {
  return {
    root: [],
    coreUser: [],
    psp: [],
    emotion: [],
    visual: [],
    painPoint: [],
    angle: [],
  };
}

function mergeUniqueLabels(...groups: Array<Array<string | null | undefined> | undefined>): string[] {
  return Array.from(
    new Set(
      groups
        .flatMap(group => group || [])
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  );
}

function mapFilterOptionsToWorkflowLevels(optionMap: Record<string, string[]>): Record<WorkflowLevel, string[]> {
  return {
    root: [],
    coreUser: optionMap.coreUser || [],
    psp: optionMap.solution || [],
    emotion: optionMap.emotion || [],
    visual: optionMap.visualType || [],
    painPoint: optionMap.painPoint || [],
    angle: optionMap.angle || [],
  };
}

function buildFallbackAnglesFromPainpoints(painpoints: string[]): string[] {
  return mergeUniqueLabels(
    ...painpoints.map(painpoint => ([
      `${painpoint} nhưng vẫn chưa biết bắt đầu từ đâu`,
      `${painpoint} và mỗi lần nhìn vào lại thấy rối hơn`,
      `${painpoint} dù đã xem rất nhiều idea trên mạng`,
    ]))
  );
}

function getNextWorkflowLevel(level: WorkflowLevel): WorkflowLevel | null {
  const currentIndex = LEVEL_ORDER.indexOf(level);
  if (currentIndex < 0 || currentIndex >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[currentIndex + 1];
}

function isTreeNode(node: WorkflowNode): node is TreeNode {
  return !('custom' in node);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cloneFilters(filters?: Partial<FilterState> | null): Partial<FilterState> {
  if (!filters) return {};
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  ) as Partial<FilterState>;
}

function withLevelFilter(filters: Partial<FilterState> | null | undefined, level: WorkflowLevel, label: string): Partial<FilterState> {
  const next = cloneFilters(filters);
  const key = LEVEL_TO_FILTER_KEY[level];
  if (key) {
    next[key] = [label];
  }
  return next;
}

function normalizeWorkflowKeyPart(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function getWorkflowNodeCanonicalKey(node: WorkflowNode): string | null {
  if (node.level === 'root') return 'root';

  const nodeLevelIndex = LEVEL_ORDER.indexOf(node.level);
  const parts: string[] = [];

  for (const level of LEVEL_ORDER) {
    if (level === 'root') continue;
    if (LEVEL_ORDER.indexOf(level) > nodeLevelIndex) break;

    const filterKey = LEVEL_TO_FILTER_KEY[level];
    if (!filterKey) continue;

    const rawValues = node.filters?.[filterKey];
    const values = (Array.isArray(rawValues) ? rawValues : [])
      .map(value => (typeof value === 'string' ? normalizeWorkflowKeyPart(value) : ''))
      .filter(Boolean)
      .sort();

    if (values.length === 0 && level === node.level) {
      values.push(normalizeWorkflowKeyPart(node.label));
    }

    if (values.length === 0) return null;
    parts.push(`${level}:${values.join(',')}`);
  }

  return parts.length > 0 ? parts.join('|') : null;
}

function buildVerticalWorkflowLayout(
  tree: TreeNode,
  customNodes: CustomWorkflowNode[],
  customEdges: CustomWorkflowEdge[],
  manualNodePositions: Record<string, ManualNodePosition>,
  hiddenNodeIds: Set<string>,
  minWidth: number
) {
  const customRows = new Map<WorkflowLevel, CustomWorkflowNode[]>();
  const treeEdges: { fromId: string; toId: string }[] = [];
  const aliasNodeIdByCustomId = new Map<string, string>();

  LEVEL_ORDER.forEach(level => {
    customRows.set(level, []);
  });

  const centerAreaX = LEVEL_LABEL_W + 48;
  const minCenter = centerAreaX + NODE_W / 2;
  const flatNodes: FlatNode[] = [];
  const posById = new Map<string, FlatNode>();
  const rowCentersByLevel = new Map<WorkflowLevel, number[]>();
  const treeRowsByLevel = new Map<WorkflowLevel, TreeNode[]>();
  let maxRight = minWidth - 32;

  LEVEL_ORDER.forEach(level => {
    rowCentersByLevel.set(level, []);
    treeRowsByLevel.set(level, []);
  });

  const getLevelY = (level: WorkflowLevel) => {
    const levelIndex = Math.max(0, LEVEL_ORDER.indexOf(level));
    return 24 + levelIndex * (NODE_H + ROW_GAP);
  };

  const registerFlatNode = (node: WorkflowNode, absX: number, absY: number) => {
    const flat = { node, absX, absY };
    flatNodes.push(flat);
    posById.set(node.id, flat);
    rowCentersByLevel.get(node.level)?.push(absX);
    maxRight = Math.max(maxRight, absX + NODE_W / 2);
    return flat;
  };

  const findAvailableRowCenter = (desiredX: number, rowCenters: number[], maxCenter: number) => {
    const clampedDesiredX = clamp(desiredX, minCenter, maxCenter);
    if (!rowCenters.some(center => Math.abs(center - clampedDesiredX) < NODE_CLEARANCE)) {
      return clampedDesiredX;
    }

    const rightSlot = rowCenters.length > 0 ? Math.max(...rowCenters) + NODE_CLEARANCE : minCenter;
    if (rightSlot <= maxCenter && !rowCenters.some(center => Math.abs(center - rightSlot) < NODE_CLEARANCE)) {
      return rightSlot;
    }

    for (let attempt = 1; attempt < 32; attempt++) {
      const rightCandidate = clamp(clampedDesiredX + attempt * NODE_CLEARANCE, minCenter, maxCenter);
      if (!rowCenters.some(center => Math.abs(center - rightCandidate) < NODE_CLEARANCE)) {
        return rightCandidate;
      }

      const leftCandidate = clamp(clampedDesiredX - attempt * NODE_CLEARANCE, minCenter, maxCenter);
      if (!rowCenters.some(center => Math.abs(center - leftCandidate) < NODE_CLEARANCE)) {
        return leftCandidate;
      }
    }

    return rowCenters.length > 0 ? Math.max(...rowCenters) + NODE_CLEARANCE : clampedDesiredX;
  };

  const compareTreeNodes = (a: TreeNode, b: TreeNode) => {
    const levelDelta = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
    if (levelDelta !== 0) return levelDelta;

    const labelDelta = a.label.localeCompare(b.label, 'vi', { numeric: true, sensitivity: 'base' });
    if (labelDelta !== 0) return labelDelta;

    return a.id.localeCompare(b.id, 'vi', { numeric: true, sensitivity: 'base' });
  };

  const sortedTreeChildren = (node: TreeNode) => [...node.children].sort(compareTreeNodes);

  const collectTreeRows = (node: TreeNode) => {
    if (hiddenNodeIds.has(node.id)) return;

    treeRowsByLevel.get(node.level)?.push(node);

    sortedTreeChildren(node).forEach(child => {
      if (hiddenNodeIds.has(child.id)) return;
      treeEdges.push({ fromId: node.id, toId: child.id });
      collectTreeRows(child);
    });
  };

  collectTreeRows(tree);

  const visibleTreeNodeIdByKey = new Map<string, string>();
  LEVEL_ORDER.forEach(level => {
    (treeRowsByLevel.get(level) || []).forEach(node => {
      const key = getWorkflowNodeCanonicalKey(node);
      if (key && !visibleTreeNodeIdByKey.has(key)) {
        visibleTreeNodeIdByKey.set(key, node.id);
      }
    });
  });

  customNodes.forEach(node => {
    if (hiddenNodeIds.has(node.id)) return;

    const matchingTreeNodeId = visibleTreeNodeIdByKey.get(getWorkflowNodeCanonicalKey(node) || '');
    if (matchingTreeNodeId) {
      aliasNodeIdByCustomId.set(node.id, matchingTreeNodeId);
      return;
    }

    customRows.get(node.level)?.push(node);
  });

  LEVEL_ORDER.forEach(level => {
    const y = getLevelY(level);
    const treeRow = treeRowsByLevel.get(level) || [];
    treeRow.forEach((node, index) => {
      registerFlatNode(node, minCenter + index * NODE_CLEARANCE, y);
    });
  });

  const baseCanvasW = Math.max(minWidth, maxRight + 48, LEVEL_LABEL_W + NODE_W + 96);

  LEVEL_ORDER.forEach((level, levelIndex) => {
    const y = 24 + levelIndex * (NODE_H + ROW_GAP);
    const rowCenters = rowCentersByLevel.get(level) || [];

    const customRow = [...(customRows.get(level) || [])].sort((a, b) => {
      const ax = typeof a.preferredX === 'number' ? a.preferredX : Number.MAX_SAFE_INTEGER;
      const bx = typeof b.preferredX === 'number' ? b.preferredX : Number.MAX_SAFE_INTEGER;
      return ax - bx;
    });

    customRow.forEach((node, index) => {
      const manualPosition = manualNodePositions[node.id];
      const rightMostRowCenter = rowCenters.length > 0 ? Math.max(...rowCenters) : minCenter - NODE_CLEARANCE;
      const fallbackX = rightMostRowCenter + NODE_CLEARANCE * (index + 1);
      const resolvedY = manualPosition?.y ?? y;
      const preferredX = typeof manualPosition?.x === 'number'
        ? manualPosition.x
        : typeof node.preferredX === 'number'
          ? node.preferredX
          : fallbackX;
      const maxCenter = Math.max(minCenter, baseCanvasW - NODE_W / 2 - 32 + (customRow.length + 1) * NODE_CLEARANCE);
      const resolvedX = findAvailableRowCenter(preferredX, rowCenters, maxCenter);

      registerFlatNode(node, resolvedX, resolvedY);
    });
  });

  const canvasW = Math.max(baseCanvasW, maxRight + 48, LEVEL_LABEL_W + NODE_W + 96);
  flatNodes.sort((a, b) => LEVEL_ORDER.indexOf(a.node.level) - LEVEL_ORDER.indexOf(b.node.level));

  const makeLine = (edge: { fromId: string; toId: string }, custom = false): FlatLine | null => {
    const from = posById.get(edge.fromId);
    const to = posById.get(edge.toId);
    if (!from || !to) return null;

    return {
      x1: from.absX,
      y1: from.absY + NODE_H,
      x2: to.absX,
      y2: to.absY,
      parentLevel: from.node.level,
      childLevel: to.node.level,
      parentId: from.node.id,
      childId: to.node.id,
      custom,
    };
  };

  const resolvedCustomEdges = Array.from(
    new Map(
      customEdges
        .map(edge => ({
          fromId: aliasNodeIdByCustomId.get(edge.fromId) || edge.fromId,
          toId: aliasNodeIdByCustomId.get(edge.toId) || edge.toId,
        }))
        .filter(edge => edge.fromId !== edge.toId)
        .map(edge => [`${edge.fromId}->${edge.toId}`, edge] as const)
    ).values()
  );

  const flatLines = [
    ...treeEdges.map(edge => makeLine(edge)).filter((line): line is FlatLine => !!line),
    ...resolvedCustomEdges.map(edge => makeLine(edge, true)).filter((line): line is FlatLine => !!line),
  ];

  return {
    flatNodes,
    flatLines,
    canvasW,
    canvasH: 24 + LEVEL_ORDER.length * NODE_H + (LEVEL_ORDER.length - 1) * ROW_GAP + 32,
  };
}

// ===== Week helpers =====
function toLocalNoonDate(input: string | Date): Date {
  const source = input instanceof Date ? input : new Date(input);
  return new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate(),
    12, 0, 0, 0
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfIsoWeek(input: string | Date): Date {
  const date = toLocalNoonDate(input);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return date;
}

function getWeekInfo(input: string | Date) {
  const monday = startOfIsoWeek(input);
  const thursday = addDays(monday, 3);
  const weekYear = thursday.getFullYear();
  const firstWeekMonday = startOfIsoWeek(new Date(weekYear, 0, 4));
  const diffMs = monday.getTime() - firstWeekMonday.getTime();
  const weekNumber = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;

  return {
    monday,
    weekYear,
    weekNumber,
  };
}

function getWeekKey(dateInput: string | Date): string {
  const { weekYear, weekNumber } = getWeekInfo(dateInput);
  return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function getMondayOfWeek(year: number, week: number): Date {
  const firstWeekMonday = startOfIsoWeek(new Date(year, 0, 4));
  return addDays(firstWeekMonday, (week - 1) * 7);
}

function getWeekRange(weekKey: string): string {
  const [yearStr, wStr] = weekKey.split('-W');
  const monday = getMondayOfWeek(parseInt(yearStr), parseInt(wStr));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth() + 1).padStart(2,'0')}`;
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function getWeekMonthLabel(weekKey: string): string {
  const [yearStr, wStr] = weekKey.split('-W');
  const monday = getMondayOfWeek(parseInt(yearStr), parseInt(wStr));
  const months = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  return `${months[monday.getMonth()]} / ${monday.getFullYear()}`;
}

function getWeekNumber(weekKey: string): number {
  return parseInt(weekKey.split('-W')[1]);
}

// Generate weeks from the oldest history week through the end of the visible planning year.
function generateWeekTimeline(historyWeekKeys: string[] = []): { key: string; label: string }[] {
  const now = new Date();
  const currentWeek = getWeekInfo(now);
  const historyMondays = historyWeekKeys
    .map(key => {
      const [yearStr, wStr] = key.split('-W');
      const year = Number.parseInt(yearStr, 10);
      const week = Number.parseInt(wStr, 10);
      if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
      return getMondayOfWeek(year, week);
    })
    .filter((date): date is Date => !!date && !Number.isNaN(date.getTime()));
  const startTime = Math.min(
    currentWeek.monday.getTime(),
    ...historyMondays.map(date => date.getTime())
  );
  const endYear = Math.max(
    now.getFullYear(),
    ...historyMondays.map(date => date.getFullYear())
  );
  const endDate = new Date(endYear, 11, 31, 12, 0, 0, 0);
  const result: { key: string; label: string }[] = [];

  let monday = new Date(startTime);

  while (monday <= endDate) {
    const key = getWeekKey(monday);
    if (!result.find(r => r.key === key)) {
      result.push({ key, label: getWeekRange(key) });
    }
    monday = addDays(monday, 7);
  }
  return result;
}

interface StrategyMapProps {
  app: AppProject;
  onBack: () => void;
  inline?: boolean;
  onCreateFromBranch?: (filters: Partial<FilterState>) => void;
}

function normalizeFilterSnapshot(value: unknown): Partial<FilterState> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => {
        if (!Array.isArray(raw)) return [key, []] as const;
        const values = raw
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map(item => item.trim());
        return [key, values] as const;
      })
      .filter(([, values]) => values.length > 0)
  ) as Partial<FilterState>;
}

function toResultType(value: unknown): ResultType {
  return value === 'win' || value === 'failed' || value === 'monitoring' ? value : null;
}

function hydrateCustomNodes(savedNodes: StrategyMapCustomNodeState[] | undefined): CustomWorkflowNode[] {
  return (savedNodes || []).map(node => ({
    ...node,
    filters: cloneFilters(node.filters),
    ideaCount: 0,
    wins: 0,
    fails: 0,
    monitoring: 0,
    custom: true,
  }));
}

function getMaxCustomNodeSequence(nodes: StrategyMapCustomNodeState[] | undefined) {
  return (nodes || []).reduce((max, node) => {
    const match = node.id.match(/^custom:[^:]+:(\d+)$/);
    const seq = match ? Number(match[1]) : 0;
    return Number.isFinite(seq) ? Math.max(max, seq) : max;
  }, 0);
}

export const StrategyMap: React.FC<StrategyMapProps> = ({ app, onBack, inline = false, onCreateFromBranch }) => {
  const [sessions, setSessions] = useState<IdeaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [ideaResults, setIdeaResults] = useState<Record<string, ResultType>>({});
  const [ideaDetailCache, setIdeaDetailCache] = useState<Record<string, GeneratedIdea>>({});
  const [loadingIdeaDetails, setLoadingIdeaDetails] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string>(() => getWeekKey(new Date()));
  const [showWeekDropdown, setShowWeekDropdown] = useState(false);
  const [containerWidth, setContainerWidth] = useState(900);
  const [storedOptionValues, setStoredOptionValues] = useState<Record<WorkflowLevel, string[]>>(() => createEmptyWorkflowOptionValues());
  const [customNodes, setCustomNodes] = useState<CustomWorkflowNode[]>([]);
  const [customEdges, setCustomEdges] = useState<CustomWorkflowEdge[]>([]);
  const [manualNodePositions, setManualNodePositions] = useState<Record<string, ManualNodePosition>>({});
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  const [dragConnection, setDragConnection] = useState<DragConnection | null>(null);
  const [pendingNodePicker, setPendingNodePicker] = useState<PendingNodePicker | null>(null);
  const [pendingCustomNodeEditor, setPendingCustomNodeEditor] = useState<PendingCustomNodeEditor | null>(null);
  const [generatedAngleOptions, setGeneratedAngleOptions] = useState<string[]>([]);
  const [isGeneratingAngleOptions, setIsGeneratingAngleOptions] = useState(false);
  const [selectedCustomNodeId, setSelectedCustomNodeId] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [draggedCustomNodeId, setDraggedCustomNodeId] = useState<string | null>(null);
  const [isFullView, setIsFullView] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 1200, height: 900 });
  const [strategyStateHydrated, setStrategyStateHydrated] = useState(false);
  const [strategyStateStatus, setStrategyStateStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [showOnlyUngenerated, setShowOnlyUngenerated] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const customNodeSeqRef = useRef(0);
  const droppedOnHandleRef = useRef(false);
  const autoFitPendingRef = useRef(true);
  const panSessionRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const customNodeDragRef = useRef<{ nodeId: string; pointerId: number; startClientX: number; startClientY: number; startNodeX: number; startNodeY: number; moved: boolean } | null>(null);
  const suppressNodeClickRef = useRef(false);
  const pendingFullViewFitRef = useRef(false);
  const angleSuggestionSeqRef = useRef(0);
  const lastSavedStrategyStateRef = useRef('');
  const latestStrategyMapSnapshotRef = useRef<StrategyMapState | null>(null);
  const latestStrategyMapPayloadRef = useRef('');

  const cancelActiveDraft = useCallback(() => {
    droppedOnHandleRef.current = false;
    setDragConnection(null);
    setPendingNodePicker(null);
    setPendingCustomNodeEditor(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setIdeaDetailCache({});
      setLoadingIdeaDetails(false);
      const [data, savedOptionMap] = await Promise.all([
        getIdeaSessions(app.id, { includeContent: false }),
        getFilterOptions(app),
      ]);
      if (cancelled) return;

      const visibleSessions = removeHookLibrarySessions(data);
      setSessions(visibleSessions);
      setStoredOptionValues(mapFilterOptionsToWorkflowLevels(savedOptionMap));
      const r: Record<string, ResultType> = {};
      visibleSessions.forEach(s => s.ideas.forEach(i => { r[i.id] = toResultType(i.result); }));
      setIdeaResults(r);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [app, app.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowWeekDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (loading) return;

    const node = treeContainerRef.current;
    if (!node) return;

    const updateWidth = () => setContainerWidth(node.clientWidth || 900);
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [loading]);

  useEffect(() => {
    const updateWindowSize = () => setWindowSize({
      width: window.innerWidth || 1200,
      height: window.innerHeight || 900,
    });
    updateWindowSize();
    window.addEventListener('resize', updateWindowSize);
    return () => window.removeEventListener('resize', updateWindowSize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dragConnection || pendingNodePicker || pendingCustomNodeEditor) {
        cancelActiveDraft();
        return;
      }
      if (isFullView) {
        setIsFullView(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelActiveDraft, dragConnection, isFullView, pendingCustomNodeEditor, pendingNodePicker]);

  useEffect(() => {
    if (!isFullView) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullView]);

  useEffect(() => {
    let cancelled = false;

    autoFitPendingRef.current = true;
    setStrategyStateHydrated(false);
    setStrategyStateStatus('loading');
    setCustomNodes([]);
    setCustomEdges([]);
    setManualNodePositions({});
    setHiddenNodeIds([]);
    setPendingNodePicker(null);
    setPendingCustomNodeEditor(null);
    setDragConnection(null);
    customNodeDragRef.current = null;
    setDraggedCustomNodeId(null);
    setSelectedCustomNodeId(null);
    setGeneratedAngleOptions([]);
    setIsGeneratingAngleOptions(false);
    angleSuggestionSeqRef.current += 1;

    (async () => {
      const savedState = await getStrategyMapState(app.id, selectedWeek);
      if (cancelled) return;

      const localBackup = readStrategyMapLocalBackup(app.id, selectedWeek);
      const shouldPreferLocal =
        !!localBackup && (!savedState || localBackup.savedAt > (savedState.savedAt || 0));

      const nextState: StrategyMapState = (shouldPreferLocal ? localBackup?.state : savedState) || {
        version: 1,
        weekKey: selectedWeek,
        customNodes: [],
        customEdges: [],
        manualNodePositions: {},
        hiddenNodeIds: [],
      };

      setCustomNodes(hydrateCustomNodes(nextState.customNodes));
      setCustomEdges((nextState.customEdges || []).map(edge => ({ fromId: edge.fromId, toId: edge.toId })));
      setManualNodePositions(filterCustomManualNodePositions(nextState.manualNodePositions));
      setHiddenNodeIds(nextState.hiddenNodeIds || []);
      customNodeSeqRef.current = getMaxCustomNodeSequence(nextState.customNodes);
      lastSavedStrategyStateRef.current = shouldPreferLocal
        ? JSON.stringify(savedState || {})
        : JSON.stringify(nextState);
      setStrategyStateHydrated(true);
      setStrategyStateStatus(shouldPreferLocal ? 'saving' : 'saved');
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWeek, app.id]);

  // ===== Count ideas per week (for badges) =====
  const weekIdeaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.forEach(s => {
      const wk = getWeekKey(s.createdAt);
      counts.set(wk, (counts.get(wk) || 0) + s.ideas.length);
    });
    return counts;
  }, [sessions]);

  // ===== Full weekly timeline: history weeks + current week → year end =====
  const allWeeks = useMemo(() => generateWeekTimeline(Array.from(weekIdeaCounts.keys())), [weekIdeaCounts]);

  const optionValuesByLevel = useMemo(() => {
    const values: Record<WorkflowLevel, Set<string>> = {
      root: new Set<string>(),
      coreUser: new Set<string>(),
      psp: new Set<string>(),
      emotion: new Set<string>(),
      visual: new Set<string>(),
      painPoint: new Set<string>(),
      angle: new Set<string>(),
    };

    sessions.forEach(session => {
      session.ideas.forEach(idea => {
        const filters = normalizeFilterSnapshot(idea.filters_snapshot || session.filters);
        (filters.coreUser || []).forEach(value => values.coreUser.add(value));
        (filters.solution || []).forEach(value => values.psp.add(value));
        (filters.emotion || []).forEach(value => values.emotion.add(value));
        (filters.visualType || []).forEach(value => values.visual.add(value));
        (filters.painPoint || []).forEach(value => values.painPoint.add(value));
        (filters.angle || []).forEach(value => values.angle.add(value));
      });
    });

    return Object.fromEntries(
      LEVEL_ORDER.map(level => {
        const fromApp = Array.from(values[level]).filter(Boolean);
        return [level, mergeUniqueLabels(storedOptionValues[level], fromApp, FALLBACK_OPTIONS[level])];
      })
    ) as Record<WorkflowLevel, string[]>;
  }, [sessions, storedOptionValues]);

  // Current week key for highlighting
  const currentWeekKey = useMemo(() => getWeekKey(new Date()), []);

  // Group weeks by month for dropdown
  const weeksGroupedByMonth = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; weekNum: number }[]>();
    allWeeks.forEach(w => {
      const monthLabel = getWeekMonthLabel(w.key);
      if (!groups.has(monthLabel)) groups.set(monthLabel, []);
      groups.get(monthLabel)!.push({ ...w, weekNum: getWeekNumber(w.key) });
    });
    return groups;
  }, [allWeeks]);

  // Selected week display label
  const selectedWeekLabel = useMemo(() => {
    if (selectedWeek === 'all') return 'Tất cả';
    if (selectedWeek === currentWeekKey) return 'Tuần này';
    const w = allWeeks.find(w => w.key === selectedWeek);
    return w ? w.label : selectedWeek;
  }, [selectedWeek, currentWeekKey, allWeeks]);

  // ===== Filter sessions by selected week =====
  const filteredSessions = useMemo(() => {
    if (selectedWeek === 'all') return sessions;
    return sessions.filter(s => getWeekKey(s.createdAt) === selectedWeek);
  }, [sessions, selectedWeek]);

  const strategyMapSnapshot = useMemo<StrategyMapState>(() => ({
    version: 1,
    weekKey: selectedWeek,
    customNodes: customNodes.map(node => ({
      id: node.id,
      label: node.label,
      level: node.level,
      preferredX: node.preferredX,
      filters: cloneFilters(node.filters),
    })),
    customEdges: customEdges.map(edge => ({ fromId: edge.fromId, toId: edge.toId })),
    manualNodePositions: filterCustomManualNodePositions(manualNodePositions),
    hiddenNodeIds: Array.from(new Set(hiddenNodeIds)).sort(),
  }), [customEdges, customNodes, hiddenNodeIds, manualNodePositions, selectedWeek]);

  const strategyMapPayload = useMemo(() => JSON.stringify(strategyMapSnapshot), [strategyMapSnapshot]);

  useEffect(() => {
    latestStrategyMapSnapshotRef.current = strategyMapSnapshot;
    latestStrategyMapPayloadRef.current = strategyMapPayload;
  }, [strategyMapPayload, strategyMapSnapshot]);

  useEffect(() => {
    if (!strategyStateHydrated) return;
    const backupSavedAt = Date.now();
    writeStrategyMapLocalBackup(app.id, selectedWeek, strategyMapSnapshot, backupSavedAt);
  }, [app.id, selectedWeek, strategyMapSnapshot, strategyStateHydrated]);

  useEffect(() => {
    if (!strategyStateHydrated) return;
    if (strategyMapPayload === lastSavedStrategyStateRef.current) return;

    let cancelled = false;
    setStrategyStateStatus('saving');

    const saveId = window.setTimeout(async () => {
      const savedAt = Date.now();
      const saved = await saveStrategyMapState(app.id, selectedWeek, { ...strategyMapSnapshot, savedAt });
      if (cancelled) return;
      if (saved) {
        lastSavedStrategyStateRef.current = strategyMapPayload;
        setStrategyStateStatus('saved');
      } else {
        setStrategyStateStatus('error');
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(saveId);
    };
  }, [app.id, selectedWeek, strategyMapPayload, strategyMapSnapshot, strategyStateHydrated]);

  useEffect(() => {
    if (!strategyStateHydrated) return;

    const flushPendingStrategyState = () => {
      const snapshot = latestStrategyMapSnapshotRef.current;
      const payload = latestStrategyMapPayloadRef.current;
      if (!snapshot || payload === lastSavedStrategyStateRef.current) return;

      const savedAt = Date.now();
      writeStrategyMapLocalBackup(app.id, selectedWeek, snapshot, savedAt);
      saveStrategyMapState(app.id, selectedWeek, { ...snapshot, savedAt }).then(saved => {
        if (saved) {
          lastSavedStrategyStateRef.current = payload;
          setStrategyStateStatus('saved');
        }
      }).catch(() => {
        // Ignore unload flush errors; local backup remains available.
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingStrategyState();
      }
    };

    window.addEventListener('pagehide', flushPendingStrategyState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushPendingStrategyState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [app.id, selectedWeek, strategyStateHydrated]);

  // Build tree: root → coreUser → psp → emotion → visual → painPoint → angle
  // Skip levels where filter value is empty (no "Chung" nodes)
  const tree = useMemo((): TreeNode => {
    const root: TreeNode = { id: 'root', label: app.name, level: 'root', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 };
    const mkNode = (id: string, label: string, level: TreeNode['level'], filters?: Partial<FilterState>): TreeNode => ({
      id,
      label,
      level,
      filters,
      children: [],
      ideas: [],
      ideaCount: 0,
      wins: 0,
      fails: 0,
      monitoring: 0,
    });

    filteredSessions.forEach(session => {
      session.ideas.forEach((idea) => {
        const f = normalizeFilterSnapshot(idea.filters_snapshot || session.filters);
        if (Object.keys(f).length === 0) return;

        const cuVals = (f.coreUser || []) as string[];
        const pspVals = (f.solution || []) as string[];
        const emVals = (f.emotion || []) as string[];
        const visVals = (f.visualType || []) as string[];
        const ppVals = (f.painPoint || []) as string[];
        const angleVals = (f.angle || []) as string[];

        const result = ideaResults[idea.id] || toResultType(idea.result);
        const findAncestors = (node: TreeNode, target: string, path: TreeNode[]): TreeNode[] | null => {
          const np = [...path, node];
          if (node.id === target) return np;
          for (const c of node.children) { const r = findAncestors(c, target, np); if (r) return r; }
          return null;
        };
        const addIdeaToNode = (target: TreeNode) => {
          target.ideas.push(idea);
          const ancestors = findAncestors(root, target.id, []) || [target];
          ancestors.forEach(n => {
            n.ideaCount++;
            if (result === 'win') n.wins++;
            if (result === 'failed') n.fails++;
            if (result === 'monitoring') n.monitoring++;
          });
        };

        const baseLevels: { label: string; level: TreeNode['level']; key: string }[] = [];
        if (cuVals.length > 0) baseLevels.push({ label: cuVals.join(', '), level: 'coreUser', key: cuVals.join(',') });
        if (pspVals.length > 0) baseLevels.push({ label: pspVals.join(', '), level: 'psp', key: pspVals.join(',') });
        if (emVals.length > 0) baseLevels.push({ label: emVals.join(', '), level: 'emotion', key: emVals.join(',') });
        if (visVals.length > 0) baseLevels.push({ label: visVals.join(', '), level: 'visual', key: visVals.join(',') });
        if (ppVals.length > 0) baseLevels.push({ label: ppVals.join(', '), level: 'painPoint', key: ppVals.join(',') });

        let parent = root;
        let pathKey = '';
        for (const lvl of baseLevels) {
          pathKey += `|${lvl.key}`;
          const nodeId = `${lvl.level}:${pathKey}`;
          let node = parent.children.find(c => c.id === nodeId);
          if (!node) {
            node = mkNode(nodeId, lvl.label, lvl.level, f);
            parent.children.push(node);
          } else if (!node.filters || Object.keys(node.filters).length === 0) {
            node.filters = f;
          }
          parent = node;
        }

        if (angleVals.length > 0) {
          angleVals.forEach(angle => {
            const anglePath = `${pathKey}|${angle}`;
            const nodeId = `angle:${anglePath}`;
            let angleNode = parent.children.find(c => c.id === nodeId);
            if (!angleNode) {
              angleNode = mkNode(nodeId, angle, 'angle', f);
              parent.children.push(angleNode);
            } else if (!angleNode.filters || Object.keys(angleNode.filters).length === 0) {
              angleNode.filters = f;
            }
            addIdeaToNode(angleNode);
          });
        } else {
          addIdeaToNode(parent);
        }
      });
    });
    return root;
  }, [filteredSessions, ideaResults, app.name]);

  const workflowAdjacency = useMemo(() => {
    const adjacency = new Map<string, Set<string>>();
    const addEdge = (fromId: string, toId: string) => {
      if (!adjacency.has(fromId)) adjacency.set(fromId, new Set<string>());
      adjacency.get(fromId)!.add(toId);
    };

    const walkTree = (node: TreeNode) => {
      node.children.forEach(child => {
        addEdge(node.id, child.id);
        walkTree(child);
      });
    };

    walkTree(tree);
    customEdges.forEach(edge => addEdge(edge.fromId, edge.toId));

    return adjacency;
  }, [customEdges, tree]);

  const workflowParentAdjacency = useMemo(() => {
    const adjacency = new Map<string, Set<string>>();
    workflowAdjacency.forEach((children, parentId) => {
      children.forEach(childId => {
        if (!adjacency.has(childId)) adjacency.set(childId, new Set<string>());
        adjacency.get(childId)!.add(parentId);
      });
    });
    return adjacency;
  }, [workflowAdjacency]);

  const workflowNodeRegistry = useMemo(() => {
    const registry = new Map<string, WorkflowNode>();
    const walkTree = (node: TreeNode) => {
      registry.set(node.id, node);
      node.children.forEach(walkTree);
    };
    walkTree(tree);
    customNodes.forEach(node => registry.set(node.id, node));
    return registry;
  }, [customNodes, tree]);

  const branchStatusByNodeId = useMemo(() => {
    const cache = new Map<string, BranchGenerationStatus>();
    const visiting = new Set<string>();

    const resolveStatus = (nodeId: string): BranchGenerationStatus => {
      if (cache.has(nodeId)) return cache.get(nodeId)!;
      if (visiting.has(nodeId)) return 'ungenerated';
      visiting.add(nodeId);

      const node = workflowNodeRegistry.get(nodeId);
      const ownIdeas = node?.ideaCount || 0;
      const childStatuses = Array.from(workflowAdjacency.get(nodeId) || []).map(resolveStatus);

      let nextStatus: BranchGenerationStatus;
      if (ownIdeas > 0) {
        nextStatus = 'generated';
      } else if (childStatuses.some(status => status === 'generated' || status === 'partial')) {
        nextStatus = 'partial';
      } else {
        nextStatus = 'ungenerated';
      }

      visiting.delete(nodeId);
      cache.set(nodeId, nextStatus);
      return nextStatus;
    };

    Array.from(workflowNodeRegistry.keys()).forEach(resolveStatus);
    return cache;
  }, [workflowAdjacency, workflowNodeRegistry]);

  const onlyUngeneratedVisibleNodeIds = useMemo(() => {
    if (!showOnlyUngenerated) return null;

    const keep = new Set<string>();
    const stack = Array.from(branchStatusByNodeId.entries())
      .filter(([, status]) => status === 'ungenerated')
      .map(([nodeId]) => nodeId);

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId || keep.has(currentId)) continue;
      keep.add(currentId);
      Array.from(workflowParentAdjacency.get(currentId) || []).forEach(parentId => {
        if (!keep.has(parentId)) stack.push(parentId);
      });
    }

    keep.add('root');
    return keep;
  }, [branchStatusByNodeId, showOnlyUngenerated, workflowParentAdjacency]);

  const effectiveHiddenNodeIdSet = useMemo(() => {
    const next = new Set(hiddenNodeIds);
    if (showOnlyUngenerated && onlyUngeneratedVisibleNodeIds) {
      workflowNodeRegistry.forEach((_, nodeId) => {
        if (!onlyUngeneratedVisibleNodeIds.has(nodeId)) next.add(nodeId);
      });
    }
    return next;
  }, [hiddenNodeIds, onlyUngeneratedVisibleNodeIds, showOnlyUngenerated, workflowNodeRegistry]);
  const visibleLayoutSignature = useMemo(() => (
    Array.from(effectiveHiddenNodeIdSet).sort().join('|')
  ), [effectiveHiddenNodeIdSet]);

  const collectBranchNodeIds = useCallback((startNodeId: string) => {
    const visited = new Set<string>();
    const stack = [startNodeId];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      const children = workflowAdjacency.get(currentId);
      if (!children) continue;
      children.forEach(childId => {
        if (!visited.has(childId)) stack.push(childId);
      });
    }

    return Array.from(visited);
  }, [workflowAdjacency]);

  // Stats
  const stats = useMemo(() => {
    const cu = new Set<string>(), em = new Set<string>(), pp = new Set<string>(), psp = new Set<string>();
    const walkTree = (node: TreeNode) => {
      if (node.level === 'coreUser') cu.add(node.label);
      if (node.level === 'psp') psp.add(node.label);
      if (node.level === 'emotion') em.add(node.label);
      if (node.level === 'painPoint') pp.add(node.label);
      node.children.forEach(walkTree);
    };
    walkTree(tree);
    return { cu: cu.size, em: em.size, pp: pp.size, psp: psp.size, total: tree.ideaCount, wins: tree.wins, fails: tree.fails, monitoring: tree.monitoring };
  }, [tree]);

  // Compute vertical workflow layout: level labels are stacked on the Y axis.
  const { flatNodes, flatLines, canvasW, canvasH } = useMemo(() => {
    return buildVerticalWorkflowLayout(tree, customNodes, customEdges, manualNodePositions, effectiveHiddenNodeIdSet, WORKFLOW_MIN_CANVAS_WIDTH);
  }, [tree, customNodes, customEdges, manualNodePositions, effectiveHiddenNodeIdSet]);

  const viewportWidth = isFullView ? Math.max(windowSize.width, 640) : Math.max(containerWidth - 8, 640);
  const viewportHeight = isFullView
    ? Math.max(windowSize.height - 104, 560)
    : inline ? Math.min(620, VIEWPORT_HEIGHT - 80) : VIEWPORT_HEIGHT;
  const workflowNodeById = useMemo(() => {
    return new Map(flatNodes.map(item => [item.node.id, item.node] as const));
  }, [flatNodes]);

  const workflowFlatNodeById = useMemo(() => {
    return new Map(flatNodes.map(item => [item.node.id, item] as const));
  }, [flatNodes]);

  const contentBounds = useMemo(() => {
    if (flatNodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: canvasW,
        maxY: canvasH,
        width: canvasW,
        height: canvasH,
      };
    }

    const maxRight = Math.max(...flatNodes.map(({ absX }) => absX + NODE_W / 2), LEVEL_LABEL_W - 12) + 24;
    const maxBottom = Math.max(...flatNodes.map(({ absY }) => absY + NODE_H)) + 24;
    const minX = 12;
    const minY = 16;

    return {
      minX,
      minY,
      maxX: maxRight,
      maxY: maxBottom,
      width: Math.max(1, maxRight - minX),
      height: Math.max(1, maxBottom - minY),
    };
  }, [canvasH, canvasW, flatNodes]);

  const draftPreviewConnection = useMemo(() => {
    const draft = pendingCustomNodeEditor ?? pendingNodePicker;
    if (!draft) return null;

    const source = workflowFlatNodeById.get(draft.fromId);
    if (!source) return null;

    const panelMargin = pendingCustomNodeEditor ? 340 : 320;
    const panelLeft = Math.min(Math.max(draft.x + 16, LEVEL_LABEL_W + 20), canvasW - panelMargin);

    return {
      fromX: source.absX,
      fromY: source.absY + NODE_H,
      toX: panelLeft,
      toY: draft.y + 58,
      level: source.node.level,
    };
  }, [canvasW, pendingCustomNodeEditor, pendingNodePicker, workflowFlatNodeById]);

  const clampPanToViewport = useCallback((
    nextPan: { x: number; y: number },
    scale: number,
    options?: { centerWhenSmaller?: boolean }
  ) => {
    const centerWhenSmaller = options?.centerWhenSmaller ?? true;
    const topPadding = 18;
    const visibleWidth = contentBounds.width * scale;
    const visibleHeight = contentBounds.height * scale;
    const rawPanX1 = viewportWidth - FIT_PADDING - contentBounds.maxX * scale;
    const rawPanX2 = FIT_PADDING - contentBounds.minX * scale;
    const minPanX = Math.min(rawPanX1, rawPanX2);
    const maxPanX = Math.max(rawPanX1, rawPanX2);
    const rawPanY1 = viewportHeight - FIT_PADDING - contentBounds.maxY * scale;
    const rawPanY2 = topPadding - contentBounds.minY * scale;
    const minPanY = Math.min(rawPanY1, rawPanY2);
    const maxPanY = Math.max(rawPanY1, rawPanY2);

    let x = nextPan.x;
    if (centerWhenSmaller && visibleWidth <= viewportWidth - FIT_PADDING * 2) {
      x = Math.round((viewportWidth - visibleWidth) / 2 - contentBounds.minX * scale);
    } else {
      x = clamp(nextPan.x, minPanX, maxPanX);
    }

    let y = nextPan.y;
    if (centerWhenSmaller && visibleHeight <= viewportHeight - topPadding - FIT_PADDING) {
      const availableHeight = viewportHeight - topPadding - FIT_PADDING;
      y = Math.round(topPadding + (availableHeight - visibleHeight) / 2 - contentBounds.minY * scale);
    } else {
      y = clamp(nextPan.y, minPanY, maxPanY);
    }

    return { x, y };
  }, [contentBounds.height, contentBounds.maxX, contentBounds.maxY, contentBounds.minX, contentBounds.minY, contentBounds.width, viewportHeight, viewportWidth]);

  const getViewportZoomAnchor = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + Math.min(rect.height * 0.34, 220),
    };
  }, []);

  const fitView = useCallback((options?: { animate?: boolean; mode?: 'auto' | 'edit' | 'readable' }) => {
    const animate = options?.animate ?? true;
    const mode = options?.mode ?? 'edit';
    const widthScale = (viewportWidth - FIT_PADDING * 2) / contentBounds.width;
    const heightScale = (viewportHeight - FIT_PADDING - 18) / contentBounds.height;
    const fitAllScale = Math.min(widthScale, heightScale, 1);
    const targetScale = mode === 'auto'
      ? fitAllScale
      : mode === 'readable'
        ? Math.max(fitAllScale, READABLE_VIEW_MIN_SCALE)
        : widthScale;
    const nextScale = clamp(
      targetScale,
      ZOOM_MIN,
      mode === 'edit' ? Math.min(ZOOM_MAX, FIT_VIEW_EDIT_MAX) : 1
    );
    const availableHeight = viewportHeight - 18 - FIT_PADDING;
    const nextPan = clampPanToViewport({
      x: Math.round((viewportWidth - contentBounds.width * nextScale) / 2 - contentBounds.minX * nextScale),
      y: Math.round(18 + (availableHeight - contentBounds.height * nextScale) / 2 - contentBounds.minY * nextScale),
    }, nextScale);
    setViewScale(nextScale);
    setViewPan(nextPan);
    if (!animate) {
      setIsPanning(false);
    }
  }, [clampPanToViewport, contentBounds.height, contentBounds.minX, contentBounds.minY, contentBounds.width, viewportHeight, viewportWidth]);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - viewPan.x) / viewScale,
      y: (clientY - rect.top - viewPan.y) / viewScale,
    };
  }, [viewPan.x, viewPan.y, viewScale]);

  useEffect(() => {
    if (!viewportWidth || !viewportHeight) return;
    if (!autoFitPendingRef.current && (viewScale > 0 || viewPan.x !== 0 || viewPan.y !== 0)) return;
    const fitId = window.requestAnimationFrame(() => {
      fitView({ animate: false, mode: 'readable' });
      autoFitPendingRef.current = false;
    });
    return () => window.cancelAnimationFrame(fitId);
  }, [canvasW, canvasH, fitView, viewportHeight, viewportWidth, viewPan.x, viewPan.y, viewScale, visibleLayoutSignature]);

  useEffect(() => {
    if (!pendingFullViewFitRef.current || !isFullView) return;
    const fitId = window.requestAnimationFrame(() => {
      fitView({ mode: 'edit' });
      pendingFullViewFitRef.current = false;
    });
    return () => window.cancelAnimationFrame(fitId);
  }, [fitView, isFullView, viewportHeight, viewportWidth]);

  useEffect(() => {
    if (!dragConnection) return;

    const handleMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      setDragConnection(prev => prev ? { ...prev, x: point.x, y: point.y } : prev);
    };

    const handleUp = (event: PointerEvent) => {
      if (droppedOnHandleRef.current) {
        droppedOnHandleRef.current = false;
        return;
      }

      const sourceNode = workflowNodeById.get(dragConnection.fromId);
      const nextLevel = sourceNode ? getNextWorkflowLevel(sourceNode.level) : null;
      const point = getCanvasPoint(event.clientX, event.clientY);

      if (nextLevel) {
        setPendingNodePicker({
          fromId: dragConnection.fromId,
          level: nextLevel,
          x: Math.max(LEVEL_LABEL_W + NODE_W / 2, Math.min(point.x, canvasW - NODE_W / 2 - 32)),
          y: Math.max(16, Math.min(point.y, canvasH - 220)),
        });
      }
      setDragConnection(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragConnection, workflowNodeById, getCanvasPoint, canvasW, canvasH]);

  useEffect(() => {
    const session = panSessionRef.current;
    if (!session) return;

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      setViewPan(clampPanToViewport({
        x: session.originX + (event.clientX - session.startX),
        y: session.originY + (event.clientY - session.startY),
      }, viewScale, { centerWhenSmaller: false }));
    };

    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      panSessionRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [clampPanToViewport, isPanning, viewScale]);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clampedScale = clamp(nextScale, ZOOM_MIN, ZOOM_MAX);
    const canvasPoint = {
      x: (clientX - rect.left - viewPan.x) / viewScale,
      y: (clientY - rect.top - viewPan.y) / viewScale,
    };

    setViewScale(clampedScale);
    setViewPan(clampPanToViewport({
      x: clientX - rect.left - canvasPoint.x * clampedScale,
      y: clientY - rect.top - canvasPoint.y * clampedScale,
    }, clampedScale));
  }, [clampPanToViewport, viewPan.x, viewPan.y, viewScale]);

  const zoomBy = useCallback((factor: number) => {
    const anchor = getViewportZoomAnchor();
    if (!anchor) return;
    autoFitPendingRef.current = false;
    zoomAtPoint(anchor.x, anchor.y, viewScale * factor);
  }, [getViewportZoomAnchor, viewScale, zoomAtPoint]);

  const handleFitMap = useCallback(() => {
    autoFitPendingRef.current = true;
    fitView({ mode: 'auto' });
    autoFitPendingRef.current = false;
  }, [fitView]);

  const handleReadableMap = useCallback(() => {
    autoFitPendingRef.current = false;
    fitView({ mode: 'readable' });
  }, [fitView]);

  const focusWorkflowNode = useCallback((nodeId: string) => {
    const flat = workflowFlatNodeById.get(nodeId);
    if (!flat) return;

    const nextScale = clamp(Math.max(viewScale, READABLE_VIEW_MIN_SCALE), ZOOM_MIN, ZOOM_MAX);
    setViewScale(nextScale);
    setViewPan(clampPanToViewport({
      x: Math.round(viewportWidth / 2 - flat.absX * nextScale),
      y: Math.round(viewportHeight * 0.38 - (flat.absY + NODE_H / 2) * nextScale),
    }, nextScale, { centerWhenSmaller: false }));
    autoFitPendingRef.current = false;
  }, [clampPanToViewport, viewScale, viewportHeight, viewportWidth, workflowFlatNodeById]);

  const normalizedMapSearchQuery = useMemo(() => normalizeWorkflowKeyPart(mapSearchQuery), [mapSearchQuery]);
  const searchMatches = useMemo(() => {
    if (!normalizedMapSearchQuery) return [];
    return flatNodes.filter(({ node }) => {
      const searchable = [
        node.label,
        node.level,
        node.filters?.coreUser?.join(' '),
        node.filters?.solution?.join(' '),
        node.filters?.emotion?.join(' '),
        node.filters?.visualType?.join(' '),
        node.filters?.painPoint?.join(' '),
        node.filters?.angle?.join(' '),
      ].filter(Boolean).join(' ');
      return normalizeWorkflowKeyPart(searchable).includes(normalizedMapSearchQuery);
    });
  }, [flatNodes, normalizedMapSearchQuery]);
  const searchMatchNodeIds = useMemo(() => new Set(searchMatches.map(({ node }) => node.id)), [searchMatches]);

  const handleViewportWheelAt = useCallback((clientX: number, clientY: number, deltaY: number) => {
    autoFitPendingRef.current = false;
    const factor = deltaY < 0 ? 1.08 : 0.92;
    zoomAtPoint(clientX, clientY, viewScale * factor);
  }, [viewScale, zoomAtPoint]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const normalizedDeltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * viewportHeight
          : event.deltaY;

      handleViewportWheelAt(event.clientX, event.clientY, normalizedDeltaY);
    };

    const blockMiddleButtonDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('mousedown', blockMiddleButtonDefault, true);
    viewport.addEventListener('auxclick', blockMiddleButtonDefault, true);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('mousedown', blockMiddleButtonDefault, true);
      viewport.removeEventListener('auxclick', blockMiddleButtonDefault, true);
    };
  }, [handleViewportWheelAt, viewportHeight]);

  const handleViewportMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const isMiddleButton = event.button === 1;
    if (event.button !== 0 && !isMiddleButton) {
      return;
    }
    const target = event.target as HTMLElement;
    if (isMiddleButton) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      autoFitPendingRef.current = false;
      panSessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: viewPan.x,
        originY: viewPan.y,
      };
      setIsPanning(true);
      return;
    }
    if ((dragConnection || pendingNodePicker || pendingCustomNodeEditor) && !target.closest('[data-node-picker="true"]')) {
      cancelActiveDraft();
      return;
    }
    if (target.closest('[data-node-card="true"]') || target.closest('[data-node-handle="true"]') || target.closest('[data-node-picker="true"]')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    autoFitPendingRef.current = false;
    panSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewPan.x,
      originY: viewPan.y,
    };
    setIsPanning(true);
  };

  const handleViewportAuxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  useEffect(() => {
    const session = customNodeDragRef.current;
    if (!session) return;
    if (!isCustomWorkflowNodeId(session.nodeId)) return;

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      const deltaX = (event.clientX - session.startClientX) / viewScale;
      const deltaY = (event.clientY - session.startClientY) / viewScale;
      if (Math.abs(deltaX) > 2) {
        session.moved = true;
        suppressNodeClickRef.current = true;
      }
      if (Math.abs(deltaY) > 2) {
        session.moved = true;
        suppressNodeClickRef.current = true;
      }

      setManualNodePositions(prev => ({
        ...prev,
        [session.nodeId]: {
          x: Math.max(LEVEL_LABEL_W + NODE_W / 2, session.startNodeX + deltaX),
          y: Math.max(16, session.startNodeY + deltaY),
        },
      }));
    };

    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      customNodeDragRef.current = null;
      setDraggedCustomNodeId(null);
      window.setTimeout(() => {
        suppressNodeClickRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggedCustomNodeId, viewScale]);

  // Click node → highlight path + show ideas for painpoint
  const handleNodeClick = (node: TreeNode) => {
    if (node.level === 'root') { setActivePath([]); setSelectedNode(null); return; }
    const findPath = (current: TreeNode, target: string, path: string[]): string[] | null => {
      const np = [...path, current.id];
      if (current.id === target) return np;
      for (const child of current.children) { const f = findPath(child, target, np); if (f) return f; }
      return null;
    };
    const fullPath = findPath(tree, node.id, []) || [];
    if (activePath.join('/') === fullPath.join('/')) { setActivePath([]); setSelectedNode(null); return; }
    const collectDesc = (n: TreeNode): string[] => { let ids = [n.id]; n.children.forEach(c => { ids = ids.concat(collectDesc(c)); }); return ids; };
    setActivePath([...fullPath, ...collectDesc(node).slice(1)]);
    setSelectedNode(node);
  };

  const getWorkflowNodeFilters = useCallback((nodeId: string | null | undefined) => {
    if (!nodeId) return {};
    const node = workflowNodeById.get(nodeId);
    if (!node) return {};
    return cloneFilters(node.filters);
  }, [workflowNodeById]);

  const buildConnectedNodeFilters = useCallback((fromId: string, level: WorkflowLevel, label: string) => {
    return withLevelFilter(getWorkflowNodeFilters(fromId), level, label.trim());
  }, [getWorkflowNodeFilters]);

  const persistWorkflowOptionValue = useCallback(async (level: WorkflowLevel, label: string) => {
    const category = LEVEL_TO_OPTION_CATEGORY[level];
    const normalizedLabel = label.trim();
    if (!category || !normalizedLabel) return false;
    if ((storedOptionValues[level] || []).includes(normalizedLabel)) return true;

    const saved = await addFilterOption(app.id, category, normalizedLabel);
    if (!saved) return false;

    setStoredOptionValues(prev => ({
      ...prev,
      [level]: mergeUniqueLabels(prev[level], [normalizedLabel]),
    }));
    return true;
  }, [app.id, storedOptionValues]);

  const activeAngleDraftSource = useMemo(() => {
    if (pendingCustomNodeEditor?.level === 'angle') {
      return { fromId: pendingCustomNodeEditor.fromId };
    }
    if (pendingNodePicker?.level === 'angle') {
      return { fromId: pendingNodePicker.fromId };
    }
    return null;
  }, [pendingCustomNodeEditor?.fromId, pendingCustomNodeEditor?.level, pendingNodePicker?.fromId, pendingNodePicker?.level]);

  const requestAngleSuggestions = useCallback(async (fromId: string) => {
    const parentFilters = getWorkflowNodeFilters(fromId);
    const painpoints = parentFilters.painPoint || [];
    if (painpoints.length === 0) {
      setGeneratedAngleOptions([]);
      setIsGeneratingAngleOptions(false);
      return;
    }

    const requestId = ++angleSuggestionSeqRef.current;
    setIsGeneratingAngleOptions(true);

    try {
      const res = await authenticatedFetch('/api/generate-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate-angles',
          appName: app.name,
          appCategory: app.category,
          painpoints,
          coreUsers: parentFilters.coreUser || [],
          emotions: parentFilters.emotion || [],
        }),
      });

      const result = await res.json();
      if (requestId !== angleSuggestionSeqRef.current) return;

      if (res.ok && result.success && Array.isArray(result.angles) && result.angles.length > 0) {
        setGeneratedAngleOptions(mergeUniqueLabels(result.angles));
        return;
      }

      setGeneratedAngleOptions(buildFallbackAnglesFromPainpoints(painpoints));
    } catch {
      if (requestId !== angleSuggestionSeqRef.current) return;
      setGeneratedAngleOptions(buildFallbackAnglesFromPainpoints(painpoints));
    } finally {
      if (requestId === angleSuggestionSeqRef.current) {
        setIsGeneratingAngleOptions(false);
      }
    }
  }, [app.category, app.name, getWorkflowNodeFilters]);

  useEffect(() => {
    if (!activeAngleDraftSource) {
      angleSuggestionSeqRef.current += 1;
      setGeneratedAngleOptions([]);
      setIsGeneratingAngleOptions(false);
      return;
    }

    void requestAngleSuggestions(activeAngleDraftSource.fromId);
  }, [activeAngleDraftSource, requestAngleSuggestions]);

  const pickerOptionValues = useMemo(() => {
    if (!pendingNodePicker) return [];
    if (pendingNodePicker.level === 'angle') {
      return mergeUniqueLabels(generatedAngleOptions, optionValuesByLevel.angle);
    }
    return optionValuesByLevel[pendingNodePicker.level] || [];
  }, [generatedAngleOptions, optionValuesByLevel, pendingNodePicker]);

  const handleRefreshAngleSuggestions = useCallback(() => {
    if (!activeAngleDraftSource) return;
    void requestAngleSuggestions(activeAngleDraftSource.fromId);
  }, [activeAngleDraftSource, requestAngleSuggestions]);

  const handleAddCustomNode = (level: WorkflowLevel, label?: string, preferredX?: number, filters?: Partial<FilterState>) => {
    const sameLevelCount = customNodes.filter(node => node.level === level).length + 1;
    const baseLabel = LEVEL_AXIS_LABELS[level] || LEVEL_COLORS[level]?.label || level;
    customNodeSeqRef.current += 1;
    const customNode: CustomWorkflowNode = {
      id: `custom:${level}:${customNodeSeqRef.current}`,
      label: label || `${baseLabel} custom ${sameLevelCount}`,
      level,
      preferredX,
      filters: cloneFilters(filters),
      ideaCount: 0,
      wins: 0,
      fails: 0,
      monitoring: 0,
      custom: true,
    };
    autoFitPendingRef.current = true;
    setCustomNodes(prev => [...prev, customNode]);
    setSelectedCustomNodeId(customNode.id);
    setSelectedNode(null);
    return customNode.id;
  };

  const handleStartDragConnection = (nodeId: string, fromX: number, fromY: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPendingCustomNodeEditor(null);
    setPendingNodePicker(null);
    setDragConnection({ fromId: nodeId, fromX, fromY, x: fromX, y: fromY });
  };

  const handleStartCustomNodeDrag = (nodeId: string, absX: number, absY: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-node-handle="true"]') || target.closest('[data-node-action="true"]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!isCustomWorkflowNodeId(nodeId)) {
      return;
    }
    autoFitPendingRef.current = false;
    customNodeDragRef.current = {
      nodeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startNodeX: absX,
      startNodeY: absY,
      moved: false,
    };
    setDraggedCustomNodeId(nodeId);
    setSelectedCustomNodeId(nodeId);
    setSelectedNode(null);
  };

  const handleDropOnNode = (nodeId: string, event: React.PointerEvent) => {
    if (!dragConnection || dragConnection.fromId === nodeId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    droppedOnHandleRef.current = true;
    setCustomEdges(prev => {
      if (prev.some(edge => edge.fromId === dragConnection.fromId && edge.toId === nodeId)) return prev;
      return [...prev, { fromId: dragConnection.fromId, toId: nodeId }];
    });
    setDragConnection(null);
    setPendingCustomNodeEditor(null);
    setPendingNodePicker(null);
  };

  const handlePickNextNode = async (label: string) => {
    if (!pendingNodePicker) return;
    const draft = pendingNodePicker;
    autoFitPendingRef.current = true;
    const nextFilters = buildConnectedNodeFilters(draft.fromId, draft.level, label);
    const nodeId = handleAddCustomNode(draft.level, label, draft.x, nextFilters);
    setCustomEdges(prev => [...prev, { fromId: draft.fromId, toId: nodeId }]);
    setPendingCustomNodeEditor(null);
    setPendingNodePicker(null);
    await persistWorkflowOptionValue(draft.level, label);
  };

  const handleOpenCustomNodeEditor = () => {
    if (!pendingNodePicker) return;
    setPendingCustomNodeEditor({
      fromId: pendingNodePicker.fromId,
      level: pendingNodePicker.level,
      x: pendingNodePicker.x,
      y: pendingNodePicker.y,
      draftLabel: '',
    });
    setPendingNodePicker(null);
  };

  const handleSubmitCustomNodeEditor = async () => {
    if (!pendingCustomNodeEditor) return;
    const draft = pendingCustomNodeEditor;
    const label = draft.draftLabel.trim();
    if (!label) return;

    const nextFilters = buildConnectedNodeFilters(draft.fromId, draft.level, label);
    const nodeId = handleAddCustomNode(draft.level, label, draft.x, nextFilters);
    setCustomEdges(prev => [...prev, { fromId: draft.fromId, toId: nodeId }]);
    setPendingCustomNodeEditor(null);
    await persistWorkflowOptionValue(draft.level, label);

    if (draft.level === 'angle' && onCreateFromBranch) {
      onCreateFromBranch(nextFilters);
    }
  };

  const handleToggleFullView = () => {
    if (isFullView) {
      pendingFullViewFitRef.current = false;
      setIsFullView(false);
      return;
    }
    autoFitPendingRef.current = false;
    pendingFullViewFitRef.current = true;
    setIsFullView(true);
  };

  const handleRemoveCustomNode = (nodeId: string) => {
    setCustomNodes(prev => prev.filter(node => node.id !== nodeId));
    setCustomEdges(prev => prev.filter(edge => edge.fromId !== nodeId && edge.toId !== nodeId));
    setManualNodePositions(prev => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    if (dragConnection?.fromId === nodeId) setDragConnection(null);
    if (pendingNodePicker?.fromId === nodeId) setPendingNodePicker(null);
    if (pendingCustomNodeEditor?.fromId === nodeId) setPendingCustomNodeEditor(null);
    if (customNodeDragRef.current?.nodeId === nodeId) {
      customNodeDragRef.current = null;
      setDraggedCustomNodeId(null);
    }
    if (selectedCustomNodeId === nodeId) setSelectedCustomNodeId(null);
  };

  const handleSetResult = async (ideaId: string, result: ResultType) => {
    setIdeaResults(prev => ({ ...prev, [ideaId]: result }));
    await updateIdeaResult(ideaId, result);
  };

  const isHigh = (nodeId: string) => activePath.length === 0 || activePath.includes(nodeId);

  const selectedCustomNode = selectedCustomNodeId
    ? customNodes.find(node => node.id === selectedCustomNodeId) || null
    : null;
  const selectedTreeFilters = selectedNode
    ? selectedNode.filters || normalizeFilterSnapshot(selectedNode.ideas[0]?.filters_snapshot)
    : null;
  const activeCreateFilters = selectedTreeFilters || selectedCustomNode?.filters || null;
  const canCreateFromBranch = !!activeCreateFilters && Object.keys(activeCreateFilters).length > 0;
  const selectedIdeaIds = useMemo(
    () => (selectedNode?.ideas || []).map(idea => idea.id).filter(Boolean),
    [selectedNode]
  );
  const selectedIdeaIdsKey = selectedIdeaIds.join('|');
  const detailIdeas = useMemo(
    () => (selectedNode?.ideas || []).map(idea => ideaDetailCache[idea.id] || idea),
    [ideaDetailCache, selectedNode]
  );
  const detailLabel = selectedNode?.label || '';
  const detailIdeaCount = selectedNode?.ideaCount || detailIdeas.length;
  const selectedBranchNodeId = selectedCustomNodeId || selectedNode?.id || null;
  const selectedBranchNode = selectedCustomNode || selectedNode;
  const selectedBranchStatus = selectedBranchNodeId
    ? branchStatusByNodeId.get(selectedBranchNodeId) || 'ungenerated'
    : null;
  const selectedBranchStatusTheme = selectedBranchStatus ? BRANCH_STATUS_THEME[selectedBranchStatus] : null;
  const selectedBranchLevelTheme = selectedBranchNode ? LEVEL_COLORS[selectedBranchNode.level] : null;
  const selectedBranchFilterRows = BRANCH_FILTER_FIELDS.map(field => {
    const values = activeCreateFilters?.[field.key];
    const cleanValues = Array.isArray(values)
      ? values.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    return cleanValues.length > 0 ? { ...field, values: cleanValues } : null;
  }).filter((row): row is { key: keyof FilterState; label: string; level: WorkflowLevel; values: string[] } => Boolean(row));
  const canHideSelectedBranch = !!selectedBranchNodeId && selectedBranchNodeId !== 'root';
  const hiddenBranchCount = hiddenNodeIds.length;
  const ungeneratedBranchCount = useMemo(() => (
    Array.from(branchStatusByNodeId.entries()).filter(([nodeId, status]) => nodeId !== 'root' && status === 'ungenerated').length
  ), [branchStatusByNodeId]);
  const strategyStateBadge = strategyStateStatus === 'saving'
    ? { label: 'Đang lưu biểu đồ...', className: 'bg-amber-50 text-amber-700 border-amber-200' }
    : strategyStateStatus === 'error'
      ? { label: 'Lưu DB thất bại', className: 'bg-red-50 text-red-600 border-red-200' }
      : strategyStateStatus === 'loading'
        ? { label: 'Đang tải biểu đồ...', className: 'bg-slate-50 text-slate-600 border-slate-200' }
        : { label: 'Đã lưu vào DB', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };

  useEffect(() => {
    if (!selectedNode || selectedIdeaIds.length === 0) {
      setLoadingIdeaDetails(false);
      return;
    }

    const missingIds = selectedIdeaIds.filter(ideaId => !ideaDetailCache[ideaId]?.content);
    if (missingIds.length === 0) {
      setLoadingIdeaDetails(false);
      return;
    }

    let cancelled = false;
    setLoadingIdeaDetails(true);
    getIdeasByIds(app.id, missingIds)
      .then(ideas => {
        if (cancelled) return;
        setIdeaDetailCache(prev => {
          const next = { ...prev };
          ideas.forEach(idea => {
            next[idea.id] = idea;
          });
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingIdeaDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [app.id, ideaDetailCache, selectedIdeaIds, selectedIdeaIdsKey, selectedNode]);

  const handleHideSelectedBranch = useCallback(() => {
    if (!selectedBranchNodeId || selectedBranchNodeId === 'root') return;
    const branchNodeIds = collectBranchNodeIds(selectedBranchNodeId).filter(nodeId => nodeId !== 'root');
    if (branchNodeIds.length === 0) return;

    autoFitPendingRef.current = true;
    setHiddenNodeIds(prev => Array.from(new Set([...prev, ...branchNodeIds])));
    setSelectedNode(null);
    setSelectedCustomNodeId(null);
    setActivePath([]);
    cancelActiveDraft();
  }, [cancelActiveDraft, collectBranchNodeIds, selectedBranchNodeId]);

  const handleHideBranch = useCallback((nodeId: string) => {
    if (!nodeId || nodeId === 'root') return;
    const branchNodeIds = collectBranchNodeIds(nodeId).filter(branchNodeId => branchNodeId !== 'root');
    if (branchNodeIds.length === 0) return;

    autoFitPendingRef.current = true;
    setHiddenNodeIds(prev => Array.from(new Set([...prev, ...branchNodeIds])));
    if (selectedNode && branchNodeIds.includes(selectedNode.id)) {
      setSelectedNode(null);
      setActivePath([]);
    }
    if (selectedCustomNodeId && branchNodeIds.includes(selectedCustomNodeId)) {
      setSelectedCustomNodeId(null);
    }
    if (dragConnection?.fromId && branchNodeIds.includes(dragConnection.fromId)) {
      setDragConnection(null);
    }
    if (pendingNodePicker?.fromId && branchNodeIds.includes(pendingNodePicker.fromId)) {
      setPendingNodePicker(null);
    }
    if (pendingCustomNodeEditor?.fromId && branchNodeIds.includes(pendingCustomNodeEditor.fromId)) {
      setPendingCustomNodeEditor(null);
    }
    cancelActiveDraft();
  }, [cancelActiveDraft, collectBranchNodeIds, dragConnection?.fromId, pendingCustomNodeEditor?.fromId, pendingNodePicker?.fromId, selectedCustomNodeId, selectedNode]);

  const handleShowAllBranches = useCallback(() => {
    autoFitPendingRef.current = true;
    setHiddenNodeIds([]);
  }, []);

  useEffect(() => {
    if (selectedNode && effectiveHiddenNodeIdSet.has(selectedNode.id)) {
      setSelectedNode(null);
      setActivePath([]);
    }
    if (selectedCustomNodeId && effectiveHiddenNodeIdSet.has(selectedCustomNodeId)) {
      setSelectedCustomNodeId(null);
    }
    if (dragConnection?.fromId && effectiveHiddenNodeIdSet.has(dragConnection.fromId)) {
      setDragConnection(null);
    }
    if (pendingNodePicker?.fromId && effectiveHiddenNodeIdSet.has(pendingNodePicker.fromId)) {
      setPendingNodePicker(null);
    }
    if (pendingCustomNodeEditor?.fromId && effectiveHiddenNodeIdSet.has(pendingCustomNodeEditor.fromId)) {
      setPendingCustomNodeEditor(null);
    }
  }, [dragConnection?.fromId, effectiveHiddenNodeIdSet, pendingCustomNodeEditor?.fromId, pendingNodePicker?.fromId, selectedCustomNodeId, selectedNode]);

  if (loading) {
    if (inline) return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>;
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6"><ArrowLeft size={18} /> Quay lại</button>
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
      </div>
    );
  }

  return (
    <div className={inline ? 'animate-in fade-in duration-300' : 'p-6 md:p-8 max-w-full mx-auto animate-in fade-in duration-500'}>
      {!inline && (
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors">
          <ArrowLeft size={18} /> Quay lại
        </button>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className={`font-extrabold text-gray-900 flex items-center gap-3 ${inline ? 'text-lg' : 'text-2xl'}`}>
            🗺️ Strategy Map
            {!inline && <span className="text-sm font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{app.name}</span>}
          </h2>
          <p className="text-xs text-gray-400 mt-1">Core User → PSP → Emotion → Visual → Painpoint · Click painpoint để xem ideas</p>
        </div>
      </div>

      {/* ===== Week Picker — Dropdown ===== */}
      <div className="flex items-center gap-2 mb-4 flex-wrap" ref={dropdownRef}>
        {/* Dropdown trigger */}
        <div className="relative">
          <button
            onClick={() => setShowWeekDropdown(!showWeekDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <Calendar size={14} className="text-indigo-500" />
            {selectedWeekLabel}
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showWeekDropdown ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown panel */}
          {showWeekDropdown && (
            <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Quick selections */}
              <div className="p-3 border-b border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Chọn nhanh</p>
                <div className="space-y-1">
                  {[
                    { key: currentWeekKey, label: 'Tuần này', icon: '📌' },
                    { key: 'all', label: 'Tất cả', icon: '📊' },
                  ].map(q => (
                    <button key={q.key} onClick={() => { setSelectedWeek(q.key); setShowWeekDropdown(false); setSelectedNode(null); setActivePath([]); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                        selectedWeek === q.key
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}>
                      <span>{q.icon}</span>
                      {q.label}
                      {selectedWeek === q.key && <span className="ml-auto text-indigo-500">✓</span>}
                      {q.key !== 'all' && (weekIdeaCounts.get(q.key) || 0) > 0 && (
                        <span className="ml-auto text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold">{weekIdeaCounts.get(q.key)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monthly grouped weeks — scrollable */}
              <div className="max-h-[360px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {Array.from(weeksGroupedByMonth.entries()).map(([monthLabel, weeks]) => (
                  <div key={monthLabel} className="border-b border-gray-50 last:border-0">
                    <div className="px-4 py-2 bg-gray-50 sticky top-0 z-10">
                      <span className="text-xs font-bold text-gray-500">{monthLabel}</span>
                    </div>
                    <div className="px-2 py-1 space-y-0.5">
                      {weeks.map(w => {
                        const count = weekIdeaCounts.get(w.key) || 0;
                        const isCurrent = w.key === currentWeekKey;
                        const isSelected = selectedWeek === w.key;
                        return (
                          <button key={w.key}
                            onClick={() => { setSelectedWeek(w.key); setShowWeekDropdown(false); setSelectedNode(null); setActivePath([]); }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                              isSelected
                                ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200'
                                : isCurrent
                                  ? 'text-indigo-600 font-bold hover:bg-indigo-50'
                                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                            }`}>
                            <span className="font-mono text-gray-400 w-12 text-left">Tuần {w.weekNum}:</span>
                            <span className="flex-1 text-left">{w.label}</span>
                            {isCurrent && <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">NOW</span>}
                            {count > 0 && <span className="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold">{count}</span>}
                            {isSelected && <span className="text-indigo-500 text-xs">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Selected week range display */}
        {selectedWeek !== 'all' && selectedWeek !== currentWeekKey && (
          <span className="text-xs text-gray-400 font-medium">
            {allWeeks.find(w => w.key === selectedWeek)?.label}
          </span>
        )}
        {selectedWeek === currentWeekKey && (
          <span className="text-xs text-indigo-500 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
            {allWeeks.find(w => w.key === currentWeekKey)?.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold ${strategyStateBadge.className}`}>
          {strategyStateBadge.label}
        </span>
        <button
          onClick={() => {
            autoFitPendingRef.current = true;
            setShowOnlyUngenerated(prev => !prev);
          }}
          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
            showOnlyUngenerated
              ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {showOnlyUngenerated ? 'Đang lọc nhánh chưa gen' : 'Chỉ hiện nhánh chưa gen'}
          <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px]">
            {ungeneratedBranchCount}
          </span>
        </button>
        {canHideSelectedBranch && (
          <button
            onClick={handleHideSelectedBranch}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <EyeOff size={13} /> Ẩn nhánh đang chọn
          </button>
        )}
        {hiddenBranchCount > 0 && (
          <button
            onClick={handleShowAllBranches}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 transition-colors hover:bg-teal-100"
          >
            Hiện tất cả ({hiddenBranchCount} node ẩn)
          </button>
        )}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-500">
          {(['generated', 'ungenerated', 'partial'] as BranchGenerationStatus[]).map(status => {
            const theme = BRANCH_STATUS_THEME[status];
            return (
              <span key={status} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${theme.chipClassName}`}>
                <span>{theme.icon}</span> {theme.label}
              </span>
            );
          })}
        </div>
      </div>

      {selectedBranchNode && selectedBranchNode.level !== 'root' && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className="h-1 w-full"
            style={{ background: selectedBranchLevelTheme?.gradient || 'linear-gradient(135deg, #64748b, #475569)' }}
          />
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]"
                  style={{
                    background: selectedBranchLevelTheme?.bg,
                    borderColor: selectedBranchLevelTheme?.border,
                    color: selectedBranchLevelTheme?.accent,
                  }}
                >
                  {LEVEL_AXIS_LABELS[selectedBranchNode.level]}
                </span>
                {selectedBranchStatusTheme && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${selectedBranchStatusTheme.chipClassName}`}>
                    <span>{selectedBranchStatusTheme.icon}</span> {selectedBranchStatusTheme.label}
                  </span>
                )}
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                  {selectedBranchNode.ideaCount} idea
                </span>
              </div>
              <h3 className="truncate text-sm font-black text-slate-900" title={selectedBranchNode.label}>
                {selectedBranchNode.label}
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedBranchFilterRows.map(row => {
                  const style = LEVEL_COLORS[row.level];
                  return (
                    <span
                      key={row.key}
                      className="max-w-[260px] truncate rounded-full border px-2.5 py-1 text-[10px] font-bold"
                      style={{ background: style.bg, borderColor: style.border, color: style.accent }}
                      title={`${row.label}: ${row.values.join(', ')}`}
                    >
                      {row.label}: {row.values.slice(0, 2).join(', ')}
                      {row.values.length > 2 ? ` +${row.values.length - 2}` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canCreateFromBranch && activeCreateFilters && onCreateFromBranch && (
                <button
                  onClick={() => onCreateFromBranch(activeCreateFilters)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 px-4 py-2 text-xs font-black text-white shadow-sm transition-all hover:shadow-lg hover:shadow-rose-100"
                >
                  <Sparkles size={14} /> Tạo idea từ nhánh
                </button>
              )}
              {canHideSelectedBranch && (
                <button
                  onClick={handleHideSelectedBranch}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <EyeOff size={14} /> Ẩn nhánh
                </button>
              )}
              <button
                onClick={() => { setSelectedNode(null); setSelectedCustomNodeId(null); setActivePath([]); }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-50"
              >
                <X size={14} /> Bỏ chọn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className={`grid gap-2 mb-4 ${inline ? 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-8' : 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-8'}`}>
        {[
          { n: stats.cu, label: 'Đối tượng', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600', icon: '👤' },
          { n: stats.psp, label: 'PSP', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', icon: '💊' },
          { n: stats.em, label: 'Cảm xúc', bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', icon: '💜' },
          { n: stats.pp, label: 'Nỗi đau', bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', icon: '🔥' },
          { n: stats.total, label: 'Tổng Ideas', bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600', icon: '💡' },
          { n: stats.wins, label: 'Win', bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600', icon: '🏆' },
          { n: stats.fails, label: 'Failed', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-500', icon: '❌' },
          { n: stats.monitoring, label: 'Theo dõi', bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', icon: '👁️' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-2.5 text-center`}>
            <span className="text-xs">{s.icon}</span>
            <p className={`text-lg font-bold ${s.text}`}>{s.n}</p>
            <p className="text-[9px] text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="hidden">
        {(['coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'] as const).map(key => {
          const s = LEVEL_COLORS[key];
          return (
            <div key={key} className="flex items-center">
              <span className="text-[10px] font-semibold text-gray-500">{s.icon} {s.label}</span>
            </div>
          );
        })}
      </div>

      {/* Vertical connectable workflow */}
      <div className="flex items-center justify-between gap-3 mb-3 px-1 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-700">Vertical Strategy Map</p>
          <p className="text-[11px] text-gray-400">Level chạy theo trục Y. Kéo từ chấm dưới ra canvas để mở picker node kế tiếp.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative w-full sm:w-72">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={mapSearchQuery}
              onChange={(event) => setMapSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchMatches[0]) {
                  focusWorkflowNode(searchMatches[0].node.id);
                }
              }}
              placeholder="Tìm painpoint, angle, visual..."
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-[11px] font-semibold text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
            />
            {mapSearchQuery && (
              <button
                onClick={() => setMapSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Xóa tìm kiếm"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {mapSearchQuery && (
            <button
              onClick={() => searchMatches[0] && focusWorkflowNode(searchMatches[0].node.id)}
              disabled={searchMatches.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {searchMatches.length > 0 ? `${searchMatches.length} kết quả` : '0 kết quả'}
            </button>
          )}
          {(['coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'] as WorkflowLevel[]).map(level => {
            const style = LEVEL_COLORS[level];
            return (
              <button
                key={level}
                onClick={() => handleAddCustomNode(level)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all hover:shadow-sm"
                style={{ background: style.bg, borderColor: style.border, color: style.accent }}
              >
                <Plus size={12} /> {LEVEL_AXIS_LABELS[level]}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={treeContainerRef}
        className={`bg-white shadow-sm overflow-hidden ${isFullView ? 'fixed inset-0 z-[70] rounded-none border-0' : 'rounded-2xl border border-gray-200'}`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <div className="text-[11px] font-medium text-gray-400">Pan nền để di chuyển, lăn chuột để zoom, bấm fit để tự căn chỉnh.</div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleFitMap}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-black text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
              title="Thu toàn bộ map vào khung"
            >
              Fit all
            </button>
            <button
              onClick={handleReadableMap}
              className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-[11px] font-black text-indigo-600 transition-colors hover:bg-indigo-100"
              title="Zoom về mức dễ đọc"
            >
              Đọc rõ
            </button>
            <button
              onClick={() => zoomBy(0.9)}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => zoomBy(1.1)}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={handleToggleFullView}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
              title={isFullView ? 'Thu nhỏ view' : 'Mở full view'}
            >
              {isFullView ? <Minimize2 size={14} /> : <Scan size={14} />}
            </button>
            <div className="ml-2 min-w-[52px] rounded-lg bg-gray-50 px-2 py-1 text-center text-[11px] font-bold text-gray-500">
              {Math.round(viewScale * 100)}%
            </div>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={`relative overflow-hidden touch-none bg-[radial-gradient(circle_at_center,_rgba(148,163,184,0.08)_1px,_transparent_1px)] [background-size:18px_18px] ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ height: viewportHeight }}
          onAuxClick={handleViewportAuxClick}
          onMouseDownCapture={handleViewportMouseDownCapture}
          onPointerDown={handleViewportPointerDown}
        >
            {(dragConnection || pendingNodePicker || pendingCustomNodeEditor) && (
              <button
                onClick={cancelActiveDraft}
                className="absolute right-3 top-3 z-50 flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg"
              >
                <X size={12} /> Hủy kéo
              </button>
            )}
            <div
              className="absolute top-0 left-0"
              style={{
                width: canvasW,
                height: canvasH + 24,
                transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewScale})`,
                transformOrigin: 'top left',
                transition: isPanning || !!dragConnection || !!draggedCustomNodeId ? 'none' : 'transform 180ms ease-out',
              }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-[160px] border-r border-gray-100">
                {LEVEL_ORDER.map((level, levelIndex) => {
                  const style = LEVEL_COLORS[level];
                  return (
                    <div
                      key={level}
                      className="absolute left-3 w-[130px] rounded-lg border px-3 py-2 text-center"
                      style={{
                        top: 24 + levelIndex * (NODE_H + ROW_GAP) + 16,
                        background: style.bg,
                        borderColor: style.border,
                      }}
                    >
                      <p className="text-[10px] font-black tracking-[0.12em]" style={{ color: style.accent }}>
                        {LEVEL_AXIS_LABELS[level]}
                      </p>
                    </div>
                  );
                })}
              </div>

              <svg className="absolute inset-0" width={canvasW} height={canvasH} style={{ pointerEvents: 'none', zIndex: 0 }}>
                <defs>
                  {flatLines.map((line, i) => {
                    const parentColor = LEVEL_COLORS[line.parentLevel]?.accent || '#94a3b8';
                    const childColor = LEVEL_COLORS[line.childLevel]?.accent || '#94a3b8';
                    return (
                      <linearGradient key={`v-lg-${i}`} id={`v-lg-${i}`} gradientUnits="userSpaceOnUse"
                        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
                        <stop offset="0%" stopColor={parentColor} stopOpacity={line.custom ? 0.9 : 0.75} />
                        <stop offset="100%" stopColor={childColor} stopOpacity={line.custom ? 0.9 : 0.5} />
                      </linearGradient>
                    );
                  })}
                </defs>
                {flatLines.map((line, i) => {
                  const midY = line.y1 + (line.y2 - line.y1) * 0.52;
                  const branchStatus = branchStatusByNodeId.get(line.childId) || 'ungenerated';
                  const branchTheme = BRANCH_STATUS_THEME[branchStatus];
                  const isActive = line.custom
                    ? selectedCustomNodeId === line.parentId || selectedCustomNodeId === line.childId || dragConnection?.fromId === line.parentId
                    : activePath.length === 0 || (activePath.includes(line.parentId) && activePath.includes(line.childId));
                  return (
                    <g key={`${line.parentId}-${line.childId}-${i}`}>
                      <path
                        d={`M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`}
                        fill="none"
                        stroke="#cbd5e1"
                        strokeWidth={isActive ? (line.custom ? 5.8 : 5) : 2.6}
                        strokeDasharray={line.custom ? '7 6' : branchTheme.lineDash}
                        strokeLinecap="round"
                        style={{ opacity: isActive ? 0.5 : 0.22 }}
                      />
                      <path
                        d={`M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`}
                        fill="none"
                        stroke={branchTheme.line}
                        strokeWidth={isActive ? (line.custom ? 3.4 : 3) : 1.7}
                        strokeDasharray={line.custom ? '7 6' : branchTheme.lineDash}
                        strokeLinecap="round"
                        className="transition-all duration-300"
                        style={{ opacity: isActive ? 0.95 : 0.3 }}
                      />
                      {isActive && (
                        <>
                          <circle cx={line.x1} cy={line.y1} r={3}
                            fill={LEVEL_COLORS[line.parentLevel]?.accent || '#94a3b8'} opacity={0.65} />
                          <circle cx={line.x2} cy={line.y2} r={3}
                            fill={LEVEL_COLORS[line.childLevel]?.accent || '#94a3b8'} opacity={0.8} />
                        </>
                      )}
                    </g>
                  );
                })}
                {dragConnection && (
                  <>
                    <path
                      d={`M ${dragConnection.fromX} ${dragConnection.fromY} C ${dragConnection.fromX} ${dragConnection.fromY + 70}, ${dragConnection.x} ${dragConnection.y - 70}, ${dragConnection.x} ${dragConnection.y}`}
                      fill="none"
                      stroke="#cbd5e1"
                      strokeWidth={6}
                      strokeLinecap="round"
                      strokeDasharray="7 7"
                      opacity={0.55}
                    />
                    <path
                      d={`M ${dragConnection.fromX} ${dragConnection.fromY} C ${dragConnection.fromX} ${dragConnection.fromY + 70}, ${dragConnection.x} ${dragConnection.y - 70}, ${dragConnection.x} ${dragConnection.y}`}
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth={3.2}
                      strokeLinecap="round"
                      strokeDasharray="7 7"
                      opacity={0.92}
                    />
                  </>
                )}
                {draftPreviewConnection && (
                  <>
                    <path
                      d={`M ${draftPreviewConnection.fromX} ${draftPreviewConnection.fromY} C ${draftPreviewConnection.fromX} ${draftPreviewConnection.fromY + 70}, ${draftPreviewConnection.toX} ${draftPreviewConnection.toY - 70}, ${draftPreviewConnection.toX} ${draftPreviewConnection.toY}`}
                      fill="none"
                      stroke="#cbd5e1"
                      strokeWidth={6}
                      strokeLinecap="round"
                      strokeDasharray="8 7"
                      opacity={0.55}
                    />
                    <path
                      d={`M ${draftPreviewConnection.fromX} ${draftPreviewConnection.fromY} C ${draftPreviewConnection.fromX} ${draftPreviewConnection.fromY + 70}, ${draftPreviewConnection.toX} ${draftPreviewConnection.toY - 70}, ${draftPreviewConnection.toX} ${draftPreviewConnection.toY}`}
                      fill="none"
                      stroke={LEVEL_COLORS[draftPreviewConnection.level]?.accent || '#475569'}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeDasharray="8 7"
                      opacity={0.88}
                    />
                  </>
                )}
              </svg>

              {flatNodes.map(({ node, absX, absY }) => {
                const style = LEVEL_COLORS[node.level];
                const treeNode = isTreeNode(node) ? node : null;
                const highlighted = treeNode ? isHigh(node.id) : selectedCustomNodeId === node.id || activePath.length === 0;
                const isSelected = selectedNode?.id === node.id || selectedCustomNodeId === node.id;
                const isSearchMatched = searchMatchNodeIds.has(node.id);
                const displayLabel = node.label.length > 28 ? node.label.substring(0, 28) + '...' : node.label;
                const branchStatus = branchStatusByNodeId.get(node.id) || 'ungenerated';
                const branchTheme = BRANCH_STATUS_THEME[branchStatus];
                const canHideNode = node.id !== 'root';
                const statusIconOffset = !treeNode && canHideNode ? 'right-12' : canHideNode ? 'right-7' : !treeNode ? 'right-7' : 'right-1.5';

                return (
                  <div
                    key={node.id}
                    role="button"
                    data-node-card="true"
                    tabIndex={0}
                    onClick={(e) => {
                      if (suppressNodeClickRef.current) {
                        suppressNodeClickRef.current = false;
                        return;
                      }
                      e.stopPropagation();
                      if (treeNode) {
                        setSelectedCustomNodeId(null);
                        handleNodeClick(treeNode);
                      } else {
                        setSelectedCustomNodeId(node.id);
                        setSelectedNode(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && treeNode) {
                        e.preventDefault();
                        handleNodeClick(treeNode);
                      }
                    }}
                    onPointerDown={(e) => handleStartCustomNodeDrag(node.id, absX, absY, e)}
                    className="absolute select-none transition-all duration-300"
                    style={{
                      left: absX - NODE_W / 2,
                      top: absY,
                      width: NODE_W,
                      height: NODE_H,
                      zIndex: isSelected ? 20 : isSearchMatched ? 16 : highlighted ? 10 : 1,
                      opacity: highlighted || isSearchMatched ? 1 : 0.88,
                      transform: draggedCustomNodeId === node.id ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <button
                      title="Thả dây vào đây để nối với node này"
                      onPointerUp={(e) => handleDropOnNode(node.id, e)}
                      data-node-handle="true"
                      className={`absolute left-1/2 -top-2 z-30 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white transition-all ${dragConnection ? 'scale-125 ring-2 ring-gray-300' : ''}`}
                      style={{ background: style.accent }}
                    />
                    <div
                      className="relative w-full h-full rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer"
                      style={{
                        background: style.bg,
                        border: `2px solid ${isSelected || isSearchMatched ? style.accent : style.border}`,
                        boxShadow: isSelected
                          ? `0 0 0 3px ${style.accent}22, 0 8px 24px ${style.accent}20`
                          : isSearchMatched ? `0 0 0 4px ${style.accent}22, 0 10px 26px ${style.accent}18`
                          : highlighted ? `0 2px 8px rgba(0,0,0,0.06)` : `0 1px 4px rgba(0,0,0,0.04)`,
                      }}
                    >
                      <div className="absolute inset-0 pointer-events-none" style={{ background: branchTheme.overlay }} />
                      <div className="h-[3px] w-full" style={{ background: style.gradient }} />
                      <div className="relative flex flex-col items-center justify-center px-3 pt-2 pb-1.5">
                        <span
                          className={`absolute top-1.5 ${statusIconOffset} inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border px-1 text-[10px] font-black ${branchTheme.chipClassName}`}
                          title={branchTheme.label}
                        >
                          {branchTheme.icon}
                        </span>
                        <div className="flex items-center gap-1.5 w-full justify-center mb-1">
                          <span className="text-[11px] flex-shrink-0">{style.icon}</span>
                          <span className="text-[11px] font-bold text-gray-800 truncate leading-tight" title={node.label}>
                            {displayLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: style.textBg, color: style.accent, border: `1px solid ${style.border}` }}
                          >
                            {node.ideaCount} ideas
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${branchTheme.chipClassName}`}>
                            {branchTheme.label}
                          </span>
                          {node.wins > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">
                              win {node.wins}
                            </span>
                          )}
                          {node.fails > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 border border-red-200">
                              fail {node.fails}
                            </span>
                          )}
                        </div>
                        {!treeNode && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveCustomNode(node.id); }}
                            data-node-action="true"
                            className="absolute right-1.5 top-1.5 rounded-full bg-white/80 p-1 text-gray-400 hover:text-red-500"
                            title="Xóa node custom"
                          >
                            <X size={10} />
                          </button>
                        )}
                        {canHideNode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleHideBranch(node.id);
                            }}
                            data-node-action="true"
                            className={`absolute ${treeNode ? 'right-1.5' : 'right-7'} top-1.5 rounded-full bg-white/80 p-1 text-gray-400 hover:text-slate-700`}
                            title="Ẩn nhánh này"
                          >
                            <EyeOff size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      title="Kéo để tạo node kế tiếp"
                      onPointerDown={(e) => handleStartDragConnection(node.id, absX, absY + NODE_H, e)}
                      data-node-handle="true"
                      className={`absolute left-1/2 -bottom-2 z-30 flex h-4 w-4 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white transition-all active:cursor-grabbing ${dragConnection?.fromId === node.id ? 'scale-150 ring-2 ring-gray-900' : ''}`}
                      style={{ background: style.accent }}
                    >
                      {dragConnection?.fromId === node.id && <Link2 size={8} className="text-white" />}
                    </button>
                  </div>
                );
              })}
              {pendingNodePicker && (
                <div
                  data-node-picker="true"
                  className="absolute z-40 w-[300px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                  style={{
                    left: Math.min(Math.max(pendingNodePicker.x + 16, LEVEL_LABEL_W + 20), canvasW - 320),
                    top: pendingNodePicker.y,
                  }}
                >
                  <div className="border-b border-gray-100 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">
                      Chọn {LEVEL_AXIS_LABELS[pendingNodePicker.level]}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-gray-700">Option của app hiện tại</p>
                    {pendingNodePicker.level === 'angle' && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-teal-600">AI gợi ý từ painpoint đang chọn</p>
                        <button
                          onClick={handleRefreshAngleSuggestions}
                          disabled={isGeneratingAngleOptions}
                          className="inline-flex items-center gap-1 rounded-lg border border-teal-200 px-2 py-1 text-[10px] font-bold text-teal-700 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isGeneratingAngleOptions ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                          Gen lại
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="max-h-[260px] overflow-y-auto p-2">
                    {isGeneratingAngleOptions && pickerOptionValues.length === 0 && (
                      <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-500">
                        <Loader2 size={14} className="animate-spin" />
                        Đang tạo angle từ painpoint...
                      </div>
                    )}
                    {pickerOptionValues.slice(0, 12).map(option => (
                      <button
                        key={option}
                        onClick={() => handlePickNextNode(option)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span
                          className="h-7 w-7 rounded-lg border"
                          style={{
                            background: LEVEL_COLORS[pendingNodePicker.level].bg,
                            borderColor: LEVEL_COLORS[pendingNodePicker.level].border,
                          }}
                        />
                        <span className="truncate">{option}</span>
                      </button>
                    ))}
                    {!isGeneratingAngleOptions && pickerOptionValues.length === 0 && (
                      <div className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-400">
                        Chưa có option phù hợp. Bạn có thể tạo custom ngay bên dưới.
                      </div>
                    )}
                    <button
                      onClick={handleOpenCustomNodeEditor}
                      className="mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-left text-sm font-bold text-gray-500 transition-colors hover:bg-gray-50"
                    >
                      <Plus size={16} />
                      Tạo custom {LEVEL_AXIS_LABELS[pendingNodePicker.level]}
                    </button>
                  </div>
                </div>
              )}
              {pendingCustomNodeEditor && (
                <div
                  data-node-picker="true"
                  className="absolute z-40 w-[320px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                  style={{
                    left: Math.min(Math.max(pendingCustomNodeEditor.x + 16, LEVEL_LABEL_W + 20), canvasW - 340),
                    top: pendingCustomNodeEditor.y,
                  }}
                >
                  <div className="border-b border-gray-100 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">
                      Custom {LEVEL_AXIS_LABELS[pendingCustomNodeEditor.level]}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-gray-700">
                      {pendingCustomNodeEditor.level === 'angle' ? 'Nhập tên angle rồi generate từ branch này.' : 'Nhập tên node để nối tiếp branch hiện tại.'}
                    </p>
                  </div>
                  <div className="space-y-3 p-3">
                    {pendingCustomNodeEditor.level === 'angle' && (
                      <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-bold text-teal-700">Gợi ý AI từ painpoint</p>
                          <button
                            onClick={handleRefreshAngleSuggestions}
                            disabled={isGeneratingAngleOptions}
                            className="inline-flex items-center gap-1 rounded-lg border border-teal-200 px-2 py-1 text-[10px] font-bold text-teal-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isGeneratingAngleOptions ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                            Gen lại
                          </button>
                        </div>
                        {isGeneratingAngleOptions && generatedAngleOptions.length === 0 ? (
                          <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-teal-700">
                            <Loader2 size={12} className="animate-spin" />
                            Đang tạo gợi ý angle...
                          </div>
                        ) : generatedAngleOptions.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {generatedAngleOptions.slice(0, 6).map(option => (
                              <button
                                key={option}
                                onClick={() => setPendingCustomNodeEditor(prev => prev ? { ...prev, draftLabel: option } : prev)}
                                className="rounded-full border border-teal-200 bg-white px-3 py-1.5 text-left text-[11px] font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-teal-700/80">Chưa tạo được gợi ý. Bạn vẫn có thể nhập angle thủ công.</p>
                        )}
                      </div>
                    )}
                    <input
                      autoFocus
                      value={pendingCustomNodeEditor.draftLabel}
                      onChange={(e) => setPendingCustomNodeEditor(prev => prev ? { ...prev, draftLabel: e.target.value } : prev)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSubmitCustomNodeEditor();
                        }
                      }}
                      placeholder={`Nhập ${LEVEL_AXIS_LABELS[pendingCustomNodeEditor.level]}`}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-indigo-300"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setPendingCustomNodeEditor(null)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-50"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={handleSubmitCustomNodeEditor}
                        disabled={!pendingCustomNodeEditor.draftLabel.trim()}
                        className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {pendingCustomNodeEditor.level === 'angle' ? 'Tạo + Generate' : 'Tạo node'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* ===== SELECTED ANGLE → Ideas Detail ===== */}
      {detailIdeas.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-teal-200 shadow-sm p-6 animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
              🧭 {detailLabel}
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{detailIdeaCount} ideas</span>
            </h3>
            <button onClick={() => { setSelectedNode(null); setActivePath([]); }}
              className="text-gray-400 hover:text-gray-600 text-sm font-medium px-3 py-1 hover:bg-gray-100 rounded-lg transition-colors">
              Đóng ✕
            </button>
          </div>

          {loadingIdeaDetails && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Đang tải script chi tiết cho nhánh này...
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {detailIdeas.map((idea) => {
              const c = idea.content;
              const result = ideaResults[idea.id] || toResultType(idea.result);
              return (
                <div key={idea.id} className="border border-gray-100 rounded-xl bg-gradient-to-br from-white to-gray-50/50 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-800 text-sm truncate flex-1">{idea.title}</h4>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        {(['win', 'failed', 'monitoring'] as const).map(r => (
                          <button key={r} onClick={(e) => { e.stopPropagation(); handleSetResult(idea.id, result === r ? null : r); }}
                            className={`text-[10px] font-bold px-2 py-1 rounded-full transition-all border ${
                              result === r
                                ? r === 'win' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : r === 'failed' ? 'bg-red-100 text-red-500 border-red-200' : 'bg-amber-100 text-amber-600 border-amber-200'
                                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                            }`}>
                            {r === 'win' ? '🏆' : r === 'failed' ? '❌' : '👁'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-3">{idea.duration} · {new Date(idea.created_at).toLocaleDateString('vi-VN')}</p>

                    {c?.hook?.script && (
                      <div className="bg-rose-50/60 rounded-lg p-3 border border-rose-100 mb-2">
                        <span className="text-[9px] font-bold text-rose-400 uppercase block mb-1">🎣 Hook</span>
                        <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{c.hook.script}</p>
                        {c.hook.textOverlay && <p className="text-[10px] font-bold text-gray-800 mt-1.5">📝 {c.hook.textOverlay}</p>}
                      </div>
                    )}
                    {c?.body?.script && (
                      <div className="bg-blue-50/40 rounded-lg p-3 border border-blue-100 mb-2">
                        <span className="text-[9px] font-bold text-blue-400 uppercase block mb-1">📖 Body</span>
                        <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{c.body.script}</p>
                        {c.body.textOverlay && <p className="text-[10px] font-bold text-gray-800 mt-1.5">📝 {c.body.textOverlay}</p>}
                      </div>
                    )}
                    {c?.cta?.script && (
                      <div className="bg-emerald-50/40 rounded-lg p-3 border border-emerald-100 mb-2">
                        <span className="text-[9px] font-bold text-emerald-400 uppercase block mb-1">🔥 CTA</span>
                        <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{c.cta.script}</p>
                        {c.cta.textOverlay && <p className="text-[10px] font-bold text-gray-800 mt-1.5">📝 {c.cta.textOverlay}</p>}
                        {c.cta.endCard && <p className="text-[10px] text-gray-500 mt-0.5">🏷️ {c.cta.endCard}</p>}
                      </div>
                    )}

                    <button onClick={() => {
                      navigator.clipboard.writeText(
                        `${idea.title}\n\n🎣 HOOK:\n${c?.hook?.script || ''}\nText: ${c?.hook?.textOverlay || c?.hook?.text || ''}\n\n📖 BODY:\n${c?.body?.script || ''}\nText: ${c?.body?.textOverlay || c?.body?.text || ''}\n\n🔥 CTA:\n${c?.cta?.script || c?.cta?.voice || ''}\nText: ${c?.cta?.text || ''}`
                      );
                    }} className="w-full text-center text-[10px] text-indigo-500 hover:text-indigo-700 font-medium py-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center gap-1 mt-2 border border-transparent hover:border-indigo-100 transition-all">
                      <Copy size={10} /> Copy Script
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
