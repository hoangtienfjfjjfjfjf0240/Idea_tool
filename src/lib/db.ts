import { supabase } from './supabase';
import type {
  AppProject,
  Feature,
  Hook,
  GeneratedIdea,
  FilterOption,
  SyncLog,
  FilterState,
  StrategyMapState,
  StrategyMapCustomNodeState,
  StrategyMapEdgeState,
  StrategyMapLayoutPosition,
  StrategyWorkflowLevel,
} from '@/types/database';
import { GLOBAL_EMOTION_OPTIONS, mergeWithGlobalEmotionOptions, uniqueNonEmptyStrings } from './emotionOptions';

// ============================================
// CATEGORY SPECIFIC SEEDS (Kept from original)
// ============================================
const CATEGORY_SEEDS: Record<string, Partial<FilterState>> = {
  'Sức khỏe & Thể hình': {
    coreUser: ['Người 35-50 tuổi (Lo sức khỏe)', 'Người có tiền sử tim mạch', 'Người sống độc thân', 'Gymer / Vận động viên', 'Phụ nữ mang thai'],
    painPoint: ['Sợ đột quỵ bất ngờ', 'Lo lắng khi ở nhà một mình', 'Không tin tưởng bác sĩ', 'Chi phí y tế quá cao', 'Cơ thể mệt mỏi không rõ lý do', 'Nhịp tim tăng cao khi hồi hộp'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Sợ hãi (Fear)', 'Lo lắng (Anxiety)', 'An tâm (Relief)', 'Shock / Bất ngờ'])
  },
  'Tiện ích': {
    coreUser: ['Nam 35-45 (Cần Update iOS)', 'Nữ 35-45 (Lưu giữ kỷ niệm con cái)', 'Người cao tuổi 55+ (Cần trợ giúp công nghệ)', 'Người dùng 22-55+ (Thích quay chụp/ASMR)', 'Người bận rộn (Nhiều Email/File rác)'],
    painPoint: ['Đầy bộ nhớ không thể Update iOS mới', 'Bỏ lỡ khoảnh khắc con cái vì máy đầy', 'Điện thoại báo đầy dung lượng liên tục', 'Email rác lấp mất hóa đơn quan trọng', 'Xóa ảnh thủ công quá tốn thời gian', 'Máy nóng, chai pin do dữ liệu rác', 'Không thể tải thêm ứng dụng mới'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Thỏa mãn (ASMR)', 'Nhẹ nhõm (Relief)', 'Tò mò (Curiosity)', 'Bực bội → Hài lòng'])
  },
  'Trò chơi': {
    coreUser: ['Gen Z (Thích thử thách)', 'Nhân viên văn phòng (Giải trí)', 'Hardcore Gamer', 'Người thích giải đố'],
    painPoint: ['Chán nản, không có gì làm', 'Cần xả stress nhanh', 'Muốn khẳng định bản thân', 'Game cũ quá nhàm chán'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Hưng phấn (Excitement)', 'Thỏa mãn (Satisfaction)', 'Tò mò (Curiosity)', 'FOMO'])
  },
  'Tài chính': {
    coreUser: ['Người muốn tiết kiệm', 'Nhà đầu tư F0', 'Chủ shop nhỏ', 'Sinh viên mới ra trường'],
    painPoint: ['Không biết tiền đi đâu hết', 'Nợ nần chồng chất', 'Sợ lạm phát mất giá', 'Thủ tục vay vốn phức tạp'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Lo lắng (Anxiety)', 'FOMO', 'Tự hào (Pride)', 'An tâm (Relief)'])
  },
  'Giáo dục': {
    coreUser: ['Cha mẹ có con nhỏ', 'Người đi làm bận rộn', 'Học sinh mất gốc', 'Người muốn thăng tiến'],
    painPoint: ['Học mãi không vào', 'Không có thời gian đến lớp', 'Sợ tụt hậu so với bạn bè', 'Chi phí khóa học đắt đỏ'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Tự hào (Pride)', 'Sợ tụt hậu (FOMO)', 'Đồng cảm (Empathy)', 'Hy vọng (Hope)'])
  },
  'Mạng xã hội': {
    coreUser: ['Người tìm kiếm người yêu', 'Người hướng nội', 'KOLs / Creators', 'Gen Z thích trend'],
    painPoint: ['Cô đơn, khó kết bạn', 'Sợ bị lừa đảo qua mạng', 'Bị bóp tương tác', 'Nội dung kém hấp dẫn'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Tò mò (Curiosity)', 'FOMO', 'Đồng cảm (Empathy)', 'Hưng phấn (Excitement)'])
  },
  'Tổng hợp': {
    coreUser: ['Người dùng phổ thông', 'Người thích công nghệ'],
    painPoint: ['Vấn đề nan giải hàng ngày', 'Tốn thời gian làm thủ công', 'Chi phí đắt đỏ'],
    emotion: uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, 'Tò mò (Curiosity)', 'Thỏa mãn (Satisfaction)', 'Shock / Bất ngờ'])
  }
};

const GLOBAL_VIDEO_STRUCTURE = [
  'Cơ bản (Hook - Demo - Kêu gọi)',
  'Vấn đề - Khoét sâu - Giải pháp (PAS)',
  'Trước - Sau - Cầu nối (BAB)',
  'Kể chuyện & Dẫn dắt (Storytelling)',
  'Tính năng - Lợi ích - Chứng minh (FAB)',
  'Review & Người dùng thật (Testimonial)',
  'Phong cách Đời thường (UGC)'
];

const GLOBAL_VISUAL_TYPES = [
  '2D Animation',
  '3D Animation',
  'UGC',
  'POV',
  'Motion Graphic',
];

const STRATEGY_MAP_STATE_CATEGORY_PREFIX = '__strategy_map_state__:';
const STRATEGY_MAP_STATE_VERSION = 1;
const STRATEGY_WORKFLOW_LEVELS: StrategyWorkflowLevel[] = ['root', 'coreUser', 'psp', 'emotion', 'visual', 'painPoint', 'angle'];

function getStrategyMapStateCategory(weekKey: string) {
  return `${STRATEGY_MAP_STATE_CATEGORY_PREFIX}${weekKey}`;
}

function isInternalFilterCategory(category: string) {
  return category.startsWith(STRATEGY_MAP_STATE_CATEGORY_PREFIX);
}

function isStrategyWorkflowLevel(value: unknown): value is StrategyWorkflowLevel {
  return typeof value === 'string' && STRATEGY_WORKFLOW_LEVELS.includes(value as StrategyWorkflowLevel);
}

function normalizeStrategyMapCustomNode(value: unknown): StrategyMapCustomNodeState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const level = raw.level;
  if (!id || !label || !isStrategyWorkflowLevel(level)) return null;

  const filters =
    raw.filters && typeof raw.filters === 'object'
      ? Object.fromEntries(
          Object.entries(raw.filters as Record<string, unknown>)
            .map(([key, items]) => [
              key,
              Array.isArray(items)
                ? items
                    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                    .map(item => item.trim())
                : [],
            ])
            .filter(([, items]) => items.length > 0)
        ) as Partial<FilterState>
      : undefined;

  return {
    id,
    label,
    level,
    preferredX: typeof raw.preferredX === 'number' && Number.isFinite(raw.preferredX) ? raw.preferredX : undefined,
    filters,
  };
}

function normalizeStrategyMapEdge(value: unknown): StrategyMapEdgeState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const fromId = typeof raw.fromId === 'string' ? raw.fromId.trim() : '';
  const toId = typeof raw.toId === 'string' ? raw.toId.trim() : '';
  if (!fromId || !toId) return null;
  return { fromId, toId };
}

function normalizeStrategyMapPositionMap(value: unknown): Record<string, StrategyMapLayoutPosition> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([nodeId, position]) => {
        if (!position || typeof position !== 'object') return [nodeId, null] as const;
        const raw = position as Record<string, unknown>;
        const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : null;
        const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : null;
        if (!nodeId.trim() || x === null || y === null) return [nodeId, null] as const;
        return [nodeId, { x, y }] as const;
      })
      .filter((entry): entry is [string, StrategyMapLayoutPosition] => !!entry[1])
  );
}

function normalizeStrategyMapState(value: unknown, weekKey: string): StrategyMapState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  return {
    version: STRATEGY_MAP_STATE_VERSION,
    weekKey,
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : undefined,
    customNodes: Array.isArray(raw.customNodes)
      ? raw.customNodes
          .map(normalizeStrategyMapCustomNode)
          .filter((node): node is StrategyMapCustomNodeState => !!node)
      : [],
    customEdges: Array.isArray(raw.customEdges)
      ? raw.customEdges
          .map(normalizeStrategyMapEdge)
          .filter((edge): edge is StrategyMapEdgeState => !!edge)
      : [],
    manualNodePositions: normalizeStrategyMapPositionMap(raw.manualNodePositions),
    hiddenNodeIds: Array.isArray(raw.hiddenNodeIds)
      ? raw.hiddenNodeIds
          .filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.trim().length > 0)
          .map(nodeId => nodeId.trim())
      : [],
  };
}

// ============================================
//  APPS
// ============================================
export async function getApps(): Promise<AppProject[]> {
  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getApps error:', error);
    throw new Error(error.message || 'Supabase request failed while loading apps.');
  }
  return data || [];
}

export async function getApp(id: string): Promise<AppProject | null> {
  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .eq('id', id)
    .single();
  if (error) { console.error('getApp error:', error); return null; }
  return data;
}

export async function addApp(app: { name: string; category: string; icon_url: string; store_link?: string }): Promise<AppProject | null> {
  const { data, error } = await supabase
    .from('apps')
    .insert({
      name: app.name,
      category: app.category,
      icon_url: app.icon_url,
      store_link: app.store_link || null,
      features_count: 0,
      last_synced_at: null,
    })
    .select()
    .single();
  if (error) { console.error('addApp error:', error); return null; }
  return data;
}

export async function updateApp(id: string, updates: Partial<AppProject>): Promise<AppProject | null> {
  const { data, error } = await supabase
    .from('apps')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateApp error:', error); return null; }
  return data;
}

export async function deleteApp(id: string): Promise<boolean> {
  // Delete related data first (safety net in case CASCADE isn't applied)
  await supabase.from('sync_logs').delete().eq('app_id', id);
  await supabase.from('filter_options').delete().eq('app_id', id);
  await supabase.from('generated_ideas').delete().eq('app_id', id);
  await supabase.from('hooks').delete().eq('app_id', id);
  await supabase.from('features').delete().eq('app_id', id);
  
  const { error } = await supabase
    .from('apps')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('deleteApp error:', error);
    throw new Error(error.message || 'Failed to delete app');
  }
  return true;
}

// ============================================
//  FEATURES
// ============================================
export async function getFeatures(appId: string): Promise<Feature[]> {
  const { data, error } = await supabase
    .from('features')
    .select('*')
    .eq('app_id', appId)
    .order('created_at');
  if (error) { console.error('getFeatures error:', error); return []; }
  return data || [];
}

export async function addFeature(feature: { app_id: string; name: string; description: string }): Promise<Feature | null> {
  const { data, error } = await supabase
    .from('features')
    .insert(feature)
    .select()
    .single();
  if (error) { console.error('addFeature error:', error); return null; }
  return data;
}

export async function addFeaturesBatch(features: { app_id: string; name: string; description: string }[]): Promise<Feature[]> {
  if (features.length === 0) return [];
  const { data, error } = await supabase
    .from('features')
    .insert(features)
    .select();
  if (error) { console.error('addFeaturesBatch error:', error); return []; }
  return data || [];
}

export async function updateFeature(id: string, updates: Partial<Feature>): Promise<Feature | null> {
  const { data, error } = await supabase
    .from('features')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateFeature error:', error); return null; }
  return data;
}

// ============================================
//  HOOKS
// ============================================
export async function getHooks(appId?: string): Promise<Hook[]> {
  let query = supabase.from('hooks').select('*').order('created_at');
  if (appId) {
    query = query.eq('app_id', appId);
  }
  const { data, error } = await query;
  if (error) { console.error('getHooks error:', error); return []; }
  return data || [];
}

export async function addHook(hook: Omit<Hook, 'id' | 'created_at'>): Promise<Hook | null> {
  const { data, error } = await supabase
    .from('hooks')
    .insert(hook)
    .select()
    .single();
  if (error) { console.error('addHook error:', error); return null; }
  return data;
}

export async function updateHook(id: string, updates: Partial<Hook>): Promise<Hook | null> {
  const { data, error } = await supabase
    .from('hooks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateHook error:', error); return null; }
  return data;
}

export async function deleteHook(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('hooks')
    .delete()
    .eq('id', id);
  if (error) { console.error('deleteHook error:', error); return false; }
  return true;
}

// ============================================
//  GENERATED IDEAS
// ============================================
const IDEA_LIST_COLUMNS = 'id,app_id,title,duration,session_id,filters_snapshot,result,created_at';

export interface GetIdeasOptions {
  limit?: number;
  includeContent?: boolean;
}

export interface IdeaStats {
  totalIdeas: number;
  wins: number;
  failed: number;
  monitoring: number;
  sessions: number;
}

export async function getIdeas(appId: string, options: GetIdeasOptions = {}): Promise<GeneratedIdea[]> {
  let query = supabase
    .from('generated_ideas')
    .select(options.includeContent === false ? IDEA_LIST_COLUMNS : '*')
    .eq('app_id', appId)
    .order('created_at', { ascending: false });

  if (typeof options.limit === 'number' && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) { console.error('getIdeas error:', error); return []; }
  return (data || []) as unknown as GeneratedIdea[];
}

export async function getRecentIdeas(appId: string, limit = 24): Promise<GeneratedIdea[]> {
  return getIdeas(appId, { limit });
}

export async function getIdeasByIds(appId: string, ids: string[]): Promise<GeneratedIdea[]> {
  const cleanIds = [...new Set(ids.filter(id => typeof id === 'string' && id.trim().length > 0))];
  if (cleanIds.length === 0) return [];

  const { data, error } = await supabase
    .from('generated_ideas')
    .select('*')
    .eq('app_id', appId)
    .in('id', cleanIds);

  if (error) { console.error('getIdeasByIds error:', error); return []; }
  return (data || []) as GeneratedIdea[];
}

export async function getIdeaStats(appId: string): Promise<IdeaStats> {
  const { data, error } = await supabase
    .from('generated_ideas')
    .select('id, session_id, result')
    .eq('app_id', appId);

  if (error) {
    console.error('getIdeaStats error:', error);
    return { totalIdeas: 0, wins: 0, failed: 0, monitoring: 0, sessions: 0 };
  }

  const rows = (data || []) as Array<{ id: string; session_id: string | null; result: string | null }>;
  const sessionIds = new Set<string>();
  let wins = 0;
  let failed = 0;
  let monitoring = 0;

  rows.forEach(row => {
    sessionIds.add(row.session_id || `legacy:${row.id}`);
    if (row.result === 'win') wins++;
    if (row.result === 'failed') failed++;
    if (row.result === 'monitoring') monitoring++;
  });

  return {
    totalIdeas: rows.length,
    wins,
    failed,
    monitoring,
    sessions: sessionIds.size,
  };
}

function hasMeaningfulText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toFilterValues(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim().length > 0);
  if (typeof value === 'string' && value.trim().length > 0) return [value];
  return [];
}

export function isHookLibraryIdea(idea: GeneratedIdea): boolean {
  const meta = idea.content?.meta;
  const angleValues = toFilterValues(idea.filters_snapshot?.angle);
  const videoStructures = toFilterValues(idea.filters_snapshot?.videoStructure);

  if (meta?.builderVersion === 'hook_library_modify_history_v1' || meta?.builderVersion === 'hook_library_full_idea_v1') {
    return true;
  }

  if (meta?.track === 'hook-modify' || meta?.track === 'hook-full-idea') {
    return true;
  }

  if (meta?.sessionType === 'modify-hook' || meta?.sessionType === 'full-idea') {
    return true;
  }

  if (idea.content?.creativeType === 'Modified Hook') {
    return true;
  }

  if (videoStructures.includes('Hook Library')) {
    return true;
  }

  return angleValues.some(value => value.startsWith('Winning Hook:') || value.startsWith('Modified Hook:'));
}

function isHookOnlyIdea(idea: GeneratedIdea): boolean {
  const body = idea.content?.body;
  const cta = idea.content?.cta;
  return ![
    body?.script,
    body?.textOverlay,
    body?.visual,
    body?.text,
    body?.voice,
    body?.viTranslation,
    cta?.script,
    cta?.textOverlay,
    cta?.visual,
    cta?.text,
    cta?.voice,
    cta?.endCard,
    cta?.viTranslation,
  ].some(hasMeaningfulText);
}

function isFullIdeaRecord(idea: GeneratedIdea): boolean {
  const meta = idea.content?.meta;
  if (meta?.builderVersion === 'hook_library_full_idea_v1') return true;
  if (meta?.track === 'hook-full-idea' || meta?.sessionType === 'full-idea') return true;
  return !isHookOnlyIdea(idea);
}

function isModifyIdeaRecord(idea: GeneratedIdea): boolean {
  const meta = idea.content?.meta;
  const videoStructures = toFilterValues(idea.filters_snapshot?.videoStructure);

  if (meta?.builderVersion === 'hook_library_modify_history_v1') return true;
  if (meta?.track === 'hook-modify' || meta?.sessionType === 'modify-hook') return true;
  if (idea.content?.creativeType === 'Modified Hook') return true;
  if (videoStructures.includes('Modified Hook')) return true;

  if (isFullIdeaRecord(idea)) return false;

  return isHookOnlyIdea(idea) && videoStructures.includes('Hook Library');
}

function matchesHookHistoryIdea(
  idea: GeneratedIdea,
  hook: Pick<Hook, 'id' | 'title'>,
  track: 'modify' | 'full'
): boolean {
  const meta = idea.content?.meta;
  const expectedAngle = `${track === 'modify' ? 'Modified Hook' : 'Winning Hook'}: ${hook.title}`;
  const filterAngles = toFilterValues(idea.filters_snapshot?.angle);
  const matchesSourceHook =
    meta?.sourceHookId === hook.id ||
    meta?.sourceHookTitle === hook.title;
  const matchesAngle =
    meta?.angleName === expectedAngle ||
    filterAngles.includes(expectedAngle);

  if (!matchesSourceHook && !matchesAngle) return false;

  if (track === 'modify') {
    return isModifyIdeaRecord(idea);
  }

  return isFullIdeaRecord(idea);
}

export async function getIdeasForHook(
  appId: string,
  hook: Pick<Hook, 'id' | 'title'>,
  track: 'modify' | 'full'
): Promise<GeneratedIdea[]> {
  const ideas = await getIdeas(appId);
  return ideas.filter(idea => matchesHookHistoryIdea(idea, hook, track));
}

export async function saveIdeas(
  appId: string, 
  ideas: { title: string; duration: string; content: object; filtersSnapshot?: object }[],
  sessionId?: string,
  filtersSnapshot?: object
): Promise<GeneratedIdea[]> {
  const sid = sessionId || crypto.randomUUID();
  const rows = ideas.map(idea => ({ 
    app_id: appId, 
    title: idea.title, 
    duration: idea.duration, 
    content: idea.content,
    session_id: sid,
    filters_snapshot: idea.filtersSnapshot || filtersSnapshot || {},
  }));
  const { data, error } = await supabase
    .from('generated_ideas')
    .insert(rows)
    .select();
  if (error) { console.error('saveIdeas error:', error); return []; }
  return data || [];
}

// Strategy History — group ideas by session
export interface IdeaSession {
  sessionId: string;
  filters: FilterState | null;
  ideas: GeneratedIdea[];
  createdAt: string;
  ideaCount: number;
}

export async function getIdeaSessions(appId: string, options: GetIdeasOptions = {}): Promise<IdeaSession[]> {
  const data = await getIdeas(appId, options);

  // Group by session_id
  const sessionMap = new Map<string, GeneratedIdea[]>();
  data.forEach((idea: GeneratedIdea) => {
    const sid = idea.session_id || 'legacy';
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(idea);
  });

  // Convert to session list
  const sessions: IdeaSession[] = [];
  sessionMap.forEach((ideas, sessionId) => {
    sessions.push({
      sessionId,
      filters: ideas[0]?.filters_snapshot || null,
      ideas,
      createdAt: ideas[0]?.created_at || '',
      ideaCount: ideas.length,
    });
  });

  return sessions;
}

export async function updateIdeaResult(ideaId: string, result: string | null): Promise<boolean> {
  const { error } = await supabase
    .from('generated_ideas')
    .update({ result })
    .eq('id', ideaId);
  if (error) { console.error('updateIdeaResult error:', error); return false; }
  return true;
}

export async function updateIdeaContent(ideaId: string, title: string, content: GeneratedIdea['content']): Promise<boolean> {
  const { error } = await supabase
    .from('generated_ideas')
    .update({ title, content })
    .eq('id', ideaId);
  if (error) { console.error('updateIdeaContent error:', error); return false; }
  return true;
}

export async function updateIdeaFavorite(
  appId: string,
  idea: GeneratedIdea,
  isFavorite: boolean,
  favoriteKeys: string[]
): Promise<boolean> {
  const content = idea.content || {} as GeneratedIdea['content'];
  const nextContent = {
    ...content,
    meta: {
      ...(content.meta || {}),
      isFavorite,
      favoriteKeys: isFavorite ? Array.from(new Set(favoriteKeys.filter(Boolean))) : [],
      favoriteMarkedAt: isFavorite ? new Date().toISOString() : null,
    },
  } as GeneratedIdea['content'];

  const { error } = await supabase
    .from('generated_ideas')
    .update({ content: nextContent })
    .eq('app_id', appId)
    .eq('id', idea.id);

  if (error) { console.error('updateIdeaFavorite error:', error); return false; }
  return true;
}

export async function deleteIdea(ideaId: string): Promise<boolean> {
  const { error } = await supabase
    .from('generated_ideas')
    .delete()
    .eq('id', ideaId);
  if (error) { console.error('deleteIdea error:', error); return false; }
  return true;
}

// ============================================
//  FILTER OPTIONS
// ============================================
export async function getFilterOptions(app: AppProject): Promise<Record<string, string[]>> {
  // Get custom options from DB (app-specific)
  const { data: customRows } = await supabase
    .from('filter_options')
    .select('*')
    .eq('app_id', app.id);

  const customOptions: Record<string, string[]> = {};
  (customRows || []).forEach((row: FilterOption) => {
    if (isInternalFilterCategory(row.category)) return;
    const cat = row.category;
    if (!customOptions[cat]) customOptions[cat] = [];
    customOptions[cat] = uniqueNonEmptyStrings([...customOptions[cat]!, row.value]);
  });

  const manualOnlyResult: Record<string, string[]> = {
    coreUser: customOptions.coreUser || [],
    painPoint: customOptions.painPoint || [],
    solution: customOptions.solution || [],
    emotion: mergeWithGlobalEmotionOptions(customOptions.emotion || []),
    videoStructure: customOptions.videoStructure || [],
    visualType: GLOBAL_VISUAL_TYPES,
    targetMarket: customOptions.targetMarket || [],
  };

  const customCategoryKeys = new Set(['coreUser', 'painPoint', 'solution', 'emotion', 'videoStructure', 'visualType', 'targetMarket']);
  for (const [key, values] of Object.entries(customOptions)) {
    if (!customCategoryKeys.has(key)) {
      manualOnlyResult[key] = values;
    }
  }

  return manualOnlyResult;

  // Get app features for "solution"
  const features = await getFeatures(app.id);
  const featureNames = features.map(f => f.name);

  // Use app-specific DB filters first, fallback to category seeds only if no custom
  const categorySeeds = CATEGORY_SEEDS[app.category] || CATEGORY_SEEDS['Tổng hợp'];

  const result: Record<string, string[]> = {
    coreUser: customOptions.coreUser?.length ? customOptions.coreUser : (categorySeeds.coreUser || []),
    painPoint: customOptions.painPoint?.length ? customOptions.painPoint : (categorySeeds.painPoint || []),
    solution: featureNames.length ? featureNames : (customOptions.solution || []),
    emotion: customOptions.emotion?.length
      ? mergeWithGlobalEmotionOptions(customOptions.emotion)
      : mergeWithGlobalEmotionOptions(categorySeeds.emotion || []),
    videoStructure: GLOBAL_VIDEO_STRUCTURE,
    visualType: customOptions.visualType?.length ? customOptions.visualType : GLOBAL_VISUAL_TYPES,
    targetMarket: customOptions.targetMarket?.length ? customOptions.targetMarket : ['US (Mỹ)', 'SEA (Đông Nam Á)', 'EU (Châu Âu)', 'JP (Nhật Bản)', 'KR (Hàn Quốc)', 'LATAM (Mỹ Latin)', 'VN (Việt Nam)'],
  };

  // Include any custom (non-standard) categories from DB
  const standardKeys = new Set(['coreUser', 'painPoint', 'solution', 'emotion', 'videoStructure', 'visualType', 'targetMarket']);
  for (const [key, values] of Object.entries(customOptions)) {
    if (!standardKeys.has(key)) {
      result[key] = values;
    }
  }

  return result;
}

export async function addFilterOption(appId: string, category: string, value: string): Promise<FilterOption | null> {
  const { data, error } = await supabase
    .from('filter_options')
    .insert({ app_id: appId, category, value, is_custom: true })
    .select()
    .single();
  if (error) { console.error('addFilterOption error:', error); return null; }
  return data;
}

export async function updateFilterOptionByValue(
  appId: string,
  category: string,
  oldValue: string,
  newValue: string
): Promise<boolean> {
  const normalizedValue = newValue.trim();
  if (!normalizedValue) return false;
  if (normalizedValue === oldValue) return true;

  const { data: existingRows, error: existingError } = await supabase
    .from('filter_options')
    .select('id')
    .eq('app_id', appId)
    .eq('category', category)
    .eq('value', normalizedValue);

  if (existingError) {
    console.error('updateFilterOptionByValue select existing error:', existingError);
    return false;
  }

  if ((existingRows || []).length > 0) {
    return deleteFilterOptionByValue(appId, category, oldValue);
  }

  const { data, error } = await supabase
    .from('filter_options')
    .update({ value: normalizedValue, is_custom: true })
    .eq('app_id', appId)
    .eq('category', category)
    .eq('value', oldValue)
    .select('id');

  if (error) {
    console.error('updateFilterOptionByValue update error:', error);
    return false;
  }

  if ((data || []).length > 0) return true;

  const inserted = await addFilterOption(appId, category, normalizedValue);
  return Boolean(inserted);
}

export async function deleteFilterOption(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('filter_options')
    .delete()
    .eq('id', id);
  if (error) { console.error('deleteFilterOption error:', error); return false; }
  return true;
}

export async function getStrategyMapState(appId: string, weekKey: string): Promise<StrategyMapState | null> {
  const category = getStrategyMapStateCategory(weekKey);
  const { data, error } = await supabase
    .from('filter_options')
    .select('value')
    .eq('app_id', appId)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getStrategyMapState error:', error);
    return null;
  }

  if (!data?.value) return null;

  try {
    return normalizeStrategyMapState(JSON.parse(data.value), weekKey);
  } catch (parseError) {
    console.error('getStrategyMapState parse error:', parseError);
    return null;
  }
}

export async function saveStrategyMapState(appId: string, weekKey: string, state: StrategyMapState): Promise<boolean> {
  const normalized = normalizeStrategyMapState(state, weekKey);
  if (!normalized) return false;
  const savedAt = typeof state.savedAt === 'number' && Number.isFinite(state.savedAt) ? state.savedAt : Date.now();

  const category = getStrategyMapStateCategory(weekKey);
  const value = JSON.stringify({
    ...normalized,
    version: STRATEGY_MAP_STATE_VERSION,
    weekKey,
    savedAt,
  });

  const { data: existingRows, error: selectError } = await supabase
    .from('filter_options')
    .select('id')
    .eq('app_id', appId)
    .eq('category', category)
    .order('created_at', { ascending: false });

  if (selectError) {
    console.error('saveStrategyMapState select error:', selectError);
    return false;
  }

  const [currentRow, ...duplicateRows] = existingRows || [];

  if (currentRow?.id) {
    const { error: updateError } = await supabase
      .from('filter_options')
      .update({ value, is_custom: true })
      .eq('id', currentRow.id);

    if (updateError) {
      console.error('saveStrategyMapState update error:', updateError);
      return false;
    }
  } else {
    const { error: insertError } = await supabase
      .from('filter_options')
      .insert({ app_id: appId, category, value, is_custom: true });

    if (insertError) {
      console.error('saveStrategyMapState insert error:', insertError);
      return false;
    }
  }

  if (duplicateRows.length > 0) {
    const duplicateIds = duplicateRows.map(row => row.id).filter(Boolean);
    if (duplicateIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('filter_options')
        .delete()
        .in('id', duplicateIds);
      if (deleteError) {
        console.error('saveStrategyMapState cleanup error:', deleteError);
      }
    }
  }

  return true;
}


// ============================================
//  SYNC LOGS
// ============================================
export async function getSyncLogs(appId?: string, limit = 20): Promise<SyncLog[]> {
  let query = supabase.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (appId) query = query.eq('app_id', appId);
  const { data, error } = await query;
  if (error) { console.error('getSyncLogs error:', error); return []; }
  return data || [];
}

export async function addSyncLog(log: Omit<SyncLog, 'id' | 'created_at'>): Promise<SyncLog | null> {
  const { data, error } = await supabase
    .from('sync_logs')
    .insert(log)
    .select()
    .single();
  if (error) { console.error('addSyncLog error:', error); return null; }
  return data;
}

// ============================================
//  STORAGE (Hook Media)
// ============================================
export async function uploadHookMedia(file: File, hookId?: string): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'bin';
  const prefix = hookId || crypto.randomUUID();
  const path = `hooks/${prefix}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('hook-media')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) { console.error('uploadHookMedia error:', error); return null; }

  const { data: urlData } = supabase.storage
    .from('hook-media')
    .getPublicUrl(path);

  return urlData?.publicUrl || null;
}

export async function uploadBase64Media(base64: string, filename: string): Promise<string | null> {
  // Convert base64 to Blob
  const match = base64.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const rawData = match[2];
  const byteChars = atob(rawData);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArray], { type: mimeType });

  const ext = mimeType.split('/')[1] || 'bin';
  const path = `hooks/${filename}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('hook-media')
    .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: mimeType });

  if (error) { console.error('uploadBase64Media error:', error); return null; }

  const { data: urlData } = supabase.storage
    .from('hook-media')
    .getPublicUrl(path);

  return urlData?.publicUrl || null;
}

// ============================================
//  DELETE FILTER OPTION BY VALUE
// ============================================
export async function deleteFilterOptionByValue(appId: string, category: string, value: string): Promise<boolean> {
  const { error } = await supabase
    .from('filter_options')
    .delete()
    .eq('app_id', appId)
    .eq('category', category)
    .eq('value', value);
  if (error) { console.error('deleteFilterOptionByValue error:', error); return false; }
  return true;
}

export { CATEGORY_SEEDS, GLOBAL_EMOTION_OPTIONS, GLOBAL_VIDEO_STRUCTURE, GLOBAL_VISUAL_TYPES };

