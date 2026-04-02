'use client';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Wand2, Loader2, Check, Target, Clock, Copy, ListOrdered, FileEdit, Filter, Users, Zap, Lightbulb, Layout, Settings2, Trash2, Pencil, Send, Sparkles, MessageCircle, Bot } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, ScreenType, IdeaContent, Hook } from '@/types/database';
import * as dbService from '@/lib/db';

interface FilterGeneratorProps {
  app: AppProject;
  currentScreen: ScreenType;
  setScreen: (s: ScreenType) => void;
}

const CATEGORIES: { id: keyof FilterState; label: string; icon: React.ElementType }[] = [
  { id: 'coreUser', label: 'Đối tượng', icon: Users },
  { id: 'painPoint', label: 'Nỗi đau', icon: Zap },
  { id: 'solution', label: 'Tính năng / Giải pháp', icon: Lightbulb },
  { id: 'motivation', label: 'Động lực', icon: Target },
  { id: 'videoStructure', label: 'Cấu trúc', icon: Layout },
];

export const FilterGenerator: React.FC<FilterGeneratorProps> = ({ app, currentScreen, setScreen }) => {
  const [filters, setFilters] = useState<FilterState>({ coreUser: [], painPoint: [], solution: [], motivation: [], videoStructure: [] });
  const [options, setOptions] = useState<Record<keyof FilterState, string[]>>({ coreUser: [], painPoint: [], solution: [], motivation: [], videoStructure: [] });
  const [newItem, setNewItem] = useState<{ cat: keyof FilterState | null; text: string }>({ cat: null, text: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GeneratedIdea[]>([]);
  const [duration, setDuration] = useState('30s');
  const [quantity, setQuantity] = useState(3);
  const [ideaDescription, setIdeaDescription] = useState('');
  const [editModeCat, setEditModeCat] = useState<keyof FilterState | null>(null);
  const [editingItemText, setEditingItemText] = useState<{ original: string; current: string } | null>(null);
  const [savedHistory, setSavedHistory] = useState<GeneratedIdea[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // AI Command Bar
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadOptions();
    loadHistory();
    loadHooks();
  }, [app.id]);

  const loadOptions = async () => {
    const fullOptions = await dbService.getFilterOptions(app);
    setOptions(fullOptions);
  };

  const loadHistory = async () => {
    const ideas = await dbService.getIdeas(app.id);
    setSavedHistory(ideas);
  };

  const loadHooks = async () => {
    const h = await dbService.getHooks(app.id);
    setHooks(h);
  };

  // AI Command Bar: send message
  const handleAiSend = async (text?: string) => {
    const msg = text || aiInput.trim();
    if (!msg || aiLoading) return;
    setAiInput('');
    setAiLoading(true);
    setAiMessages(prev => [...prev, { role: 'user', content: msg }]);

    try {
      const res = await fetch('/api/chat-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          appContext: {
            name: app.name,
            category: app.category,
            features: options.solution || [],
            storeLink: app.store_link || '',
            appKnowledge: app.app_knowledge || '',
            recentIdeas: savedHistory.slice(0, 5),
            hooks: hooks.slice(0, 5),
            filters: options,
          },
          chatHistory: aiMessages.slice(-10),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setAiMessages(prev => [...prev, { role: 'assistant', content: data.response }]);

        // If AI generated ideas, parse and show them in full-size results
        if (data.ideas && Array.isArray(data.ideas) && data.ideas.length > 0) {
          const mapped = data.ideas.map((item: Record<string, unknown>) => ({
            title: (item.title as string) || 'Ý tưởng AI',
            duration: (item.duration as string) || '30s',
            content: {
              explanation: (item.explanation as string) || '',
              hook: (item.hook as IdeaContent['hook']) || { visual: '', text: '', voice: '' },
              problem: (item.problem as IdeaContent['problem']) || { scenes: [] },
              solution: (item.solution as IdeaContent['solution']) || { visual: '', voice: '', text: '' },
              demo: (item.demo as IdeaContent['demo']) || { step1_prep: { visual: '' }, step2_action: { visual: '' }, step3_result: { visual: '', voice: '' } },
              cta: (item.cta as IdeaContent['cta']) || { voice: '', text: '' },
            },
          }));
          const saved = await dbService.saveIdeas(app.id, mapped);
          setResults(prev => [...saved, ...prev]);
          setSavedHistory(prev => [...saved, ...prev]);
          setScreen('f2.1.2');

          // Background learn
          fetch('/api/learn-app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: app.id, appName: app.name, appCategory: app.category,
              newIdeas: mapped.slice(0, 5), existingKnowledge: app.app_knowledge || '',
            }),
          }).catch(() => {});
        }
      } else {
        setAiMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + (data.error || 'Lỗi AI') }]);
      }
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Không thể kết nối AI' }]);
    }
    setAiLoading(false);
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
    if (!window.confirm(`Xóa mục "${item}"?`)) return;
    // Persist deletion to DB
    await dbService.deleteFilterOptionByValue(app.id, category, item);
    setOptions(prev => ({ ...prev, [category]: prev[category].filter(i => i !== item) }));
    if (filters[category].includes(item)) {
      setFilters(prev => ({ ...prev, [category]: prev[category].filter(i => i !== item) }));
    }
  };

  const handleUpdateOption = (category: keyof FilterState, oldItem: string, newItemText: string) => {
    if (!newItemText.trim() || newItemText === oldItem) { setEditingItemText(null); return; }
    setOptions(prev => ({ ...prev, [category]: prev[category].map(i => (i === oldItem ? newItemText.trim() : i)) }));
    if (filters[category].includes(oldItem)) {
      setFilters(prev => ({ ...prev, [category]: prev[category].map(i => (i === oldItem ? newItemText.trim() : i)) }));
    }
    setEditingItemText(null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Prepare previous ideas summary for AI to learn from (richer data for better learning)
      const previousIdeasSummary = savedHistory.slice(0, 10).map((idea, i) => {
        const c = idea.content as IdeaContent;
        return `${i + 1}. "${idea.title}" (${idea.duration})
   Concept: ${c?.explanation || ''}
   Hook: visual="${c?.hook?.visual || ''}", text="${c?.hook?.text || ''}", voice="${c?.hook?.voice || ''}"
   Demo: ${c?.demo?.step1_prep?.visual || ''} → ${c?.demo?.step2_action?.visual || ''} → ${c?.demo?.step3_result?.visual || ''}
   CTA: "${c?.cta?.voice || ''}"`;
      }).join('\n');

      const res = await fetch('/api/generate-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: app.name,
          appCategory: app.category,
          filters,
          config: { quantity, duration, ideaDescription },
          previousIdeas: previousIdeasSummary || null,
          appKnowledge: app.app_knowledge || null,
        }),
      });
      const result = await res.json();

      let ideas: { title: string; duration: string; content: IdeaContent }[];

      if (res.ok && result.success && result.data?.length > 0) {
        // Map API response to our format
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ideas = result.data.map((item: any) => ({
          title: item.title || `Ý tưởng: ${app.name}`,
          duration: item.duration || duration,
          content: {
            explanation: item.explanation || '',
            hook: item.hook || { visual: '', text: '', voice: '' },
            problem: item.problem || { scenes: [] },
            solution: item.solution || { visual: '', voice: '', text: '' },
            demo: item.demo || {
              step1_prep: { visual: '' },
              step2_action: { visual: '' },
              step3_result: { visual: '', voice: '' },
            },
            cta: item.cta || { voice: '', text: '' },
          },
        }));
      } else {
        // Fallback mock if API fails
        ideas = Array.from({ length: quantity }, (_, i) => ({
          title: `Ý tưởng ${i + 1}: ${app.name}`,
          duration: duration,
          content: {
            explanation: `Video ${duration} kết hợp ${filters.painPoint[0] || 'nỗi đau phổ biến'} với ${filters.solution[0] || 'tính năng chính'} của ${app.name}`,
            hook: { visual: 'Cận cảnh tay cầm điện thoại, màn hình hiện cảnh báo', text: filters.painPoint[0] || 'Bạn có biết?', voice: `"${filters.painPoint[0] || 'Điều gì sẽ xảy ra nếu...'}"` },
            problem: { scenes: [{ visual: 'Người dùng lo lắng nhìn màn hình', voice: `"${filters.motivation[0] || 'Tôi cần giải pháp ngay'}"` }] },
            solution: { visual: `Mở app ${app.name}, giao diện sáng`, voice: `"Chỉ cần 1 phút với ${filters.solution[0] || app.name}"`, text: 'Giải pháp đơn giản' },
            demo: {
              step1_prep: { visual: 'Tải app từ App Store', voice: '"Bước 1: Tải app miễn phí"' },
              step2_action: { visual: `Sử dụng ${filters.solution[0] || 'tính năng chính'}`, voice: '"Bước 2: Bắt đầu sử dụng"' },
              step3_result: { visual: 'Kết quả hiện trên màn hình', voice: '"Kết quả chỉ trong 30 giây!"' },
            },
            cta: { voice: '"Tải ngay link ở bio!"', text: `Tải ${app.name} Miễn Phí` },
          },
        }));
      }

      // Save to Supabase DB
      const saved = await dbService.saveIdeas(app.id, ideas);
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
      setIsGenerating(false);
    }
  };

  const handleCopy = (idea: GeneratedIdea) => {
    const c = idea.content;
    const text = `TIÊU ĐỀ: ${idea.title} (${idea.duration})\nSCENARIO: ${c.explanation}\n\n1. HOOK\n- Visual: ${c.hook.visual}\n- Text: ${c.hook.text || ''}\n- Voice: "${c.hook.voice}"\n\n2. PROBLEM\n${c.problem?.scenes?.map(s => `- ${s.visual} ("${s.voice}")`).join('\n') || 'N/A'}\n\n3. SOLUTION\n- Visual: ${c.solution?.visual || ''}\n- Voice: "${c.solution?.voice || ''}"\n\n4. DEMO\n- Prep: ${c.demo.step1_prep.visual}\n- Action: ${c.demo.step2_action.visual}\n- Result: ${c.demo.step3_result.visual}\n\n5. CTA\n- Voice: "${c.cta.voice}"\n- Text: ${c.cta.text}`;
    navigator.clipboard.writeText(text);
  };

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
              <input type="number" min="1" max="10" value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
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

          {/* History count */}
          {savedHistory.length > 0 && (
            <button onClick={() => { setResults(savedHistory); setScreen('f2.1.2'); }}
              className="w-full mt-3 text-sm text-gray-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2">
              📜 Xem lịch sử ({savedHistory.length} ý tưởng đã tạo)
            </button>
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
            const c = idea.content;
            return (
            <div key={idea.id || idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
              <div className="h-1 bg-gradient-to-r from-indigo-500 to-purple-500 w-full" />
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="font-bold text-lg text-gray-800 mb-1">{idea.title}</h4>
                    <div className="flex gap-2">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">{idea.duration}</span>
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded">Viral Script</span>
                      <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-400 rounded">{new Date(idea.created_at).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <p className="text-gray-400 italic text-sm mt-2 border-l-2 border-indigo-200 pl-3">{c.explanation}</p>
                  </div>
                  <button onClick={() => handleCopy(idea)} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="Copy">
                    <Copy size={16} />
                  </button>
                </div>

                {/* Hook */}
                <div className="mb-4 bg-red-50 rounded-xl p-4 border border-red-100">
                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Target size={10} /> HOOK (3s)</span>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Visual</span><p className="text-gray-700">{c.hook.visual}</p></div>
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Text</span><p className="text-gray-700">{c.hook.text || '—'}</p></div>
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Voice</span><p className="text-gray-500 italic">"{c.hook.voice}"</p></div>
                  </div>
                </div>

                {/* Problem */}
                {c.problem?.scenes?.length > 0 && (
                  <div className="mb-4 bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2 block">PROBLEM</span>
                    {c.problem.scenes.map((s, i) => (
                      <div key={i} className="grid grid-cols-3 gap-4 text-sm mb-2">
                        <p className="col-span-2 text-gray-700">- {s.visual}</p>
                        <p className="text-amber-600 italic">"{s.voice}"</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Solution */}
                {(c.solution?.visual || c.solution?.voice) && (
                  <div className="mb-4 bg-sky-50 rounded-xl p-4 border border-sky-100">
                    <span className="text-[10px] font-bold text-sky-600 uppercase tracking-widest mb-2 block">SOLUTION</span>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <p className="col-span-2 text-gray-700">{c.solution.visual}</p>
                      <p className="text-sky-600 italic">"{c.solution.voice}"</p>
                    </div>
                  </div>
                )}

                {/* Demo */}
                <div className="mb-4 bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-2 block">DEMO (3 Steps)</span>
                  {[
                    { n: '01', data: c.demo.step1_prep },
                    { n: '02', data: c.demo.step2_action },
                    { n: '03', data: c.demo.step3_result }
                  ].map(step => (
                    <div key={step.n} className="flex gap-3 mb-2 last:mb-0">
                      <span className="font-bold text-indigo-300 text-sm">{step.n}</span>
                      <div className="grid grid-cols-3 gap-4 flex-1 text-sm">
                        <p className="col-span-2 text-gray-700">{step.data.visual}</p>
                        {step.data.voice ? <p className="text-indigo-500 italic">"{step.data.voice}"</p> : <p className="text-gray-300">—</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-2 block">CTA</span>
                  <div className="grid grid-cols-2 gap-4 text-sm items-center">
                    <div><span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Voice</span><p className="text-gray-500 italic">"{c.cta.voice}"</p></div>
                    <div className="bg-white rounded-lg p-3 text-center border border-emerald-200"><span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">End Card</span><p className="font-bold text-emerald-600">{c.cta.text}</p></div>
                  </div>
                </div>
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
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setScreen('f2')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"><ArrowLeft /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">Tạo Ý Tưởng <span className="text-gray-400 font-normal text-sm">/ {app.name}</span></h1>
        </div>
      </div>

      {/* AI COMMAND BAR */}
      <div className="mb-6">
        <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 rounded-2xl border border-indigo-200/50 p-4 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} color="white" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-gray-800">🧠 Creative Agent <span className="text-xs font-normal text-gray-400">• Pro Model</span></div>
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className={`text-xs px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${showFilters ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'}`}>
              <Filter size={12} /> Bộ lọc
            </button>
            {savedHistory.length > 0 && (
              <button onClick={() => { setResults(savedHistory); setScreen('f2.1.2'); }} className="text-xs px-3 py-1.5 rounded-lg border bg-white text-gray-500 border-gray-200 hover:border-indigo-300 transition-all">
                📜 Lịch sử ({savedHistory.length})
              </button>
            )}
          </div>

          {/* Quick prompts */}
          {aiMessages.length === 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { text: `Tạo 3 ideas creative cho ${app.name}`, icon: '💡' },
                { text: 'Gợi ý hook viral dễ quay', icon: '🎬' },
                { text: 'Phân tích chiến lược tốt nhất', icon: '📊' },
                { text: 'Ideas focus đối tượng mới', icon: '🎯' },
              ].map((q, i) => (
                <button key={i} onClick={() => handleAiSend(q.text)}
                  className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 transition-all cursor-pointer">
                  {q.icon} {q.text}
                </button>
              ))}
            </div>
          )}

          {/* AI Response area */}
          {aiMessages.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-3 mb-3 max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 mb-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && <Bot size={16} className="text-purple-500 mt-1 flex-shrink-0" />}
                  <div className={`text-xs leading-relaxed max-w-[85%] px-3 py-2 rounded-xl ${
                    msg.role === 'user' 
                      ? 'bg-indigo-500 text-white rounded-br-sm' 
                      : 'bg-gray-50 text-gray-700 rounded-bl-sm'
                  }`}>
                    {msg.content.replace(/```json[\s\S]*?```/g, '✅ Ideas đã tạo — xem bên dưới ↓').split('\n').map((line, j) => (
                      <span key={j}>{line}<br/></span>
                    ))}
                  </div>
                  {msg.role === 'user' && <MessageCircle size={16} className="text-indigo-400 mt-1 flex-shrink-0" />}
                </div>
              ))}
              {aiLoading && (
                <div className="flex gap-2 items-center text-xs text-gray-400">
                  <Loader2 size={14} className="animate-spin text-purple-500" /> Đang suy nghĩ (Pro model)...
                </div>
              )}
            </div>
          )}

          {/* Input bar */}
          <div className="flex gap-2">
            <textarea
              ref={aiInputRef}
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
              placeholder={`Yêu cầu AI tạo ideas, phân tích, tư vấn cho ${app.name}...`}
              rows={1}
              className="flex-1 resize-none text-sm py-2.5 px-4 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
              style={{ minHeight: 40, maxHeight: 80 }}
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 80) + 'px'; }}
            />
            <button onClick={() => handleAiSend()} disabled={aiLoading || !aiInput.trim()}
              className={`px-4 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
                aiInput.trim() ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg' : 'bg-gray-100 text-gray-400'
              }`}>
              {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Filter/Config sections (collapsible) */}
      {showFilters && (
        <div className="w-full">
          <div className="flex items-center gap-2 mb-4">
            {['f2.1', 'f2.1.1', 'f2.1.2'].map(s => (
              <div key={s} className={`h-1 rounded-full transition-all duration-500 ${currentScreen === s ? 'w-10 bg-indigo-500' : 'w-6 bg-gray-200'}`} />
            ))}
          </div>
          {currentScreen === 'f2.1' && renderFilterDashboard()}
          {currentScreen === 'f2.1.1' && renderConfigScreen()}
        </div>
      )}

      {/* Results always visible below */}
      {currentScreen === 'f2.1.2' && (
        <div className="w-full">{renderResult()}</div>
      )}
    </div>
  );
};
