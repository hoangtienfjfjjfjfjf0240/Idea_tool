'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, Loader2, Sparkles, Copy, ChevronLeft, ChevronRight, ChevronDown, Calendar } from 'lucide-react';
import type { AppProject } from '@/types/database';
import { getIdeaSessions, updateIdeaResult, type IdeaSession } from '@/lib/db';

type ResultType = 'win' | 'failed' | 'monitoring' | null;

interface TreeNode {
  id: string;
  label: string;
  level: 'root' | 'coreUser' | 'psp' | 'emotion' | 'visual' | 'painPoint' | 'angle';
  children: TreeNode[];
  ideas: any[];
  ideaCount: number;
  wins: number;
  fails: number;
  monitoring: number;
}

// ===== Layout constants =====
const NODE_W = 150;
const NODE_H = 64;
const GAP_X = 20;
const GAP_Y = 48;

interface LayoutNode {
  treeNode: TreeNode;
  x: number;
  y: number;
  subtreeWidth: number;
  children: LayoutNode[];
}

function computeLayout(node: TreeNode, depth: number): LayoutNode {
  if (node.children.length === 0) {
    return { treeNode: node, x: 0, y: depth * (NODE_H + GAP_Y), subtreeWidth: NODE_W, children: [] };
  }
  const childLayouts = node.children.map(c => computeLayout(c, depth + 1));
  const totalChildrenWidth = childLayouts.reduce((s, c) => s + c.subtreeWidth, 0) + (childLayouts.length - 1) * GAP_X;
  const subtreeWidth = Math.max(NODE_W, totalChildrenWidth);

  let offsetX = -totalChildrenWidth / 2;
  childLayouts.forEach(child => {
    child.x = offsetX + child.subtreeWidth / 2;
    offsetX += child.subtreeWidth + GAP_X;
  });

  return { treeNode: node, x: 0, y: depth * (NODE_H + GAP_Y), subtreeWidth, children: childLayouts };
}

interface FlatNode { node: TreeNode; absX: number; absY: number }
interface FlatLine { x1: number; y1: number; x2: number; y2: number; parentLevel: string; childLevel: string }

function flattenLayout(layout: LayoutNode, parentAbsX: number, nodes: FlatNode[], lines: FlatLine[]) {
  const absX = parentAbsX + layout.x;
  const absY = layout.y;
  nodes.push({ node: layout.treeNode, absX, absY });
  layout.children.forEach(child => {
    const childAbsX = absX + child.x;
    const childAbsY = child.y;
    lines.push({
      x1: absX, y1: absY + NODE_H,
      x2: childAbsX, y2: childAbsY,
      parentLevel: layout.treeNode.level,
      childLevel: child.treeNode.level,
    });
    flattenLayout(child, absX, nodes, lines);
  });
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

// ===== Week helpers =====
function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMondayOfWeek(year: number, week: number): Date {
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = jan1.getDay() || 7;
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() + (1 - dayOfWeek));
  const monday = new Date(firstMonday);
  monday.setDate(firstMonday.getDate() + (week - 1) * 7);
  return monday;
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

// Generate all weeks from current week through end of 2026
function generateWeekTimeline(): { key: string; label: string }[] {
  const now = new Date();
  const currentWeekKey = getWeekKey(now.toISOString());
  const endDate = new Date(2026, 11, 31);
  const result: { key: string; label: string }[] = [];

  // Start from current week's Monday
  const [cy, cw] = currentWeekKey.split('-W').map(Number);
  let monday = getMondayOfWeek(cy, cw);

  while (monday <= endDate) {
    const key = getWeekKey(monday.toISOString());
    if (!result.find(r => r.key === key)) {
      result.push({ key, label: getWeekRange(key) });
    }
    monday = new Date(monday);
    monday.setDate(monday.getDate() + 7);
  }
  return result;
}

interface StrategyMapProps {
  app: AppProject;
  onBack: () => void;
  inline?: boolean;
  onCreateFromBranch?: (filters: { coreUser: string[]; emotion: string[]; painPoint: string[]; solution: string[] }) => void;
}

export const StrategyMap: React.FC<StrategyMapProps> = ({ app, onBack, inline = false, onCreateFromBranch }) => {
  const [sessions, setSessions] = useState<IdeaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [ideaResults, setIdeaResults] = useState<Record<string, ResultType>>({});
  const [selectedWeek, setSelectedWeek] = useState<string>('all');
  const [showWeekDropdown, setShowWeekDropdown] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await getIdeaSessions(app.id);
      setSessions(data);
      const r: Record<string, ResultType> = {};
      data.forEach(s => s.ideas.forEach((i: any) => { if (i.result) r[i.id] = i.result; }));
      setIdeaResults(r);
      setLoading(false);
    })();
  }, [app.id]);

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

  // ===== Full weekly timeline: current week → end of 2026 =====
  const allWeeks = useMemo(() => generateWeekTimeline(), []);

  // ===== Count ideas per week (for badges) =====
  const weekIdeaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.forEach(s => {
      const wk = getWeekKey(s.createdAt);
      counts.set(wk, (counts.get(wk) || 0) + s.ideas.length);
    });
    return counts;
  }, [sessions]);

  // Current week key for highlighting
  const currentWeekKey = useMemo(() => getWeekKey(new Date().toISOString()), []);

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

  // Auto-select current week on first load
  useEffect(() => {
    if (selectedWeek === 'all' && currentWeekKey) {
      setSelectedWeek(currentWeekKey);
    }
  }, [currentWeekKey]);

  // ===== Filter sessions by selected week =====
  const filteredSessions = useMemo(() => {
    if (selectedWeek === 'all') return sessions;
    return sessions.filter(s => getWeekKey(s.createdAt) === selectedWeek);
  }, [sessions, selectedWeek]);

  // Build tree: root → coreUser → psp → emotion → visual → painPoint → angle
  // Skip levels where filter value is empty (no "Chung" nodes)
  const tree = useMemo((): TreeNode => {
    const root: TreeNode = { id: 'root', label: app.name, level: 'root', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 };
    const mkNode = (id: string, label: string, level: TreeNode['level']): TreeNode => ({ id, label, level, children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 });

    filteredSessions.forEach(session => {
      const f = session.filters as any;
      if (!f) return;

      // Extract filter values (empty array = not selected)
      const cuVals = (f.coreUser || []) as string[];
      const pspVals = (f.solution || []) as string[];
      const emVals = (f.emotion || []) as string[];
      const visVals = (f.visualType || []) as string[];
      const ppVals = (f.painPoint || []) as string[];
      const angleVals = (f.angle || []) as string[];

      // Build chain of levels, skipping empty ones
      const levels: { label: string; level: TreeNode['level']; key: string }[] = [];
      if (cuVals.length > 0) levels.push({ label: cuVals.join(', '), level: 'coreUser', key: cuVals.join(',') });
      if (pspVals.length > 0) levels.push({ label: pspVals.join(', '), level: 'psp', key: pspVals.join(',') });
      if (emVals.length > 0) levels.push({ label: emVals.join(', '), level: 'emotion', key: emVals.join(',') });
      if (visVals.length > 0) levels.push({ label: visVals.join(', '), level: 'visual', key: visVals.join(',') });
      if (ppVals.length > 0) levels.push({ label: ppVals.join(', '), level: 'painPoint', key: ppVals.join(',') });
      // Angle: each selected angle becomes its own node under painPoint
      if (angleVals.length > 0) {
        angleVals.forEach(angle => levels.push({ label: angle, level: 'angle', key: angle }));
      }

      // Walk down the tree, creating nodes as needed
      let parent = root;
      let pathKey = '';
      for (const lvl of levels) {
        pathKey += `|${lvl.key}`;
        const nodeId = `${lvl.level}:${pathKey}`;
        let node = parent.children.find(c => c.id === nodeId);
        if (!node) {
          node = mkNode(nodeId, lvl.label, lvl.level);
          parent.children.push(node);
        }
        parent = node;
      }

      // Attach ideas to the deepest node (angle or painPoint)
      session.ideas.forEach((idea: any) => {
        parent.ideas.push(idea);

        const result = ideaResults[idea.id] || idea.result;
        // Bubble up counts to all ancestors
        const findAncestors = (node: TreeNode, target: string, path: TreeNode[]): TreeNode[] | null => {
          const np = [...path, node];
          if (node.id === target) return np;
          for (const c of node.children) { const r = findAncestors(c, target, np); if (r) return r; }
          return null;
        };
        const ancestors = findAncestors(root, parent.id, []) || [parent];
        ancestors.forEach(n => {
          n.ideaCount++;
          if (result === 'win') n.wins++;
          if (result === 'failed') n.fails++;
          if (result === 'monitoring') n.monitoring++;
        });
      });
    });
    return root;
  }, [filteredSessions, ideaResults, app.name]);

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

  // Compute layout
  const { flatNodes, flatLines, canvasW, canvasH } = useMemo(() => {
    if (tree.children.length === 0) return { flatNodes: [], flatLines: [], canvasW: 400, canvasH: 200 };
    const layout = computeLayout(tree, 0);
    const nodes: FlatNode[] = [];
    const lines: FlatLine[] = [];
    flattenLayout(layout, 0, nodes, lines);

    let minX = Infinity, maxX = -Infinity, maxY = 0;
    nodes.forEach(n => { minX = Math.min(minX, n.absX - NODE_W / 2); maxX = Math.max(maxX, n.absX + NODE_W / 2); maxY = Math.max(maxY, n.absY + NODE_H); });

    const pad = 40;
    const shiftX = -minX + pad;
    nodes.forEach(n => n.absX += shiftX);
    lines.forEach(l => { l.x1 += shiftX; l.x2 += shiftX; });

    return { flatNodes: nodes, flatLines: lines, canvasW: maxX - minX + pad * 2, canvasH: maxY + pad };
  }, [tree]);

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
    // Show ideas panel for any node that has ideas attached
    if (node.ideas.length > 0) setSelectedNode(node); else setSelectedNode(null);
  };

  const handleSetResult = async (ideaId: string, result: ResultType) => {
    setIdeaResults(prev => ({ ...prev, [ideaId]: result }));
    await updateIdeaResult(ideaId, result);
  };

  const isHigh = (nodeId: string) => activePath.length === 0 || activePath.includes(nodeId);

  // Auto-scale: compute scale to fit tree into container width
  const containerWidth = treeContainerRef.current?.clientWidth || 900;
  const autoScale = canvasW > containerWidth ? containerWidth / canvasW : 1;
  const displayH = canvasH * autoScale + 32;

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
        {selectedNode && onCreateFromBranch && (
          <button onClick={() => {
            const parts = selectedNode.id.split('|');
            onCreateFromBranch({
              coreUser: parts[0] && parts[0] !== 'Chung' ? [parts[0].replace(/^.*:/, '')] : [],
              solution: parts[1] && parts[1] !== 'Chung' ? [parts[1]] : [],
              emotion: parts[2] && parts[2] !== 'Chung' ? [parts[2]] : [],
              painPoint: parts[4] && parts[4] !== 'Chung' ? [parts[4]] : [],
            });
          }}
            className="bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:shadow-lg hover:shadow-pink-200 hover:scale-105 transition-all">
            <Sparkles size={16} /> Tạo idea từ nhánh này
          </button>
        )}
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

      {/* Stats */}
      <div className={`grid gap-2 mb-4 ${inline ? 'grid-cols-4 md:grid-cols-8' : 'grid-cols-4 md:grid-cols-8'}`}>
        {[
          { n: stats.cu, label: 'Đối tượng', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600', icon: '👤' },
          { n: stats.psp, label: 'PSP', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', icon: '💊' },
          { n: stats.em, label: 'Cảm xúc', bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', icon: '💜' },
          { n: stats.pp, label: 'Nỗi đau', bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', icon: '🔥' },
          { n: stats.total, label: 'Tổng Ideas', bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600', icon: '💡' },
          { n: stats.wins, label: 'Win', bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600', icon: '🏆' },
          { n: stats.fails, label: 'Failed', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-500', icon: '❌' },
          { n: stats.monitoring, label: 'Theo dõi', bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', icon: '👁' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-2.5 text-center`}>
            <span className="text-xs">{s.icon}</span>
            <p className={`text-lg font-bold ${s.text}`}>{s.n}</p>
            <p className="text-[9px] text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 px-1 flex-wrap">
        {(['coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'] as const).map(key => {
          const s = LEVEL_COLORS[key];
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.accent }} />
              <span className="text-[10px] font-semibold text-gray-500">{s.icon} {s.label}</span>
            </div>
          );
        })}
      </div>

      {/* ===== TREE DIAGRAM — simple auto-fit ===== */}
      <div ref={treeContainerRef} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {tree.children.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🗺️</p>
            <p className="text-lg font-bold text-gray-400 mb-2">Chưa có dữ liệu chiến lược</p>
            <p className="text-sm text-gray-400">Tạo ý tưởng với bộ lọc để bắt đầu xây dựng Strategy Map</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="relative mx-auto"
              style={{
                width: canvasW,
                height: canvasH + 24,
                transform: autoScale < 1 ? `scale(${autoScale})` : undefined,
                transformOrigin: 'top left',
              }}
            >
              {/* SVG Lines */}
              <svg className="absolute inset-0" width={canvasW} height={canvasH} style={{ pointerEvents: 'none', zIndex: 0 }}>
                <defs>
                  {flatLines.map((line, i) => {
                    const parentColor = LEVEL_COLORS[line.parentLevel]?.accent || '#94a3b8';
                    const childColor = LEVEL_COLORS[line.childLevel]?.accent || '#94a3b8';
                    return (
                      <linearGradient key={`lg-${i}`} id={`lg-${i}`} gradientUnits="userSpaceOnUse"
                        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
                        <stop offset="0%" stopColor={parentColor} stopOpacity={0.7} />
                        <stop offset="100%" stopColor={childColor} stopOpacity={0.45} />
                      </linearGradient>
                    );
                  })}
                </defs>
                {flatLines.map((line, i) => {
                  const midY = line.y1 + (line.y2 - line.y1) * 0.5;
                  const isActive = activePath.length === 0 ||
                    (flatNodes.some(n => n.absX === line.x1 && n.absY === line.y1 - NODE_H && activePath.includes(n.node.id)) &&
                    flatNodes.some(n => n.absX === line.x2 && n.absY === line.y2 && activePath.includes(n.node.id)));
                  return (
                    <g key={i}>
                      <path
                        d={`M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`}
                        fill="none"
                        stroke={`url(#lg-${i})`}
                        strokeWidth={isActive ? 2.5 : 1}
                        strokeLinecap="round"
                        className="transition-all duration-400"
                        style={{ opacity: isActive ? 1 : 0.15 }}
                      />
                      {isActive && (
                        <>
                          <circle cx={line.x1} cy={line.y1} r={3}
                            fill={LEVEL_COLORS[line.parentLevel]?.accent || '#94a3b8'} opacity={0.5} />
                          <circle cx={line.x2} cy={line.y2} r={3}
                            fill={LEVEL_COLORS[line.childLevel]?.accent || '#94a3b8'} opacity={0.7} />
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Nodes */}
              {flatNodes.map(({ node, absX, absY }) => {
                const style = LEVEL_COLORS[node.level];
                const highlighted = isHigh(node.id);
                const isSelected = selectedNode?.id === node.id;
                const isLeaf = node.level === 'angle';
                const displayLabel = node.label.length > 16 ? node.label.substring(0, 16) + '…' : node.label;

                return (
                  <div
                    key={node.id}
                    onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
                    className={`absolute cursor-pointer select-none transition-all duration-300 ${isLeaf ? 'hover:scale-105' : ''}`}
                    style={{
                      left: absX - NODE_W / 2,
                      top: absY,
                      width: NODE_W,
                      height: NODE_H,
                      zIndex: isSelected ? 20 : highlighted ? 10 : 1,
                      opacity: highlighted ? 1 : 0.15,
                      transform: highlighted ? 'scale(1)' : 'scale(0.92)',
                    }}
                  >
                    <div
                      className="w-full h-full rounded-2xl overflow-hidden transition-all duration-300"
                      style={{
                        background: style.bg,
                        border: `2px solid ${isSelected ? style.accent : style.border}`,
                        boxShadow: isSelected
                          ? `0 0 0 3px ${style.accent}20, 0 8px 24px ${style.accent}18`
                          : highlighted ? `0 2px 8px rgba(0,0,0,0.06)` : 'none',
                      }}
                    >
                      <div className="h-[3px] w-full" style={{ background: style.gradient }} />
                      <div className="flex flex-col items-center justify-center px-2 pt-1.5 pb-1">
                        <div className="flex items-center gap-1 w-full justify-center mb-0.5">
                          <span className="text-[10px] flex-shrink-0">{style.icon}</span>
                          <span
                            className="text-[10px] font-bold text-gray-800 truncate leading-tight"
                            title={node.label}
                          >
                            {displayLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: style.textBg, color: style.accent, border: `1px solid ${style.border}` }}
                          >
                            {node.ideaCount} ideas
                          </span>
                          {node.wins > 0 && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">
                              🏆{node.wins}
                            </span>
                          )}
                          {node.fails > 0 && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-red-100 text-red-500 border border-red-200">
                              ❌{node.fails}
                            </span>
                          )}
                        </div>
                        {isLeaf && (
                          <p className="text-[7px] text-gray-400 mt-0.5">Click để xem →</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ===== SELECTED ANGLE → Ideas Detail ===== */}
      {selectedNode && selectedNode.ideas.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-teal-200 shadow-sm p-6 animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
              🧭 {selectedNode.label}
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{selectedNode.ideaCount} ideas</span>
            </h3>
            <button onClick={() => { setSelectedNode(null); setActivePath([]); }}
              className="text-gray-400 hover:text-gray-600 text-sm font-medium px-3 py-1 hover:bg-gray-100 rounded-lg transition-colors">
              Đóng ✕
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedNode.ideas.map((idea: any) => {
              const c = idea.content as any;
              const result = ideaResults[idea.id] || idea.result;
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
