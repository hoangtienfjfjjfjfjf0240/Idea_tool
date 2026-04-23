import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import { guardApiRequest } from '@/lib/apiGuards';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'generate-thumbnail', max: 40, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const { idea, appName, appCategory } = await request.json();

    if (!idea) {
      return NextResponse.json({ error: 'Missing idea data' }, { status: 400 });
    }

    const hookScript = idea.hook?.script || idea.hook?.visual || '';
    const coreUser = idea.framework?.coreUser || '';
    const painpoint = idea.framework?.painpoint || '';
    const emotion = idea.framework?.emotion || '';
    const creativeType = idea.creativeType || 'UGC';
    const title = idea.title || '';

    const prompt = `You are an expert at writing image generation prompts for AI tools like DALL-E 3 and Midjourney.

Given this video ad concept, create a SINGLE detailed image prompt for generating the HOOK THUMBNAIL — the first frame that grabs attention on TikTok/Instagram Reels.

[CONCEPT]
Title: "${title}"
App: "${appName}" (${appCategory || 'General'})
Creative Type: ${creativeType}
Core User: ${coreUser}
Painpoint: ${painpoint}
Emotion Target: ${emotion}
Hook Script: ${hookScript}

[RULES]
1. The image should capture the HOOK MOMENT — the most attention-grabbing frame
2. Style: ${creativeType === 'UGC' ? 'Realistic smartphone-shot style, natural lighting, candid feel' : 'Cinematic, high production value'}
3. Include: specific person description (age, gender, ethnicity, expression), setting, props, lighting, camera angle
4. The image should make viewers STOP SCROLLING
5. Do NOT include any text/typography in the image description
6. Do NOT mention app names or logos
7. Keep it under 200 words
8. Output ONLY the image prompt, nothing else — no quotes, no explanation

[OUTPUT]
Write the image prompt in English:`;

    const text = await askAI(prompt, {
      model: 'openai/gpt-4.1',
      temperature: 0.7,
      max_tokens: 500,
      useCreativePersona: false,
    });

    if (!text) {
      return NextResponse.json({ error: 'AI không phản hồi' }, { status: 500 });
    }

    // Clean up — remove quotes and extra whitespace
    const imagePrompt = text.replace(/^["']|["']$/g, '').trim();

    return NextResponse.json({ success: true, prompt: imagePrompt });
  } catch (err) {
    console.error('[generate-thumbnail] Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
