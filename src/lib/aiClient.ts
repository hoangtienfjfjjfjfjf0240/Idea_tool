// Centralized AI client using OpenAI-compatible API (internal gateway)

const AI_BASE_URL = process.env.AI_BASE_URL || '';
const AI_API_KEY = process.env.AI_API_KEY || process.env.AI_GATEWAY_API_KEY || '';
let lastAIErrorMessage = '';

export function getAIChatCompletionsUrl(baseUrl = AI_BASE_URL): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  if (!normalizedBase) return '';
  if (normalizedBase.endsWith('/chat/completions')) return normalizedBase;
  return normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/chat/completions`
    : `${normalizedBase}/v1/chat/completions`;
}

export function getAIApiKey(): string {
  return AI_API_KEY;
}

export function getLastAIErrorMessage(): string {
  return lastAIErrorMessage;
}

function extractAIErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || parsed?.message || raw;
  } catch {
    return raw;
  }
}

// Senior Creative Strategist persona - Meta Video Creative Framework
export const CREATIVE_SYSTEM_PROMPT = `Bạn là Senior Creative Strategist với 10 năm kinh nghiệm chuyên sâu về Performance Marketing cho Mobile App trên Meta (Facebook/Instagram).

═══════════════════════════════════════
META VIDEO CREATIVE FRAMEWORK
INPUT GRAMMAR BAT BUOC CHO MOI KHIA CANH:
1. CORE USER = Ai + dang nghi gi + dang lam gi + vi sao chua giai quyet + dieu gi khien ho act.
   Health: ghi ro "khong phai benh nhan" neu dung. Utility: ghi muc tech-savvy. AI: ghi social platform dung nhieu nhat.
2. PAINPOINT = Who + Where + Doing What + What Goes Wrong.
   Painpoint phai la canh quay duoc trong 3 giay, khong phai cam xuc. Core User + PSP -> Pain Points -> Angles -> Ideas.
3. EMOTION = Hook Emotion -> Body Emotion -> CTA Emotion. Ba emotion phai khac nhau. Neu khong chac thi de auto.
4. ANGLE = 1 angle_type + 1 cach tiep can/framework thi truong + 1 execution nhin khac nhau.
   Health nen co Fact. Utility nen co Comparison/Demo. AI nen co Trend.
5. MARKET = Geo cu the + ngon ngu output + cultural reference dung/tranh.
6. NOTES = toi da 3-5 bullets ngan: DO, DON'T, Data, Constraint. Khong lap lai field khac.

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

type AIPriority = 'high' | 'normal' | 'low';

interface AICallOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  useCreativePersona?: boolean;
  priority?: AIPriority;
  timeoutMs?: number;
}

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const AI_MAX_CONCURRENT_REQUESTS = parsePositiveInt(process.env.AI_MAX_CONCURRENT_REQUESTS, 12);
const AI_RESERVED_INTERACTIVE_SLOTS = Math.min(
  AI_MAX_CONCURRENT_REQUESTS - 1,
  parsePositiveInt(process.env.AI_RESERVED_INTERACTIVE_SLOTS, 3)
);

type QueueEntry = {
  priority: AIPriority;
  resolve: (release: () => void) => void;
};

const PRIORITY_ORDER: Record<AIPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

let activeAICallCount = 0;
const pendingAICallQueue: QueueEntry[] = [];

function canStartAICall(priority: AIPriority) {
  if (activeAICallCount >= AI_MAX_CONCURRENT_REQUESTS) return false;
  if (priority === 'low') {
    return activeAICallCount < AI_MAX_CONCURRENT_REQUESTS - AI_RESERVED_INTERACTIVE_SLOTS;
  }
  return true;
}

function sortPendingAICalls() {
  pendingAICallQueue.sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]);
}

function drainAICallQueue() {
  let started = true;
  while (started) {
    started = false;
    for (let index = 0; index < pendingAICallQueue.length; index++) {
      const entry = pendingAICallQueue[index];
      if (!canStartAICall(entry.priority)) continue;

      pendingAICallQueue.splice(index, 1);
      activeAICallCount += 1;
      entry.resolve(() => {
        activeAICallCount = Math.max(0, activeAICallCount - 1);
        drainAICallQueue();
      });
      started = true;
      break;
    }
  }
}

function acquireAICallSlot(priority: AIPriority): Promise<() => void> {
  if (canStartAICall(priority)) {
    activeAICallCount += 1;
    return Promise.resolve(() => {
      activeAICallCount = Math.max(0, activeAICallCount - 1);
      drainAICallQueue();
    });
  }

  return new Promise(resolve => {
    pendingAICallQueue.push({ priority, resolve });
    sortPendingAICalls();
    drainAICallQueue();
  });
}

export async function callAI(
  messages: ChatMessage[],
  options: AICallOptions = {}
): Promise<string | null> {
  lastAIErrorMessage = '';

  if (!AI_BASE_URL || !AI_API_KEY) {
    lastAIErrorMessage = 'Missing AI_BASE_URL or AI_API_KEY';
    console.error('[AI]', lastAIErrorMessage);
    return null;
  }

  const {
    model = 'gemini/gemini-2.5-pro',
    temperature = 0.7,
    max_tokens = 8192,
    useCreativePersona = true,
    priority = 'normal',
    timeoutMs = 180000,
  } = options;

  // Prepend system prompt if using creative persona
  const allMessages: ChatMessage[] = useCreativePersona
    ? [{ role: 'system', content: CREATIVE_SYSTEM_PROMPT }, ...messages]
    : messages;

  const releaseSlot = await acquireAICallSlot(priority);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(getAIChatCompletionsUrl(), {
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
      lastAIErrorMessage = extractAIErrorMessage(err).substring(0, 500);
      console.error(`[AI] Error ${res.status}:`, err.substring(0, 200));
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      lastAIErrorMessage = `AI request timed out after ${Math.round(timeoutMs / 1000)} seconds`;
      console.error(`[AI] Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    } else {
      lastAIErrorMessage = err instanceof Error ? err.message : String(err);
      console.error('[AI] Fetch error:', err);
    }
    return null;
  } finally {
    releaseSlot();
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
