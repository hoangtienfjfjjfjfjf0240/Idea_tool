import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

function parseJson(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);
    return JSON.parse(clean);
  } catch { return null; }
}

// Detect language from Core User text
function detectLang(coreUsers: string[]): string {
  const joined = (coreUsers || []).join(' ').toLowerCase();
  if (joined.includes('es') || joined.includes('tây ban nha') || joined.includes('spanish')) return 'ES (Tây Ban Nha)';
  if (joined.includes('pt') || joined.includes('brazil') || joined.includes('portuguese')) return 'PT (Bồ Đào Nha)';
  if (joined.includes('jp') || joined.includes('japan') || joined.includes('nhật')) return 'JP (Nhật)';
  if (joined.includes('vn') || joined.includes('việt')) return 'VI (Việt Nam)';
  if (joined.includes('se') || joined.includes('thụy điển') || joined.includes('swedish')) return 'SE (Thụy Điển)';
  if (joined.includes('de') || joined.includes('đức') || joined.includes('german')) return 'DE (Đức)';
  if (joined.includes('fr') || joined.includes('pháp') || joined.includes('french')) return 'FR (Pháp)';
  if (joined.includes('sea') || joined.includes('thái') || joined.includes('malay') || joined.includes('indo')) return 'SEA (Đa ngôn ngữ ĐNA)';
  return 'EN (Tiếng Anh)';
}

export async function POST(request: NextRequest) {
  try {
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge } = await request.json();
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = config?.quantity || 3;
    const duration = config?.duration || '30s';
    const targetLang = detectLang(filters?.coreUser);

    // Truncate knowledge to avoid prompt overflow
    const rawKnowledge = appKnowledge || '';
    const truncatedKnowledge = rawKnowledge.length > 3000 ? rawKnowledge.substring(0, 3000) + '\n[...truncated]' : rawKnowledge;

    const knowledgeBlock = truncatedKnowledge
      ? `\n[APP BRAIN — Kiến thức AI đã học cho app "${appName}". NGUỒN THAM KHẢO #1.]\n${truncatedKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas 
      ? `\n[IDEAS GẦN ĐÂY — Học phong cách, nâng cấp, KHÔNG lặp lại]\n${previousIdeas}\n`
      : '';

    const prompt = `[ROLE] Bạn là Senior Creative Strategist chuyên tạo Production Brief cho Meta/TikTok Video Ads.
Output của bạn PHẢI giống hệt một dòng trong Google Sheet production mà team editor đọc xong có thể quay/gen ngay — không cần hỏi thêm.
${knowledgeBlock}
${ideasBlock}

[APP] "${appName}" — Category: "${appCategory || 'General'}"
[PSP] ${featureContext}
[CORE USER] ${filters?.coreUser?.join(', ') || 'General'}
[PAINPOINT] ${filters?.painPoint?.join(', ') || 'General'}
[EMOTION] ${filters?.emotion?.join(', ') || 'General'}
[NGÔN NGỮ MỤC TIÊU] ${targetLang}
[MÔ TẢ BỔ SUNG] ${config?.ideaDescription || 'Creative Freedom'}
[SỐ LƯỢNG] ${quantity} ideas

═══════════════════════════════════════
RULE #1: HOOK FORMULA (BẮT BUỘC)
═══════════════════════════════════════
Hook = Nơi mà CORE USER cảm thấy EMOTION khi thấy PAINPOINT được thể hiện qua visual/text/voice.
→ Hook KHÔNG giới thiệu app. Hook KỂ CHUYỆN về vấn đề của user.
→ App chỉ xuất hiện ở BODY và CTA.

═══════════════════════════════════════
RULE #2: VISUAL — Mô tả CHI TIẾT cho Production
═══════════════════════════════════════
Visual PHẢI ghi rõ (đến mức editor đọc xong biết quay gì):
✅ Ai: bao nhiêu người, giới tính, tuổi, trang phục, ngoại hình cụ thể
✅ Ở đâu: bối cảnh chi tiết (phòng bếp kiểu US, tiệm nail hiện đại, sân bóng rổ...)
✅ Làm gì: hành động cụ thể (ngồi ghế bành cầm remote + iPhone, đang nấu ăn vừa hỏi Siri...)
✅ Biểu cảm: RÕ NÉT (tức giận hét lên, hoảng hốt nhìn màn hình, cười ha ha vỗ đùi...)
✅ Góc quay: POV / cận mặt / wide shot / từ sau lưng / nghiêng...
✅ Số option/ver: VD "3 option: 2 nam 1 nữ, đa dạng bối cảnh"

❌ TUYỆT ĐỐI KHÔNG VIẾT: "Người dùng lo lắng nhìn điện thoại" → QUÁ CHUNG CHUNG
❌ TUYỆT ĐỐI KHÔNG VIẾT KIỂU TVC: "Cảnh quay cinematic..." → KHÔNG THỰC TẾ

═══════════════════════════════════════
RULE #3: VOICE — Đối thoại bằng ${targetLang}
═══════════════════════════════════════
- Voice PHẢI viết bằng NGÔN NGỮ MỤC TIÊU (${targetLang})
- Hook voice = ĐỐI THOẠI giữa 2 người (hoặc người + AI assistant). 1-2 câu. Cảm xúc mạnh.
- Body voice = DÀI HƠN, 3-5 câu, giải thích app hoạt động + lợi ích. Giọng thuyết phục.
- CTA voice = RẤT NGẮN, 1 câu. Direct.

═══════════════════════════════════════
RULE #4: TEXT — Chữ overlay trên video, bằng ${targetLang}
═══════════════════════════════════════
- Ngắn gọn, BOLD, giật gân, 1-2 dòng
- Hook text = 3 options (Op1/Op2/Op3) — production team chọn 1
- Body text = Kết quả/con số ấn tượng
- CTA text = 2-5 words kêu gọi hành động

═══════════════════════════════════════
RULE #5: CREATIVE TYPE (ghi rõ)
═══════════════════════════════════════
Mỗi idea PHẢI thuộc 1 trong các kiểu sau:
• UGC (người thật nói/quay)
• POV (góc nhìn người dùng)
• Split Screen (chia 2 before/after)
• Interview (phỏng vấn đường phố/talkshow)
• Reaction (người xem react lại video/tin tức)
• Hỏi AI (Alexa/Siri/Google Assistant/ChatGPT)
• ASMR (thỏa mãn visual/âm thanh)
• Localize (bản địa hóa creative có sẵn)
• Scale (thay đổi visual/face/bối cảnh creative win)
• Breaking News (bản tin thời sự giả)
• Social Proof (review/testimonial)

═══════════════════════════════════════
RULE #6: ANTI-TVC (KHÔNG vi phạm)
═══════════════════════════════════════
❌ Không dùng nhạc nền epic/cinematic
❌ Không dùng slow-motion
❌ Không dùng studio lighting chuyên nghiệp
❌ Không dùng script dài dòng, sáo rỗng
✅ Phải giống video TikTok/UGC: tự nhiên, hơi raw, đời thường, gần gũi

═══════════════════════════════════════
CẤU TRÚC VIDEO ${duration}
═══════════════════════════════════════
🎣 HOOK (3-5s): visual + text (3 options) + voice → TẠO EMOTION từ PAINPOINT
📖 BODY (10-25s): visual + text + voice → DEMO PSP giải quyết Painpoint
🔥 CTA (3-5s): voice + text + end card → KÊU GỌI HÀNH ĐỘNG

═══════════════════════════════════════
OUTPUT FORMAT — QUAN TRỌNG
═══════════════════════════════════════
Trả về ĐÚNG ${quantity} objects trong JSON ARRAY.
KHÔNG markdown. KHÔNG giải thích thêm. KHÔNG wrap trong \`\`\`.
Visual + Explanation = TIẾNG VIỆT (cho team VN đọc).
Voice + Text = ${targetLang} (cho production).

[{
  "id": 1,
  "title": "Tên concept ngắn (VD: 'Hook hỏi Alexa - Ông già sợ hack')",
  "duration": "${duration}",
  "creativeType": "UGC / Hỏi AI / Interview / POV / ...",
  "framework": {
    "coreUser": "Chân dung user cụ thể (tiếng Việt)",
    "painpoint": "Nỗi đau cụ thể (tiếng Việt)",
    "emotion": "Cảm xúc hook tạo ra (tiếng Việt)",
    "psp": "Tính năng giải quyết (tiếng Việt)"
  },
  "explanation": "Tại sao idea hiệu quả + concept hook lấy cảm hứng từ đâu (tiếng Việt)",
  "hook": {
    "visual": "Mô tả cảnh quay CHI TIẾT: ai (tuổi/giới/trang phục), ở đâu (bối cảnh cụ thể), đang làm gì, tay cầm gì, biểu cảm gì, góc quay nào. Bằng TIẾNG VIỆT.",
    "text": "Op1: [headline bằng ${targetLang}]\\nOp2: [headline bằng ${targetLang}]\\nOp3: [headline bằng ${targetLang}]",
    "voice": "Đối thoại bằng ${targetLang}. Ghi rõ ai nói gì. VD: Người A: '...' → Người B: '...'"
  },
  "body": {
    "visual": "Mô tả cảnh demo app trên điện thoại (tiếng Việt). Screen recording style.",
    "text": "Text overlay bằng ${targetLang}",
    "voice": "Voiceover giải thích app, 3-5 câu, bằng ${targetLang}"
  },
  "cta": {
    "voice": "CTA 1 câu bằng ${targetLang}",
    "text": "CTA bold 2-5 words bằng ${targetLang}",
    "endCard": "${appName} + tagline bằng ${targetLang}"
  }
}]`;

    console.log('[generate-ideas] Prompt length:', prompt.length, 'chars');
    const text = await askAI(prompt, { 
      model: 'gemini/gemini-2.5-pro', 
      temperature: 0.8, 
      max_tokens: 16384,
      useCreativePersona: false  // Our prompt already has all rules
    });
    if (!text) {
      console.error('[generate-ideas] AI returned null - likely content filter or timeout');
      return NextResponse.json({ error: 'AI không phản hồi. Có thể do content filter hoặc timeout. Thử lại.' }, { status: 500 });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    const parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'Không parse được response. Thử lại.' }, { status: 500 });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook && i?.body).slice(0, quantity);

    if (valid.length === 0) {
      console.error('[generate-ideas] No valid ideas with hook+body:', JSON.stringify(arr[0]).substring(0, 200));
      return NextResponse.json({ error: 'AI trả về format sai. Thử lại.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
