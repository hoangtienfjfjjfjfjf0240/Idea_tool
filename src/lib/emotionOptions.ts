export interface GlobalEmotionDefinition {
  label: string;
  description: string;
  trigger: string;
}

export const GLOBAL_EMOTION_DEFINITIONS: GlobalEmotionDefinition[] = [
  {
    label: 'Fear / Urgency',
    description: 'Sợ bỏ lỡ, sợ hậu quả, sợ muộn',
    trigger: 'Sợ hãi / Khẩn cấp',
  },
  {
    label: 'Curiosity',
    description: 'Open loop, câu hỏi chưa có trả lời',
    trigger: 'Sự tò mò',
  },
  {
    label: 'Aspirational',
    description: 'Muốn trở thành phiên bản tốt hơn',
    trigger: 'Tham vọng',
  },
  {
    label: 'Social Proof',
    description: 'Người giống mình đang dùng và thành công',
    trigger: 'Bằng chứng xã hội',
  },
  {
    label: 'Bất ngờ / Nhẹ nhõm',
    description: 'Tìm thấy giải pháp sau nỗi đau dài',
    trigger: 'Bất ngờ / Nhẹ nhõm',
  },
  {
    label: 'FOMO',
    description: 'Mọi người đã biết, chỉ mình chưa',
    trigger: 'Social / Trending / Viral',
  },
];

export const GLOBAL_EMOTION_OPTIONS = GLOBAL_EMOTION_DEFINITIONS.map(item => item.label);

export const GLOBAL_EMOTION_PROMPT_GUIDE = GLOBAL_EMOTION_DEFINITIONS
  .map(item => `- ${item.label}: ${item.description}. Trigger: ${item.trigger}.`)
  .join('\n');

export function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  );
}

export function mergeWithGlobalEmotionOptions(values: ReadonlyArray<string | null | undefined> = []): string[] {
  return uniqueNonEmptyStrings([...GLOBAL_EMOTION_OPTIONS, ...values]);
}
