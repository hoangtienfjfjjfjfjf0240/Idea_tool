// Centralized AI client using OpenAI-compatible API (internal gateway)

const AI_BASE_URL = process.env.AI_BASE_URL || '';
const AI_API_KEY = process.env.AI_API_KEY || '';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

interface AICallOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export async function callAI(
  messages: ChatMessage[],
  options: AICallOptions = {}
): Promise<string | null> {
  if (!AI_BASE_URL || !AI_API_KEY) {
    console.error('[AI] Missing AI_BASE_URL or AI_API_KEY');
    return null;
  }

  const { model = 'gemini/gemini-2.5-flash', temperature = 0.7, max_tokens = 4096 } = options;

  try {
    const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[AI] Error ${res.status}:`, err.substring(0, 200));
      return null;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('[AI] Fetch error:', err);
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
  }], { model: 'gemini/gemini-2.5-flash', ...options });
}
