'use client';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Wand2, Loader2, Check, Target, Clock, Copy, ListOrdered, FileEdit, Filter, Users, Zap, Lightbulb, Layout, Settings2, Trash2, Pencil, ChevronRight, Save, Video } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, ScreenType, IdeaContent } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';

interface FilterGeneratorProps {
  app: AppProject;
  currentScreen: ScreenType;
  setScreen: (s: ScreenType) => void;
  selectedModel?: AIModel;
}

const CATEGORIES: { id: keyof FilterState; label: string; icon: React.ElementType }[] = [
  { id: 'coreUser', label: 'Đối tượng', icon: Users },
  { id: 'painPoint', label: 'Nỗi đau', icon: Zap },
  { id: 'solution', label: 'Tính năng / Giải pháp', icon: Lightbulb },
  { id: 'emotion', label: 'Cảm xúc', icon: Target },
  { id: 'visualType', label: 'Dạng Visual', icon: Video },
];

export const FilterGenerator: React.FC<FilterGeneratorProps> = ({ app, currentScreen, setScreen, selectedModel }) => {
  const [filters, setFilters] = useState<FilterState>({ coreUser: [], painPoint: [], solution: [], emotion: [], videoStructure: [], visualType: [] });
  const [options, setOptions] = useState<Record<keyof FilterState, string[]>>({ coreUser: [], painPoint: [], solution: [], emotion: [], videoStructure: [], visualType: [] });
  const [newItem, setNewItem] = useState<{ cat: keyof FilterState | null; text: string }>({ cat: null, text: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [results, setResults] = useState<GeneratedIdea[]>([]);
  const [duration, setDuration] = useState('30s');
  const [quantity, setQuantity] = useState(3);
  const [ideaDescription, setIdeaDescription] = useState('');
  const [editModeCat, setEditModeCat] = useState<keyof FilterState | null>(null);
  const [editingItemText, setEditingItemText] = useState<{ original: string; current: string } | null>(null);
  const [savedHistory, setSavedHistory] = useState<GeneratedIdea[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingIdea, setEditingIdea] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<any>(null);

  useEffect(() => {
    loadOptions();
    loadHistory();
  }, [app.id]);

  // Auto-load results from DB when entering results screen
  useEffect(() => {
    if (currentScreen === 'f2.1.2' && results.length === 0) {
      dbService.getIdeas(app.id).then(ideas => {
        setResults(ideas);
        setSavedHistory(ideas);
      });
    }
  }, [currentScreen]);

  const loadOptions = async () => {
    const fullOptions = await dbService.getFilterOptions(app);
    setOptions(fullOptions);
  };

  const loadHistory = async () => {
    const ideas = await dbService.getIdeas(app.id);
    setSavedHistory(ideas);
  };

  const toggleFilter = (category: keyof FilterState, item: string) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(item) ? prev[category].filter(i => i !== item) : [...prev[category], item]
    }));
  };

  const handleAddItem = async (category: keyof FilterState) => {
    if (newItem.text.trim()) {
      await dbService.addFilterOption(app.id, category, newItem.text.trim());
      setOptions(prev => ({ ...prev, [category]: [...prev[category], newItem.text.trim()] }));
      setNewItem({ cat: null, text: '' });
    }
  };

  const handleDeleteOption = async (category: keyof FilterState, item: string) => {
    // Immediately update UI
    setOptions(prev => ({ ...prev, [category]: prev[category].filter(i => i !== item) }));
    if (filters[category].includes(item)) {
      setFilters(prev => ({ ...prev, [category]: prev[category].filter(i => i !== item) }));
    }
    // Persist deletion to DB
    const ok = await dbService.deleteFilterOptionByValue(app.id, category, item);
    console.log(`Delete filter option [${category}] "${item}":`, ok ? 'success' : 'failed');
  };

  const handleUpdateOption = (category: keyof FilterState, oldItem: string, newItemText: string) => {
    if (!newItemText.trim() || newItemText === oldItem) { setEditingItemText(null); return; }
    setOptions(prev => ({ ...prev, [category]: prev[category].map(i => (i === oldItem ? newItemText.trim() : i)) }));
    if (filters[category].includes(oldItem)) {
      setFilters(prev => ({ ...prev, [category]: prev[category].map(i => (i === oldItem ? newItemText.trim() : i)) }));
    }
    setEditingItemText(null);
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
      { at: 92, label: 'Đang lưu vào database...' },
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

  const handleGenerate = async () => {
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    startProgress();
    try {
      // Prepare previous ideas summary for AI to learn from (richer data for better learning)
      const previousIdeasSummary = savedHistory.slice(0, 10).map((idea, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = idea.content as any;
        return `${i + 1}. "${idea.title}" (${idea.duration})
   Framework: CoreUser="${c?.framework?.coreUser || ''}", Painpoint="${c?.framework?.painpoint || ''}", Emotion="${c?.framework?.emotion || ''}", PSP="${c?.framework?.psp || ''}"
   Hook: visual="${c?.hook?.visual || ''}", content="${c?.hook?.content || ''}", voice="${c?.hook?.voice || ''}"
   Body: visual="${c?.body?.visual || ''}", voice="${c?.body?.voice || ''}"
   CTA: "${c?.cta?.voice || ''}"`;
      }).join('\n');

      const res = await fetch('/api/generate-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: app.name,
          appCategory: app.category,
          filters,
          config: { quantity, duration, ideaDescription, visualType: filters.visualType?.join(', ') || 'UGC (Người thật)' },
          previousIdeas: previousIdeasSummary || null,
          appKnowledge: app.app_knowledge || null,
          selectedModel: selectedModel || 'gemini-2.5-pro',
        }),
        signal: controller.signal,
      });
      const result = await res.json();

      let ideas: { title: string; duration: string; content: IdeaContent }[];

      if (res.ok && result.success && result.data?.length > 0) {
        // Map API response — new script format
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ideas = result.data.map((item: any) => ({
          title: item.title || `Ý tưởng: ${app.name}`,
          duration: item.duration || duration,
          content: {
            framework: item.framework || { coreUser: '', painpoint: '', emotion: '', psp: '' },
            explanation: item.explanation || '',
            hook: {
              script: item.hook?.script || '',
              textOverlay: item.hook?.textOverlay || item.hook?.text_overlay || '',
              visual: item.hook?.script || item.hook?.visual || '',
              text: item.hook?.textOverlay || item.hook?.text_overlay || item.hook?.text || '',
              voice: item.hook?.voice || '',
            },
            body: {
              script: item.body?.script || '',
              textOverlay: item.body?.textOverlay || item.body?.text_overlay || '',
              visual: item.body?.script || item.body?.visual || '',
              text: item.body?.textOverlay || item.body?.text_overlay || item.body?.text || '',
              voice: item.body?.voice || '',
            },
            cta: {
              script: item.cta?.script || '',
              voice: item.cta?.voice || '',
              text: item.cta?.textOverlay || item.cta?.text_overlay || item.cta?.text || '',
              endCard: item.cta?.endCard || item.cta?.end_card || '',
            },
          },
        }));
      } else {
        // Fallback mock if API fails
        ideas = Array.from({ length: quantity }, (_, i) => ({
          title: `Ý tưởng ${i + 1}: ${app.name}`,
          duration: duration,
          content: {
            framework: {
              coreUser: filters.coreUser[0] || 'Người dùng phổ thông',
              painpoint: filters.painPoint[0] || 'Nỗi đau phổ biến',
              emotion: filters.emotion[0] || 'Tò mò',
              psp: filters.solution[0] || app.name,
            },
            explanation: `Video ${duration} kết hợp ${filters.painPoint[0] || 'nỗi đau'} với ${filters.solution[0] || 'tính năng chính'} của ${app.name}`,
            hook: { visual: 'Cận cảnh tay cầm điện thoại', text: filters.painPoint[0] || 'Bạn có biết?', voice: `"${filters.painPoint[0] || 'Điều gì sẽ xảy ra nếu...'}"` },
            body: { visual: `Mở app ${app.name}, demo tính năng`, text: `${filters.solution[0] || 'Tính năng chính'}`, voice: `"Chỉ cần 1 phút với ${app.name}"` },
            cta: { voice: '"Tải ngay link ở bio!"', text: `Tải ${app.name} Miễn Phí`, endCard: `${app.name} - Tải miễn phí` },
          },
        }));
      }

      // Save to Supabase DB with session tracking
      const sessionId = crypto.randomUUID();
      const saved = await dbService.saveIdeas(app.id, ideas, sessionId, filters);
      setResults(prev => [...saved, ...prev]);
      setSavedHistory(prev => [...saved, ...prev]);
      if (currentScreen !== 'f2.1.2') setScreen('f2.1.2');

      // Background: AI learns from new ideas → update app knowledge
      fetch('/api/learn-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          appName: app.name,
          appCategory: app.category,
          newIdeas: ideas.slice(0, 5),
          existingKnowledge: app.app_knowledge || '',
        }),
      }).catch(err => console.warn('Background learning failed:', err));
    } catch (err) {
      console.error('Generate failed:', err);
      alert('Có lỗi khi tạo ý tưởng. Vui lòng thử lại.');
    } finally {
      stopProgress();
      setIsGenerating(false);
    }
  };

  const handleCopy = (idea: GeneratedIdea) => {
    const c = idea.content as any;
    const fw = c.framework;
    const hookScript = c.hook?.script || c.hook?.visual || '';
    const bodyScript = c.body?.script || c.body?.visual || '';
    const ctaScript = c.cta?.script || '';
    const copyText = `TIÊU ĐỀ: ${idea.title} (${idea.duration})\n\n═══ FRAMEWORK ═══\n👤 Core User: ${fw?.coreUser || ''}\n💔 Painpoint: ${fw?.painpoint || ''}\n😱 Emotion: ${fw?.emotion || ''}\n💊 PSP: ${fw?.psp || ''}\n\nWHY IT WORKS: ${c.explanation}\n\n═══ VIDEO SCRIPT ═══\n\n🎣 HOOK (3-5s)\n${hookScript}\n[TEXT OVERLAY] ${c.hook?.textOverlay || c.hook?.text || ''}\n\n📖 BODY (10-25s)\n${bodyScript}\n[TEXT OVERLAY] ${c.body?.textOverlay || c.body?.text || ''}\n\n🔥 CTA (3-5s)\n${ctaScript}\n[TEXT OVERLAY] ${c.cta?.text || ''}\nEnd Card: ${c.cta?.endCard || ''}`;
    navigator.clipboard.writeText(copyText);
  };

  const startEditIdea = (idea: GeneratedIdea) => {
    setEditingIdea(idea.id);
    const c = idea.content as any;
    setEditBuffer({
      title: idea.title,
      explanation: c.explanation || '',
      hook: { script: c.hook?.script || '', textOverlay: c.hook?.textOverlay || '', visual: c.hook?.visual || '', text: c.hook?.text || '', voice: c.hook?.voice || '' },
      body: { script: c.body?.script || '', textOverlay: c.body?.textOverlay || '', visual: c.body?.visual || '', text: c.body?.text || '', voice: c.body?.voice || '' },
      cta: { script: c.cta?.script || '', voice: c.cta?.voice || '', text: c.cta?.text || '', endCard: c.cta?.endCard || '' },
    });
  };

  const saveEditIdea = async (idea: GeneratedIdea) => {
    if (!editBuffer) return;
    const newContent = {
      ...idea.content,
      explanation: editBuffer.explanation,
      hook: editBuffer.hook,
      body: editBuffer.body,
      cta: editBuffer.cta,
    };
    await dbService.updateIdeaContent(idea.id, editBuffer.title, newContent);
    // Update local state
    const updater = (list: GeneratedIdea[]) => list.map(i => i.id === idea.id ? { ...i, title: editBuffer.title, content: newContent } : i);
    setResults(updater);
    setSavedHistory(updater);
    setEditingIdea(null);
    setEditBuffer(null);
  };

  const STEPS = [
    { id: 'f2.1' as ScreenType, label: 'Bộ lọc', icon: Filter },
    { id: 'f2.1.1' as ScreenType, label: 'Cấu hình', icon: Settings2 },
    { id: 'f2.1.2' as ScreenType, label: 'Kết quả', icon: Wand2 },
  ];
  const currentStepIdx = STEPS.findIndex(s => s.id === currentScreen);

  // === RENDER: Filter Dashboard ===
  const renderFilterDashboard = () => (
    <div className="relative pb-28">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const filterItems = (options[cat.id] || []) as string[];
          const isEditMode = editModeCat === cat.id;

          return (
            <div key={cat.id} className={`bg-white rounded-2xl border overflow-hidden flex flex-col h-[400px] transition-all shadow-sm ${isEditMode ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
              <div className={`px-4 py-3 border-b flex justify-between items-center ${isEditMode ? 'bg-indigo-50 border-indigo-200' : 'border-gray-100'}`}>
                <h3 className="font-bold text-sm flex items-center gap-2 text-gray-700">
                  <Icon size={16} className={isEditMode ? 'text-indigo-500' : 'text-gray-400'} /> {cat.label}
                </h3>
                <div className="flex items-center gap-2">
                  {!isEditMode && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${filters[cat.id].length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                      {filters[cat.id].length}
                    </span>
                  )}
                  <button onClick={() => { setEditModeCat(isEditMode ? null : cat.id); setEditingItemText(null); }}
                    className={`p-1.5 rounded-lg transition-colors ${isEditMode ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}>
                    {isEditMode ? <Check size={14} /> : <Settings2 size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {isEditMode ? (
                  <div className="space-y-1.5">
                    {filterItems.map(item => (
                      <div key={item} className="flex items-center gap-1.5 group">
                        {editingItemText?.original === item ? (
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
                            <div onClick={() => setEditingItemText({ original: item, current: item })}
                              className="flex-1 px-3 py-2 rounded-lg text-sm bg-gray-50 border border-transparent hover:border-indigo-200 hover:bg-indigo-50/50 transition-all cursor-text text-gray-700 flex justify-between items-center">
                              {item}
                              <Pencil size={11} className="opacity-0 group-hover:opacity-100 text-gray-400" />
                            </div>
                            <button onClick={() => handleDeleteOption(cat.id, item)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {filterItems.map(item => (
                      <button key={item} onClick={() => toggleFilter(cat.id, item)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium text-left transition-all ${
                          filters[cat.id].includes(item) ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 shadow-sm' : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300'
                        }`}>
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-2.5 border-t border-gray-100">
                {newItem.cat === cat.id ? (
                  <div className="flex gap-1.5">
                    <input autoFocus className="flex-1 text-sm py-1.5 px-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200"
                      value={newItem.text} onChange={e => setNewItem({ ...newItem, text: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && handleAddItem(cat.id)} placeholder="Thêm mới..." />
                    <button onClick={() => handleAddItem(cat.id)} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check size={14} /></button>
                    <button onClick={() => setNewItem({ cat: null, text: '' })} className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-100"><X size={14} /></button>
                  </div>
                ) : (
                  <button onClick={() => setNewItem({ cat: cat.id, text: '' })} className="w-full text-xs font-bold flex items-center justify-center gap-1 py-2 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors">
                    <Plus size={14} /> THÊM TÙY CHỌN
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Action */}
      <div className="fixed bottom-6 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto bg-white/90 backdrop-blur-xl border border-gray-200 rounded-full p-2 pl-6 flex items-center gap-6 max-w-3xl w-full shadow-xl">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Đã chọn</span>
            <span className="font-bold text-indigo-600">{Object.values(filters).flat().length} <span className="text-xs text-gray-400 font-normal">yếu tố</span></span>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex-1 overflow-x-auto flex gap-1.5" style={{ scrollbarWidth: 'none' }}>
            {Object.values(filters).flat().slice(0, 5).map((f, i) => (
              <span key={i} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded whitespace-nowrap">{f}</span>
            ))}
            {Object.values(filters).flat().length > 5 && <span className="text-xs text-gray-400 self-center">...</span>}
          </div>
          <button onClick={() => setScreen('f2.1.1')} className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-full px-6 py-2.5 text-sm font-bold flex items-center gap-2 hover:shadow-lg transition-all">
            Tiếp tục <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  // === RENDER: Config Screen ===
  const renderConfigScreen = () => (
    <div className="max-w-4xl mx-auto pb-10">
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6 shadow-sm">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><Filter size={14} /> Bối cảnh đã chọn</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(filters).flatMap(([key, items]) =>
            (items as string[]).map(item => (
              <button key={`${key}-${item}`} onClick={() => toggleFilter(key as keyof FilterState, item)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors group cursor-pointer">
                {item} <X size={12} className="opacity-50 group-hover:opacity-100" />
              </button>
            ))
          )}
          {Object.values(filters).flat().length === 0 && <span className="text-gray-400 italic text-sm">Chưa chọn bối cảnh nào (AI sẽ tự do sáng tạo)</span>}
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-200 p-8 md:p-10 relative overflow-hidden min-h-[480px]">
        <button onClick={() => setScreen('f2.1')} className="mb-8 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft size={18} /> Quay lại Bộ lọc
        </button>

        <div className="max-w-2xl mx-auto relative z-10">
          <h3 className="text-2xl font-bold mb-8 flex items-center justify-center gap-3 text-gray-800">
            <Target className="text-pink-500" size={28} /> Cấu Hình Tạo Video
          </h3>

          <div className="grid grid-cols-2 gap-5 mb-6">
            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><Clock size={14} /> Thời lượng</label>
              <div className="flex gap-2">
                {['15s', '30s', '60s'].map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${duration === d ? 'bg-indigo-500 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><ListOrdered size={14} /> Số lượng Idea</label>
              <input type="number" min="1" value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full text-center text-xl font-bold py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
            </div>
          </div>


          <div className="mb-8">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><FileEdit size={14} /> Mô tả ý tưởng (Tùy chọn)</label>
            <textarea value={ideaDescription} onChange={(e) => setIdeaDescription(e.target.value)}
              placeholder="VD: Video cảm xúc mạnh, tập trung vào cảnh báo nguy hiểm..."
              className="w-full h-28 resize-none py-3 px-4 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
          </div>

          <button onClick={handleGenerate} disabled={isGenerating}
            className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${
              isGenerating ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-pink-500 to-orange-500 hover:shadow-orange-200 text-white hover:scale-[1.01]'
            }`}>
            {isGenerating ? <Loader2 className="animate-spin" size={22} /> : <Wand2 size={22} />}
            {isGenerating ? 'Đang Sáng Tạo & Lưu...' : 'BẮT ĐẦU TẠO IDEA'}
          </button>

          {/* Progress bar */}
          {isGenerating && progress > 0 && (
            <div className="mt-4 space-y-2">
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
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>Phân tích</span>
                <span>Hook & Visual</span>
                <span>Voice & Text</span>
                <span>Lưu DB</span>
              </div>
              <button onClick={handleCancel}
                className="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2">
                <X size={16} /> Hủy Tạo
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );

  // === RENDER: Results ===
  const renderResult = () => (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 w-full shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-gray-100">
        <div>
          <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Wand2 className="text-indigo-500" size={24} /> Kết Quả ({results.length})
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            {showHistory ? 'Tất cả ý tưởng đã tạo' : 'Ý tưởng theo bối cảnh đã chọn'}
            {' • '}<span className="text-emerald-500 font-medium">Đã lưu Supabase ✓</span>
          </p>
        </div>
        <div className="flex gap-2">
          {savedHistory.length > results.length && !showHistory && (
            <button onClick={() => { setResults(savedHistory); setShowHistory(true); }}
              className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">
              📜 Lịch sử ({savedHistory.length})
            </button>
          )}
          <button onClick={() => setScreen('f2.1.1')} className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600"><ArrowLeft size={14} /> Cấu hình</button>
          <button onClick={handleGenerate} disabled={isGenerating} className="text-sm flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600">
            {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Tạo thêm
          </button>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {results.map((idea, idx) => {
            const c = idea.content as any;
            const isEditing = editingIdea === idea.id;
            return (
            <div key={idea.id || idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
              <div className="h-1 bg-gradient-to-r from-indigo-500 to-purple-500 w-full" />
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input value={editBuffer?.title || ''} onChange={e => setEditBuffer({...editBuffer, title: e.target.value})}
                        className="font-bold text-lg text-gray-800 mb-1 w-full border-b-2 border-indigo-300 focus:outline-none bg-transparent" />
                    ) : (
                      <h4 className="font-bold text-lg text-gray-800 mb-1">{idea.title}</h4>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">{idea.duration}</span>
                      <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-400 rounded">{new Date(idea.created_at).toLocaleDateString('vi-VN')}</span>
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
                        <button onClick={() => startEditIdea(idea)} className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" title="Chỉnh sửa">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleCopy(idea)} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="Copy">
                          <Copy size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Explanation */}
                {isEditing ? (
                  <textarea value={editBuffer?.explanation || ''} onChange={e => setEditBuffer({...editBuffer, explanation: e.target.value})}
                    className="w-full text-sm text-gray-500 italic mb-4 border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-16" />
                ) : (
                  <p className="text-gray-400 italic text-sm mb-4 border-l-2 border-indigo-200 pl-3">{c.explanation}</p>
                )}

                {/* Sections: HOOK, BODY, CTA — unified script format */}
                {[{ key: 'hook', label: '🎣 HOOK (3-5s)', bg: 'bg-red-50', border: 'border-red-100', title: 'text-red-500' },
                  { key: 'body', label: '📖 BODY (10-25s)', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
                  { key: 'cta', label: '🔥 CTA (3-5s)', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
                ].map(sec => {
                  const secData = isEditing ? editBuffer?.[sec.key] : (c?.[sec.key] || {});
                  const scriptContent = secData?.script || secData?.visual || '';
                  const textOverlay = secData?.textOverlay || secData?.text || '';
                  const endCard = sec.key === 'cta' ? (secData?.endCard || '') : '';
                  const viTranslation = secData?.viTranslation || '';
                  return (
                    <div key={sec.key} className={`mb-4 ${sec.bg} rounded-xl p-4 border ${sec.border}`}>
                      <span className={`text-[10px] font-bold ${sec.title} uppercase tracking-widest flex items-center gap-1 mb-3`}>{sec.label}</span>
                      
                      {/* Script — unified storyboard */}
                      {isEditing ? (
                        <textarea value={secData?.script || secData?.visual || ''}
                          onChange={e => setEditBuffer({...editBuffer, [sec.key]: {...editBuffer[sec.key], script: e.target.value, visual: e.target.value}})}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-32 bg-white mb-2"
                          placeholder="Kịch bản liền mạch: visual + [VOICE] + [TEXT OVERLAY] + [SFX]" />
                      ) : (
                        <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed mb-3">{scriptContent || '—'}</p>
                      )}

                      {/* Vietnamese Translation */}
                      {!isEditing && viTranslation && (
                        <div className="mb-3 bg-white/60 rounded-lg px-3 py-2 border border-gray-200">
                          <span className="text-[10px] font-bold text-violet-500 uppercase">🇻🇳 Bản dịch Tiếng Việt</span>
                          <p className="text-sm text-gray-600 italic mt-0.5 whitespace-pre-line">{viTranslation}</p>
                        </div>
                      )}

                      {/* Hook Analysis — only for hook section */}
                      {sec.key === 'hook' && !isEditing && (secData?.viewerProfile || secData?.viewerEmotion || secData?.painpointImpact) && (
                        <div className="mb-3 space-y-2">
                          {secData?.viewerProfile && (
                            <div className="bg-purple-50 rounded-lg px-3 py-2 border border-purple-200">
                              <span className="text-[10px] font-bold text-purple-500 uppercase">👁️ Ai đang xem?</span>
                              <p className="text-xs text-gray-700 mt-0.5">{secData.viewerProfile}</p>
                            </div>
                          )}
                          {secData?.viewerEmotion && (
                            <div className="bg-orange-50 rounded-lg px-3 py-2 border border-orange-200">
                              <span className="text-[10px] font-bold text-orange-500 uppercase">😱 Người xem cảm nhận gì?</span>
                              <p className="text-xs text-gray-700 mt-0.5">{secData.viewerEmotion}</p>
                            </div>
                          )}
                          {secData?.painpointImpact && (
                            <div className="bg-rose-50 rounded-lg px-3 py-2 border border-rose-200">
                              <span className="text-[10px] font-bold text-rose-500 uppercase">💔 Painpoint đánh vào tâm lý</span>
                              <p className="text-xs text-gray-700 mt-0.5">{secData.painpointImpact}</p>
                            </div>
                          )}
                          {secData?.whyTheyStopScrolling && (
                            <div className="bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-200">
                              <span className="text-[10px] font-bold text-indigo-500 uppercase">🛑 Dừng scroll vì?</span>
                              <p className="text-xs text-gray-700 font-semibold mt-0.5">{secData.whyTheyStopScrolling}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Text Overlay + End Card */}
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <span className="text-[10px] font-bold text-amber-600 uppercase">📝 Text Overlay</span>
                          {isEditing ? (
                            <input value={secData?.textOverlay || secData?.text || ''}
                              onChange={e => setEditBuffer({...editBuffer, [sec.key]: {...editBuffer[sec.key], textOverlay: e.target.value, text: e.target.value}})}
                              className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-200 bg-white mt-1" />
                          ) : (
                            <p className="text-sm text-gray-800 font-bold mt-0.5">{textOverlay || '—'}</p>
                          )}
                        </div>
                        {sec.key === 'cta' && (
                          <div className="flex-1">
                            <span className="text-[10px] font-bold text-emerald-600 uppercase">🏷️ End Card</span>
                            {isEditing ? (
                              <input value={secData?.endCard || ''}
                                onChange={e => setEditBuffer({...editBuffer, [sec.key]: {...editBuffer[sec.key], endCard: e.target.value}})}
                                className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-200 bg-white mt-1" />
                            ) : (
                              <p className="text-sm text-gray-700 mt-0.5">{endCard || '—'}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-400">
          <Wand2 size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="font-bold text-gray-500">Chưa có ý tưởng nào</p>
          <p className="text-sm">Bấm "Tạo thêm" để bắt đầu.</p>
        </div>
      )}
    </div>
  );


  return (
    <div className={`p-6 sm:p-8 mx-auto transition-all duration-300 w-full ${currentScreen === 'f2.1.2' ? 'max-w-[95%]' : 'max-w-7xl'}`}>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setScreen('f2')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"><ArrowLeft /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">Tạo Ý Tưởng <span className="text-gray-400 font-normal text-sm">/ {app.name}</span></h1>
          {/* Clickable step navigation */}
          <div className="flex items-center gap-1 mt-2">
            {STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isCurrent = currentScreen === step.id;
              const isPast = i < currentStepIdx;
              return (
                <React.Fragment key={step.id}>
                  {i > 0 && <ChevronRight size={14} className="text-gray-300 mx-0.5" />}
                  <button onClick={() => setScreen(step.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isCurrent ? 'bg-indigo-100 text-indigo-700 shadow-sm' : isPast ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                    }`}>
                    <StepIcon size={13} /> {step.label}
                    {isPast && <Check size={12} className="text-emerald-500" />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {currentScreen === 'f2.1' && renderFilterDashboard()}
        {currentScreen === 'f2.1.1' && renderConfigScreen()}
        {currentScreen === 'f2.1.2' && renderResult()}
      </div>
    </div>
  );
};
