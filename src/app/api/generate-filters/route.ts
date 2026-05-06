import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import { createServerClient } from '@/lib/supabase';
import { guardApiRequest } from '@/lib/apiGuards';
import { GLOBAL_EMOTION_PROMPT_GUIDE, mergeWithGlobalEmotionOptions, uniqueNonEmptyStrings } from '@/lib/emotionOptions';

export const maxDuration = 60;

function parseJson(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);
    return JSON.parse(clean);
  } catch { return null; }
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueNonEmptyStrings(value.filter((item): item is string => typeof item === 'string'))
    : [];
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'generate-filters', max: 20, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const { appId, appName, appCategory, features } = await request.json();
    if (!appId || !appName) {
      return NextResponse.json({ error: 'appId and appName required' }, { status: 400 });
    }

    const featuresText = features?.length
      ? features.map((f: { name: string; description?: string }) => `- ${f.name}: ${f.description || ''}`).join('\n')
      : 'Chưa có thông tin tính năng';

    const prompt = `Bạn là Performance Marketing Expert. Phân tích app sau và tạo ra các filter options cho chiến dịch quảng cáo.

APP: "${appName}"
CATEGORY: "${appCategory || 'General'}"
FEATURES:
${featuresText}

NHIỆM VỤ: Tạo 3 danh sách filter CHO APP NÀY (tiếng Việt, cụ thể cho app, không chung chung):

1. coreUser (5-7 items): Chân dung người dùng mục tiêu CỤ THỂ cho app này
   → Phải có tuổi, giới tính, hành vi, bối cảnh sống
   → VD: "Phụ nữ 35-50 tuổi (Lo sức khỏe gia đình)", "Nam 25-35 IT (Cần dọn dẹp phone)"
   
2. painPoint (5-8 items): Nỗi đau / vấn đề CỤ THỂ mà người dùng gặp, app này giải quyết được
   → Phải liên quan trực tiếp đến tính năng app
   → VD: "Điện thoại đầy bộ nhớ không thể update iOS", "Sợ mất dữ liệu quan trọng"

3. emotion (6-8 items): Cảm xúc hook quảng cáo có thể trigger cho app này
   → Luôn bao gồm đủ 6 emotion drivers chuẩn này cho mọi app:
${GLOBAL_EMOTION_PROMPT_GUIDE}
   → Có thể thêm tối đa 2 emotion riêng cho app nếu thật sự khác 6 driver trên

OUTPUT JSON ONLY (no markdown):
{"coreUser":["..."],"painPoint":["..."],"emotion":["..."]}`;

    const text = await askAI(prompt, {
      model: 'gemini/gemini-2.5-flash',
      temperature: 0.5,
      useCreativePersona: false,
    });

    if (!text) {
      return NextResponse.json({ error: 'AI không phản hồi' }, { status: 500 });
    }

    const parsed = parseJson(text);
    if (!parsed || !parsed.coreUser || !parsed.painPoint || !parsed.emotion) {
      return NextResponse.json({ error: 'Parse failed' }, { status: 500 });
    }
    const data = {
      coreUser: normalizeStringList(parsed.coreUser),
      painPoint: normalizeStringList(parsed.painPoint),
      emotion: mergeWithGlobalEmotionOptions(normalizeStringList(parsed.emotion)),
    };
    if (data.coreUser.length === 0 || data.painPoint.length === 0 || data.emotion.length === 0) {
      return NextResponse.json({ error: 'Parse failed' }, { status: 500 });
    }

    // Save to filter_options table
    const supabase = createServerClient();
    const rows: { app_id: string; category: string; value: string; is_custom: boolean }[] = [];

    for (const val of data.coreUser) {
      rows.push({ app_id: appId, category: 'coreUser', value: val, is_custom: true });
    }
    for (const val of data.painPoint) {
      rows.push({ app_id: appId, category: 'painPoint', value: val, is_custom: true });
    }
    for (const val of data.emotion) {
      rows.push({ app_id: appId, category: 'emotion', value: val, is_custom: true });
    }

    const { error: insertError } = await supabase.from('filter_options').insert(rows);
    if (insertError) {
      console.error('[generate-filters] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save filters' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data,
      count: rows.length,
    });
  } catch (err) {
    console.error('[generate-filters] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
