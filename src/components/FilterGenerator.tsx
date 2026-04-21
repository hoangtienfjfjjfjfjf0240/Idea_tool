'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Wand2, Loader2, Check, Target, Copy, ListOrdered, FileEdit, Filter, Users, Zap, Lightbulb, Layout, Settings2, Trash2, Pencil, ChevronRight, Save, Video, Globe, Sparkles, RotateCcw, Compass, AlertTriangle, Heart, Image, ExternalLink, ChevronDown, ChevronUp, TrendingUp, Link2, Hash, Eye } from 'lucide-react';
import type { AppProject, FilterState, GeneratedIdea, ScreenType, IdeaContent } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';
import { CATEGORY_SEEDS, GLOBAL_VISUAL_TYPES } from '@/lib/db';
import { buildFavoriteFingerprint, loadFavoriteKeys, saveFavoriteKeys } from '@/lib/favorites';

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

const IDEA_RUNTIME_GUIDANCE = 'Short social-first runtime';
const MAX_IDEAS_PER_GENERATE_REQUEST = 5;

type IdeaApiSection = {
  script?: string;
  visual?: string;
  voice?: string;
  text?: string;
  textOverlay?: string;
  text_overlay?: string;
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
  };
};

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  { id: 'coreUser', label: 'Đối tượng', icon: Users },
  { id: 'painPoint', label: 'Nỗi đau', icon: Zap },
  { id: 'solution', label: 'Tính năng / Giải pháp', icon: Lightbulb },
  { id: 'emotion', label: 'Cảm xúc (Viewer)', icon: Target },
  { id: 'visualType', label: 'Dạng Visual', icon: Video },
  { id: 'targetMarket', label: 'Thị trường mục tiêu', icon: Globe },
];

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

export const FilterGenerator: React.FC<FilterGeneratorProps> = ({ app, currentScreen, setScreen, selectedModel, prefillFilters, onPrefillConsumed, onAppKnowledgeUpdated }) => {
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
  const [generatingAngles, setGeneratingAngles] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setOptions({
      coreUser: [],
      painPoint: [],
      solution: [],
      emotion: [],
      videoStructure: [],
      visualType: [],
      targetMarket: [],
    });
  }, [app.id]);

  const mergeOptionSelections = (existing: Record<string, string[]>, nextFilters: Partial<FilterState>) => {
    const merged = { ...existing };
    Object.entries(nextFilters).forEach(([key, raw]) => {
      if (!Array.isArray(raw)) return;
      const values = raw
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());
      if (values.length === 0) return;
      merged[key] = [...new Set([...(merged[key] || []), ...values])];
    });
    return merged;
  };

  const appendTrendingTopics = (items: string[]) => {
    const normalized = items
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
    if (normalized.length === 0) return;

    setTrendingTopics(prev => [...new Set([...prev, ...normalized])]);
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
      const res = await fetch('/api/import-trending-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const result = await res.json();

      if (!res.ok || !result.success || !result.data) {
        throw new Error(result.error || 'Không import được video từ URL này.');
      }

      const analysis = result.data as ImportedTrendAnalysis;
      setImportedTrendAnalyses(prev => [analysis, ...prev.filter(item => item.sourceUrl !== analysis.sourceUrl)]);
      appendTrendingTopics(analysis.suggestedTopics || []);
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
    loadOptions();
    loadHistory();
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
            return [key, values] as const;
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
      dbService.getIdeas(app.id).then(ideas => {
        setResults(ideas);
        setSavedHistory(ideas);
        setShowHistory(true);
      });
    }
  }, [currentScreen]);

  const loadOptions = async () => {
    const fullOptions = await dbService.getFilterOptions(app);
    setOptions(prev => mergeOptionSelections(fullOptions, prefillFilters || filters));
    return;
    // Merge market presets with any DB options
    const marketPresets = ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'];
    const dbMarket = fullOptions.targetMarket || [];
    const mergedMarket = [...new Set([...marketPresets, ...dbMarket])];
    setOptions(prev => mergeOptionSelections({ ...fullOptions, targetMarket: mergedMarket }, prefillFilters || filters));
  };

  const loadHistory = async () => {
    const ideas = await dbService.getIdeas(app.id);
    setSavedHistory(ideas);
  };

  const getIdeaFavoriteKey = useCallback((idea: GeneratedIdea) => buildFavoriteFingerprint([
    'filter-generator',
    app.id,
    idea.title,
    idea.duration,
    idea.content?.hook?.voice,
    idea.content?.hook?.textOverlay,
    idea.content?.hook?.script,
    idea.content?.body?.voice,
    idea.content?.cta?.voice,
    idea.content?.cta?.endCard,
  ]), [app.id]);

  useEffect(() => {
    setFavoriteIdeas(loadFavoriteKeys(app.id));
    setShowFavoriteIdeas(false);
  }, [app.id]);

  useEffect(() => {
    saveFavoriteKeys(app.id, favoriteIdeas);
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
      const previousIdeasSummary = savedHistory.slice(0, 10).map((idea, i) => {
        const c = idea.content;
        return `${i + 1}. "${idea.title}"
   Framework: CoreUser="${c?.framework?.coreUser || ''}", Painpoint="${c?.framework?.painpoint || ''}", Emotion="${c?.framework?.emotion || ''}", PSP="${c?.framework?.psp || ''}"
   Hook: visual="${c?.hook?.visual || ''}", script="${c?.hook?.script || ''}", voice="${c?.hook?.voice || ''}"
   Body: visual="${c?.body?.visual || ''}", voice="${c?.body?.voice || ''}"
   CTA: "${c?.cta?.voice || ''}"`;
      }).join('\n');

      const selectedAngles = Array.from(new Set((filters.angle || []).map(angle => angle.trim()).filter(Boolean)));
      const anglesToGenerate = selectedAngles.length > 0 ? selectedAngles : [null];
      const generationTasks = anglesToGenerate.map((angle, angleIndex) => ({
        selectedAngle: angle,
        angleIndex,
        filtersSnapshot: {
          ...filters,
          angle: angle ? [angle] : [],
        } as FilterState,
      }));
      const totalRequestedIdeas = generationTasks.length * quantity;
      let allData: Array<{ item: GeneratedIdeaApiItem; filtersSnapshot: FilterState }> = [];
      const maxConcurrent = quantity > MAX_IDEAS_PER_GENERATE_REQUEST
        ? Math.min(2, Math.max(1, generationTasks.length))
        : Math.min(3, Math.max(1, generationTasks.length));

      const requestAngleBatch = async (task: { selectedAngle: string | null; angleIndex: number; filtersSnapshot: FilterState }) => {
        const requestAngleChunk = async (batchQuantity: number, startIndex: number, attempt = 1) => {
          const rangeEnd = startIndex + batchQuantity;
          setProgressLabel(`Đang tạo angle ${task.angleIndex + 1}/${anglesToGenerate.length}, idea ${startIndex + 1}-${rangeEnd}/${quantity}...`);

          try {
            const res = await fetch('/api/generate-ideas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                appName: app.name,
                appCategory: app.category,
                filters: task.filtersSnapshot,
                config: {
                  quantity: batchQuantity,
                  duration: IDEA_RUNTIME_GUIDANCE,
                  ideaDescription,
                  visualType: task.filtersSnapshot.visualType?.join(', ') || 'UGC (Người thật)',
                  seasonalVisualContext,
                  totalVariations: quantity,
                  startIndex,
                  angleIndex: task.angleIndex + 1,
                  totalAngles: anglesToGenerate.length,
                  selectedAngle: task.selectedAngle,
                },
                previousIdeas: previousIdeasSummary || null,
                appKnowledge: app.app_knowledge || null,
                selectedModel: selectedModel || '',
                trendingTopics: trendingTopics.length > 0 ? trendingTopics : null,
                trendingStructures: importedTrendAnalyses.length > 0
                  ? importedTrendAnalyses.map(item => item.promptBooster).filter(Boolean)
                  : null,
              }),
              signal: controller.signal,
            });

            const result = await res.json().catch(() => null) as GenerateIdeasApiResponse | null;
            const aiItems = res.ok && result?.success && Array.isArray(result.data) ? result.data : [];
            if (!res.ok || !result?.success || aiItems.length === 0) {
              throw new Error(result?.error || `Angle ${task.angleIndex + 1}, idea ${startIndex + 1}-${rangeEnd} không có idea hợp lệ từ API.`);
            }

            if (result.meta?.warnings?.length) {
              console.warn(`[generate-ideas] Angle ${task.angleIndex + 1} warnings:`, result.meta.warnings);
            }

            const completedItems = aiItems.slice(0, batchQuantity);
            if (completedItems.length < batchQuantity) {
              throw new Error(`Angle ${task.angleIndex + 1}, idea ${startIndex + 1}-${rangeEnd} chỉ trả ${completedItems.length}/${batchQuantity} idea. API chưa top-up đủ.`);
            }

            return completedItems.map(item => ({
              item,
              filtersSnapshot: task.filtersSnapshot,
            }));
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }

            console.warn(`[generate-ideas] Angle ${task.angleIndex + 1}, chunk ${startIndex + 1}-${rangeEnd} request failed.`, error);
            if (attempt < 2) {
              return requestAngleChunk(batchQuantity, startIndex, attempt + 1);
            }

            throw error instanceof Error ? error : new Error(`Angle ${task.angleIndex + 1} request failed.`);
          }
        };

        const completed: Array<{ item: GeneratedIdeaApiItem; filtersSnapshot: FilterState }> = [];
        for (let startIndex = 0; startIndex < quantity; startIndex += MAX_IDEAS_PER_GENERATE_REQUEST) {
          const batchQuantity = Math.min(MAX_IDEAS_PER_GENERATE_REQUEST, quantity - startIndex);
          completed.push(...await requestAngleChunk(batchQuantity, startIndex));
        }

        return completed;
      };

      for (let start = 0; start < generationTasks.length; start += maxConcurrent) {
        const end = Math.min(start + maxConcurrent, generationTasks.length);
        const briefStart = start * quantity + 1;
        const briefEnd = Math.min(end * quantity, totalRequestedIdeas);
        setProgressLabel(`Đang tạo full brief ${briefStart}-${briefEnd}/${totalRequestedIdeas}...`);
        const chunk = await Promise.all(
          generationTasks.slice(start, end).map(task => requestAngleBatch(task))
        );
        allData = [...allData, ...chunk.flatMap(item => item)];
        if (allData.length === 0 && end >= generationTasks.length) {
          throw new Error('AI không phản hồi');
        }
      }

      const result = { success: allData.length > 0, data: allData, error: allData.length === 0 ? 'Không có kết quả' : null };

      let ideas: { title: string; duration: string; content: IdeaContent; filtersSnapshot: FilterState }[];

      if (result.success && result.data?.length > 0) {
        ideas = result.data.map(({ item, filtersSnapshot }) => ({
          title: item.title || `Ý tưởng: ${app.name}`,
          duration: item.duration || IDEA_RUNTIME_GUIDANCE,
          filtersSnapshot,
          content: {
            creativeType: item.creativeType || '',
            meta: item.meta || undefined,
            framework: item.framework || { coreUser: '', painpoint: '', emotion: '', psp: '' },
            explanation: item.explanation || '',
            hook: {
              script: item.hook?.script || item.hook?.visual || '',
              textOverlay: item.hook?.textOverlay || item.hook?.text_overlay || '',
              visual: item.hook?.visual || item.hook?.script || '',
              text: item.hook?.textOverlay || item.hook?.text_overlay || item.hook?.text || '',
              voice: item.hook?.voice || '',
            },
            body: {
              script: item.body?.script || item.body?.visual || '',
              textOverlay: item.body?.textOverlay || item.body?.text_overlay || '',
              visual: item.body?.visual || item.body?.script || '',
              text: item.body?.textOverlay || item.body?.text_overlay || item.body?.text || '',
              voice: item.body?.voice || '',
            },
            cta: {
              script: item.cta?.script || item.cta?.visual || '',
              visual: item.cta?.visual || item.cta?.script || '',
              voice: item.cta?.voice || '',
              text: item.cta?.textOverlay || item.cta?.text_overlay || item.cta?.text || '',
              textOverlay: item.cta?.textOverlay || item.cta?.text_overlay || item.cta?.text || '',
              endCard: item.cta?.endCard || item.cta?.end_card || '',
            },
          },
        }));
      } else {
        throw new Error(result.error || 'API không trả idea hợp lệ.');
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
      setResults(tempResults);
      setSavedHistory(prev => [...tempResults, ...prev]);
      stopProgress();
      setIsGenerating(false);
      if (currentScreen !== 'f2.1.2') setScreen('f2.1.2');

      const sessionId = crypto.randomUUID();
      dbService.saveIdeas(app.id, ideas, sessionId, filters).then(saved => {
        if (saved.length > 0) {
          const tempIds = new Set(tempResults.map(t => t.id));
          setResults(prev => [...saved, ...prev.filter(r => !tempIds.has(r.id))]);
          setSavedHistory(prev => [...saved, ...prev.filter(r => !tempIds.has(r.id))]);

          return fetch('/api/learn-app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: app.id,
              appName: app.name,
              appCategory: app.category,
              sessionId,
              existingKnowledge: app.app_knowledge || '',
            }),
          }).then(async response => {
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.success) {
              throw new Error(data?.error || 'Background learning failed');
            }
            if (data.knowledge && onAppKnowledgeUpdated) {
              onAppKnowledgeUpdated(data.knowledge);
            }
          });
        }
      }).catch(err => console.warn('Background DB save or learning failed:', err));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Generate failed:', err);
      const message = err instanceof Error && err.message
        ? err.message
        : 'Có lỗi khi tạo ý tưởng. Vui lòng thử lại.';
      alert(message);
      stopProgress();
      setIsGenerating(false);
    }
  };


  /* Legacy copy helper retained during transition.
    const c = idea.content as any;
    const fw = c.framework;
    const meta = c.meta || {};
    const hookVisual = c.hook?.visual || c.hook?.script || '';
    const bodyVisual = c.body?.visual || c.body?.script || '';
    const ctaVisual = c.cta?.visual || c.cta?.script || '';
    const hookVariantsBlock = [meta?.hookPrimary, meta?.hookAlt1, meta?.hookAlt2].some(Boolean)
      ? `\n🧠 HOOK VARIATIONS\n[PRIMARY] ${meta?.hookPrimary || ''}\n[ALT 1] ${meta?.hookAlt1 || ''}\n[ALT 2] ${meta?.hookAlt2 || ''}\n`
      : '';
    const copyText = `TIÊU ĐỀ: ${idea.title}\n\n═══ FRAMEWORK ═══\n👤 Core User: ${fw?.coreUser || ''}\n💔 Painpoint: ${fw?.painpoint || ''}\n😱 Emotion: ${fw?.emotion || ''}\n💊 PSP: ${fw?.psp || ''}\n\nWHY IT WORKS: ${c.explanation}\n\n═══ VIDEO SCRIPT ═══\n\n🎣 HOOK\n[VISUAL] ${hookVisual}\n[VOICE] ${c.hook?.voice || ''}\n[TEXT OVERLAY] ${c.hook?.textOverlay || c.hook?.text || ''}\n\n📖 BODY\n[VISUAL] ${bodyVisual}\n[VOICE] ${c.body?.voice || ''}\n[TEXT OVERLAY] ${c.body?.textOverlay || c.body?.text || ''}\n\n🔥 CTA\n[VISUAL] ${ctaVisual}\n[VOICE] ${c.cta?.voice || ''}\n[TEXT OVERLAY] ${c.cta?.textOverlay || c.cta?.text || ''}\nEnd Card: ${c.cta?.endCard || ''}`;
    const finalCopyText = hookVariantsBlock
      ? copyText.replace('═══ VIDEO SCRIPT ═══\n\n', `═══ VIDEO SCRIPT ═══\n${hookVariantsBlock}\n`)
      : copyText;
    navigator.clipboard.writeText(finalCopyText);
  };

  */
  const handleCopy = (idea: GeneratedIdea) => {
    const content = idea.content as IdeaContent;
    const framework = content.framework;
    const meta = content.meta;
    const hookVisual = content.hook?.visual || content.hook?.script || '';
    const bodyVisual = content.body?.visual || content.body?.script || '';
    const ctaVisual = content.cta?.visual || content.cta?.script || '';
    const primaryHook = meta?.hookPrimary || '';
    const sections = [
      `TIÊU ĐỀ: ${idea.title}`,
      '═══ FRAMEWORK ═══',
      `Core User: ${framework?.coreUser || ''}`,
      `Painpoint: ${framework?.painpoint || ''}`,
      `Emotion: ${framework?.emotion || ''}`,
      `PSP: ${framework?.psp || ''}`,
      '',
      `WHY IT WORKS: ${content.explanation || ''}`,
      '',
      '═══ VIDEO SCRIPT ═══',
      ...(primaryHook
        ? [
            `HOOK: ${primaryHook}`,
            '',
          ]
        : []),
      'HOOK (3-5s)',
      `[VISUAL] ${hookVisual}`,
      `[VOICE] ${content.hook?.voice || ''}`,
      `[TEXT OVERLAY] ${content.hook?.textOverlay || content.hook?.text || ''}`,
      '',
      'BODY (10-25s)',
      `[VISUAL] ${bodyVisual}`,
      `[VOICE] ${content.body?.voice || ''}`,
      `[TEXT OVERLAY] ${content.body?.textOverlay || content.body?.text || ''}`,
      '',
      'CTA (3-5s)',
      `[VISUAL] ${ctaVisual}`,
      `[VOICE] ${content.cta?.voice || ''}`,
      `[TEXT OVERLAY] ${content.cta?.textOverlay || content.cta?.text || ''}`,
      `End Card: ${content.cta?.endCard || ''}`,
    ];

    navigator.clipboard.writeText(sections.join('\n'));
  };
  const cleanPreviewText = (value: unknown) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  const truncatePreviewText = (value: unknown, limit = 150) => {
    const text = cleanPreviewText(value);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}...`;
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
    const c = idea.content as any;
    setEditBuffer({
      title: idea.title,
      explanation: c.explanation || '',
      hook: { script: c.hook?.script || '', textOverlay: c.hook?.textOverlay || '', visual: c.hook?.visual || '', text: c.hook?.text || '', voice: c.hook?.voice || '' },
      body: { script: c.body?.script || '', textOverlay: c.body?.textOverlay || '', visual: c.body?.visual || '', text: c.body?.text || '', voice: c.body?.voice || '' },
      cta: { script: c.cta?.script || '', visual: c.cta?.visual || '', voice: c.cta?.voice || '', text: c.cta?.text || '', textOverlay: c.cta?.textOverlay || '', endCard: c.cta?.endCard || '' },
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

  const historyCount = savedHistory.length;
  const favoriteCount = useMemo(() => {
    const keys = new Set(savedHistory.map(getIdeaFavoriteKey).filter(key => favoriteIdeas.has(key)));
    return keys.size;
  }, [favoriteIdeas, getIdeaFavoriteKey, savedHistory]);

  useEffect(() => {
    if (favoriteCount === 0 && showFavoriteIdeas) {
      setShowFavoriteIdeas(false);
    }
  }, [favoriteCount, showFavoriteIdeas]);

  const visibleResults = useMemo(() => {
    const source = showHistory ? savedHistory : results;
    if (!showFavoriteIdeas) return source;
    return source.filter(idea => favoriteIdeas.has(getIdeaFavoriteKey(idea)));
  }, [favoriteIdeas, getIdeaFavoriteKey, results, savedHistory, showFavoriteIdeas, showHistory]);

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

  const selectedAngleCount = Math.max(1, Array.from(new Set((filters.angle || []).map(angle => angle.trim()).filter(Boolean))).length);
  const totalIdeasToGenerate = selectedAngleCount * quantity;

  const handleOpenResults = () => {
    setShowHistory(results.length === 0 && savedHistory.length > 0);
    setScreen('f2.1.2');
  };

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
          `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
          `${pp} và mỗi lần nhìn vào nhà lại càng rối hơn`,
          `${pp} dù đã xem rất nhiều ý tưởng đẹp trên mạng`,
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
        `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
        `${pp} và mỗi lần nhìn vào nhà lại càng rối hơn`,
        `${pp} dù đã xem rất nhiều ý tưởng đẹp trên mạng`,
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
                for (const item of filterItems) { await dbService.deleteFilterOptionByValue(app.id, cat.id, item); }
                setOptions(prev => ({ ...prev, [cat.id]: [] }));
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
            {importedTrendAnalyses.length > 0 && (
              <div className="mb-3 space-y-2">
                {importedTrendAnalyses.map((analysis) => (
                  <div key={analysis.sourceUrl} className="rounded-xl border border-rose-200 bg-white p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-800">{analysis.title}</p>
                        <p className="truncate text-[11px] text-gray-400">{analysis.sourceLabel || analysis.sourceUrl}</p>
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
                      {[analysis.creativeType, analysis.angleType, analysis.emotionalDriver].filter(Boolean).map((label) => (
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
                  </div>
                ))}
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
            {trendingTopics.length === 0 && importedTrendAnalyses.length === 0 && (
              <p className="text-xs text-gray-400 italic">Nhập trend text hoặc URL video để import luôn hook/body/CTA structure vào prompt.</p>
            )}
          </div>

          {/* Quantity */}
          <div className="grid grid-cols-1 gap-5">
            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><ListOrdered size={14} /> Số lượng Idea</label>
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
            {showHistory ? 'Tất cả ý tưởng đã tạo' : 'Ý tưởng theo bối cảnh đã chọn'}
            {showFavoriteIdeas ? ' • Đang lọc các idea đã thả tim' : ''}
            {' • '}<span className="text-emerald-500 font-medium">Đã lưu Supabase ✓</span>
          </p>
        </div>
        <div className="flex gap-2">
          {historyCount > 0 && (
            <button onClick={() => setShowHistory(prev => !prev)}
              className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">
              {showHistory ? 'Ẩn Lịch sử' : `📜 Lịch sử (${historyCount})`}
            </button>
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
          <button onClick={() => setScreen('f2.1.1')} className="text-sm flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600"><ArrowLeft size={14} /> Cấu hình</button>
          <button onClick={handleGenerate} disabled={isGenerating} className="text-sm flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600">
            {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Tạo thêm
          </button>
        </div>
      </div>

      {visibleResults.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {visibleResults.map((idea, idx) => {
            const c = idea.content as any;
            const isEditing = editingIdea === idea.id;
            const ideaKey = getIdeaFavoriteKey(idea) || idea.id || `idea-${idx}`;
            const isExpanded = expandedIdeas.has(ideaKey);
            const isFavorite = favoriteIdeas.has(ideaKey);
            const hookData = isEditing ? editBuffer?.hook || {} : c?.hook || {};
            const angleTag = Array.isArray(idea.filters_snapshot?.angle) ? idea.filters_snapshot?.angle?.[0] : '';
            const hookVisual = hookData?.visual || hookData?.script || '';
            const hookVoice = hookData?.voice || '';
            const hookText = hookData?.textOverlay || hookData?.text || '';
            const primaryHook = c?.meta?.hookPrimary || '';
            const creativeTag = c?.creativeType || c?.framework?.emotion || 'Creative';
            return (
              <div key={ideaKey} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input value={editBuffer?.title || ''} onChange={e => setEditBuffer({ ...editBuffer, title: e.target.value })}
                          className="font-bold text-base text-gray-800 mb-1 w-full border-b-2 border-indigo-300 focus:outline-none bg-transparent" />
                      ) : (
                        <h4 className="font-bold text-base text-gray-900 leading-snug mb-1">{idea.title}</h4>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[11px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md">{new Date(idea.created_at).toLocaleDateString('vi-VN')}</span>
                        <span className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-500 rounded-md">{creativeTag}</span>
                        {c?.framework?.coreUser && <span className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-500 rounded-md">{truncatePreviewText(c.framework.coreUser, 28)}</span>}
                        {angleTag && <span className="text-[11px] px-2 py-0.5 bg-teal-50 text-teal-600 rounded-md">{truncatePreviewText(angleTag, 32)}</span>}
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

                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 mb-2">
                    <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1 mb-3">Hook (3-5s)</span>
                    {isEditing ? (
                      <div className="space-y-3">
                        <textarea value={hookData?.visual || hookData?.script || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, visual: e.target.value, script: e.target.value } })}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-200 resize-none h-24 bg-white"
                          placeholder="Mô tả cảnh quay / hành động / camera" />
                        <textarea value={hookData?.voice || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, voice: e.target.value } })}
                          className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-200 resize-none h-20 bg-white"
                          placeholder="Lời nhân vật nói" />
                        <input value={hookData?.textOverlay || hookData?.text || ''}
                          onChange={e => setEditBuffer({ ...editBuffer, hook: { ...editBuffer.hook, textOverlay: e.target.value, text: e.target.value } })}
                          className="w-full text-sm border rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-red-200 bg-white" />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-red-100 bg-white/70 px-4 py-3 text-sm leading-6 text-gray-700">
                        <p className="whitespace-pre-line">{hookVisual || 'Hook visual will appear here.'}</p>
                        <p className="mt-1 text-gray-800">[VOICE] {hookVoice || '—'}</p>
                        <p className="text-gray-800">[TEXT OVERLAY] {hookText || '—'}</p>
                        {primaryHook && <p className="mt-2 font-semibold text-gray-900">+ {primaryHook}</p>}
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
                                meta: refined.meta || (idea.content as any).meta,
                                framework: refined.framework || (idea.content as any).framework,
                                explanation: refined.explanation || (idea.content as any).explanation,
                                hook: refined.hook ? { script: refined.hook.script || refined.hook.visual || '', textOverlay: refined.hook.textOverlay || '', visual: refined.hook.visual || refined.hook.script || '', text: refined.hook.textOverlay || '', voice: refined.hook.voice || '', viTranslation: refined.hook.viTranslation || '', viewerProfile: refined.hook.viewerProfile || '', viewerEmotion: refined.hook.viewerEmotion || '', painpointImpact: refined.hook.painpointImpact || '', whyTheyStopScrolling: refined.hook.whyTheyStopScrolling || '' } : (idea.content as any).hook,
                                body: refined.body ? { script: refined.body.script || refined.body.visual || '', textOverlay: refined.body.textOverlay || '', visual: refined.body.visual || refined.body.script || '', text: refined.body.textOverlay || '', voice: refined.body.voice || '', viTranslation: refined.body.viTranslation || '' } : (idea.content as any).body,
                                cta: refined.cta ? { script: refined.cta.script || refined.cta.visual || '', visual: refined.cta.visual || refined.cta.script || '', voice: refined.cta.voice || '', text: refined.cta.textOverlay || '', textOverlay: refined.cta.textOverlay || '', endCard: refined.cta.endCard || '', viTranslation: refined.cta.viTranslation || '' } : (idea.content as any).cta,
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

                  {/* Body + CTA shown only when the card is expanded, being edited, or refined. */}
                  {[{ key: 'body', label: '📖 BODY (10-25s)', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
                  { key: 'cta', label: '🔥 CTA (3-5s)', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
                  ].map(sec => {
                    const secData = isEditing ? editBuffer?.[sec.key] : (c?.[sec.key] || {});
                    const visualContent = secData?.visual || secData?.script || '';
                    const voiceContent = secData?.voice || '';
                    const textOverlay = secData?.textOverlay || secData?.text || '';
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
                            <textarea value={secData?.voice || ''}
                              onChange={e => setEditBuffer({ ...editBuffer, [sec.key]: { ...editBuffer[sec.key], voice: e.target.value } })}
                              className="w-full text-sm border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-200 resize-none h-20 bg-white"
                              placeholder="Lời nhân vật nói / CTA voice" />
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
                            <p className="whitespace-pre-line">{visualContent || '—'}</p>
                            <p className="mt-1 text-gray-800 whitespace-pre-line">[VOICE] {voiceContent || '—'}</p>
                            <p className="text-gray-800">[TEXT OVERLAY] {textOverlay || '—'}</p>
                            {textOverlay && <p className="mt-2 font-semibold text-gray-900">+ {textOverlay}</p>}
                            {sec.key === 'cta' && endCard && <p className="mt-2 text-xs text-gray-500">+ {endCard}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => toggleIdeaSet(setFavoriteIdeas, ideaKey)}
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
          <p className="font-bold text-gray-500">{showFavoriteIdeas ? 'Chưa có idea nào được thả tim' : 'Chưa có ý tưởng nào'}</p>
          <p className="text-sm">
            {showFavoriteIdeas ? 'Tắt bộ lọc "Đã thả tim" hoặc thả tim ở các card để gom các idea đã chọn.' : 'Bấm "Tạo thêm" để bắt đầu.'}
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
        {(results.length > 0 || savedHistory.length > 0) && (
          <button
            onClick={handleOpenResults}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2"
          >
            <Eye size={14} />
            Xem kết quả ({results.length > 0 ? results.length : savedHistory.length})
          </button>
        )}
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
