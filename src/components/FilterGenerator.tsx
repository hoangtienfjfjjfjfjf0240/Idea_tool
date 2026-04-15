'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Wand2, Loader2, Check, Target, Clock, Copy, ListOrdered, FileEdit, Filter, Users, Zap, Lightbulb, Layout, Settings2, Trash2, Pencil, ChevronRight, Save, Video, Globe, Sparkles, RotateCcw, Compass, AlertTriangle, Heart, Image, ExternalLink, ChevronDown, ChevronUp, TrendingUp, Link2 } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, ScreenType, IdeaContent } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';
import { CATEGORY_SEEDS, GLOBAL_VISUAL_TYPES } from '@/lib/db';

interface FilterGeneratorProps {
  app: AppProject;
  currentScreen: ScreenType;
  setScreen: (s: ScreenType) => void;
  selectedModel?: AIModel;
  prefillFilters?: { coreUser: string[]; emotion: string[]; painPoint: string[]; solution: string[] } | null;
  onPrefillConsumed?: () => void;
}

interface CategoryConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  isCustom?: boolean;
}

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  { id: 'coreUser', label: 'Đối tượng', icon: Users },
  { id: 'painPoint', label: 'Nỗi đau', icon: Zap },
  { id: 'solution', label: 'Tính năng / Giải pháp', icon: Lightbulb },
  { id: 'emotion', label: 'Cảm xúc (Viewer)', icon: Target },
  { id: 'visualType', label: 'Dạng Visual', icon: Video },
  { id: 'targetMarket', label: 'Thị trường mục tiêu', icon: Globe },
];

const CATEGORIES_STORAGE_KEY = (appId: string) => `idea_tool_categories_${appId}`;

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

export const FilterGenerator: React.FC<FilterGeneratorProps> = ({ app, currentScreen, setScreen, selectedModel, prefillFilters, onPrefillConsumed }) => {
  const [categories, setCategories] = useState<CategoryConfig[]>(() => loadCategories(app.id));
  const [filters, setFilters] = useState<FilterState>({ coreUser: [], painPoint: [], solution: [], emotion: [], videoStructure: [], visualType: [], targetMarket: [], angle: [] });
  const [options, setOptions] = useState<Record<string, string[]>>({ coreUser: [], painPoint: [], solution: [], emotion: [], videoStructure: [], visualType: [], targetMarket: ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'] });
  const [newItem, setNewItem] = useState<{ cat: string | null; text: string }>({ cat: null, text: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [results, setResults] = useState<GeneratedIdea[]>([]);
  const [duration, setDuration] = useState('30s');
  const [quantity, setQuantity] = useState(3);
  const [ideaDescription, setIdeaDescription] = useState('');
  const [editModeCat, setEditModeCat] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState<{ original: string; current: string } | null>(null);
  const [savedHistory, setSavedHistory] = useState<GeneratedIdea[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingIdea, setEditingIdea] = useState<string | null>(null);
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
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({});
  const [generatingThumbnail, setGeneratingThumbnail] = useState<string | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);
  const [trendingInput, setTrendingInput] = useState('');
  const [selectedSeasonInsights, setSelectedSeasonInsights] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCategories(loadCategories(app.id));
    loadOptions();
    loadHistory();
  }, [app.id]);

  // Auto-fill from Strategy Map → xuyên suốt
  useEffect(() => {
    if (prefillFilters) {
      setFilters(prev => ({
        ...prev,
        coreUser: prefillFilters.coreUser || [],
        emotion: prefillFilters.emotion || [],
        painPoint: prefillFilters.painPoint || [],
        solution: prefillFilters.solution || [],
      }));
      onPrefillConsumed?.();
    }
  }, [prefillFilters]);

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
    // Merge market presets with any DB options
    const marketPresets = ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'];
    const dbMarket = fullOptions.targetMarket || [];
    const mergedMarket = [...new Set([...marketPresets, ...dbMarket])];
    setOptions({ ...fullOptions, targetMarket: mergedMarket });
  };

  const loadHistory = async () => {
    const ideas = await dbService.getIdeas(app.id);
    setSavedHistory(ideas);
  };

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
    setFilters(prev => ({
      ...prev,
      [category]: (prev[category] || []).includes(item) ? (prev[category] || []).filter(i => i !== item) : [...(prev[category] || []), item]
    }));
  };

  const handleAddItem = async (category: string) => {
    if (newItem.text.trim()) {
      await dbService.addFilterOption(app.id, category, newItem.text.trim());
      setOptions(prev => ({ ...prev, [category]: [...(prev[category] || []), newItem.text.trim()] }));
      setNewItem({ cat: null, text: '' });
    }
  };

  const handleDeleteOption = async (category: string, item: string) => {
    // Immediately update UI
    setOptions(prev => ({ ...prev, [category]: (prev[category] || []).filter(i => i !== item) }));
    if ((filters[category] || []).includes(item)) {
      setFilters(prev => ({ ...prev, [category]: (prev[category] || []).filter(i => i !== item) }));
    }
    // Persist deletion to DB
    const ok = await dbService.deleteFilterOptionByValue(app.id, category, item);
    console.log(`Delete filter option [${category}] "${item}":`, ok ? 'success' : 'failed');
  };

  const handleUpdateOption = (category: string, oldItem: string, newItemText: string) => {
    if (!newItemText.trim() || newItemText === oldItem) { setEditingItemText(null); return; }
    setOptions(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === oldItem ? newItemText.trim() : i)) }));
    if ((filters[category] || []).includes(oldItem)) {
      setFilters(prev => ({ ...prev, [category]: (prev[category] || []).map(i => (i === oldItem ? newItemText.trim() : i)) }));
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

      // Split into batches of 5 to avoid gateway timeout
      const batchSize = 5;
      const batches = Math.ceil(quantity / batchSize);
      let allData: any[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const batchQty = Math.min(batchSize, quantity - batch * batchSize);
        setProgressLabel(`Đang tạo batch ${batch + 1}/${batches} (${batchQty} ideas)...`);

        const res = await fetch('/api/generate-ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appName: app.name,
            appCategory: app.category,
            filters,
            config: { quantity: batchQty, duration, ideaDescription, visualType: filters.visualType?.join(', ') || 'UGC (Người thật)' },
            previousIdeas: previousIdeasSummary || null,
            appKnowledge: app.app_knowledge || null,
            selectedModel: selectedModel || '',
            trendingTopics: trendingTopics.length > 0 ? trendingTopics : null,
          }),
          signal: controller.signal,
        });
        const result = await res.json();

        if (res.ok && result.success && result.data?.length > 0) {
          allData = [...allData, ...result.data];
        } else if (batch === 0) {
          // First batch failed — show error immediately
          throw new Error(result.error || 'AI không phản hồi');
        }
      }

      const result = { success: allData.length > 0, data: allData, error: allData.length === 0 ? 'Không có kết quả' : null };

      let ideas: { title: string; duration: string; content: IdeaContent }[];

      if (result.success && result.data?.length > 0) {
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

      // ⚡ HIỂN THỊ KẾT QUẢ NGAY — không đợi DB save
      // Create temporary IDs for immediate display
      const tempResults: GeneratedIdea[] = ideas.map((idea, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        app_id: app.id,
        title: idea.title,
        duration: idea.duration,
        content: idea.content,
        session_id: null,
        filters_snapshot: filters,
        result: null,
        created_at: new Date().toISOString(),
      }));

      setResults(prev => [...tempResults, ...prev]);
      setSavedHistory(prev => [...tempResults, ...prev]);
      stopProgress();
      setIsGenerating(false);
      if (currentScreen !== 'f2.1.2') setScreen('f2.1.2');

      // 🔄 LƯU DB TRONG BACKGROUND — replace temp IDs with real IDs khi xong
      const sessionId = crypto.randomUUID();
      dbService.saveIdeas(app.id, ideas, sessionId, filters).then(saved => {
        if (saved.length > 0) {
          // Replace temp results with real DB records  
          const tempIds = new Set(tempResults.map(t => t.id));
          setResults(prev => [...saved, ...prev.filter(r => !tempIds.has(r.id))]);
          setSavedHistory(prev => [...saved, ...prev.filter(r => !tempIds.has(r.id))]);
        }
      }).catch(err => console.warn('Background DB save failed:', err));

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
      if ((err as Error).name === 'AbortError') return; // User cancelled
      console.error('Generate failed:', err);
      alert('Có lỗi khi tạo ý tưởng. Vui lòng thử lại.');
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

  // ===== SEASONAL EVENTS =====
  const SEASONS: Record<string, { label: string; icon: string; months: string; events: string[]; visualInsights: { costumes: string[]; behaviors: string[]; colors: string[]; props: string[]; moods: string[] } }> = {
    spring: { label: 'Xuân', icon: '🌸', months: 'Mar – May', events: ['Easter', 'St Patrick', "Mother's Day", 'Earth Day', 'April Fools'], visualInsights: { costumes: ['Pastel outfits', 'Floral patterns', 'Easter bunny ears', 'Light layers', 'Rain jackets'], behaviors: ['Spring cleaning', 'Outdoor picnics', 'Gardening', 'Family gatherings', 'Window shopping'], colors: ['Pastel pink', 'Mint green', 'Lavender', 'Soft yellow', 'Sky blue'], props: ['Flowers', 'Easter eggs', 'Butterflies', 'Garden tools', 'Baskets'], moods: ['Renewal', 'Fresh start', 'Hope', 'Joy', 'Optimism'] } },
    summer: { label: 'Hè', icon: '☀️', months: 'Jun – Aug', events: ['Summer Sale', 'Independence Day (US)', 'Back to School', "Father's Day"], visualInsights: { costumes: ['Swimwear', 'Sunglasses', 'Tank tops', 'Shorts', 'Hats & caps'], behaviors: ['Beach trips', 'BBQ parties', 'Road trips', 'Late-night hangouts', 'Ice cream runs'], colors: ['Bright orange', 'Ocean blue', 'Coral', 'Lime green', 'Sunset gold'], props: ['Sunscreen', 'Pool floats', 'Surfboards', 'Popsicles', 'Camping gear'], moods: ['Freedom', 'Adventure', 'Relaxation', 'FOMO', 'Carefree'] } },
    autumn: { label: 'Thu', icon: '🍂', months: 'Sep – Nov', events: ['Halloween', 'Thanksgiving', 'Black Friday', 'Cyber Monday', 'Singles Day 11/11'], visualInsights: { costumes: ['Cozy sweaters', 'Scarves', 'Boots', 'Halloween costumes', 'Leather jackets'], behaviors: ['Pumpkin spice shopping', 'Binge-watching', 'Early holiday prep', 'Cozy nights in', 'Trick-or-treating'], colors: ['Burnt orange', 'Deep red', 'Golden yellow', 'Burgundy', 'Forest green'], props: ['Pumpkins', 'Fall leaves', 'Candles', 'Blankets', 'Mugs'], moods: ['Nostalgia', 'Cozy', 'Urgency (deals)', 'Excitement', 'Gratitude'] } },
    winter: { label: 'Đông', icon: '❄️', months: 'Dec – Feb', events: ['Christmas', 'New Year', "Valentine's Day", 'Lunar New Year', 'Super Bowl'], visualInsights: { costumes: ['Winter coats', 'Ugly sweaters', 'Beanies', 'Scarves & gloves', 'Formal party wear'], behaviors: ['Gift shopping', 'New Year resolutions', 'Indoor activities', 'Family dinners', 'Hot cocoa nights'], colors: ['Red & green', 'Silver & gold', 'Icy blue', 'White & cream', 'Deep purple'], props: ['Gift boxes', 'Christmas tree', 'Snowflakes', 'Fireworks', 'Heart decorations'], moods: ['Warmth', 'Generosity', 'Romance', 'Reflection', 'Celebration'] } },
  };

  const [wizardStep, setWizardStep] = useState(0);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [generatingAngles, setGeneratingAngles] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const WIZARD_STEPS = [
    { label: 'Core User & PSP', icon: Users, categories: ['coreUser', 'solution'], required: ['coreUser', 'solution'] },
    { label: 'Emotion & Visual', icon: Target, categories: ['emotion', 'visualType'], required: ['emotion'] },
    { label: 'Painpoint', icon: Zap, categories: ['painPoint'], required: ['painPoint'] },
    { label: 'Angle', icon: Compass, categories: ['angle', 'targetMarket'], required: ['angle'] },
    { label: 'Cấu hình & Tạo', icon: Settings2, categories: [], required: [] },
  ];

  // === Validation: check if current step has required selections ===
  const isStepValid = (stepIndex: number): boolean => {
    const step = WIZARD_STEPS[stepIndex];
    if (!step?.required || step.required.length === 0) return true;
    return step.required.every(cat => (filters[cat] || []).length > 0);
  };

  const getStepValidationMessage = (stepIndex: number): string => {
    const step = WIZARD_STEPS[stepIndex];
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

  // === Auto-generate angles from selected painpoints ===
  const generateAnglesFromPainpoints = async () => {
    const selectedPainpoints = filters.painPoint || [];
    if (selectedPainpoints.length === 0) return;

    setGeneratingAngles(true);
    try {
      const res = await fetch('/api/generate-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate-angles',
          appName: app.name,
          appCategory: app.category,
          painpoints: selectedPainpoints,
          coreUsers: filters.coreUser || [],
          emotions: filters.emotion || [],
          selectedModel: selectedModel || '',
        }),
      });
      const result = await res.json();
      if (res.ok && result.success && result.angles?.length > 0) {
        // Add generated angles to options
        const newAngles = result.angles as string[];
        setOptions(prev => {
          const existing = prev.angle || [];
          const merged = [...new Set([...existing, ...newAngles])];
          return { ...prev, angle: merged };
        });
      } else {
        // Fallback: generate angles locally from painpoints
        const fallbackAngles = selectedPainpoints.flatMap(pp => [
          `Sợ hãi: ${pp}`,
          `Giải pháp cho: ${pp}`,
          `So sánh trước/sau: ${pp}`,
        ]);
        setOptions(prev => {
          const existing = prev.angle || [];
          const merged = [...new Set([...existing, ...fallbackAngles])];
          return { ...prev, angle: merged };
        });
      }
    } catch {
      // Fallback on error
      const fallbackAngles = (filters.painPoint || []).flatMap(pp => [
        `Sợ hãi: ${pp}`,
        `Giải pháp cho: ${pp}`,
        `So sánh trước/sau: ${pp}`,
      ]);
      setOptions(prev => {
        const existing = prev.angle || [];
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
    const filterItems = (options[cat.id] || []) as string[];
    const isEditMode = editModeCat === cat.id;

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
            <button onClick={() => { setEditModeCat(isEditMode ? null : cat.id); setEditingItemText(null); setConfirmDeleteCat(null); }}
              className={`p-1.5 rounded-lg transition-colors ${isEditMode ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}>
              {isEditMode ? <Check size={14} /> : <Settings2 size={14} />}
            </button>
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium text-left transition-all ${(filters[cat.id] || []).includes(item) ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 shadow-sm' : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300'
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
          ) : isEditMode ? (
            <div className="flex gap-1.5">
              <button onClick={() => setNewItem({ cat: cat.id, text: '' })} className="flex-1 text-xs font-bold flex items-center justify-center gap-1 py-2 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors">
                <Plus size={14} /> THÊM
              </button>
              <button onClick={async () => {
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
                (items as string[]).map(item => (
                  <button key={`${key}-${item}`} onClick={() => toggleFilter(key, item)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors group cursor-pointer">
                    {item} <X size={12} className="opacity-50 group-hover:opacity-100" />
                  </button>
                ))
              )}
              {Object.values(filters).flat().length === 0 && <span className="text-gray-400 italic text-sm">Chưa chọn bối cảnh nào (AI sẽ tự do sáng tạo)</span>}
            </div>
          </div>

          {/* Seasonal Events — Expanded */}
          <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-200 p-5">
            <h3 className="text-xs font-bold text-violet-600 uppercase mb-3 flex items-center gap-2">📅 Sự kiện theo mùa</h3>
            <div className="flex gap-2 mb-3">
              {Object.entries(SEASONS).map(([key, season]) => (
                <button key={key} onClick={() => {
                  if (selectedSeason === key) {
                    setSelectedSeason(null);
                    setSelectedSeasonInsights(new Set());
                    setIdeaDescription(prev => {
                      // Remove all season-related text
                      return Object.values(SEASONS).reduce((txt, s) => {
                        return txt.replace(new RegExp(`\\[${s.icon}[^\\]]*\\][^\\n]*`, 'g'), '').trim();
                      }, prev);
                    });
                  } else {
                    setSelectedSeason(key);
                    setSelectedSeasonInsights(new Set());
                    const events = season.events.join(', ');
                    setIdeaDescription(prev => {
                      const cleaned = Object.values(SEASONS).reduce((txt, s) => {
                        return txt.replace(new RegExp(`\\[${s.icon}[^\\]]*\\][^\\n]*`, 'g'), '').trim();
                      }, prev);
                      return cleaned ? `${cleaned}\n[${season.icon} ${season.label}] ${events}` : `[${season.icon} ${season.label}] ${events}`;
                    });
                  }
                }}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex flex-col items-center gap-1 ${selectedSeason === key
                    ? 'bg-white text-violet-700 border-2 border-violet-400 shadow-md'
                    : 'bg-white/50 text-gray-500 border border-gray-200 hover:bg-white hover:border-violet-300'
                    }`}>
                  <span className="text-lg">{season.icon}</span>
                  <span>{season.label}</span>
                  <span className="text-[10px] font-normal text-gray-400">{season.months}</span>
                </button>
              ))}
            </div>
            {selectedSeason && (() => {
              const season = SEASONS[selectedSeason];
              const insightGroups = [
                { key: 'events', label: '🎉 Sự kiện', items: season.events, color: 'violet' },
                { key: 'costumes', label: '👗 Trang phục', items: season.visualInsights.costumes, color: 'pink' },
                { key: 'behaviors', label: '🎭 Hành vi', items: season.visualInsights.behaviors, color: 'blue' },
                { key: 'colors', label: '🎨 Màu sắc', items: season.visualInsights.colors, color: 'amber' },
                { key: 'props', label: '🎬 Props', items: season.visualInsights.props, color: 'emerald' },
                { key: 'moods', label: '💫 Mood', items: season.visualInsights.moods, color: 'purple' },
              ];
              const toggleInsight = (item: string) => {
                const next = new Set(selectedSeasonInsights);
                if (next.has(item)) next.delete(item); else next.add(item);
                setSelectedSeasonInsights(next);
                // Update ideaDescription with selected insights
                const allSelected = Array.from(next);
                const events = season.events.join(', ');
                const insightsText = allSelected.length > 0 ? `\n[Visual Insights] ${allSelected.join(', ')}` : '';
                setIdeaDescription(prev => {
                  let cleaned = prev.replace(/\[Visual Insights\][^\n]*/g, '').trim();
                  cleaned = Object.values(SEASONS).reduce((txt, s) => {
                    return txt.replace(new RegExp(`\\[${s.icon}[^\\]]*\\][^\\n]*`, 'g'), '').trim();
                  }, cleaned);
                  return `${cleaned ? cleaned + '\n' : ''}[${season.icon} ${season.label}] ${events}${insightsText}`.trim();
                });
              };
              return (
                <div className="space-y-3 animate-in fade-in duration-200">
                  {insightGroups.map(group => (
                    <div key={group.key}>
                      <span className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">{group.label}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map(item => {
                          const isSelected = selectedSeasonInsights.has(item);
                          return (
                            <button key={item} onClick={() => group.key !== 'events' ? toggleInsight(item) : undefined}
                              className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                                group.key === 'events'
                                  ? 'bg-white text-violet-600 border-violet-200 cursor-default'
                                  : isSelected
                                    ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer'
                              }`}>
                              {group.key === 'events' ? `🎉 ${item}` : item}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {selectedSeasonInsights.size > 0 && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-indigo-200 text-xs text-indigo-600 font-medium">
                      ✅ Đã chọn {selectedSeasonInsights.size} visual insights — sẽ kết hợp vào prompt AI
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Import Trending */}
          <div className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-2xl border border-rose-200 p-5">
            <h3 className="text-xs font-bold text-rose-600 uppercase mb-3 flex items-center gap-2"><TrendingUp size={14} /> Import Trending</h3>
            <div className="flex gap-2 mb-3">
              <input value={trendingInput} onChange={e => setTrendingInput(e.target.value)}
                placeholder="Nhập trend hoặc paste URL TikTok..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && trendingInput.trim()) {
                    setTrendingTopics(prev => [...prev, trendingInput.trim()]);
                    setTrendingInput('');
                  }
                }}
                className="flex-1 text-sm py-2.5 px-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200 bg-white" />
              <button onClick={() => {
                if (trendingInput.trim()) {
                  setTrendingTopics(prev => [...prev, trendingInput.trim()]);
                  setTrendingInput('');
                }
              }}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-bold text-sm hover:shadow-lg transition-all flex items-center gap-1">
                <Plus size={14} /> Thêm
              </button>
            </div>
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
            {trendingTopics.length === 0 && (
              <p className="text-xs text-gray-400 italic">Thêm trending topics hoặc paste URL TikTok để kết hợp vào idea</p>
            )}
          </div>

          {/* Duration + Quantity */}
          <div className="grid grid-cols-2 gap-5">
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
                onChange={(e) => setQuantity(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full text-center text-xl font-bold py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
            </div>
          </div>

          {/* Description */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><FileEdit size={14} /> Mô tả ý tưởng (Tùy chọn)</label>
            <textarea value={ideaDescription} onChange={(e) => setIdeaDescription(e.target.value)}
              placeholder="VD: Video cảm xúc mạnh, tập trung vào cảnh báo nguy hiểm..."
              className="w-full h-28 resize-none py-3 px-4 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
          </div>

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
                  Chọn angle hoặc bấm "Gen Angle" để AI tự tạo từ painpoint đã chọn
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
                        <input value={editBuffer?.title || ''} onChange={e => setEditBuffer({ ...editBuffer, title: e.target.value })}
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
                          <button onClick={() => { setRefiningIdea(refiningIdea === idea.id ? null : idea.id); setRefineInstruction(''); }} className={`p-2 rounded-lg transition-colors ${refiningIdea === idea.id ? 'text-purple-600 bg-purple-50' : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'}`} title="AI Refine">
                            <Sparkles size={16} />
                          </button>
                          <button onClick={() => startEditIdea(idea)} className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" title="Chỉnh sửa thủ công">
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
                    <textarea value={editBuffer?.explanation || ''} onChange={e => setEditBuffer({ ...editBuffer, explanation: e.target.value })}
                      className="w-full text-sm text-gray-500 italic mb-4 border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-16" />
                  ) : (
                    <p className="text-gray-400 italic text-sm mb-4 border-l-2 border-indigo-200 pl-3">{c.explanation}</p>
                  )}

                  {/* AI Refine Panel */}
                  {refiningIdea === idea.id && !isEditing && (
                    <div className="mb-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-200 animate-in slide-in-from-top duration-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={16} className="text-purple-500" />
                        <span className="text-sm font-bold text-purple-700">AI Refine — Chỉnh sửa bằng AI</span>
                      </div>
                      <textarea value={refineInstruction} onChange={e => setRefineInstruction(e.target.value)}
                        placeholder='VD: "Đổi nhân vật thành cặp vợ chồng 50 tuổi, thêm hài hước", "Đổi emotion sang FOMO", "Rút gọn hook còn 3 giây"...'
                        className="w-full h-20 resize-none text-sm border border-purple-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white mb-3" />
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!refineInstruction.trim() || isRefining) return;
                          setIsRefining(true);
                          try {
                            const res = await fetch('/api/generate-ideas', {
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
                              const refined = result.data;
                              const newContent = {
                                ...idea.content,
                                framework: refined.framework || (idea.content as any).framework,
                                explanation: refined.explanation || (idea.content as any).explanation,
                                hook: refined.hook ? { script: refined.hook.script || '', textOverlay: refined.hook.textOverlay || '', visual: refined.hook.script || '', text: refined.hook.textOverlay || '', voice: '', viTranslation: refined.hook.viTranslation || '', viewerProfile: refined.hook.viewerProfile || '', viewerEmotion: refined.hook.viewerEmotion || '', painpointImpact: refined.hook.painpointImpact || '', whyTheyStopScrolling: refined.hook.whyTheyStopScrolling || '' } : (idea.content as any).hook,
                                body: refined.body ? { script: refined.body.script || '', textOverlay: refined.body.textOverlay || '', visual: refined.body.script || '', text: refined.body.textOverlay || '', voice: '', viTranslation: refined.body.viTranslation || '' } : (idea.content as any).body,
                                cta: refined.cta ? { script: refined.cta.script || '', voice: '', text: refined.cta.textOverlay || '', endCard: refined.cta.endCard || '', viTranslation: refined.cta.viTranslation || '' } : (idea.content as any).cta,
                              };
                              const newTitle = refined.title || idea.title;
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
                            onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], script: e.target.value, visual: e.target.value } })}
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
                                onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], textOverlay: e.target.value, text: e.target.value } })}
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
                                  onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], endCard: e.target.value } })}
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
                  onClick={() => setWizardStep(i)}
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
