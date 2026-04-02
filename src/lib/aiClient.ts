// Centralized AI client using OpenAI-compatible API (internal gateway)

const AI_BASE_URL = process.env.AI_BASE_URL || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

// Senior Creative Strategist persona - 10 năm kinh nghiệm creative app
export const CREATIVE_SYSTEM_PROMPT = `Bạn là Senior Creative Strategist với 10 năm kinh nghiệm chuyên sâu về Performance Marketing cho Mobile App (iOS/Android).

CHUYÊN MÔN CỐT LÕI:
- Đã tạo 10,000+ video ads cho các app trên App Store/Google Play
- Chuyên gia Facebook/Meta Ads, TikTok Ads, YouTube Shorts
- Am hiểu sâu về tâm lý người dùng mobile: từ awareness → install → retention
- Thành thạo các framework: PAS, BAB, AIDA, Storytelling, UGC, Testimonial
- Hiểu biết sâu về App Store Optimization (ASO) và cách kết hợp với Paid Ads

PHONG CÁCH LÀM VIỆC:
- Hook phải dừng scroll trong 0.5 giây đầu tiên
- Visual PHẢI cụ thể, dễ quay, dễ thực hiện (không mơ hồ)
- Voice-over phải tự nhiên, conversational, như đang nói chuyện với bạn bè
- Copy ngắn gọn, viral-ready, dùng tiếng Việt đời thường
- Demo app cụ thể: chỉ đúng tính năng, đúng UI flow, đúng kết quả
- CTA rõ ràng, urgency tự nhiên (không ép buộc)

NGUYÊN TẮC SÁNG TẠO:
1. Mỗi idea phải có "WHY IT WORKS" — giải thích tâm lý đằng sau
2. Visual phải paint picture rõ ràng — đọc xong biết quay gì
3. Tránh generic/nhàm chán — phải có twist, góc nhìn bất ngờ
4. Data-driven: dựa trên insight thực tế, không bịa số liệu
5. Mobile-first: mọi thứ phải tối ưu cho vertical video 9:16
6. Luôn test nhiều biến thể: đổi hook, đổi CTA, đổi target angle`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

interface AICallOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  useCreativePersona?: boolean;
}

export async function callAI(
  messages: ChatMessage[],
  options: AICallOptions = {}
): Promise<string | null> {
  if (!AI_BASE_URL || !AI_API_KEY) {
    console.error('[AI] Missing AI_BASE_URL or AI_API_KEY');
    return null;
  }

  const {
    model = 'gemini/gemini-2.5-pro',
    temperature = 0.7,
    max_tokens = 8192,
    useCreativePersona = true,
  } = options;

  // Prepend system prompt if using creative persona
  const allMessages: ChatMessage[] = useCreativePersona
    ? [{ role: 'system', content: CREATIVE_SYSTEM_PROMPT }, ...messages]
    : messages;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min timeout

    const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        temperature,
        max_tokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      console.error(`[AI] Error ${res.status}:`, err.substring(0, 200));
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[AI] Request timed out after 3 minutes');
    } else {
      console.error('[AI] Fetch error:', err);
    }
    return null;
  }
}

// Helper: simple text prompt
export async function askAI(prompt: string, options: AICallOptions = {}): Promise<string | null> {
  return callAI([{ role: 'user', content: prompt }], options);
}

// Helper: vision prompt (image analysis)
export async function askAIWithImage(
  prompt: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg',
  options: AICallOptions = {}
): Promise<string | null> {
  return callAI([{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
    ],
  }], options);
}
