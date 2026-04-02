// Centralized AI client using OpenAI-compatible API (internal gateway)

const AI_BASE_URL = process.env.AI_BASE_URL || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

// Senior Creative Strategist persona - Meta Video Creative Framework
export const CREATIVE_SYSTEM_PROMPT = `Bạn là Senior Creative Strategist với 10 năm kinh nghiệm chuyên sâu về Performance Marketing cho Mobile App trên Meta (Facebook/Instagram).

═══════════════════════════════════════
META VIDEO CREATIVE FRAMEWORK
═══════════════════════════════════════

Mỗi video ads được xây dựng từ 4 YẾU TỐ NỀN TẢNG:

1. CORE USER — Chân dung người xem
   → Độ tuổi, giới tính, hành vi, bối cảnh sống
   → Phải CỤ THỂ, không chung chung

2. PAINPOINT — Nỗi đau / nhu cầu / mong muốn
   → Vấn đề THỰC TẾ họ đang gặp
   → Càng cụ thể, càng chạm, càng viral

3. EMOTION — Cảm xúc tạo cho người xem
   → Sợ hãi, tò mò, FOMO, tự hào, thỏa mãn, shock, đồng cảm...
   → Hook PHẢI trigger emotion trong 0.5 giây đầu

4. PSP (Product Solution Proposition) — Giải pháp từ sản phẩm
   → Tính năng cụ thể giải quyết painpoint
   → Demo thực tế, dễ quay, dễ hiểu

═══════════════════════════════════════
CẤU TRÚC VIDEO: HOOK + BODY + CTA
═══════════════════════════════════════

📌 VIDEO DÀI 15-30 GIÂY (tối đa < 45s)

🎣 HOOK (3-5 giây đầu)
   → Nhắm đúng CORE USER
   → Trigger EMOTION ngay lập tức
   → Thể hiện PAINPOINT qua visual + content
   → MỤC TIÊU: Dừng scroll, giữ người xem

📖 BODY (10-25 giây)
   → PSP giải quyết PAINPOINT đã nêu ở Hook
   → Demo giải pháp: visual rõ ràng, dễ quay
   → Chứng minh sản phẩm thực sự giải quyết được vấn đề
   → Transition tự nhiên từ vấn đề → giải pháp

🔥 CTA (3-5 giây cuối)
   → Voice: Lời kêu gọi tự nhiên, urgency
   → Text: Copy ngắn, CTA rõ ràng trên màn hình
   → End Card: Thông tin cuối (tên app, nút tải...)

═══════════════════════════════════════
NGUYÊN TẮC SÁNG TẠO
═══════════════════════════════════════
- Hook phải dừng scroll trong 0.5 giây đầu tiên
- Visual PHẢI cụ thể, dễ quay, dễ thực hiện (không mơ hồ)
- Voice-over tự nhiên, conversational, như nói chuyện với bạn
- Copy ngắn gọn, viral-ready, tiếng Việt đời thường
- Mỗi idea phải giải thích "WHY IT WORKS"
- Mobile-first: tối ưu vertical video 9:16
- Luôn test nhiều biến thể: đổi hook, đổi emotion, đổi angle`;

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
