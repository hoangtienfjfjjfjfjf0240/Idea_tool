import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

export const maxDuration = 120;

function parseJson(text: string) {
  try {
    // Step 1: Strip markdown fences and trim
    let clean = text.replace(/```json\s*|```/g, '').trim();

    // Step 2: Remove BOM and zero-width chars
    clean = clean.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

    // Step 3: Extract JSON array or object
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);

    // Step 4: Try direct parse first
    try { return JSON.parse(clean); } catch {}

    // Step 5: Fix common issues and retry
    let fixed = clean
      .replace(/,\s*([}\]])/g, '$1')        // trailing commas
      .replace(/\n/g, '\\n')                 // unescaped newlines in strings
      .replace(/\r/g, '\\r')                 // unescaped carriage returns
      .replace(/\t/g, '\\t');                // unescaped tabs
    try { return JSON.parse(fixed); } catch {}

    // Step 6: More aggressive â€” fix unescaped newlines inside string values
    fixed = clean.replace(/("(?:[^"\\]|\\.)*")|[\n\r\t]/g, (match, str) => {
      if (str) return str; // inside string, keep as-is
      return ' '; // outside string, replace with space
    });
    try { return JSON.parse(fixed); } catch {}

    // Step 7: Last resort â€” eval-safe parse via Function
    try {
      const fn = new Function('return ' + clean);
      return fn();
    } catch {}

    return null;
  } catch { return null; }
}

// Detect language from Core User text
function detectLang(coreUsers: string[]): string {
  const joined = (coreUsers || []).join(' ').toLowerCase();

  // Use word boundary check to avoid false matches (e.g. "user" matching "se")
  const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(joined);

  if (hasWord('spanish') || hasWord('tÃ¢y ban nha') || hasWord('espaÃ±ol') || hasWord('latina')) return 'ES (TÃ¢y Ban Nha)';
  if (hasWord('portuguese') || hasWord('brazil') || hasWord('brasil') || hasWord('bá»“ Ä‘Ã o nha')) return 'PT (Bá»“ ÄÃ o Nha)';
  if (hasWord('japanese') || hasWord('japan') || hasWord('nháº­t') || hasWord('æ—¥æœ¬')) return 'JP (Nháº­t)';
  if (hasWord('vietnamese') || hasWord('viá»‡t') || hasWord('vietnam')) return 'VI (Viá»‡t Nam)';
  if (hasWord('swedish') || hasWord('thá»¥y Ä‘iá»ƒn') || hasWord('sweden') || hasWord('svenska')) return 'SE (Thá»¥y Äiá»ƒn)';
  if (hasWord('german') || hasWord('Ä‘á»©c') || hasWord('germany') || hasWord('deutsch')) return 'DE (Äá»©c)';
  if (hasWord('french') || hasWord('phÃ¡p') || hasWord('france') || hasWord('franÃ§ais')) return 'FR (PhÃ¡p)';
  if (hasWord('thai') || hasWord('thÃ¡i') || hasWord('malay') || hasWord('indonesia') || hasWord('sea')) return 'SEA (Äa ngÃ´n ngá»¯ ÄNA)';
  if (hasWord('korean') || hasWord('hÃ n') || hasWord('korea')) return 'KO (HÃ n Quá»‘c)';
  return 'EN (Tiáº¿ng Anh)';
}

// Map frontend model names to gateway model identifiers
function resolveModel(selected?: string): string {
  const map: Record<string, string> = {
    'gemini-2.5-pro': 'gemini/gemini-2.5-pro',
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'openai/gpt-4.1';
}

// Build culture/market context based on selected target market
function buildMarketContext(targetMarket: string[]): string {
  const market = (targetMarket || []).join(', ').toLowerCase();

  if (!market || market.includes('us') || market.includes('má»¹')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: US (Má»¹)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a Má»¹:

ðŸ  Bá»I Cáº¢NH: suburban house, apartment, kitchen, backyard/patio, garage
ðŸ“± CÃ”NG NGHá»†: iPhone/Samsung, Siri, Ring doorbell, Apple Pay, Chase/BoA
ðŸ‘¥ HÃ€NH VI: gá»i "Dad/Mom/honey/babe", dÃ¹ng iMessage, tiáº¿ng lÃ³ng "literally/no way/oh my god"
ðŸ” Äá»œI Sá»NG: Starbucks, Target, Walmart, Home Depot, Netflix, road trip, BBQ
ðŸ’µ ÄÆ N Vá»Š: USD, miles, Â°F, pounds, inches

âŒ KHÃ”NG: Zalo, xe mÃ¡y, VNÄ, chá»£, Grab, MoMo, xÆ°ng hÃ´ bá»‘/máº¹/con kiá»ƒu VN`;
  }

  if (market.includes('jp') || market.includes('nháº­t')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: JP (Nháº­t Báº£n)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a Nháº­t:

ðŸ  Bá»I Cáº¢NH: mansion (apartment), 1LDK/2LDK, genkan (lá»‘i vÃ o), tatami room, konbini (7-Eleven, Lawson, FamilyMart), eki (station)
ðŸ“± CÃ”NG NGHá»†: iPhone (chá»§ yáº¿u), LINE app, PayPay, Suica/PASMO, Yahoo! Japan
ðŸ‘¥ HÃ€NH VI: lá»‹ch sá»±, Ã­t nÃ³i tháº³ng, review ká»¹ trÆ°á»›c khi mua, xem YouTube/TikTok, dÃ¹ng LINE thay SMS
ðŸ± Äá»œI Sá»NG: bento, izakaya, daiso, Don Quijote, Uniqlo, shinkansen, cherry blossom
ðŸ’´ ÄÆ N Vá»Š: JPY (Â¥), cm/m, Â°C, kg

âŒ KHÃ”NG: bá»‘i cáº£nh Má»¹/VN, Facebook (Ã­t dÃ¹ng á»Ÿ JP), Ä‘Æ¡n vá»‹ miles/Â°F`;
  }

  if (market.includes('sea') || market.includes('Ä‘Ã´ng nam Ã¡') || market.includes('vn') || market.includes('viá»‡t')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: SEA (ÄÃ´ng Nam Ã)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a ÄÃ´ng Nam Ã:

ðŸ  Bá»I Cáº¢NH: chung cÆ°, nhÃ  phá»‘, quÃ¡n cÃ  phÃª, chá»£, trung tÃ¢m thÆ°Æ¡ng máº¡i
ðŸ“± CÃ”NG NGHá»†: Ä‘a dáº¡ng Android/iPhone, Shopee, Grab, GoPay/Momo/GCash, TikTok Shop, Facebook Messenger, Zalo (VN), Line (TH)
ðŸ‘¥ HÃ€NH VI: hay xem review TikTok, mua hÃ ng qua livestream, chia sáº» qua group chat, giÃ¡ cáº£ quan trá»ng
ðŸœ Äá»œI Sá»NG: xe mÃ¡y, street food, trÃ  sá»¯a, karaoke, phá»Ÿ/pad thai/nasi goreng
ðŸ’µ ÄÆ N Vá»Š: VND/THB/PHP/IDR, km, Â°C, kg

âŒ KHÃ”NG: bá»‘i cáº£nh Má»¹/Nháº­t, suburban house, Target/Walmart, miles/Â°F`;
  }

  if (market.includes('eu') || market.includes('chÃ¢u Ã¢u') || market.includes('de') || market.includes('Ä‘á»©c') || market.includes('fr') || market.includes('phÃ¡p')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: EU (ChÃ¢u Ã‚u)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a ChÃ¢u Ã‚u:

ðŸ  Bá»I Cáº¢NH: flat/apartment, terraced house, city centre, public transport
ðŸ“± CÃ”NG NGHá»†: iPhone/Samsung, WhatsApp (chá»§ yáº¿u), Apple Pay, Revolut, N26
ðŸ‘¥ HÃ€NH VI: quan tÃ¢m privacy/GDPR, dÃ¹ng WhatsApp thay SMS, cÃ  phÃª/pub culture, football
ðŸ• Äá»œI Sá»NG: IKEA, Zara, H&M, Lidl/Aldi, Tesco/Carrefour, train/metro
ðŸ’¶ ÄÆ N Vá»Š: EUR (â‚¬)/GBP (Â£), km, Â°C, kg

âŒ KHÃ”NG: bá»‘i cáº£nh Má»¹/chÃ¢u Ã, Target/Walmart, miles/Â°F, tipping culture`;
  }

  if (market.includes('kr') || market.includes('hÃ n') || market.includes('korea')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: KR (HÃ n Quá»‘c)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a HÃ n Quá»‘c:

ðŸ  Bá»I Cáº¢NH: apartment (ì•„íŒŒíŠ¸), officetel, PC bang, cafe, subway station
ðŸ“± CÃ”NG NGHá»†: Samsung/iPhone, KakaoTalk, Naver, Toss (payment), Coupang
ðŸ‘¥ HÃ€NH VI: aesthetics quan trá»ng, review trÃªn Naver blog, xem YouTube, K-beauty, skincare
ðŸ² Äá»œI Sá»NG: chicken + beer, convenience store (CU/GS25), Olive Young, Daiso, subway
ðŸ’´ ÄÆ N Vá»Š: KRW (â‚©), cm/m, Â°C, kg

âŒ KHÃ”NG: bá»‘i cáº£nh Má»¹/VN, Facebook (Ã­t phá»• biáº¿n), miles/Â°F`;
  }

  if (market.includes('latam') || market.includes('má»¹ latin') || market.includes('brazil') || market.includes('mexico')) {
    return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: LATAM (Má»¹ Latin)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»ŒI chi tiáº¿t pháº£i PHÃ™ Há»¢P vÄƒn hÃ³a Má»¹ Latin:

ðŸ  Bá»I Cáº¢NH: casa/apartment, tienda, mercado, plaza, centro comercial
ðŸ“± CÃ”NG NGHá»†: Android phá»• biáº¿n hÆ¡n iPhone, WhatsApp (chÃ­nh), Mercado Pago, Pix (Brazil), TikTok
ðŸ‘¥ HÃ€NH VI: gia Ä‘Ã¬nh quan trá»ng, nhÃ³m WhatsApp gia Ä‘Ã¬nh, telenovela, football, giÃ¡ ráº» = key
ðŸŒ® Äá»œI Sá»NG: taco/empanada/aÃ§aÃ­, Oxxo (Mexico), farmÃ¡cia, transporte pÃºblico
ðŸ’µ ÄÆ N Vá»Š: BRL/MXN/ARS, km, Â°C, kg

âŒ KHÃ”NG: bá»‘i cáº£nh Má»¹/chÃ¢u Ã, Apple Pay (Ã­t dÃ¹ng), miles/Â°F`;
  }

  // Fallback: generic international
  return `â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ THá»Š TRÆ¯á»œNG Má»¤C TIÃŠU: ${targetMarket.join(', ')}
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
HÃ£y Ä‘iá»u chá»‰nh bá»‘i cáº£nh, vÄƒn hÃ³a, cÃ´ng nghá»‡, hÃ nh vi, Ä‘Æ¡n vá»‹ Ä‘o lÆ°á»ng cho PHÃ™ Há»¢P vá»›i thá»‹ trÆ°á»ng "${targetMarket.join(', ')}".
KHÃ”NG máº·c Ä‘á»‹nh dÃ¹ng bá»‘i cáº£nh Má»¹ náº¿u thá»‹ trÆ°á»ng khÃ¡c.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // === MODE: REFINE (AI chá»‰nh sá»­a idea cÃ³ sáºµn) ===
    if (body.mode === 'refine') {
      const { originalIdea, instruction, appName, appCategory, selectedModel } = body;
      const refinePrompt = `[ROLE] Báº¡n lÃ  Senior Creative Strategist. User muá»‘n CHá»ˆNH Sá»¬A má»™t idea quáº£ng cÃ¡o video.

[APP] "${appName}" â€” Category: "${appCategory || 'General'}"

[IDEA Gá»C]
${JSON.stringify(originalIdea, null, 2)}

[YÃŠU Cáº¦U CHá»ˆNH Sá»¬A Tá»ª USER]
"${instruction}"

[NHIá»†M Vá»¤]
1. Äá»c hiá»ƒu idea gá»‘c vÃ  yÃªu cáº§u chá»‰nh sá»­a
2. Ãp dá»¥ng ÄÃšNG yÃªu cáº§u chá»‰nh sá»­a â€” chá»‰ thay Ä‘á»•i pháº§n user yÃªu cáº§u, giá»¯ nguyÃªn pháº§n khÃ´ng Ä‘á» cáº­p
3. Giá»¯ NGUYÃŠN JSON structure y há»‡t idea gá»‘c
4. Script váº«n pháº£i viáº¿t kiá»ƒu Ká»ŠCH Báº¢N LIá»€N Máº CH vá»›i [VOICE], [TEXT OVERLAY], [SFX]
5. Tráº£ vá» ÄÃšNG 1 JSON object (KHÃ”NG pháº£i array). KHÃ”NG markdown. KHÃ”NG giáº£i thÃ­ch.

âš ï¸ QUAN TRá»ŒNG:
- Emotion má»¥c tiÃªu = cáº£m xÃºc mÃ  NGÆ¯á»œI XEM cáº£m nháº­n khi xem video, KHÃ”NG pháº£i cáº£m xÃºc nhÃ¢n váº­t diá»…n
- Visual pháº£i thá»±c táº¿, dá»… quay (UGC style), KHÃ”NG cinematic/TVC
- Náº¿u user yÃªu cáº§u Ä‘á»•i emotion â†’ thiáº¿t káº¿ láº¡i hook Ä‘á»ƒ trigger Ä‘Ãºng emotion Má»šI cho viewer`;

      const text = await askAI(refinePrompt, {
        model: resolveModel(selectedModel),
        temperature: 0.7,
        max_tokens: 8192,
        useCreativePersona: false,
      });
      if (!text) return NextResponse.json({ error: 'AI khÃ´ng pháº£n há»“i' }, { status: 500 });
      const parsed = parseJson(text);
      if (!parsed) return NextResponse.json({ error: 'KhÃ´ng parse Ä‘Æ°á»£c' }, { status: 500 });
      return NextResponse.json({ success: true, data: parsed });
    }

    // === MODE: GENERATE ANGLES (táº¡o angle tá»« painpoint) ===
    if (body.mode === 'generate-angles') {
      const { appName, appCategory, painpoints, coreUsers, emotions } = body;
      const pps = (painpoints || []).join('; ');
      const anglePrompt = `Táº¡o angle quáº£ng cÃ¡o cho app "${appName}" (${appCategory || 'App'}).
Painpoints: ${pps}
Core Users: ${(coreUsers || []).join('; ')}
Emotions: ${(emotions || []).join('; ')}

Vá»›i má»—i painpoint táº¡o 3 angle ngáº¯n (10-15 tá»«), má»—i angle dÃ¹ng cÃ¡ch tiáº¿p cáº­n khÃ¡c nhau (Fear, FOMO, Social Proof, So sÃ¡nh, Humor, Challenge...).
VÃ­ dá»¥: ["Sá»£ hÃ£i: Äang ngá»§ mÃ  nhá»‹p tim báº¥t thÆ°á»ng", "FOMO: Ai cÅ©ng dÃ¹ng app nÃ y rá»“i"]

Tráº£ JSON array of strings. KHÃ”NG markdown.`;

      try {
        // Use fast model with short timeout (3-7s instead of 20-30s)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(`${process.env.AI_BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.AI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'openai/gpt-4.1',
            messages: [{ role: 'user', content: anglePrompt }],
            temperature: 0.85,
            max_tokens: 1024,
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) {
            const parsed = parseJson(text);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return NextResponse.json({ success: true, angles: parsed });
            }
          }
        }
      } catch (e) {
        console.error('[generate-angles] AI error:', e);
      }
      // Fallback: generate locally
      const fallback = (painpoints || []).flatMap((pp: string) => [
        `Sá»£ hÃ£i: ${pp}`,
        `Giáº£i phÃ¡p cho: ${pp}`,
        `So sÃ¡nh trÆ°á»›c/sau: ${pp}`,
      ]);
      return NextResponse.json({ success: true, angles: fallback });
    }

    // === MODE: GENERATE (táº¡o idea má»›i) ===
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge, selectedModel, trendingTopics } = body;
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = Math.min(config?.quantity || 3, 5); // Cap at 5 to avoid gateway timeout
    const duration = config?.duration || '30s';
    const visualType = config?.visualType || 'UGC (NgÆ°á»i tháº­t)';
    const targetLang = detectLang(filters?.coreUser);
    const marketContext = buildMarketContext(filters?.targetMarket);

    // Truncate knowledge to avoid prompt overflow
    const rawKnowledge = appKnowledge || '';
    const truncatedKnowledge = rawKnowledge.length > 3000 ? rawKnowledge.substring(0, 3000) + '\n[...truncated]' : rawKnowledge;

    const knowledgeBlock = truncatedKnowledge
      ? `\n[APP BRAIN â€” Kiáº¿n thá»©c AI Ä‘Ã£ há»c cho app "${appName}". NGUá»’N THAM KHáº¢O #1.]\n${truncatedKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas
      ? `\n[IDEAS Gáº¦N ÄÃ‚Y â€” Há»c phong cÃ¡ch, nÃ¢ng cáº¥p, KHÃ”NG láº·p láº¡i]\n${previousIdeas}\n`
      : '';

    const trendingBlock = trendingTopics?.length
      ? `\n[TRENDING HIá»†N Táº I â€” Káº¾T Há»¢P Náº¾U PHÃ™ Há»¢P]\n${trendingTopics.join(', ')}\nâ†’ Káº¿t há»£p trend vÃ o tÃ¬nh huá»‘ng/hook náº¿u tá»± nhiÃªn. KHÃ”NG Ã©p trend vÃ o náº¿u khÃ´ng phÃ¹ há»£p vá»›i painpoint/emotion Ä‘Ã£ chá»n.\n`
      : '';

    const prompt = `[ROLE] Báº¡n lÃ  Senior Creative Strategist chuyÃªn táº¡o Production Brief cho Meta/TikTok Video Ads.
Output cá»§a báº¡n PHáº¢I giá»‘ng há»‡t má»™t dÃ²ng trong Google Sheet production mÃ  team editor Ä‘á»c xong cÃ³ thá»ƒ quay/gen ngay â€” khÃ´ng cáº§n há»i thÃªm.
${knowledgeBlock}
${ideasBlock}
${trendingBlock}

[APP] "${appName}" â€” Category: "${appCategory || 'General'}"
[PSP] ${featureContext}
[CORE USER] ${filters?.coreUser?.join(', ') || 'General'}
[PAINPOINT] ${filters?.painPoint?.join(', ') || 'General'}
[EMOTION Má»¤C TIÃŠU â€” Cáº¢M XÃšC PHáº¢I Táº O RA CHO NGÆ¯á»œI XEM] ${filters?.emotion?.join(', ') || 'General'}
[Dáº NG VISUAL] ${visualType}
[NGÃ”N NGá»® Má»¤C TIÃŠU] ${targetLang}
[MÃ” Táº¢ Bá»” SUNG] ${config?.ideaDescription || 'Creative Freedom'}
[Sá» LÆ¯á»¢NG] ${quantity} ideas

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #1: EMOTION = Cáº¢M XÃšC Cá»¦A NGÆ¯á»œI XEM (VIEWER), KHÃ”NG PHáº¢I NHÃ‚N Váº¬T (ACTOR)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸âš ï¸âš ï¸ ÄÃ‚Y LÃ€ RULE QUAN TRá»ŒNG NHáº¤T âš ï¸âš ï¸âš ï¸

EMOTION Má»¤C TIÃŠU LÃ€: ${filters?.emotion?.join(', ') || 'General'}
â†’ ÄÃ¢y lÃ  cáº£m xÃºc mÃ  NGÆ¯á»œI ÄANG LÆ¯á»šT FEED pháº£i Cáº¢M NHáº¬N khi xem hook.
â†’ KHÃ”NG PHáº¢I cáº£m xÃºc nhÃ¢n váº­t trong video diá»…n ra.

âŒ SAI: MÃ´ táº£ nhÃ¢n váº­t "run ráº©y, hoáº£ng sá»£, khÃ³c lÃ³c, stress" â†’ Ä‘Ã¢y lÃ  DIá»„N XUáº¤T cá»§a actor, KHÃ”NG liÃªn quan Ä‘áº¿n viewer
âœ… ÄÃšNG: Thiáº¿t káº¿ TÃŒNH HUá»NG + CÃCH Ká»‚ CHUYá»†N khiáº¿n NGÆ¯á»œI XEM cáº£m tháº¥y emotion má»¥c tiÃªu

ðŸ“Œ CÃCH Táº O EMOTION CHO VIEWER THEO Tá»ªNG LOáº I:

ðŸ” TÃ’ MÃ’ (Curious) â€” VIEWER pháº£i Tá»° Há»ŽI "cÃ¡i gÃ¬ váº­y? pháº£i xem tiáº¿p!":
   â†’ DÃ¹ng: CURIOSITY GAP â€” cho tháº¥y 1 pháº§n káº¿t quáº£ báº¥t ngá» nhÆ°ng Cáº®T NGANG, khÃ´ng reveal háº¿t
   â†’ DÃ¹ng: reaction báº¥t ngá» "Wait what?!", before/after tease, "I didn't expect this"
   â†’ DÃ¹ng: Expert/authority figure nghi ngá» rá»“i bá»‹ Báº¤T NGá»œ
   â†’ VD: NgÆ°á»i quay UGC chá»¥p bathroom cÅ© â†’ app render káº¿t quáº£ â†’ Máº®T Má»ž TO "No way..." â†’ Cáº®T, khÃ´ng cho tháº¥y káº¿t quáº£
   â†’ âŒ KHÃ”NG: mÃ´ táº£ nhÃ¢n váº­t sá»£ hÃ£i, stress, khÃ³c â€” Ä‘Ã³ KHÃ”NG táº¡o tÃ² mÃ² cho viewer

ðŸ˜± Sá»¢ HÃƒI (Fear) â€” VIEWER pháº£i cáº£m tháº¥y Äá»’NG Cáº¢M + LO CHO MÃŒNH:
   â†’ DÃ¹ng: tÃ¬nh huá»‘ng relatable mÃ  viewer tá»± tháº¥y "trá»i Æ¡i mÃ¬nh cÅ©ng cÃ³ thá»ƒ bá»‹ váº­y"
   â†’ KHÃ”NG dÃ¹ng: mÃ´ táº£ nhÃ¢n váº­t run ráº©y á»›n láº¡nh kiá»ƒu horror movie
   â†’ VD: UGC bÃ¬nh thÆ°á»ng, ngÆ°á»i quay cho tháº¥y screen phone hiá»‡n cáº£nh bÃ¡o "storage 99% full" â†’ "TÃ´i suÃ½t máº¥t háº¿t áº£nh..."

ðŸ¤© FOMO â€” VIEWER pháº£i cáº£m tháº¥y "má»i ngÆ°á»i biáº¿t háº¿t rá»“i trá»« mÃ¬nh":
   â†’ DÃ¹ng: social proof, before/after dramatic, "why didn't anyone tell me about this?"
   â†’ VD: "My neighbor showed me this app..." â†’ káº¿t quáº£ wow â†’ viewer: "mÃ¬nh cÅ©ng pháº£i thá»­"

ðŸ¤¯ SHOCK â€” VIEWER pháº£i "KHÃ”NG THá»‚ TIN":
   â†’ DÃ¹ng: contrast máº¡nh, con sá»‘ báº¥t ngá», reveal báº¥t ngá»
   â†’ VD: "This FREE app just did what my $5000 interior designer did" â†’ before/after

ðŸ˜¢ Äá»’NG Cáº¢M â€” VIEWER pháº£i tháº¥y MÃŒNH trong video:
   â†’ DÃ¹ng: tÃ¬nh huá»‘ng quen thuá»™c, "ai cÅ©ng tá»«ng tráº£i qua"
   â†’ VD: Bá»‘ giÃ  loay hoay vá»›i phone, con gÃ¡i thá»Ÿ dÃ i â†’ viewer 35+: "Ä‘Ãºng bá»‘ mÃ¬nh luÃ´n"

âš ï¸ EMOTION CHECKPOINT â€” Tá»° KIá»‚M TRA TRÆ¯á»šC KHI OUTPUT:
â†’ Äá»c láº¡i hook: Má»˜T NGÆ¯á»œI ÄANG LÆ¯á»šT TIKTOK/REELS sáº½ Cáº¢M NHáº¬N "${filters?.emotion?.join(', ') || 'General'}" CHÆ¯A?
â†’ Náº¿u hook chá»‰ mÃ´ táº£ nhÃ¢n váº­t stress/sá»£ hÃ£i riÃªng â†’ viewer KHÃ”NG tá»± Ä‘á»™ng cáº£m tháº¥y gÃ¬ â†’ SAI
â†’ Hook pháº£i thiáº¿t káº¿ Ä‘á»ƒ viewer Tá»° cáº£m nháº­n emotion thÃ´ng qua: curiosity gap, relatable situation, social proof, shock value

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #2: HOOK FORMULA â€” NHÃ‚N Váº¬T + PAINPOINT + VIEWER EMOTION
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Hook = NHÃ‚N Váº¬T (core user) Gáº¶P PAINPOINT â†’ nhÆ°ng CÃCH Ká»‚ pháº£i trigger EMOTION cho VIEWER.

ðŸ”º Báº®T BUá»˜C:
1. NHÃ‚N Váº¬T KHá»šP CORE USER: Náº¿u Core User = "Phá»¥ ná»¯ 35-45" â†’ nhÃ¢n váº­t pháº£i lÃ  phá»¥ ná»¯ 35-45
2. PAINPOINT HIá»†N QUA TÃŒNH HUá»NG: NhÃ¢n váº­t Ä‘ang gáº·p painpoint trong tÃ¬nh huá»‘ng Äá»œI THÆ¯á»œNG, THá»°C Táº¾
3. CÃCH Ká»‚ trigger VIEWER EMOTION: KhÃ´ng pháº£i nhÃ¢n váº­t diá»…n emotion â†’ mÃ  CÃCH Ká»‚ CHUYá»†N táº¡o emotion cho viewer

â†’ Hook KHÃ”NG giá»›i thiá»‡u app. App chá»‰ xuáº¥t hiá»‡n á»Ÿ BODY vÃ  CTA.

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #3: HOOK PHáº¢I ÄÃNH ÄÃšNG PAINPOINT ÄÃƒ CHá»ŒN â€” KHÃ”NG THAY THáº¾
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Visual type Ä‘Ã£ chá»n: ${visualType}

âš ï¸âš ï¸âš ï¸ RULE QUAN TRá»ŒNG NHáº¤T:
PAINPOINT ÄÃƒ CHá»ŒN: "${filters?.painPoint?.join(', ') || 'General'}"
APP: "${appName}" (${appCategory || 'General'})
CORE USER: ${filters?.coreUser?.join(', ') || 'General'}

â†’ Hook PHáº¢I Ä‘Ã¡nh ÄÃšNG painpoint "${filters?.painPoint?.join(', ') || 'General'}" cho Ä‘Ãºng core user.
â†’ KHÃ”NG ÄÆ¯á»¢C thay tháº¿ báº±ng painpoint khÃ¡c dÃ¹ cÃ³ liÃªn quan.

ðŸ“Œ CÃCH HIá»‚U PAINPOINT â€” Äá»ŒC Ká»¸ VÃ€ DIá»„N GIáº¢I ÄÃšNG:
1. Äá»c painpoint tá»« filter: "${filters?.painPoint?.join(', ') || 'General'}"
2. Tá»° Há»ŽI: Painpoint nÃ y NGHÄ¨A LÃ€ GÃŒ trong Ä‘á»i thá»±c cá»§a core user?
3. TÃ¬nh huá»‘ng nÃ o HÃ€NG NGÃ€Y mÃ  core user Gáº¶P painpoint nÃ y?
4. Há» NÃ“I GÃŒ, LÃ€M GÃŒ khi Ä‘ang gáº·p painpoint nÃ y?
5. Hook pháº£i DIá»„N Táº¢ Ä‘Ãºng khoáº£nh kháº¯c Ä‘Ã³.

âš ï¸ NGUYÃŠN Táº®C DIá»„N GIáº¢I PAINPOINT:
- Äá»c painpoint THEO NGHÄ¨A ÄEN â€” nÃ³ nÃ³i gÃ¬ thÃ¬ hook pháº£i nÃ³i vá» cÃ¡i Ä‘Ã³
- KHÃ”NG tá»± suy diá»…n sang váº¥n Ä‘á» liÃªn quan nhÆ°ng KHÃC Báº¢N CHáº¤T

VÃ Dá»¤ CÃCH DIá»„N GIáº¢I ÄÃšNG (Ã¡p dá»¥ng cho Báº¤T Ká»² APP NÃ€O):

VÃ­ dá»¥ app Ä‚N Uá»NG â€” painpoint "Ä‚n uá»‘ng máº¥t kiá»ƒm soÃ¡t":
= NgÆ°á»i dÃ¹ng Ä‚N KHÃ”NG KIá»‚M SOÃT ÄÆ¯á»¢C â€” Äƒn theo cáº£m xÃºc, Äƒn snack Ä‘Ãªm, Äƒn quÃ¡ nhiá»u rá»“i há»‘i háº­n
â†’ TÃŒNH HUá»NG: Äang buá»“n/stress â†’ má»Ÿ tá»§ láº¡nh lÃºc ná»­a Ä‘Ãªm â†’ Äƒn háº¿t gÃ³i snack â†’ nhÃ¬n bao bÃ¬ trá»‘ng â†’ thá»Ÿ dÃ i
â†’ KHÃ”NG PHáº¢I: "muá»‘n giáº£m cÃ¢n" (Ä‘Ã³ lÃ  Má»¤C TIÃŠU, khÃ¡c vá»›i painpoint "máº¥t kiá»ƒm soÃ¡t")
â†’ KHÃ”NG PHáº¢I: "khÃ´ng biáº¿t náº¥u gÃ¬" (Ä‘Ã³ lÃ  painpoint khÃ¡c)

VÃ­ dá»¥ app Ä‚N Uá»NG â€” painpoint "TÄƒng cÃ¢n láº¡i dÃ¹ Ä‘Ã£ tá»«ng cá»‘ giáº£m":
= NgÆ°á»i dÃ¹ng ÄÃƒ GIáº¢M THÃ€NH CÃ”NG rá»“i nhÆ°ng TÄ‚NG Láº I â€” yo-yo dieting, tháº¥t vá»ng, tá»± há»i "sao láº§n nÃ o cÅ©ng váº­y"
â†’ TÃŒNH HUá»NG: CÃ¢n náº·ng Ä‘o sÃ¡ng nay lÃªn 5 pounds so vá»›i thÃ¡ng trÆ°á»›c â€” dÃ¹ Ä‘ang cá»‘. NhÃ¬n áº£nh cÅ© lÃºc Ä‘Ã£ slim.
â†’ KHÃ”NG PHáº¢I: "sá»£ máº¯c bá»‡nh" (Ä‘Ã³ lÃ  painpoint sá»©c khá»e, khÃ¡c)

VÃ­ dá»¥ app THIáº¾T Káº¾ â€” painpoint "Ko biáº¿t thiáº¿t káº¿":
= KHÃ”NG BIáº¾T chá»n style gÃ¬, phá»‘i mÃ u ra sao â†’ confused, overwhelmed
â†’ TÃŒNH HUá»NG: lÆ°á»›t Pinterest 3 giá» mÃ  váº«n 0 quyáº¿t Ä‘á»‹nh
â†’ KHÃ”NG PHáº¢I: "tá»‘n tiá»n designer" (Ä‘Ã³ lÃ  painpoint TÃ€I CHÃNH, khÃ¡c)

âŒ Lá»–I SAI HAY Gáº¶P â€” AI THÆ¯á»œNG TRá»˜N LáºªN PAINPOINT:
- Painpoint = "Ä‚n máº¥t kiá»ƒm soÃ¡t" â†’ AI gen hook vá» "tá»‘n tiá»n Äƒn ngoÃ i" â†’ âŒ SAI (Ä‘Ã³ lÃ  painpoint tÃ i chÃ­nh)
- Painpoint = "TÄƒng cÃ¢n láº¡i" â†’ AI gen hook vá» "khÃ´ng biáº¿t náº¥u gÃ¬" â†’ âŒ SAI (Ä‘Ã³ lÃ  painpoint ká»¹ nÄƒng)
- Painpoint = "Ko biáº¿t thiáº¿t káº¿" â†’ AI gen hook vá» "tá»‘n tiá»n contractor" â†’ âŒ SAI (Ä‘Ã³ lÃ  painpoint tÃ i chÃ­nh)
- Má»—i painpoint lÃ  Má»˜T Váº¤N Äá»€ Cá»¤ THá»‚, RIÃŠNG BIá»†T. KHÃ”NG TRá»˜N LáºªN.

ðŸ“ CÃCH PAINPOINT PHáº¢I HIá»†N TRONG HOOK:
1. Painpoint hiá»‡n qua HÃ€NH Äá»˜NG + Lá»œI NÃ“I Tá»° NHIÃŠN (khÃ´ng mÃ´ táº£ suÃ´ng)
2. TÃ¬nh huá»‘ng THá»°C Táº¾ â€” xáº£y ra tá»± nhiÃªn trong Ä‘á»i thÆ°á»ng cá»§a core user
3. Core user (viewer) pháº£i NHáº¬N RA NGAY "Ã  Ä‘Ãºng rá»“i mÃ¬nh cÅ©ng bá»‹ váº­y!"
4. KHÃ”NG setup giáº£ táº¡o, khÃ´ng diá»…n ká»‹ch

ðŸ“ CHECKLIST TRÆ¯á»šC KHI OUTPUT:
â–¡ Hook Ä‘ang nÃ³i Vá»€ ÄÃšNG painpoint "${filters?.painPoint?.join(', ') || 'General'}" chÆ°a?
â–¡ Hay Ä‘ang láº¡c sang painpoint KHÃC (dÃ¹ liÃªn quan)?
â–¡ TÃ¬nh huá»‘ng cÃ³ xáº£y ra Tá»° NHIÃŠN trong Ä‘á»i core user khÃ´ng?
â–¡ Core user cÃ³ NHáº¬N RA MÃŒNH khÃ´ng?

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #4: CREATIVE TYPE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Má»—i idea PHáº¢I thuá»™c 1 kiá»ƒu: UGC / POV / Split Screen / Interview / Reaction / ASMR / Trend Format / Social Proof / Challenge

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #5: VOICE PHáº¢I Tá»° NHIÃŠN â€” NHÆ¯ NGÆ¯á»œI THáº¬T NÃ“I
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ Voice/script lÃ  yáº¿u tá»‘ quan trá»ng nháº¥t. Náº¿u voice nghe GIáº¢ â†’ toÃ n bá»™ hook tháº¥t báº¡i.

âœ… VOICE Tá»° NHIÃŠN â€” nghe nhÆ° ngÆ°á»i tháº­t nÃ³i vá»›i báº¡n bÃ¨/camera:
- CÃ³ ngáº­p ngá»«ng, cÃ³ "um", "like", "okay so..."
- CÃ¢u ngáº¯n, Ä‘á»©t quÃ£ng, khÃ´ng hoÃ n chá»‰nh ngá»¯ phÃ¡p
- Giá»ng Ä‘iá»‡u phÃ¹ há»£p tÃ¬nh huá»‘ng (bá»±c bá»™i, hÃ o há»©ng, thÃ¬ tháº§m, deadpan)
- Pháº£n á»©ng cáº£m xÃºc THáº¬T â€” khÃ´ng diá»…n

âŒ VOICE GIáº¢ â€” nghe nhÆ° script quáº£ng cÃ¡o:
- Concept name trong voice ("bÃ i kiá»ƒm tra sai láº§m", "thá»­ thÃ¡ch 30 ngÃ y") â†’ khÃ´ng ai nÃ³i tháº¿
- QuÃ¡ formal ("TrÆ°á»›c khi tÃ´i báº¯t Ä‘áº§u hÃ nh trÃ¬nh...") â†’ khÃ´ng pháº£i UGC
- Má»Ÿ Ä‘áº§u kiá»ƒu youtuber ("ChÃ o má»i ngÆ°á»i, hÃ´m nay tÃ´i sáº½...")
- Tá»± monologue trÆ°á»›c camera khÃ´ng tá»± nhiÃªn

${marketContext}

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
RULE #7: FORMAT "SCRIPT" â€” Ká»ŠCH Báº¢N HÃ€NH Äá»˜NG LIá»€N Máº CH (QUAN TRá»ŒNG)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ KHÃ”NG viáº¿t tÃ¡ch rá»i Visual / Text / Voice thÃ nh cÃ¡c Ä‘oáº¡n riÃªng biá»‡t.
âš ï¸ KHÃ”NG viáº¿t 3 options cho text (Op1/Op2/Op3). CHá»ˆ 1 TEXT DUY NHáº¤T.

Má»—i section (hook, body, cta) dÃ¹ng field "script" = Má»˜T Ká»ŠCH Báº¢N HÃ€NH Äá»˜NG Cá»¤ THá»‚.
Viáº¿t nhÆ° STORYBOARD â€” Má»–I CÃ‚U LÃ€ 1 HÃ€NH Äá»˜NG theo TIMELINE.
Voice/text xen káº½ trong flow â€” KHÃ”NG tÃ¡ch ra sau.

ðŸ“ QUY Táº®C VIáº¾T SCRIPT:
1. Má»ž Äáº¦U = ai, á»Ÿ Ä‘Ã¢u, Ä‘ang lÃ m gÃ¬ (1 cÃ¢u, Äá»œI THÆ¯á»œNG)
2. HÃ nh Ä‘á»™ng liÃªn tá»¥c theo timeline, voice ÄÃšNG LÃšC nhÃ¢n váº­t nÃ³i
3. [VOICE] chÃ¨n ÄÃšNG thá»i Ä‘iá»ƒm nhÃ¢n váº­t nÃ³i
4. [TEXT OVERLAY] chÃ¨n Äá»‚ CHá»ˆ RÃ• text hiá»‡n lÃºc nÃ o
5. Cáº®T ngang / transition / reveal = viáº¿t rÃµ
6. Painpoint hiá»‡n qua HÃ€NH Äá»˜NG + Lá»œI NÃ“I Tá»° NHIÃŠN

ðŸ“Œ PAINPOINT = KHOáº¢NH KHáº®C, KHÃ”NG PHáº¢I MÃ” Táº¢:
âŒ SAI: "CÃ´ Ä‘á»©ng trong báº¿p, cÃ´ muá»‘n giáº£m cÃ¢n." â†’ mÃ´ táº£ suÃ´ng, khÃ´ng cÃ³ hÃ nh Ä‘á»™ng
âŒ SAI: "Anh ngá»“i nhÃ¬n cÃ¢n náº·ng tÄƒng." â†’ setup giáº£ táº¡o
âœ… ÄÃšNG: Khoáº£nh kháº¯c Äá»œI THÆ¯á»œNG â€” Ä‘ang lÃ m gÃ¬ Ä‘Ã³ bÃ¬nh thÆ°á»ng â†’ painpoint Báº¬T RA tá»± nhiÃªn qua hÃ nh Ä‘á»™ng/lá»i nÃ³i

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âŒ TUYá»†T Äá»I KHÃ”NG VIáº¾T KIá»‚U SAI NÃ€Y:
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

SAI 1 â€” Láº C PAINPOINT (Lá»–I NGHIÃŠM TRá»ŒNG NHáº¤T):
Painpoint Ä‘Ã£ chá»n lÃ  A â†’ nhÆ°ng hook láº¡i nÃ³i vá» B (dÃ¹ B liÃªn quan)
â†’ âŒ Má»–I PAINPOINT LÃ€ Má»˜T Váº¤N Äá»€ RIÃŠNG. KHÃ”NG TRá»˜N LáºªN.

SAI 2 â€” SETUP QUÃ RÃ•:
NhÃ¢n váº­t cá»‘ tÃ¬nh táº¡o tÃ¬nh huá»‘ng Ä‘á»ƒ nÃ³i vá» painpoint trÆ°á»›c camera
â†’ âŒ KhÃ´ng ai monologue trÆ°á»›c camera. Painpoint pháº£i xuáº¥t hiá»‡n Tá»° NHIÃŠN.

SAI 3 â€” Äáº¶T TÃŠN CONCEPT:
"We're running the 'XYZ' test/challenge"
â†’ âŒ KhÃ´ng ai Ä‘áº·t tÃªn hÃ nh Ä‘á»™ng mÃ¬nh. ÄÃ¢y lÃ  copywriting.

SAI 4 â€” Copy vÃ­ dá»¥ cÅ©:
â†’ âŒ KHÃ”NG copy láº¡i báº¥t cá»© vÃ­ dá»¥ nÃ o. Pháº£i Táº O Má»šI dá»±a trÃªn painpoint, app, core user ÄÃƒ CHá»ŒN.

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ RULE: HOOK PHáº¢I CÃ“ PHÃ‚N TÃCH â€” FOCUS VIEWER
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Hook PHáº¢I KÃˆM PHÃ‚N TÃCH chi tiáº¿t vá» VIEWER (ngÆ°á»i Ä‘ang lÆ°á»›t feed), KHÃ”NG pháº£i nhÃ¢n váº­t:
- "viewerProfile": Ai Ä‘ang LÆ¯á»šT FEED sáº½ dá»«ng láº¡i? (tuá»•i, giá»›i, hÃ nh vi, bá»‘i cáº£nh sá»‘ng â€” Cá»¤ THá»‚)
- "viewerEmotion": VIEWER cáº£m nháº­n gÃ¬ khi xem hook? MÃ´ táº£ hÃ nh trÃ¬nh cáº£m xÃºc Cá»¦A VIEWER: há» Tá»° Há»ŽI gÃ¬, LIÃŠN TÆ¯á»žNG gÃ¬, MUá»N BIáº¾T gÃ¬ tiáº¿p
- "painpointImpact": VIEWER tá»± tháº¥y mÃ¬nh á»Ÿ Ä‘Ã¢u trong tÃ¬nh huá»‘ng? Há» liÃªn tÆ°á»Ÿng Ä‘áº¿n váº¥n Ä‘á» nÃ o Cá»¦A Há»Œ?
- "whyTheyStopScrolling": Táº¡i sao VIEWER Dá»ªNG SCROLL? (curiosity gap, relatable, shock value...)

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
âš ï¸ RULE NGÃ”N NGá»®: PHáº¢I CÃ“ Báº¢N Dá»ŠCH TIáº¾NG VIá»†T
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Voice/text overlay viáº¿t báº±ng ${targetLang} (ngÃ´n ngá»¯ target).
NHÆ¯NG Báº®T BUá»˜C kÃ¨m báº£n dá»‹ch tiáº¿ng Viá»‡t ("viTranslation") cho Má»ŒI script.
â†’ Team VN Ä‘á»c hiá»ƒu nhanh, khÃ´ng cáº§n tra tá»« Ä‘iá»ƒn.

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Cáº¤U TRÃšC VIDEO ${duration}
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ðŸŽ£ HOOK (3-5s): script ká»‹ch báº£n â†’ Táº O EMOTION CHO VIEWER
ðŸ“– BODY (10-25s): script ká»‹ch báº£n â†’ DEMO PSP giáº£i quyáº¿t Painpoint
ðŸ”¥ CTA (3-5s): script ká»‹ch báº£n â†’ KÃŠU Gá»ŒI HÃ€NH Äá»˜NG

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
OUTPUT FORMAT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Tráº£ vá» ÄÃšNG ${quantity} objects trong JSON ARRAY.
KHÃ”NG markdown. KHÃ”NG giáº£i thÃ­ch thÃªm.
Framework/explanation/phÃ¢n tÃ­ch = TIáº¾NG VIá»†T. Script voice/text = ${targetLang}.

[{
  "id": 1,
  "title": "TÃªn concept ngáº¯n tiáº¿ng Viá»‡t (VD: 'UGC - Chá»“ng cÃ¡ cÆ°á»£c bathroom')",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Reaction / ...",
  "framework": {
    "coreUser": "ChÃ¢n dung viewer TARGET: tuá»•i, giá»›i, hÃ nh vi, bá»‘i cáº£nh (tiáº¿ng Viá»‡t, 2-3 cÃ¢u)",
    "painpoint": "Ná»—i Ä‘au Cá»¤ THá»‚, mÃ´ táº£ tÃ¬nh huá»‘ng thá»±c táº¿ (tiáº¿ng Viá»‡t, 2-3 cÃ¢u)",
    "emotion": "Cáº£m xÃºc mÃ  VIEWER sáº½ Cáº¢M NHáº¬N khi xem hook â€” mÃ´ táº£ hÃ nh trÃ¬nh: viewer nghÄ© gÃ¬, tá»± há»i gÃ¬ (tiáº¿ng Viá»‡t, 2-3 cÃ¢u)",
    "psp": "TÃ­nh nÄƒng app giáº£i quyáº¿t painpoint + cÃ¡ch demo (tiáº¿ng Viá»‡t)"
  },
  "explanation": "Táº¡i sao idea nÃ y hiá»‡u quáº£ + VIEWER emotion trigger báº±ng cÃ¡ch nÃ o (tiáº¿ng Viá»‡t, 3-5 cÃ¢u)",
  "hook": {
    "script": "Ká»ŠCH Báº¢N LIá»€N Máº CH: tÃ¬nh huá»‘ng Äá»œI THÆ¯á»œNG â†’ painpoint THáº¬T hiá»‡n qua HÃ€NH Äá»˜NG + Lá»œI NÃ“I Tá»° NHIÃŠN (khÃ´ng setup giáº£ táº¡o) â†’ VIEWER cáº£m nháº­n emotion. [VOICE báº±ng ${targetLang}, tá»± nhiÃªn nhÆ° ngÆ°á»i tháº­t nÃ³i] + [TEXT OVERLAY báº±ng ${targetLang}] chÃ¨n Ä‘Ãºng lÃºc trong flow. KHÃ”NG copy vÃ­ dá»¥ máº«u. Tá»‘i thiá»ƒu 4-6 cÃ¢u hÃ nh Ä‘á»™ng liÃªn tá»¥c.",
    "textOverlay": "1 cÃ¢u text overlay báº±ng ${targetLang}",
    "viTranslation": "Báº£n dá»‹ch TIáº¾NG VIá»†T cá»§a voice + text overlay trong hook",
    "viewerProfile": "VIEWER ÄANG LÆ¯á»šT FEED lÃ  ai? Tuá»•i, giá»›i, Ä‘ang á»Ÿ Ä‘Ã¢u, Ä‘ang lÃ m gÃ¬? (tiáº¿ng Viá»‡t, 2 cÃ¢u Cá»¤ THá»‚)",
    "viewerEmotion": "VIEWER Cáº¢M NHáº¬N GÃŒ khi xem hook? Há» Tá»° Há»ŽI gÃ¬? MUá»N BIáº¾T gÃ¬ tiáº¿p? MÃ´ táº£ hÃ nh trÃ¬nh cáº£m xÃºc Cá»¤ THá»‚ (tiáº¿ng Viá»‡t, 2-3 cÃ¢u)",
    "painpointImpact": "VIEWER tá»± tháº¥y mÃ¬nh á»Ÿ Ä‘Ã¢u? LiÃªn tÆ°á»Ÿng Ä‘áº¿n váº¥n Ä‘á» gÃ¬ Cá»¦A Há»Œ? (tiáº¿ng Viá»‡t, 2-3 cÃ¢u, nÃªu vÃ­ dá»¥ tÃ¬nh huá»‘ng tháº­t)",
    "whyTheyStopScrolling": "VIEWER dá»«ng scroll vÃ¬ lÃ½ do gÃ¬ Cá»¤ THá»‚? (tiáº¿ng Viá»‡t, 1 cÃ¢u rÃµ rÃ ng)"
  },
  "body": {
    "script": "Ká»ŠCH Báº¢N LIá»€N Máº CH body báº±ng tiáº¿ng Viá»‡t + [VOICE báº±ng ${targetLang}] + [TEXT OVERLAY báº±ng ${targetLang}].",
    "textOverlay": "Text káº¿t quáº£/con sá»‘ báº±ng ${targetLang}",
    "viTranslation": "Báº£n dá»‹ch tiáº¿ng Viá»‡t voice + text overlay trong body"
  },
  "cta": {
    "script": "Ká»ŠCH Báº¢N CTA báº±ng tiáº¿ng Viá»‡t + [VOICE báº±ng ${targetLang}] + [TEXT OVERLAY báº±ng ${targetLang}].",
    "textOverlay": "CTA bold báº±ng ${targetLang}",
    "viTranslation": "Báº£n dá»‹ch tiáº¿ng Viá»‡t voice + text overlay trong CTA",
    "endCard": "${appName} + tagline báº±ng ${targetLang}"
  }
}]`;

    console.log('[generate-ideas] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro');
    const text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: 0.8,
      max_tokens: 16384,
      useCreativePersona: false
    });
    if (!text) {
      console.error('[generate-ideas] AI returned null');
      return NextResponse.json({ error: 'AI khÃ´ng pháº£n há»“i. Thá»­ láº¡i.' }, { status: 500 });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    const parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'KhÃ´ng parse Ä‘Æ°á»£c response. Thá»­ láº¡i.' }, { status: 500 });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook).slice(0, quantity);

    if (valid.length === 0) {
      console.error('[generate-ideas] No valid ideas:', JSON.stringify(arr[0]).substring(0, 200));
      return NextResponse.json({ error: 'AI tráº£ vá» format sai. Thá»­ láº¡i.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
