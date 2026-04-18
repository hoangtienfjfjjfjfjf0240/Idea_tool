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
};

type HookOutputSpecOptions = {
  quantity?: number;
  language: string;
};

type SectionNormalizationOptions = {
  includeViewerFields?: boolean;
  includeEndCard?: boolean;
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildScript(section: Record<string, unknown>): string {
  const visual = readText(section.visual) || readText(section.script);
  const voice = readText(section.voice);
  const textOverlay = readText(section.textOverlay) || readText(section.text_overlay) || readText(section.text);
  return [visual, voice ? `[VOICE] ${voice}` : '', textOverlay ? `[TEXT OVERLAY] ${textOverlay}` : '']
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
  const normalized: Record<string, unknown> = {
    visual: readText(section.visual, readText(section.script)),
    voice: readText(section.voice),
    textOverlay: readText(section.textOverlay, readText(section.text_overlay, readText(section.text))),
    text: readText(section.text, readText(section.textOverlay, readText(section.text_overlay))),
    viTranslation: readText(section.viTranslation, readText(section.vi_translation)),
    script: readText(section.script, buildScript(section)),
  };

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

## WHAT YOU NEVER DO
- Never generate generic ideas that could apply to any app
- Never repeat the same angle with different words
- Never output cinematic brand-film copy for a social-first UGC workflow
- Never violate platform policy or invent medical claims
- Never output anything outside the requested JSON format
- Never combine multiple pain point pillars into one idea

## QUALITY STANDARD
Before outputting each idea, internally ask:
1. Does this hook make someone stop scrolling?
2. Is the pain point specific enough to feel personal?
3. Can a video creator execute this today without asking questions?
4. Is this angle genuinely different from the others in the batch?
5. If an angle is provided, does the hook externalize that exact angle instead of a broader symptom?
If any answer is no, rewrite before outputting.`;

export const CREATIVE_PROMPT_RULES = `## RULES
R01. Hook primary must stay under 12 words.
R02. Hook must create pattern interrupt, not just describe the product.
R03. Every idea must include 3 hook variations: primary + alt 1 + alt 2.
R04. Each angle must have a distinct angle type inside the same pillar.
R05. Angle means a genuinely different opening approach, not a paraphrase.
R06. Every visual scene must be executable without follow-up questions.
R07. Voiceover must be speakable inside the requested duration and stay concise.
R08. dontDo must be specific enough for QC to check.
R09. Do not make medical claims or prohibited health promises.
R10. Do not use before/after health outcome framing.
R11. Return JSON only, no markdown fences or extra prose.
R12. Metadata must be consistent and usable for tracking performance later.
R13. A selected angle is a narrow manifestation of the selected pain point, not a replacement for it.
R14. If an angle is provided, the hook must externalize that exact angle in the first action, first spoken line, or first contrast.`;

export const TOOL_COMPATIBILITY_GUARDRAILS = `## TOOL COMPATIBILITY GUARDRAILS
- Emotion means viewer emotion, not actor acting cues.
- Keep the selected pain point exact. Do not drift into an adjacent pain point.
- Treat the selected angle as one small branch of the selected pain point. Stay tight to it.
- Do not collapse the selected pain point or selected angle into a broader symptom like "old room", "needs help", or "wants change".
- If an angle exists, make it visible immediately through the first action, first line, or first contrast in the hook.
- Voice must sound like a real person talking in-feed, not a polished ad.
- Keep the output social-first, UGC-friendly, handheld, relatable.
- Separate visual, voice, and textOverlay clearly for hook, body, and CTA.
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

  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": 1,
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
    "hookPrimary": "Main hook text under 12 words",
    "hookAlt1": "Alternative hook variation A",
    "hookAlt2": "Alternative hook variation B",
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
  "hook": {
    "visual": "Detailed opening visual in Vietnamese, pure visual only",
    "voice": "Natural voice line in ${options.language}",
    "textOverlay": "Short on-screen text in ${options.language}",
    "viTranslation": "Vietnamese translation of hook voice + text",
    "viewerProfile": "Vietnamese description of who stops scrolling",
    "viewerEmotion": "Vietnamese description of what the viewer feels",
    "painpointImpact": "Vietnamese description of why this pain lands",
    "whyTheyStopScrolling": "1 Vietnamese sentence explaining the stop-scroll reason"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, pure visual only",
    "voice": "Natural body voice line in ${options.language}",
    "textOverlay": "Short body text in ${options.language}",
    "viTranslation": "Vietnamese translation of body voice + text"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, pure visual only",
    "voice": "Natural CTA line in ${options.language}",
    "textOverlay": "Short CTA text in ${options.language}",
    "viTranslation": "Vietnamese translation of CTA voice + text",
    "endCard": "${options.appName} + short tagline"
  }
}]

## OUTPUT RULES
- Fill every field. Use "N/A" only when genuinely not applicable.
- meta.hookPrimary must stay under 12 words.
- hook/body/cta.visual must stay visual-only. Do not mix voice or textOverlay into visual.
- voice must sound native to the chosen market and natural to a real person.
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
  "id": 1,
  "title": "Vietnamese variant title",
  "explanation": "Vietnamese explanation of what changed and why it works",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "hookPrimary": "Hook under 12 words",
    "hookAlt1": "Alternative hook A",
    "hookAlt2": "Alternative hook B",
    "visualRefNotes": "Specific production note",
    "talentProfile": "Age, look, clothing, or No talent",
    "dontDo": "1 specific thing not to do"
  },
  "hook": {
    "visual": "Detailed hook-only visual in Vietnamese",
    "voice": "Natural hook voice in ${options.language}",
    "textOverlay": "Short on-screen text in ${options.language}",
    "viTranslation": "Vietnamese translation of hook voice + text",
    "viewerEmotion": "Vietnamese description of what the viewer feels",
    "painpointImpact": "Vietnamese description of why this pain lands",
    "whyTheyStopScrolling": "1 Vietnamese sentence explaining the stop-scroll reason"
  }
}]

## OUTPUT RULES
- Focus on the first 3-5 seconds only.
- Keep the winning hook DNA unless the user explicitly asks to change it.
- The variation must be visually distinct, not just paraphrased text.`;
}

export function parseJsonLoose(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    clean = clean.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

    const s = clean.indexOf('[');
    const e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{');
    const e2 = clean.lastIndexOf('}');

    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);

    try {
      return JSON.parse(clean);
    } catch {}

    let fixed = clean
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    try {
      return JSON.parse(fixed);
    } catch {}

    fixed = clean.replace(/("(?:[^"\\]|\\.)*")|[\n\r\t]/g, (match, str) => {
      if (str) return str;
      return ' ';
    });

    try {
      return JSON.parse(fixed);
    } catch {}

    const fn = new Function(`return ${clean}`);
    return fn();
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
    hook: normalizeSection(item.hook, { includeViewerFields: true }),
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
    hook: normalizeSection(item.hook, { includeViewerFields: true }),
  };
}
