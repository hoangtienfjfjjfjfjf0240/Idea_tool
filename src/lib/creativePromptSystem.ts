type PromptFrameworkInput = {
  appName: string;
  category?: string;
  coreUsers?: string[];
  primaryEmotion?: string;
  visualTheme?: string;
  psp?: string;
  pillars?: string[];
  trendingHooks?: string[];
  performanceData?: string[];
  doList?: string[];
  dontList?: string[];
  anglesPerPillar?: number;
  ideasPerAngle?: number;
  trackRule?: string;
  language?: string;
  priority?: string;
  extraContext?: string[];
};

type IdeaOutputSpecOptions = {
  quantity?: number;
  duration: string;
  appName: string;
  language: string;
  includeSelectedFilters?: boolean;
  compact?: boolean;
};

type HookOutputSpecOptions = {
  quantity?: number;
  language: string;
};

type SectionNormalizationOptions = {
  includeViewerFields?: boolean;
  includeEndCard?: boolean;
  includeDurationSeconds?: boolean;
};

function normalizeList(value?: string[], fallback = 'N/A'): string {
  const items = Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  return items.length ? items.join('\n') : fallback;
}

function normalizeInlineList(value?: string[], fallback = 'N/A'): string {
  const items = Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  return items.length ? items.join(', ') : fallback;
}

function readText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function estimateHookDurationSeconds(input: {
  voice?: unknown;
  voiceover?: unknown;
  voiceOver?: unknown;
  characterSpeech?: unknown;
  textOverlay?: unknown;
  text?: unknown;
  script?: unknown;
  visual?: unknown;
}): number {
  const characterSpeech = readText(input.characterSpeech);
  const voiceover = readText(input.voiceover, readText(input.voiceOver));
  const voice = readText(input.voice);
  const overlay = readText(input.textOverlay, readText(input.text));
  const script = readText(input.script, readText(input.visual));
  const spokenText = [characterSpeech, voiceover || voice, overlay].filter(Boolean).join(' ');
  const timingText = spokenText || script;
  const words = timingText
    .replace(/\[[^\]]+\]/g, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean).length;

  if (words === 0) return 3;
  const baseSeconds = spokenText ? 1 + words / 2.7 : 2 + words / 5.2;
  return Math.min(8, Math.max(2, Math.ceil(baseSeconds)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildScript(section: Record<string, unknown>): string {
  const visual = readText(section.visual) || readText(section.script);
  const characterSpeech = readText(section.characterSpeech) || readText(section.character_speech) || readText(section.talentSpeech) || readText(section.talent_speech);
  const voiceover = readText(section.voiceover) || readText(section.voiceOver) || readText(section.voice_over);
  const voice = readText(section.voice);
  const textOverlay = readText(section.textOverlay) || readText(section.text_overlay) || readText(section.text);
  return [
    visual,
    characterSpeech ? `[CHARACTER SPEECH] ${characterSpeech}` : '',
    voiceover ? `[VOICEOVER] ${voiceover}` : '',
    !characterSpeech && !voiceover && voice ? `[VOICE] ${voice}` : '',
    textOverlay ? `[TEXT OVERLAY] ${textOverlay}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeMeta(metaInput: unknown, defaults?: { pillar?: string }): Record<string, unknown> {
  const meta = readRecord(metaInput);
  return {
    builderVersion: readText(meta.builderVersion, 'prompt_system_builder_v1'),
    pillar: readText(meta.pillar, defaults?.pillar || 'General user friction'),
    pillarIndex: Number(meta.pillarIndex ?? meta.pillar_index ?? 0) || 0,
    angleName: readText(meta.angleName, readText(meta.angle_name, 'Core angle')),
    angleType: readText(meta.angleType, readText(meta.angle_type, 'Curiosity')),
    angleDesc: readText(meta.angleDesc, readText(meta.angle_desc, 'A distinct approach for this pillar.')),
    hookPrimary: readText(meta.hookPrimary, readText(meta.hook_primary)),
    hookAlt1: readText(meta.hookAlt1, readText(meta.hook_alt_1)),
    hookAlt2: readText(meta.hookAlt2, readText(meta.hook_alt_2)),
    visualRefNotes: readText(meta.visualRefNotes, readText(meta.visual_ref_notes)),
    talentProfile: readText(meta.talentProfile, readText(meta.talent_profile, 'No talent specified')),
    dontDo: readText(meta.dontDo, readText(meta.dont_do)),
    track: readText(meta.track, 'B'),
    trackReason: readText(meta.trackReason, readText(meta.track_reason)),
    priority: readText(meta.priority, 'A'),
  };
}

function normalizeSection(
  input: unknown,
  options: SectionNormalizationOptions = {}
): Record<string, unknown> {
  const section = readRecord(input);
  const characterSpeech = readText(section.characterSpeech, readText(section.character_speech, readText(section.talentSpeech, readText(section.talent_speech))));
  const voiceover = readText(section.voiceover, readText(section.voiceOver, readText(section.voice_over)));
  const legacyVoice = readText(section.voice);
  const normalized: Record<string, unknown> = {
    visual: readText(section.visual, readText(section.script)),
    characterSpeech,
    voiceover,
    voice: legacyVoice || voiceover || characterSpeech,
    textOverlay: readText(section.textOverlay, readText(section.text_overlay, readText(section.text))),
    text: readText(section.text, readText(section.textOverlay, readText(section.text_overlay))),
    viTranslation: readText(section.viTranslation, readText(section.vi_translation)),
    script: readText(section.script, buildScript(section)),
  };

  if (options.includeDurationSeconds) {
    normalized.durationSeconds = Math.round(
      readNumber(section.durationSeconds ?? section.duration_seconds ?? section.hookDurationSeconds ?? section.hook_duration_seconds)
      ?? estimateHookDurationSeconds(normalized)
    );
  }

  if (options.includeViewerFields) {
    normalized.viewerProfile = readText(section.viewerProfile, readText(section.viewer_profile));
    normalized.viewerEmotion = readText(section.viewerEmotion, readText(section.viewer_emotion));
    normalized.painpointImpact = readText(section.painpointImpact, readText(section.painpoint_impact));
    normalized.whyTheyStopScrolling = readText(section.whyTheyStopScrolling, readText(section.why_they_stop_scrolling));
  }

  if (options.includeEndCard) {
    normalized.endCard = readText(section.endCard, readText(section.end_card));
  }

  return normalized;
}

export const CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT = `You are a Creative Idea Engine specialized in generating production-ready video ad concepts for mobile apps running on Meta (Facebook and Instagram Ads).

## ROLE
You think like a performance creative director who deeply understands:
- Consumer psychology and emotional triggers
- What makes a hook stop the scroll in the first 3 seconds
- How to translate product features into emotional benefits
- The difference between an idea and a production-ready concept

## CORE BELIEF
Every idea must be rooted in a real Pain Point Pillar.
An idea without a clear pain point is decoration, not advertising.

## OUTPUT PHILOSOPHY
- Generate ideas that are production-ready, not conceptual sketches
- Every idea must be actionable: a video creator or agency can execute it without asking questions
- Specificity beats generality
- Hooks must create pattern interruption in the first 3 seconds
- Every hook variation must feel testable on Meta as a different opening approach

## WHAT YOU NEVER DO
- Never generate generic ideas that could apply to any app
- Never repeat the same angle with different words
- Never output cinematic brand-film copy for a social-first UGC workflow
- Never violate platform policy or invent medical claims
- Never hide the real hook inside a later body line
- Never output anything outside the requested JSON format
- Never combine multiple pain point pillars into one idea

## QUALITY STANDARD
Before outputting each idea, internally ask:
1. Does this hook make someone stop scrolling?
2. Is the pain point specific enough to feel personal?
3. Can a video creator execute this today without asking questions?
4. Is this angle genuinely different from the others in the batch?
5. If an angle is provided, does the hook externalize that exact angle instead of a broader symptom?
6. Would a media buyer have 3 truly different hook options to test from this idea?
If any answer is no, rewrite before outputting.`;

export const CREATIVE_PROMPT_RULES = `## RULES
R01. meta.hookPrimary should be a natural, descriptive stop-scroll line around 8-18 words. It may be up to 22 words when needed to make the pain point specific.
R02. Hook must create pattern interrupt, not just describe the product.
R03. Every idea must include 3 hook variations: primary + alt 1 + alt 2.
R04. Each angle must have a distinct angle type inside the same pillar.
R05. Angle means a genuinely different opening approach, not a paraphrase.
R06. Every visual scene must be executable without follow-up questions.
R07. hook.characterSpeech or hook.voiceover may be 1-2 natural spoken sentences when that is needed to make the first 3-5 seconds feel real, specific, and native.
R08. dontDo must be specific enough for QC to check.
R09. Do not make medical claims or prohibited health promises.
R10. Do not use before/after health outcome framing.
R11. Return JSON only, no markdown fences or extra prose.
R12. id must follow tracking format P{pillarIndex}-A{angleIndex}-I{ideaIndex}.
R13. Metadata must stay consistent and usable for tracking performance later.
R14. A selected angle is a narrow manifestation of the selected pain point, not a replacement for it.
R15. If an angle is provided, the hook must externalize that exact angle in the first action, first spoken line, or first contrast.
R16. hook.voice and hook.textOverlay must express the same hook DNA as meta.hookPrimary, not a softer generic rewrite.
R17. hook.visual must stay concrete and dense: include camera/framing, exact blocker or pain object, location, and the first visible sign of the selected pain point or angle.`;

export const TOOL_COMPATIBILITY_GUARDRAILS = `## TOOL COMPATIBILITY GUARDRAILS
- Emotion means viewer emotion, not actor acting cues.
- Keep the selected pain point exact. Do not drift into an adjacent pain point.
- Treat the selected angle as one small branch of the selected pain point. Stay tight to it.
- Do not collapse the selected pain point or selected angle into a broader symptom like "old room", "needs help", or "wants change".
- If an angle exists, make it visible immediately through the first action, first line, or first contrast in the hook.
- meta.hookPrimary, meta.hookAlt1, meta.hookAlt2 must use 3 different rhetorical approaches, not 3 paraphrases. They can be descriptive if that makes the pain point clearer.
- On-camera speech must be characterSpeech; off-camera narrator/video voice must be voiceover. Do not merge both into one [VOICE] script.
- Voice/speech must sound like a real person talking in-feed, not a polished ad.
- Keep the output social-first, UGC-friendly, handheld, relatable.
- hook.visual should usually be 2-4 dense sentences in Vietnamese, not a vague one-liner.
- hook.characterSpeech, hook.voiceover, and hook.textOverlay should avoid keyword-fragment hooks like "Head rush standing up?" when a more natural sentence would land harder.
- Separate visual, characterSpeech, voiceover, and textOverlay clearly for hook, body, and CTA.
- Include Vietnamese translation fields so the VN team can review fast.
- When a batch requests multiple ideas, diversify creative type, opening action, blocker, reveal, and voice opening.
- Keep hooks, body, and CTA tied to the same problem-solution chain.`;

export function buildFrameworkInjection(input: PromptFrameworkInput): string {
  const pillars = (input.pillars || []).filter(Boolean);
  const pillarBlock = pillars.length
    ? pillars.map((pillar, index) => `PILLAR_${index + 1}: ${pillar}`).join('\n')
    : 'PILLAR_1: General user friction';

  const extraContext = (input.extraContext || []).filter(Boolean);

  return `## FRAMEWORK INPUT

### APP IDENTITY
- App Name: ${input.appName}
- Category: ${input.category || 'General'}

### CORE USER (Persona)
${normalizeList(input.coreUsers, 'General mobile app users')}

### EMOTION TRIGGER (Primary)
${input.primaryEmotion || 'Curiosity'}
Options: Fear/Urgency | Curiosity | Aspirational | Social Proof | Relief

### VISUAL / THEME
${input.visualTheme || 'UGC, mobile-first, handheld, social-feed native'}

### PRODUCT SELLING POINT (PSP)
${input.psp || 'General app benefit'}

---

## PAIN POINT PILLARS
${pillarBlock}

---

## SIGNAL INPUT
### Trending Hooks
${normalizeList(input.trendingHooks, 'None')}

### Performance Data
${normalizeList(input.performanceData, 'No structured performance data')}

### Do / Do Not
DO: ${normalizeInlineList(input.doList, 'Keep it social-first, specific, and executable')}
DO NOT: ${normalizeInlineList(input.dontList, 'Do not be generic, repetitive, or policy-risky')}

---

## GENERATION PARAMETERS
- Angles per Pillar: ${input.anglesPerPillar ?? 1}
- Ideas per Angle: ${input.ideasPerAngle ?? 1}
- Track Distribution: ${input.trackRule || 'A = no real person | B = real person / UGC | C = motion / animation'}
- Language: ${input.language || 'Vietnamese strategy notes + target-market copy'}
- Priority Level: ${input.priority || 'A'}
${extraContext.length ? `\n---\n## EXTRA CONTEXT\n${extraContext.map(line => `- ${line}`).join('\n')}` : ''}`;
}

export function buildIdeaOutputSpec(options: IdeaOutputSpecOptions): string {
  const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';
  const compact = options.compact === true;
  const selectedFiltersBlock = options.includeSelectedFilters
    ? `  "selectedFilters": {
    "coreUser": ["..."],
    "painPoint": ["..."],
    "solution": ["..."],
    "emotion": ["..."],
    "angle": ["..."],
    "targetMarket": ["..."],
    "visualType": ["..."]
  },
`
    : '';
  const hookBodyCtaBlock = compact
    ? `  "hook": {
    "durationSeconds": 4,
    "visual": "Detailed opening visual in Vietnamese, 2-3 dense sentences covering camera, location, exact blocker, and visible painpoint clue",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, 1-2 concise sentences",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short body text in ${options.language}"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, 1 concise sentence",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short CTA text in ${options.language}",
    "endCard": "${options.appName} + short tagline"
  }`
    : `  "hook": {
    "durationSeconds": 4,
    "visual": "Detailed opening visual in Vietnamese, pure visual only, 2-4 dense sentences covering camera, location, blocker, and visible painpoint clue",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point",
    "viTranslation": "Vietnamese translation of hook speech/voiceover + text",
    "viewerProfile": "Vietnamese description of who stops scrolling",
    "viewerEmotion": "Vietnamese description of what the viewer feels",
    "painpointImpact": "Vietnamese description of why this pain lands",
    "whyTheyStopScrolling": "1 Vietnamese sentence explaining the stop-scroll reason"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, pure visual only",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short body text in ${options.language}",
    "viTranslation": "Vietnamese translation of body speech/voiceover + text"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, pure visual only",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short CTA text in ${options.language}",
    "viTranslation": "Vietnamese translation of CTA speech/voiceover + text",
    "endCard": "${options.appName} + short tagline"
  }`;
  const compactOutputRules = compact
    ? `- Fill every field listed above.
- Do not add server-derived legacy fields such as hook.voice, hook.text, viTranslation, viewerProfile, viewerEmotion, painpointImpact, whyTheyStopScrolling, or analogous body/cta legacy fields.
- Keep explanation to 1 short sentence.
- Keep hook.visual dense and specific: usually 2-3 sentences. Body/CTA visual can stay shorter.
- hook.durationSeconds must be an integer estimate of how long the hook section takes on screen, normally 3-5 seconds and never above 8 seconds.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it speakable within 3-5 seconds, usually 8-20 words.`
    : `- Fill every field. Use "N/A" only when genuinely not applicable.
- hook.durationSeconds must be an integer estimate of how long the hook section takes on screen, normally 3-5 seconds and never above 8 seconds.
- hook/body/cta.visual must stay visual-only. Do not mix voice, characterSpeech, voiceover, or textOverlay into visual.
- hook.visual must make the selected pain point and selected angle visible through the first object, first action, or first contrast. Avoid generic one-line visuals.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- Do not place [VOICE], [TEXT OVERLAY], [CHARACTER SPEECH], or [VOICEOVER] markers inside visual/script fields.
- hook.characterSpeech or hook.voiceover and hook.textOverlay must preserve the same stop-scroll thesis as meta.hookPrimary.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it speakable within 3-5 seconds, usually 8-20 words.`;

  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "Short Vietnamese concept title",
  "duration": "${options.duration}",
  "creativeType": "UGC|POV|Split Screen|Reaction|ASMR|Trend Format|Social Proof|Interview|Challenge",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "pillar": "exact pillar text from input",
    "pillarIndex": 0,
    "angleName": "3-5 word angle name",
    "angleType": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
    "angleDesc": "1 sentence describing the unique approach",
    "hookPrimary": "Main hook text, natural and descriptive, usually 8-18 words",
    "hookAlt1": "Alternative hook variation A using a different rhetorical approach",
    "hookAlt2": "Alternative hook variation B using a different rhetorical approach",
    "visualRefNotes": "Specific production note",
    "talentProfile": "Age, look, clothing, or No talent",
    "dontDo": "1 specific thing not to do",
    "track": "A|B|C",
    "trackReason": "Why this track fits",
    "priority": "A|B|C"
  },
${selectedFiltersBlock}  "framework": {
    "coreUser": "Vietnamese strategic summary of the target viewer",
    "painpoint": "Vietnamese description of the exact pain point",
    "emotion": "Vietnamese description of the viewer emotion journey",
    "psp": "Vietnamese explanation of the product solution"
  },
  "explanation": "Vietnamese explanation of why this idea works",
${hookBodyCtaBlock}
}]

## OUTPUT RULES
- id must follow P{pillarIndex}-A{angleIndex}-I{ideaIndex}.
- meta.hookPrimary should be natural and descriptive, usually 8-18 words, max 22 words if needed for specificity.
- meta.hookAlt1 and meta.hookAlt2 must not be paraphrases of meta.hookPrimary.
${compactOutputRules}
- Speech/voiceover must sound native to the chosen market and natural to a real person.
- Keep hook/body/cta tightly connected to the same pillar and angle.
- Respect the selected language for voice and textOverlay, while strategy fields stay in Vietnamese.
- Keep the response machine-parseable.`;
}

export function buildHookOutputSpec(options: HookOutputSpecOptions): string {
  const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';
  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "Vietnamese variant title",
  "explanation": "Vietnamese explanation of what changed and why it works",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "hookPrimary": "Natural hook line, usually 8-18 words",
    "hookAlt1": "Alternative hook A with a different rhetorical approach",
    "hookAlt2": "Alternative hook B with a different rhetorical approach",
    "visualRefNotes": "Specific production note",
    "talentProfile": "Age, look, clothing, or No talent",
    "dontDo": "1 specific thing not to do"
  },
  "hook": {
    "durationSeconds": 4,
    "visual": "Detailed hook-only visual in Vietnamese",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen text in ${options.language}, around 6-16 words, aligned with meta.hookPrimary",
    "viTranslation": "Vietnamese translation of hook speech/voiceover + text",
    "viewerEmotion": "Vietnamese description of what the viewer feels",
    "painpointImpact": "Vietnamese description of why this pain lands",
    "whyTheyStopScrolling": "1 Vietnamese sentence explaining the stop-scroll reason"
  }
}]

## OUTPUT RULES
- Focus on the first 3-5 seconds only.
- Keep the winning hook DNA unless the user explicitly asks to change it.
- Hooks may be descriptive when needed. Avoid clipped keyword fragments; write native, speakable hook lines.
- hook.durationSeconds must estimate the actual hook runtime as an integer second count.
- For UGC/POV/Reaction/Interview, split on-camera talent speech into characterSpeech and off-camera narrator/video voice into voiceover.
- visual must stay visual-only; do not include [VOICE] or [TEXT OVERLAY] markers inside visual.
- id must follow P{pillarIndex}-A{angleIndex}-I{ideaIndex}.
- The variation must be visually distinct, not just paraphrased text.`;
}

function extractBalancedJsonBlock(text: string): string | null {
  const starts = ['[', '{'];

  for (const startToken of starts) {
    const startIndex = text.indexOf(startToken);
    if (startIndex === -1) continue;

    const stack: string[] = [startToken];
    let inString = false;
    let escaped = false;

    for (let index = startIndex + 1; index < text.length; index++) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '[' || char === '{') {
        stack.push(char);
        continue;
      }

      if (char === ']' || char === '}') {
        const expected = char === ']' ? '[' : '{';
        if (stack[stack.length - 1] !== expected) {
          break;
        }

        stack.pop();
        if (stack.length === 0) {
          return text.substring(startIndex, index + 1);
        }
      }
    }
  }

  return null;
}

function tryParseJsonCandidate(text: string) {
  try {
    return JSON.parse(text);
  } catch {}

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return Function(`"use strict"; return (${text});`)();
    } catch {}
  }

  return null;
}

function findNextSignificantChar(text: string, startIndex: number): string | null {
  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];
    if (!/\s/.test(char)) return char;
  }
  return null;
}

function repairJsonLikeText(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (!inString) {
      if (char === '"' || char === '“' || char === '”') {
        result += '"';
        inString = true;
        escaped = false;
        continue;
      }

      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(char)) {
        continue;
      }

      result += char;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      const next = text[index + 1] || '';
      if (next && '\\"/bfnrtu'.includes(next)) {
        result += '\\';
        escaped = true;
      } else {
        result += '\\\\';
      }
      continue;
    }

    if (char === '\n') {
      result += '\\n';
      continue;
    }

    if (char === '\r') {
      result += '\\r';
      continue;
    }

    if (char === '\t') {
      result += '\\t';
      continue;
    }

    if (char === '"' || char === '“' || char === '”') {
      const nextSig = findNextSignificantChar(text, index + 1);
      if (nextSig && ![',', '}', ']', ':'].includes(nextSig)) {
        result += '\\"';
      } else {
        result += '"';
        inString = false;
      }
      continue;
    }

    result += char;
  }

  return result.replace(/,\s*([}\]])/g, '$1');
}

function extractTopLevelObjectBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) startIndex = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && startIndex !== -1) {
        blocks.push(text.substring(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return blocks;
}

function tryParseJsonVariants(text: string) {
  const attempts = Array.from(new Set([
    text,
    text.replace(/,\s*([}\]])/g, '$1'),
    text.replace(/("(?:[^"\\]|\\.)*")|[\n\r\t]/g, (match, str) => (str ? str : ' ')),
    repairJsonLikeText(text),
  ]));

  for (const attempt of attempts) {
    const parsed = tryParseJsonCandidate(attempt);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function parseJsonLoose(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    clean = clean.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

    const extracted = extractBalancedJsonBlock(clean);
    if (extracted) clean = extracted;

    const parsed = tryParseJsonVariants(clean);
    if (parsed !== null) return parsed;

    if (clean.startsWith('[')) {
      const blocks = extractTopLevelObjectBlocks(repairJsonLikeText(clean));
      if (blocks.length > 0) {
        const parsedItems = blocks
          .map(block => tryParseJsonVariants(block))
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));

        if (parsedItems.length > 0) {
          return parsedItems;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeIdeaOutput(
  input: unknown,
  defaults: { duration: string; appName: string; pillar?: string }
): Record<string, unknown> {
  const item = readRecord(input);
  const framework = readRecord(item.framework);

  return {
    id: item.id ?? 1,
    title: readText(item.title, `Y tuong ${defaults.appName}`),
    duration: readText(item.duration, defaults.duration),
    creativeType: readText(item.creativeType, 'UGC'),
    meta: normalizeMeta(item.meta, { pillar: defaults.pillar }),
    selectedFilters: readRecord(item.selectedFilters),
    framework: {
      coreUser: readText(framework.coreUser, 'General viewer'),
      painpoint: readText(framework.painpoint, defaults.pillar || 'General user friction'),
      emotion: readText(framework.emotion, 'Create a clear viewer emotion'),
      psp: readText(framework.psp, defaults.appName),
    },
    explanation: readText(item.explanation),
    hook: normalizeSection(item.hook, { includeViewerFields: true, includeDurationSeconds: true }),
    body: normalizeSection(item.body),
    cta: normalizeSection(item.cta, { includeEndCard: true }),
  };
}

export function normalizeHookOutput(input: unknown): Record<string, unknown> {
  const item = readRecord(input);
  return {
    id: item.id ?? 1,
    title: readText(item.title, 'Bien the hook'),
    explanation: readText(item.explanation),
    meta: normalizeMeta(item.meta),
    hook: normalizeSection(item.hook, { includeViewerFields: true, includeDurationSeconds: true }),
  };
}
