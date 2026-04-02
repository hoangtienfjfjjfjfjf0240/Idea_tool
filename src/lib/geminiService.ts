import { GoogleGenAI } from "@google/genai";
import type { FilterState } from "@/types/database";

// Dynamic initialization
let ai: GoogleGenAI;

export const initGemini = (apiKey: string) => {
  const sanitizedKey = apiKey.trim();
  ai = new GoogleGenAI({ apiKey: sanitizedKey });
};

export const isGeminiInitialized = () => !!ai;

// Helper: parse JSON from text
const parseJsonFromText = (text: string) => {
  try {
    let cleanText = text.replace(/```json\s*|```/g, '').trim();
    cleanText = cleanText.replace(/[\u0000-\u001F]+/g, (match) => {
      if (match.includes('\n') || match.includes('\r') || match.includes('\t')) return match;
      return '';
    });

    const firstSquare = cleanText.indexOf('[');
    const lastSquare = cleanText.lastIndexOf(']');
    const firstCurly = cleanText.indexOf('{');
    const lastCurly = cleanText.lastIndexOf('}');

    let startIndex = -1, endIndex = -1;
    if (firstSquare !== -1 && lastSquare !== -1 && (firstCurly === -1 || firstSquare < firstCurly)) {
      startIndex = firstSquare; endIndex = lastSquare;
    } else if (firstCurly !== -1 && lastCurly !== -1) {
      startIndex = firstCurly; endIndex = lastCurly;
    }
    if (startIndex !== -1 && endIndex !== -1) {
      cleanText = cleanText.substring(startIndex, endIndex + 1);
    }
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Failed to parse JSON", e);
    return null;
  }
};

// Helper: get structure instructions
const getStructureInstructions = (structureName: string): string => {
  const strictDemoRule = `
    * DEMO SECTION RULES (Apply to 'demo' object):
      - Step 1 (Prep): Show the phone in hand, opening the feature.
      - Step 2 (Action): ONE simple interaction (tap/scan/upload/press). NO complex flows.
      - Step 3 (Result): Show the UI result. Voice MUST BE exactly: "Đây là kết quả của bạn." (Here is your result).
  `;

  switch (true) {
    case structureName.includes('PAS') || structureName.includes('Vấn đề'):
      return `[STRUCTURE: PAS]\n1. HOOK: Highlight the specific PAIN POINT immediately.\n2. BODY:\n   - 'problem': Show the Problem vividly (Agitate).\n   - 'solution': The Turning Point.\n   - 'demo': The Solution Implementation (3 Steps).\n${strictDemoRule}`;
    case structureName.includes('BAB') || structureName.includes('Trước - Sau'):
      return `[STRUCTURE: BAB]\n1. HOOK: Show the "BEFORE" state.\n2. BODY:\n   - 'problem': Detailed "BEFORE" state.\n   - 'solution': The "AFTER" state.\n   - 'demo': The BRIDGE (3 Steps).\n${strictDemoRule}`;
    case structureName.includes('Story') || structureName.includes('Kể chuyện'):
      return `[STRUCTURE: STORYTELLING]\n1. HOOK: Dramatic opener.\n2. BODY:\n   - 'problem': The Narrative Conflict.\n   - 'solution': The Discovery.\n   - 'demo': The Resolution (3 Steps).\n${strictDemoRule}`;
    case structureName.includes('Review') || structureName.includes('Testimonial'):
      return `[STRUCTURE: TESTIMONIAL]\n1. HOOK: Face-to-camera.\n2. BODY:\n   - 'problem': "Why I needed this".\n   - 'solution': "Why I picked this".\n   - 'demo': Walkthrough (3 Steps).\n${strictDemoRule}`;
    default:
      return `[STRUCTURE: BASIC]\n1. HOOK: Visual shock or strong benefit.\n2. BODY:\n   - 'problem': EMPTY ARRAY [].\n   - 'solution': EMPTY OBJECT.\n   - 'demo': 3-step demo.\n${strictDemoRule}`;
  }
};

// Mock data fallback
const mockGenerate = (qty: number, duration: string) => {
  return Array.from({ length: qty }).map((_, i) => ({
    id: Date.now() + i,
    title: `Ý tưởng Demo ${i + 1}`,
    duration,
    explanation: "Dễ quay tại nhà, không cần đạo cụ phức tạp.",
    hook: { visual: "Cảnh người dùng cầm điện thoại, vẻ mặt bất ngờ.", text: "Đừng xóa ảnh thủ công nữa!", voice: "Bạn đang lãng phí thời gian đấy." },
    problem: { scenes: [] },
    solution: { visual: "", voice: "", text: "" },
    demo: {
      step1_prep: { visual: "Mở ứng dụng trên điện thoại." },
      step2_action: { visual: "Chạm một lần vào nút 'Quét Thông Minh'." },
      step3_result: { visual: "Màn hình hiển thị kết quả.", voice: "Đây là kết quả của bạn." }
    },
    cta: { voice: "Thử ngay bây giờ.", text: "Tải miễn phí trên App Store" }
  }));
};

// 1. Generate Ideas
export const generateIdeaContent = async (
  appName: string,
  filters: Partial<FilterState>,
  config: { hookStyle?: string; quantity: number; duration: string; ideaDescription?: string }
) => {
  if (!ai) throw new Error("AI not initialized");

  const featureContext = filters.solution?.length ? filters.solution.join(', ') : "General App Features";
  const structureSelection = filters.videoStructure?.length ? filters.videoStructure[0] : "Cơ bản (Hook - Demo - Kêu gọi)";
  const structureInstruction = getStructureInstructions(structureSelection);

  const prompt = `[ROLE]
You are a Senior Performance Marketing Creative Strategist.

[INPUT DATA]
1. App Name: "${appName}"
2. Feature/Solution: "${featureContext}"
3. USER CONTEXT: "${config.ideaDescription || "Creative Freedom"}" 
4. Target Audience: ${filters.coreUser?.join(', ') || "General"}
5. Pain Points: ${filters.painPoint?.join(', ') || "General"}
6. Motivation: ${filters.motivation?.join(', ') || "General"}
7. REQUIRED QUANTITY: ${config.quantity}

[OBJECTIVE]
Generate exactly ${config.quantity} DISTINCT direct-response Meta ad ideas.
${structureInstruction}

[VISUAL & VOICE GUIDELINES]
- VISUALS: Must be clear, easy to shoot. Describe specific actions.
- VOICE: Write full Vietnamese scripts. Tone: Natural, Viral, Urgent.

[OUTPUT FORMAT]
Return a JSON ARRAY containing exactly ${config.quantity} objects. No Markdown.
[{ "id": 1, "title": "Title (Vietnamese)", "duration": "${config.duration}", "explanation": "Why this works...", "hook": { "visual": "...", "text": "...", "voice": "..." }, "problem": { "scenes": [{ "visual": "...", "voice": "..." }] }, "solution": { "visual": "...", "voice": "...", "text": "..." }, "demo": { "step1_prep": { "visual": "...", "voice": "..." }, "step2_action": { "visual": "...", "voice": "..." }, "step3_result": { "visual": "...", "voice": "Đây là kết quả của bạn." } }, "cta": { "voice": "Thử ngay bây giờ.", "text": "Tải miễn phí" } }]`;

  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { temperature: 0.8, topK: 40 } });
    const text = response.text;
    if (!text) throw new Error("No response from AI");
    const parsed = parseJsonFromText(text);
    if (!parsed) return mockGenerate(config.quantity, config.duration);
    const resultsArray = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validResults = resultsArray.filter((item: any) => item?.hook && item?.demo);
    if (validResults.length === 0) return mockGenerate(config.quantity, config.duration);
    if (validResults.length < config.quantity) {
      const extras = mockGenerate(config.quantity - validResults.length, config.duration);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [...validResults, ...extras].map((item: any) => ({ ...item, id: Math.floor(Math.random() * 100000) }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return validResults.slice(0, config.quantity).map((item: any) => ({ ...item, id: Math.floor(Math.random() * 100000) }));
  } catch (error) {
    console.error("Gemini API Error:", error);
    return mockGenerate(config.quantity, config.duration);
  }
};

// 2. Modify Hook
export const generateModifiedHook = async (originalHook: string, instructions: string): Promise<string> => {
  if (!ai) throw new Error("AI not initialized");
  const prompt = `Hook gốc: "${originalHook}"\nNgữ cảnh & Yêu cầu: ${instructions}\nNhiệm vụ: Viết lại hook. Ngắn gọn, viral, thu hút.\nNGÔN NGỮ: TIẾNG VIỆT.\nOUTPUT: Plain Text only.`;
  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    return response.text || originalHook;
  } catch { return originalHook; }
};

// 3. Scan App Info from Store URL
export const scanAppFromUrl = async (url: string): Promise<{ name: string; category: string; icon: string; features: { name: string; desc: string }[] }> => {
  if (!ai) throw new Error("AI not initialized");
  const fallback = { name: 'New App Project', category: 'Tiện ích', icon: '📱', features: [{ name: 'Tính năng chính', desc: 'Mô tả tính năng chính' }, { name: 'Giao diện', desc: 'Trải nghiệm mượt mà' }] };

  const prompt = `I have an App Store / Google Play URL: "${url}"

YOUR TASK:
1. Use 'googleSearch' to find the app's official details.
2. Extract the exact App Name.
3. IDENTIFY CATEGORY - Map to EXACTLY ONE: ["Sức khỏe & Thể hình", "Tiện ích", "Tổng hợp", "Trò chơi", "Tài chính", "Giáo dục", "Mạng xã hội"]
4. FIND THE REAL APP ICON URL:
   - For Google Play: "https://play-lh.googleusercontent.com/..."
   - For App Store: contains "mzstatic.com/image/thumb"
   - RETURN THE RAW URL STRING. Do NOT use emojis.
5. Extract 3 KEY Features in Vietnamese.

OUTPUT JSON ONLY:
{"name":"App Name","category":"Category","icon":"https://...","features":[{"name":"Feature 1","desc":"Description"},...]}`;

  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { tools: [{ googleSearch: {} }] } });
    const text = response.text;
    if (!text) return fallback;
    const data = parseJsonFromText(text);
    if (!data) return fallback;
    return { ...fallback, ...data };
  } catch (error) {
    console.error("Scan App Error:", error);
    return fallback;
  }
};

// 4. Generate Image for Hook
export const generateHookImage = async (visualDescription: string): Promise<string | null> => {
  if (!ai) throw new Error("AI not initialized");
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts: [{ text: `Photorealistic style, high quality ad visual: ${visualDescription}` }] },
      config: { imageConfig: { aspectRatio: '9:16', imageSize: '1K' } }
    });
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }
    }
    return null;
  } catch { return null; }
};

// 5. Refine Idea
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const refineIdea = async (originalIdea: any, instruction: string) => {
  if (!ai) throw new Error("AI not initialized");
  const prompt = `[OBJECTIVE]\nModify an existing ad idea based on user instructions.\nLanguage: VIETNAMESE.\n\n[ORIGINAL IDEA JSON]\n${JSON.stringify(originalIdea)}\n\n[USER INSTRUCTION]\n"${instruction}"\n\n[TASK]\n1. Apply the User Instruction.\n2. Keep the exact same JSON structure.\n3. Return ONLY the new JSON object. No Markdown.`;
  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    const text = response.text;
    if (!text) return null;
    const parsed = parseJsonFromText(text);
    if (!parsed) return null;
    return { ...parsed, id: Date.now() + Math.floor(Math.random() * 1000) };
  } catch { return null; }
};

// 6. Generate Idea from Hook
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const generateIdeaFromHook = async (winningHook: any, instruction: string, quantity = 3) => {
  if (!ai) throw new Error("AI not initialized");
  const prompt = `[OBJECTIVE]\nGenerate exactly ${quantity} DISTINCT variations of HOOKS based on:\n- WINNING HOOK: "${winningHook.title}" (${winningHook.hookConcept || ''}). Visual: "${winningHook.visualDetail || ''}".\n- USER INSTRUCTION: "${instruction}"\n\n[REQUIREMENTS]\n- Focus ONLY ON THE HOOK (First 3-5 seconds).\n- Visual: Detailed description, easy to shoot.\n- Text Overlay: Short, punchy.\n- Voice: Catchy, viral (Vietnamese).\n- Body/Demo/CTA: Leave EMPTY.\n\n[OUTPUT] JSON ARRAY of ${quantity} objects. No Markdown.\n[{"id":1,"title":"...","duration":"5s","explanation":"...","hook":{"visual":"...","text":"...","voice":"..."},"problem":{"scenes":[]},"solution":{"visual":"","voice":"","text":""},"demo":{"step1_prep":{"visual":""},"step2_action":{"visual":""},"step3_result":{"visual":"","voice":""}},"cta":{"voice":"","text":""}}]`;

  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { temperature: 0.8 } });
    const text = response.text;
    if (!text) return [];
    const parsed = parseJsonFromText(text);
    if (!parsed) return [];
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return arr.map((item: any, i: number) => ({ ...item, id: Date.now() + i }));
  } catch { return []; }
};

// 7. Analyze uploaded media
export const analyzeUploadedMedia = async (base64Data: string, mimeType: string) => {
  if (!ai) throw new Error("AI not initialized");
  const prompt = `[ROLE] Expert Direct-Response Video Marketing Analyst.\n[TASK] Analyze this visual content (Winning Hook from viral ad). Extract key elements.\n[OUTPUT] JSON Object (Vietnamese):\n{"title":"...","description":"...","hookConcept":"...","visualDetail":"..."}`;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }] }
    });
    const text = response.text;
    if (!text) return null;
    return parseJsonFromText(text);
  } catch { return null; }
};

// 8. Scan app for auto-sync (server-side usage)
export const scanAppForSync = async (apiKey: string, storeLink: string) => {
  const serverAI = new GoogleGenAI({ apiKey });
  const prompt = `I have an App Store / Google Play URL: "${storeLink}"

YOUR TASK:
1. Based on this URL, identify the app and extract its details.
2. Extract: App Name, Category, Icon URL, and up to 5 key features.
3. For icon: Google Play -> "https://play-lh.googleusercontent.com/...", App Store -> "mzstatic.com" URL. If you don't know the exact icon URL, use "📱".
4. Map category to EXACTLY ONE: ["Sức khỏe & Thể hình", "Tiện ích", "Tổng hợp", "Trò chơi", "Tài chính", "Giáo dục", "Mạng xã hội"]
5. Features should be in Vietnamese.

OUTPUT JSON ONLY (no markdown, no explanation):
{"name":"...","category":"...","icon":"📱","features":[{"name":"Feature (Vietnamese)","desc":"Short desc (Vietnamese)"}]}`;

  const models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  
  for (const model of models) {
    try {
      const response = await serverAI.models.generateContent({ model, contents: prompt });
      const text = response.text;
      if (!text) continue;
      const parsed = parseJsonFromText(text);
      if (parsed) return parsed;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`scanAppForSync error with ${model}:`, errMsg);
      continue;
    }
  }
  
  return null;
};
