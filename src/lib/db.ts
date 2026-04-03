import { supabase } from './supabase';
import type { AppProject, Feature, Hook, GeneratedIdea, FilterOption, SyncLog, FilterState } from '@/types/database';

// ============================================
// CATEGORY SPECIFIC SEEDS (Kept from original)
// ============================================
const CATEGORY_SEEDS: Record<string, Partial<FilterState>> = {
  'Sức khỏe & Thể hình': {
    coreUser: ['Người 35-50 tuổi (Lo sức khỏe)', 'Người có tiền sử tim mạch', 'Người sống độc thân', 'Gymer / Vận động viên', 'Phụ nữ mang thai'],
    painPoint: ['Sợ đột quỵ bất ngờ', 'Lo lắng khi ở nhà một mình', 'Không tin tưởng bác sĩ', 'Chi phí y tế quá cao', 'Cơ thể mệt mỏi không rõ lý do', 'Nhịp tim tăng cao khi hồi hộp'],
    emotion: ['Sợ hãi (Fear)', 'Lo lắng (Anxiety)', 'An tâm (Relief)', 'Shock / Bất ngờ']
  },
  'Tiện ích': {
    coreUser: ['Nam 35-45 (Cần Update iOS)', 'Nữ 35-45 (Lưu giữ kỷ niệm con cái)', 'Người cao tuổi 55+ (Cần trợ giúp công nghệ)', 'Người dùng 22-55+ (Thích quay chụp/ASMR)', 'Người bận rộn (Nhiều Email/File rác)'],
    painPoint: ['Đầy bộ nhớ không thể Update iOS mới', 'Bỏ lỡ khoảnh khắc con cái vì máy đầy', 'Điện thoại báo đầy dung lượng liên tục', 'Email rác lấp mất hóa đơn quan trọng', 'Xóa ảnh thủ công quá tốn thời gian', 'Máy nóng, chai pin do dữ liệu rác', 'Không thể tải thêm ứng dụng mới'],
    emotion: ['Thỏa mãn (ASMR)', 'Nhẹ nhõm (Relief)', 'Tò mò (Curiosity)', 'Bực bội → Hài lòng']
  },
  'Trò chơi': {
    coreUser: ['Gen Z (Thích thử thách)', 'Nhân viên văn phòng (Giải trí)', 'Hardcore Gamer', 'Người thích giải đố'],
    painPoint: ['Chán nản, không có gì làm', 'Cần xả stress nhanh', 'Muốn khẳng định bản thân', 'Game cũ quá nhàm chán'],
    emotion: ['Hưng phấn (Excitement)', 'Thỏa mãn (Satisfaction)', 'Tò mò (Curiosity)', 'FOMO']
  },
  'Tài chính': {
    coreUser: ['Người muốn tiết kiệm', 'Nhà đầu tư F0', 'Chủ shop nhỏ', 'Sinh viên mới ra trường'],
    painPoint: ['Không biết tiền đi đâu hết', 'Nợ nần chồng chất', 'Sợ lạm phát mất giá', 'Thủ tục vay vốn phức tạp'],
    emotion: ['Lo lắng (Anxiety)', 'FOMO', 'Tự hào (Pride)', 'An tâm (Relief)']
  },
  'Giáo dục': {
    coreUser: ['Cha mẹ có con nhỏ', 'Người đi làm bận rộn', 'Học sinh mất gốc', 'Người muốn thăng tiến'],
    painPoint: ['Học mãi không vào', 'Không có thời gian đến lớp', 'Sợ tụt hậu so với bạn bè', 'Chi phí khóa học đắt đỏ'],
    emotion: ['Tự hào (Pride)', 'Sợ tụt hậu (FOMO)', 'Đồng cảm (Empathy)', 'Hy vọng (Hope)']
  },
  'Mạng xã hội': {
    coreUser: ['Người tìm kiếm người yêu', 'Người hướng nội', 'KOLs / Creators', 'Gen Z thích trend'],
    painPoint: ['Cô đơn, khó kết bạn', 'Sợ bị lừa đảo qua mạng', 'Bị bóp tương tác', 'Nội dung kém hấp dẫn'],
    emotion: ['Tò mò (Curiosity)', 'FOMO', 'Đồng cảm (Empathy)', 'Hưng phấn (Excitement)']
  },
  'Tổng hợp': {
    coreUser: ['Người dùng phổ thông', 'Người thích công nghệ'],
    painPoint: ['Vấn đề nan giải hàng ngày', 'Tốn thời gian làm thủ công', 'Chi phí đắt đỏ'],
    emotion: ['Tò mò (Curiosity)', 'Thỏa mãn (Satisfaction)', 'Shock / Bất ngờ']
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

// ============================================
//  APPS
// ============================================
export async function getApps(): Promise<AppProject[]> {
  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('getApps error:', error); return []; }
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
  const { error } = await supabase
    .from('apps')
    .delete()
    .eq('id', id);
  if (error) { console.error('deleteApp error:', error); return false; }
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
export async function getIdeas(appId: string): Promise<GeneratedIdea[]> {
  const { data, error } = await supabase
    .from('generated_ideas')
    .select('*')
    .eq('app_id', appId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getIdeas error:', error); return []; }
  return data || [];
}

export async function saveIdeas(
  appId: string, 
  ideas: { title: string; duration: string; content: object }[],
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
    filters_snapshot: filtersSnapshot || {},
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

export async function getIdeaSessions(appId: string): Promise<IdeaSession[]> {
  const { data, error } = await supabase
    .from('generated_ideas')
    .select('*')
    .eq('app_id', appId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getIdeaSessions error:', error); return []; }

  // Group by session_id
  const sessionMap = new Map<string, GeneratedIdea[]>();
  (data || []).forEach((idea: GeneratedIdea) => {
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

export async function updateIdeaContent(ideaId: string, title: string, content: any): Promise<boolean> {
  const { error } = await supabase
    .from('generated_ideas')
    .update({ title, content })
    .eq('id', ideaId);
  if (error) { console.error('updateIdeaContent error:', error); return false; }
  return true;
}

// ============================================
//  FILTER OPTIONS
// ============================================
export async function getFilterOptions(app: AppProject): Promise<Record<keyof FilterState, string[]>> {
  // Get custom options from DB (app-specific)
  const { data: customRows } = await supabase
    .from('filter_options')
    .select('*')
    .eq('app_id', app.id);

  const customOptions: Partial<Record<keyof FilterState, string[]>> = {};
  (customRows || []).forEach((row: FilterOption) => {
    const cat = row.category as keyof FilterState;
    if (!customOptions[cat]) customOptions[cat] = [];
    customOptions[cat]!.push(row.value);
  });

  // Get app features for "solution"
  const features = await getFeatures(app.id);
  const featureNames = features.map(f => f.name);

  // Use app-specific DB filters first, fallback to category seeds only if no custom
  const categorySeeds = CATEGORY_SEEDS[app.category] || CATEGORY_SEEDS['Tổng hợp'];

  return {
    coreUser: customOptions.coreUser?.length ? customOptions.coreUser : (categorySeeds.coreUser || []),
    painPoint: customOptions.painPoint?.length ? customOptions.painPoint : (categorySeeds.painPoint || []),
    solution: featureNames.length ? featureNames : (customOptions.solution || []),
    emotion: customOptions.emotion?.length ? customOptions.emotion : (categorySeeds.emotion || []),
    videoStructure: GLOBAL_VIDEO_STRUCTURE,
  };
}

export async function addFilterOption(appId: string, category: keyof FilterState, value: string): Promise<FilterOption | null> {
  const { data, error } = await supabase
    .from('filter_options')
    .insert({ app_id: appId, category, value, is_custom: true })
    .select()
    .single();
  if (error) { console.error('addFilterOption error:', error); return null; }
  return data;
}

export async function deleteFilterOption(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('filter_options')
    .delete()
    .eq('id', id);
  if (error) { console.error('deleteFilterOption error:', error); return false; }
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

export { CATEGORY_SEEDS, GLOBAL_VIDEO_STRUCTURE };

