'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Loader2, Sparkles, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppProject } from '@/types/database';
import { getIdeaSessions, updateIdeaResult, type IdeaSession } from '@/lib/db';

type ResultType = 'win' | 'failed' | 'monitoring' | null;

interface TreeNode {
  id: string;
  label: string;
  level: 'root' | 'coreUser' | 'emotion' | 'painPoint' | 'solution';
  children: TreeNode[];
  ideas: any[];
  ideaCount: number;
  wins: number;
  fails: number;
  monitoring: number;
}

// ===== Layout constants =====
const NODE_W = 170;
const NODE_H = 78;
const GAP_X = 32;  // horizontal gap between sibling subtrees
const GAP_Y = 64;  // vertical gap between levels

// ===== Computed layout node =====
interface LayoutNode {
  treeNode: TreeNode;
  x: number;       // center x relative to parent
  y: number;       // top y (absolute)
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

  // Position children left to right, centered under parent
  let offsetX = -totalChildrenWidth / 2;
  childLayouts.forEach(child => {
    child.x = offsetX + child.subtreeWidth / 2;
    offsetX += child.subtreeWidth + GAP_X;
  });

  return { treeNode: node, x: 0, y: depth * (NODE_H + GAP_Y), subtreeWidth, children: childLayouts };
}

// Flatten layout to absolute positions
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
  emotion: { bg: '#f5f3ff', border: '#c4b5fd', accent: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', icon: '💜', label: 'Cảm xúc', textBg: '#ede9fe' },
  painPoint: { bg: '#fff1f2', border: '#fda4af', accent: '#f43f5e', gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)', icon: '🔥', label: 'Nỗi đau', textBg: '#ffe4e6' },
  solution: { bg: '#ecfdf5', border: '#6ee7b7', accent: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #059669)', icon: '💊', label: 'Giải pháp', textBg: '#d1fae5' },
};

interface StrategyMapProps {
  app: AppProject;
  onBack: () => void;
  onCreateFromBranch?: (filters: { coreUser: string[]; emotion: string[]; painPoint: string[]; solution: string[] }) => void;
}

export const StrategyMap: React.FC<StrategyMapProps> = ({ app, onBack, onCreateFromBranch }) => {
  const [sessions, setSessions] = useState<IdeaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string[]>([]);
  const [selectedLeaf, setSelectedLeaf] = useState<TreeNode | null>(null);
  const [ideaResults, setIdeaResults] = useState<Record<string, ResultType>>({});

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

  // Build tree
  const tree = useMemo((): TreeNode => {
    const root: TreeNode = { id: 'root', label: app.name, level: 'root', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 };
    sessions.forEach(session => {
      const f = session.filters as any;
      if (!f) return;
      const cuLabel = (f.coreUser || []).length > 0 ? (f.coreUser as string[]).join(', ') : 'Chung';
      const emLabel = (f.emotion || []).length > 0 ? (f.emotion as string[]).join(', ') : 'Chung';
      const ppLabel = (f.painPoint || []).length > 0 ? (f.painPoint as string[]).join(', ') : 'Chung';
      const pspLabel = (f.solution || []).length > 0 ? (f.solution as string[]).join(', ') : 'Chung';

      let cuNode = root.children.find(c => c.label === cuLabel);
      if (!cuNode) { cuNode = { id: `cu:${cuLabel}`, label: cuLabel, level: 'coreUser', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 }; root.children.push(cuNode); }
      let emNode = cuNode.children.find(c => c.label === emLabel);
      if (!emNode) { emNode = { id: `em:${cuLabel}|${emLabel}`, label: emLabel, level: 'emotion', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 }; cuNode.children.push(emNode); }
      let ppNode = emNode.children.find(c => c.label === ppLabel);
      if (!ppNode) { ppNode = { id: `pp:${cuLabel}|${emLabel}|${ppLabel}`, label: ppLabel, level: 'painPoint', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 }; emNode.children.push(ppNode); }
      let pspNode = ppNode.children.find(c => c.label === pspLabel);
      if (!pspNode) { pspNode = { id: `psp:${cuLabel}|${emLabel}|${ppLabel}|${pspLabel}`, label: pspLabel, level: 'solution', children: [], ideas: [], ideaCount: 0, wins: 0, fails: 0, monitoring: 0 }; ppNode.children.push(pspNode); }

      session.ideas.forEach((idea: any) => {
        pspNode!.ideas.push(idea);
        const result = ideaResults[idea.id] || idea.result;
        [pspNode!, ppNode!, emNode!, cuNode!, root].forEach(n => {
          n.ideaCount++;
          if (result === 'win') n.wins++;
          if (result === 'failed') n.fails++;
          if (result === 'monitoring') n.monitoring++;
        });
      });
    });
    return root;
  }, [sessions, ideaResults, app.name]);

  // Stats
  const stats = useMemo(() => {
    const cu = new Set<string>(), em = new Set<string>(), pp = new Set<string>(), psp = new Set<string>();
    tree.children.forEach(cuN => { cu.add(cuN.label); cuN.children.forEach(emN => { em.add(emN.label); emN.children.forEach(ppN => { pp.add(ppN.label); ppN.children.forEach(pspN => psp.add(pspN.label)); }); }); });
    return { cu: cu.size, em: em.size, pp: pp.size, psp: psp.size, total: tree.ideaCount, wins: tree.wins, fails: tree.fails, monitoring: tree.monitoring };
  }, [tree]);

  // Compute layout (no timing issues — pure math)
  const { flatNodes, flatLines, canvasW, canvasH } = useMemo(() => {
    if (tree.children.length === 0) return { flatNodes: [], flatLines: [], canvasW: 400, canvasH: 200 };
    const layout = computeLayout(tree, 0);
    const nodes: FlatNode[] = [];
    const lines: FlatLine[] = [];
    flattenLayout(layout, 0, nodes, lines);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    nodes.forEach(n => { minX = Math.min(minX, n.absX - NODE_W / 2); maxX = Math.max(maxX, n.absX + NODE_W / 2); maxY = Math.max(maxY, n.absY + NODE_H); });

    // Shift everything so minX = padding
    const pad = 40;
    const shiftX = -minX + pad;
    nodes.forEach(n => n.absX += shiftX);
    lines.forEach(l => { l.x1 += shiftX; l.x2 += shiftX; });

    return { flatNodes: nodes, flatLines: lines, canvasW: maxX - minX + pad * 2, canvasH: maxY + pad };
  }, [tree]);

  // Click node → highlight
  const handleNodeClick = (node: TreeNode) => {
    if (node.level === 'root') { setActivePath([]); setSelectedLeaf(null); return; }
    const findPath = (current: TreeNode, target: string, path: string[]): string[] | null => {
      const np = [...path, current.id];
      if (current.id === target) return np;
      for (const child of current.children) { const f = findPath(child, target, np); if (f) return f; }
      return null;
    };
    const fullPath = findPath(tree, node.id, []) || [];
    if (activePath.join('/') === fullPath.join('/')) { setActivePath([]); setSelectedLeaf(null); return; }
    const collectDesc = (n: TreeNode): string[] => { let ids = [n.id]; n.children.forEach(c => { ids = ids.concat(collectDesc(c)); }); return ids; };
    setActivePath([...fullPath, ...collectDesc(node).slice(1)]);
    if (node.level === 'solution') setSelectedLeaf(node); else setSelectedLeaf(null);
  };

  const handleCreate = () => {
    if (!onCreateFromBranch || !selectedLeaf) return;
    const parts = selectedLeaf.id.replace('psp:', '').split('|');
    onCreateFromBranch({
      coreUser: parts[0] && parts[0] !== 'Chung' ? [parts[0]] : [],
      emotion: parts[1] && parts[1] !== 'Chung' ? [parts[1]] : [],
      painPoint: parts[2] && parts[2] !== 'Chung' ? [parts[2]] : [],
      solution: parts[3] && parts[3] !== 'Chung' ? [parts[3]] : [],
    });
  };

  const handleSetResult = async (ideaId: string, result: ResultType) => {
    setIdeaResults(prev => ({ ...prev, [ideaId]: result }));
    await updateIdeaResult(ideaId, result);
  };

  const isHigh = (nodeId: string) => activePath.length === 0 || activePath.includes(nodeId);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6"><ArrowLeft size={18} /> Quay lại</button>
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-full mx-auto animate-in fade-in duration-500">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors">
        <ArrowLeft size={18} /> Quay lại
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
            🗺️ Strategy Map
            <span className="text-sm font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{app.name}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Click node để highlight nhánh · Click 💊 PSP để xem ideas</p>
        </div>
        {selectedLeaf && onCreateFromBranch && (
          <button onClick={handleCreate}
            className="bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:shadow-lg hover:shadow-pink-200 hover:scale-105 transition-all">
            <Sparkles size={16} /> Tạo idea từ nhánh này
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-6">
        {[
          { n: stats.cu, label: 'Đối tượng', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600', icon: '👤' },
          { n: stats.em, label: 'Cảm xúc', bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', icon: '💜' },
          { n: stats.pp, label: 'Nỗi đau', bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', icon: '🔥' },
          { n: stats.psp, label: 'PSP', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', icon: '💊' },
          { n: stats.total, label: 'Tổng Ideas', bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600', icon: '💡' },
          { n: stats.wins, label: 'Win', bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600', icon: '🏆' },
          { n: stats.fails, label: 'Failed', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-500', icon: '❌' },
          { n: stats.monitoring, label: 'Theo dõi', bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', icon: '👁' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3 text-center`}>
            <span className="text-xs">{s.icon}</span>
            <p className={`text-xl font-bold ${s.text}`}>{s.n}</p>
            <p className="text-[9px] text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4 px-2">
        {(['coreUser', 'emotion', 'painPoint', 'solution'] as const).map(key => {
          const s = LEVEL_COLORS[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.accent }} />
              <span className="text-xs font-semibold text-gray-500">{s.icon} {s.label}</span>
            </div>
          );
        })}
      </div>

      {/* ===== TREE DIAGRAM — Computed Layout + SVG Lines ===== */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
        {tree.children.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🗺️</p>
            <p className="text-lg font-bold text-gray-400 mb-2">Chưa có dữ liệu chiến lược</p>
            <p className="text-sm text-gray-400">Tạo ý tưởng với bộ lọc để bắt đầu xây dựng Strategy Map</p>
          </div>
        ) : (
          <div className="relative mx-auto" style={{ width: canvasW, height: canvasH }}>
            {/* SVG Connector Lines */}
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
                      strokeWidth={isActive ? 3 : 1.5}
                      strokeLinecap="round"
                      className="transition-all duration-400"
                      style={{ opacity: isActive ? 1 : 0.12 }}
                    />
                    {/* Dot at connection points */}
                    {isActive && (
                      <>
                        <circle cx={line.x1} cy={line.y1} r={3.5}
                          fill={LEVEL_COLORS[line.parentLevel]?.accent || '#94a3b8'} opacity={0.5} />
                        <circle cx={line.x2} cy={line.y2} r={3.5}
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
              const isSelected = selectedLeaf?.id === node.id;
              const displayLabel = node.label.length > 22 ? node.label.substring(0, 22) + '…' : node.label;

              return (
                <div
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  className="absolute cursor-pointer select-none transition-all duration-300"
                  style={{
                    left: absX - NODE_W / 2,
                    top: absY,
                    width: NODE_W,
                    height: NODE_H,
                    zIndex: isSelected ? 20 : highlighted ? 10 : 1,
                    opacity: highlighted ? 1 : 0.18,
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
                    {/* Top accent bar */}
                    <div className="h-[3px] w-full" style={{ background: style.gradient }} />

                    {/* Content */}
                    <div className="flex flex-col items-center justify-center px-3 pt-2 pb-2">
                      <div className="flex items-center gap-1.5 w-full justify-center mb-1.5">
                        <span className="text-sm flex-shrink-0">{style.icon}</span>
                        <span
                          className="text-[11px] font-bold text-gray-800 truncate leading-tight"
                          title={node.label}
                        >
                          {displayLabel}
                        </span>
                      </div>

                      {/* Stats badges */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                          style={{ background: style.textBg, color: style.accent, border: `1px solid ${style.border}` }}
                        >
                          {node.ideaCount}
                        </span>
                        {node.wins > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">
                            🏆{node.wins}
                          </span>
                        )}
                        {node.fails > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 border border-red-200">
                            ❌{node.fails}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== SELECTED LEAF → Ideas Detail ===== */}
      {selectedLeaf && selectedLeaf.ideas.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-emerald-200 shadow-sm p-6 animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
              💊 {selectedLeaf.label}
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{selectedLeaf.ideaCount} ideas</span>
            </h3>
            <button onClick={() => { setSelectedLeaf(null); setActivePath([]); }}
              className="text-gray-400 hover:text-gray-600 text-sm font-medium px-3 py-1 hover:bg-gray-100 rounded-lg transition-colors">
              Đóng ✕
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedLeaf.ideas.map((idea: any) => {
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

// ===== COMBINATION TABLE COMPONENT =====
interface ComboRow {
  coreUser: string;
  emotion: string;
  painPoint: string;
  solution: string;
  ideas: any[];
  ideaCount: number;
  wins: number;
  fails: number;
  monitoring: number;
}

function CombinationTable({ tree, ideaResults, onSetResult }: {
  tree: TreeNode;
  ideaResults: Record<string, ResultType>;
  onSetResult: (id: string, r: ResultType) => void;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'count' | 'wins'>('count');

  const combos = useMemo(() => {
    const rows: ComboRow[] = [];
    tree.children.forEach(cuNode => {
      cuNode.children.forEach(emNode => {
        emNode.children.forEach(ppNode => {
          ppNode.children.forEach(pspNode => {
            const ideas = pspNode.ideas;
            let wins = 0, fails = 0, monitoring = 0;
            ideas.forEach((i: any) => {
              const r = ideaResults[i.id] || i.result;
              if (r === 'win') wins++;
              if (r === 'failed') fails++;
              if (r === 'monitoring') monitoring++;
            });
            rows.push({
              coreUser: cuNode.label,
              emotion: emNode.label,
              painPoint: ppNode.label,
              solution: pspNode.label,
              ideas,
              ideaCount: ideas.length,
              wins, fails, monitoring,
            });
          });
        });
      });
    });
    rows.sort((a, b) => sortBy === 'wins' ? b.wins - a.wins : b.ideaCount - a.ideaCount);
    return rows;
  }, [tree, ideaResults, sortBy]);

  if (combos.length === 0) return null;

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
          📊 BIỂU ĐỒ PHỐI HỢP
          <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{combos.length} tổ hợp</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-medium">Sắp xếp:</span>
          <button onClick={() => setSortBy('count')}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${sortBy === 'count' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
            Số lượng
          </button>
          <button onClick={() => setSortBy('wins')}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${sortBy === 'wins' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
            Win rate
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">Mỗi hàng = 1 bộ kết hợp. Bộ dùng nhiều nhất ở trên. Click hàng xem chi tiết ideas.</p>

      {/* Table Header */}
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_60px_80px] gap-3 px-4 py-3 bg-gray-50 rounded-xl mb-2">
        <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">👤 Core User</span>
        <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">🔥 Painpoint</span>
        <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wider">💜 Emotion</span>
        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">💊 PSP</span>
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">SL</span>
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">KẾT QUẢ</span>
      </div>

      {/* Table Rows */}
      <div className="space-y-1.5">
        {combos.map((combo, idx) => (
          <div key={idx}>
            <div
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              className={`grid grid-cols-[1fr_1fr_1fr_1fr_60px_80px] gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:shadow-sm border ${
                expandedIdx === idx ? 'bg-indigo-50/50 border-indigo-200 shadow-sm' : 'bg-white border-gray-100 hover:bg-gray-50'
              }`}
            >
              <span className="text-[11px] text-gray-700 truncate font-medium" title={combo.coreUser}>{combo.coreUser}</span>
              <span className="text-[11px] text-gray-600 truncate" title={combo.painPoint}>{combo.painPoint}</span>
              <span className="text-[11px] text-gray-600 truncate" title={combo.emotion}>{combo.emotion}</span>
              <span className="text-[11px] text-gray-600 truncate" title={combo.solution}>{combo.solution}</span>
              <span className="text-[11px] font-bold text-indigo-600 text-center">{combo.ideaCount}</span>
              <div className="flex items-center justify-center gap-1">
                {combo.wins > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">🏆{combo.wins}</span>}
                {combo.fails > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-500">❌{combo.fails}</span>}
                {combo.wins === 0 && combo.fails === 0 && <span className="text-[9px] text-gray-300">—</span>}
                {expandedIdx === idx ? <ChevronUp size={12} className="text-gray-400 ml-1" /> : <ChevronDown size={12} className="text-gray-400 ml-1" />}
              </div>
            </div>

            {/* Expanded Ideas */}
            {expandedIdx === idx && combo.ideas.length > 0 && (
              <div className="ml-4 mr-4 mt-1 mb-2 p-4 bg-gray-50/80 rounded-xl border border-gray-100 animate-in slide-in-from-top-1 duration-200">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {combo.ideas.map((idea: any) => {
                    const c = idea.content as any;
                    const result = ideaResults[idea.id] || idea.result;
                    return (
                      <div key={idea.id} className="bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between mb-1.5">
                          <h5 className="text-[11px] font-semibold text-gray-800 truncate flex-1">{idea.title}</h5>
                          <div className="flex items-center gap-0.5 ml-2">
                            {(['win', 'failed', 'monitoring'] as const).map(r => (
                              <button key={r} onClick={(e) => { e.stopPropagation(); onSetResult(idea.id, result === r ? null : r); }}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border transition-all ${
                                  result === r
                                    ? r === 'win' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : r === 'failed' ? 'bg-red-100 text-red-500 border-red-200' : 'bg-amber-100 text-amber-600 border-amber-200'
                                    : 'bg-gray-50 text-gray-300 border-gray-200 hover:bg-gray-100'
                                }`}>
                                {r === 'win' ? '🏆' : r === 'failed' ? '❌' : '👁'}
                              </button>
                            ))}
                          </div>
                        </div>
                        {c?.hook?.script && (
                          <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">{c.hook.script.substring(0, 150)}</p>
                        )}
                        <button onClick={() => {
                          navigator.clipboard.writeText(
                            `${idea.title}\n\n🎣 HOOK:\n${c?.hook?.script || ''}\n\n📖 BODY:\n${c?.body?.script || ''}\n\n🔥 CTA:\n${c?.cta?.script || c?.cta?.voice || ''}`
                          );
                        }} className="text-[9px] text-indigo-500 font-medium mt-2 hover:text-indigo-700 flex items-center gap-1">
                          <Copy size={9} /> Copy Script
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
