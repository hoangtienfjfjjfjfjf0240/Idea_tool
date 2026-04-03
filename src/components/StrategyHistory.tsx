'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Loader2, Copy, ChevronDown, ChevronUp, Trophy, XCircle, Eye, ArrowRight } from 'lucide-react';
import type { AppProject } from '@/types/database';
import { getIdeaSessions, updateIdeaResult, type IdeaSession } from '@/lib/db';

type ResultType = 'win' | 'failed' | 'monitoring' | null;

const RESULT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  win: { label: 'Win', color: 'text-emerald-600', bg: 'bg-emerald-100', icon: '🏆' },
  failed: { label: 'Failed', color: 'text-red-600', bg: 'bg-red-100', icon: '❌' },
  monitoring: { label: 'Theo dõi', color: 'text-amber-600', bg: 'bg-amber-100', icon: '👁' },
  none: { label: '—', color: 'text-gray-400', bg: 'bg-gray-100', icon: '' },
};

// Standalone dropdown — no hooks inside parent render
function ResultSelect({ value, onChange }: { value: ResultType; onChange: (v: ResultType) => void }) {
  const [open, setOpen] = useState(false);
  const cfg = RESULT_CONFIG[value || 'none'];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg w-full justify-center ${cfg.bg} ${cfg.color} hover:shadow-sm transition-all`}
      >
        {cfg.icon} {cfg.label} <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden w-32">
            {(['win', 'failed', 'monitoring', null] as ResultType[]).map(v => {
              const c = RESULT_CONFIG[v || 'none'];
              return (
                <button key={String(v)} onClick={(e) => { e.stopPropagation(); onChange(v); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 ${c.color} ${value === v ? 'bg-gray-50 font-bold' : ''}`}>
                  {c.icon || '○'} {c.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface CombinationRow {
  key: string;
  coreUser: string;
  painpoint: string;
  emotion: string;
  psp: string;
  count: number;
  ideas: any[];
}

export const StrategyHistory: React.FC<{ app: AppProject; onBack: () => void }> = ({ app, onBack }) => {
  const [sessions, setSessions] = useState<IdeaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedIdea, setExpandedIdea] = useState<string | null>(null);
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

  // Build combination rows
  const rows = useMemo(() => {
    const map = new Map<string, CombinationRow>();
    sessions.forEach(session => {
      const f = session.filters;
      if (!f) return;
      session.ideas.forEach(idea => {
        const c = idea.content as any;
        const cu = c?.framework?.coreUser || f.coreUser?.[0] || '';
        const pp = c?.framework?.painpoint || f.painPoint?.[0] || '';
        const em = c?.framework?.emotion || f.emotion?.[0] || '';
        const psp = c?.framework?.psp || f.solution?.[0] || '';
        // Skip legacy ideas with no framework data
        if (!cu && !pp && !em && !psp) return;
        const cuLabel = cu || 'Không rõ';
        const ppLabel = pp || 'Không rõ';
        const emLabel = em || 'Không rõ';
        const pspLabel = psp || 'Không rõ';
        const key = `${cuLabel}|||${ppLabel}|||${emLabel}|||${pspLabel}`;
        if (!map.has(key)) map.set(key, { key, coreUser: cuLabel, painpoint: ppLabel, emotion: emLabel, psp: pspLabel, count: 0, ideas: [] });
        map.get(key)!.count++;
        map.get(key)!.ideas.push(idea);
      });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [sessions]);

  // Stats
  const stats = useMemo(() => {
    const cu = new Set<string>(), pp = new Set<string>(), em = new Set<string>(), psp = new Set<string>();
    rows.forEach(r => { cu.add(r.coreUser); pp.add(r.painpoint); em.add(r.emotion); psp.add(r.psp); });
    let win = 0, failed = 0, monitoring = 0;
    Object.values(ideaResults).forEach(r => { if (r === 'win') win++; else if (r === 'failed') failed++; else if (r === 'monitoring') monitoring++; });
    const totalIdeas = rows.reduce((s, r) => s + r.count, 0);
    return { cu: cu.size, pp: pp.size, em: em.size, psp: psp.size, win, failed, monitoring, totalIdeas };
  }, [rows, ideaResults]);

  const maxCount = useMemo(() => Math.max(...rows.map(r => r.count), 1), [rows]);

  const handleSetResult = async (ideaId: string, result: ResultType) => {
    setIdeaResults(prev => ({ ...prev, [ideaId]: result }));
    await updateIdeaResult(ideaId, result);
  };

  const handleSetRowResult = async (ideas: any[], result: ResultType) => {
    const updated = { ...ideaResults };
    ideas.forEach(i => { updated[i.id] = result; });
    setIdeaResults(updated);
    for (const idea of ideas) {
      await updateIdeaResult(idea.id, result);
    }
  };

  const copyIdea = (idea: any) => {
    const c = idea.content;
    navigator.clipboard.writeText(
      `${idea.title} (${idea.duration})\n\n🎣 HOOK\nVisual: ${c.hook?.visual || ''}\nText: ${c.hook?.text || ''}\nVoice: "${c.hook?.voice || ''}"\n\n📖 BODY\nVisual: ${c.body?.visual || ''}\nText: ${c.body?.text || ''}\nVoice: "${c.body?.voice || ''}"\n\n🔥 CTA\nVoice: "${c.cta?.voice || ''}"\nText: ${c.cta?.text || ''}`
    );
  };

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6"><ArrowLeft size={18} /> Quay lại</button>
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
      </div>
    );
  }

  const gridCols = 'grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_16px_minmax(0,1fr)_16px_minmax(0,1fr)_36px_80px]';

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6"><ArrowLeft size={18} /> Quay lại</button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-md flex items-center justify-center bg-gray-50">
          {app.icon_url.startsWith('http') ? <img src={app.icon_url} alt={app.name} className="w-full h-full object-cover" /> : <span className="text-3xl">{app.icon_url}</span>}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📊 Plan Overview</h1>
          <p className="text-sm text-gray-500">{app.name} — {sessions.length} phiên · {stats.totalIdeas} ideas · {rows.length} bộ kết hợp</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-7 gap-2 mb-8">
        {[
          { n: stats.cu, label: 'Core Users', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-500', sub: 'text-blue-400' },
          { n: stats.pp, label: 'Painpoints', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-500', sub: 'text-red-400' },
          { n: stats.em, label: 'Emotions', bg: 'bg-purple-50', border: 'border-purple-100', text: 'text-purple-500', sub: 'text-purple-400' },
          { n: stats.psp, label: 'PSP', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-500', sub: 'text-emerald-400' },
          { n: stats.win, label: '🏆 Win', bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600', sub: 'text-green-500' },
          { n: stats.failed, label: '❌ Failed', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-600', sub: 'text-red-500' },
          { n: stats.monitoring, label: '👁 Theo dõi', bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', sub: 'text-amber-500' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${s.text}`}>{s.n}</p>
            <p className={`text-[10px] ${s.sub} font-medium mt-1`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Flow Diagram */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6" style={{ overflow: 'visible' }}>
        <h2 className="font-bold text-gray-700 mb-1 text-sm uppercase tracking-wider">Biểu đồ kết hợp</h2>
        <p className="text-xs text-gray-400 mb-4">Mỗi hàng = 1 bộ kết hợp. Bộ dùng nhiều nhất ở trên. Click hàng xem chi tiết ideas.</p>

        {/* Header */}
        <div className={`grid ${gridCols} gap-1 mb-2 px-2`}>
          <span className="text-[9px] font-bold text-blue-500 uppercase text-center bg-blue-50 py-1 rounded-full">👤 Core User</span>
          <span />
          <span className="text-[9px] font-bold text-red-500 uppercase text-center bg-red-50 py-1 rounded-full">💔 Painpoint</span>
          <span />
          <span className="text-[9px] font-bold text-purple-500 uppercase text-center bg-purple-50 py-1 rounded-full">😱 Emotion</span>
          <span />
          <span className="text-[9px] font-bold text-emerald-500 uppercase text-center bg-emerald-50 py-1 rounded-full">💊 PSP</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase text-center">SL</span>
          <span className="text-[9px] font-bold text-gray-400 uppercase text-center">Kết quả</span>
        </div>

        {/* Rows */}
        <div className="space-y-1.5" style={{ overflow: 'visible' }}>
          {rows.map(row => {
            const isOpen = expandedRow === row.key;
            const rowResult = row.ideas.length > 0 ? (ideaResults[row.ideas[0].id] || null) : null;

            return (
              <div key={row.key} style={{ overflow: 'visible' }}>
                <div style={{ overflow: 'visible' }} className={`grid ${gridCols} gap-1 items-center px-2 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  isOpen ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/50'
                }`}>
                  {/* CU */}
                  <div onClick={() => setExpandedRow(isOpen ? null : row.key)}
                    className={`rounded-lg px-2 py-1 border overflow-hidden ${isOpen ? 'bg-blue-100 border-blue-200' : 'bg-blue-50/60 border-blue-100/80'}`}>
                    <p className="text-[10px] font-medium text-gray-700 truncate" title={row.coreUser}>{row.coreUser}</p>
                  </div>
                  <div className="flex justify-center" onClick={() => setExpandedRow(isOpen ? null : row.key)}>
                    <ArrowRight size={12} className={isOpen ? 'text-indigo-400' : 'text-gray-300'} strokeWidth={2.5} />
                  </div>

                  {/* PP */}
                  <div onClick={() => setExpandedRow(isOpen ? null : row.key)}
                    className={`rounded-lg px-2 py-1 border overflow-hidden ${isOpen ? 'bg-red-100 border-red-200' : 'bg-red-50/60 border-red-100/80'}`}>
                    <p className="text-[10px] font-medium text-gray-700 truncate" title={row.painpoint}>{row.painpoint}</p>
                  </div>
                  <div className="flex justify-center" onClick={() => setExpandedRow(isOpen ? null : row.key)}>
                    <ArrowRight size={12} className={isOpen ? 'text-indigo-400' : 'text-gray-300'} strokeWidth={2.5} />
                  </div>

                  {/* EM */}
                  <div onClick={() => setExpandedRow(isOpen ? null : row.key)}
                    className={`rounded-lg px-2 py-1 border overflow-hidden ${isOpen ? 'bg-purple-100 border-purple-200' : 'bg-purple-50/60 border-purple-100/80'}`}>
                    <p className="text-[10px] font-medium text-gray-700 truncate" title={row.emotion}>{row.emotion}</p>
                  </div>
                  <div className="flex justify-center" onClick={() => setExpandedRow(isOpen ? null : row.key)}>
                    <ArrowRight size={12} className={isOpen ? 'text-indigo-400' : 'text-gray-300'} strokeWidth={2.5} />
                  </div>

                  {/* PSP */}
                  <div onClick={() => setExpandedRow(isOpen ? null : row.key)}
                    className={`rounded-lg px-2 py-1 border overflow-hidden ${isOpen ? 'bg-emerald-100 border-emerald-200' : 'bg-emerald-50/60 border-emerald-100/80'}`}>
                    <p className="text-[10px] font-medium text-gray-700 truncate" title={row.psp}>{row.psp}</p>
                  </div>

                  {/* Count */}
                  <div className="text-center" onClick={() => setExpandedRow(isOpen ? null : row.key)}>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isOpen ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{row.count}</span>
                  </div>

                  {/* Result */}
                  <ResultSelect value={rowResult} onChange={(v) => handleSetRowResult(row.ideas, v)} />
                </div>

                {/* Expanded */}
                {isOpen && (
                  <div className="mt-1.5 ml-3 mr-3 bg-gray-50 rounded-xl border border-gray-200 p-4 animate-in slide-in-from-top-1 duration-200">
                    <p className="text-xs text-gray-500 mb-3 font-medium">{row.count} ideas</p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {row.ideas.map((idea: any) => {
                        const c = idea.content as any;
                        const isExp = expandedIdea === idea.id;
                        return (
                          <div key={idea.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                            <div className="p-3 flex items-center justify-between gap-2">
                              <button onClick={() => setExpandedIdea(isExp ? null : idea.id)} className="flex-1 text-left min-w-0">
                                <h4 className="font-semibold text-gray-800 text-xs truncate">{idea.title}</h4>
                                <p className="text-[10px] text-gray-400 mt-0.5">{idea.duration} · {new Date(idea.created_at).toLocaleDateString('vi-VN')}</p>
                              </button>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <div className="w-20">
                                  <ResultSelect value={ideaResults[idea.id] || null} onChange={(v) => handleSetResult(idea.id, v)} />
                                </div>
                                <button onClick={() => setExpandedIdea(isExp ? null : idea.id)} className="p-1">
                                  {isExp ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                                </button>
                              </div>
                            </div>

                            {isExp && (
                              <div className="border-t border-gray-100 p-3 space-y-2 bg-gray-50/30">
                                {c?.explanation && <p className="text-gray-400 italic text-[11px] border-l-2 border-indigo-200 pl-2">{c.explanation}</p>}
                                {[
                                  { key: 'hook', label: '🎣 HOOK', bg: 'bg-red-50', border: 'border-red-100', title: 'text-red-500' },
                                  { key: 'body', label: '📖 BODY', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
                                  { key: 'cta', label: '🔥 CTA', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
                                ].map(sec => {
                                  const d = c?.[sec.key];
                                  if (!d) return null;
                                  return (
                                    <div key={sec.key} className={`${sec.bg} rounded-lg p-2.5 border ${sec.border}`}>
                                      <span className={`text-[9px] font-bold ${sec.title} uppercase block mb-1`}>{sec.label}</span>
                                      <div className="space-y-0.5 text-[11px]">
                                        {d.visual && <p><b className="text-gray-500">Visual:</b> <span className="text-gray-700">{d.visual}</span></p>}
                                        {(d.text || d.content) && <p><b className="text-gray-500">Text:</b> <span className="text-gray-700 whitespace-pre-line">{d.text || d.content}</span></p>}
                                        {d.voice && <p><b className="text-gray-500">Voice:</b> <span className="text-gray-500 italic">&quot;{d.voice}&quot;</span></p>}
                                        {d.endCard && <p><b className="text-gray-500">End Card:</b> <span className="text-emerald-600 font-medium">{d.endCard}</span></p>}
                                      </div>
                                    </div>
                                  );
                                })}
                                <button onClick={() => copyIdea(idea)}
                                  className="w-full text-center text-xs text-indigo-500 hover:text-indigo-700 font-medium py-1.5 hover:bg-indigo-50 rounded-lg flex items-center justify-center gap-1">
                                  <Copy size={12} /> Copy Script
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {stats.totalIdeas === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <p className="text-lg font-bold text-gray-400 mb-2">Chưa có dữ liệu</p>
          <p className="text-sm text-gray-400">Tạo ý tưởng trước để xây dựng Plan Overview</p>
        </div>
      )}
    </div>
  );
};
