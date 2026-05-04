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
  ruleset?: 'default' | 'v7' | 'builder';
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

function readSpeechText(value: unknown, fallback = ''): string {
  const text = readText(value, fallback);
  if (!text) return '';
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    !normalized
    || /^(?:n\/a|na|none|null|empty|blank|no speech|no narrator|no voice|no talent|khong co|-)$/.test(normalized)
  ) {
    return '';
  }

  return text;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

  if (words === 0) return 8;
  const baseSeconds = spokenText ? 2 + words / 2.8 : 4 + words / 5.2;
  return Math.min(12, Math.max(6, Math.ceil(baseSeconds)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => readText(item)).filter(Boolean);
  }
  const text = readText(value);
  return text ? [text] : [];
}

function buildScript(section: Record<string, unknown>): string {
  const visual = readText(section.visual) || readText(section.script);
  const characterSpeech = readSpeechText(section.characterSpeech) || readSpeechText(section.character_speech) || readSpeechText(section.talentSpeech) || readSpeechText(section.talent_speech);
  const voiceover = readSpeechText(section.voiceover) || readSpeechText(section.voiceOver) || readSpeechText(section.voice_over);
  const voice = readSpeechText(section.voice);
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
    referencePattern: readText(meta.referencePattern, readText(meta.reference_pattern)),
    interruptMechanism: readText(meta.interruptMechanism, readText(meta.interrupt_mechanism)),
    firstFrameAsset: readText(meta.firstFrameAsset, readText(meta.first_frame_asset)),
    pspBridge: readText(meta.pspBridge, readText(meta.psp_bridge)),
    proofObject: readText(meta.proofObject, readText(meta.proof_object)),
    appDemoAction: readText(meta.appDemoAction, readText(meta.app_demo_action)),
    editNotes: readText(meta.editNotes, readText(meta.edit_notes)),
    overlaySequence: readTextArray(meta.overlaySequence ?? meta.overlay_sequence),
  };
}

function normalizeSection(
  input: unknown,
  options: SectionNormalizationOptions = {}
): Record<string, unknown> {
  const section = readRecord(input);
  const characterSpeech = readSpeechText(section.characterSpeech) || readSpeechText(section.character_speech) || readSpeechText(section.talentSpeech) || readSpeechText(section.talent_speech);
  const voiceover = readSpeechText(section.voiceover) || readSpeechText(section.voiceOver) || readSpeechText(section.voice_over);
  const legacyVoice = readSpeechText(section.voice);
  const rawVisual = readText(section.visual, readText(section.script));
  const normalized: Record<string, unknown> = {
    visual: options.includeDurationSeconds ? normalizeHookTimingText(rawVisual) : rawVisual,
    characterSpeech,
    voiceover,
    voice: legacyVoice || voiceover || characterSpeech,
    textOverlay: readText(section.textOverlay, readText(section.text_overlay, readText(section.text))),
    text: readText(section.text, readText(section.textOverlay, readText(section.text_overlay))),
    viTranslation: readText(section.viTranslation, readText(section.vi_translation)),
    script: readText(section.script, buildScript(section)),
  };

  if (options.includeDurationSeconds) {
    normalized.durationSeconds = 3;
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
R01. hook_primary / meta.hookPrimary must be a natural stop-scroll line of 6-16 words. Count carefully.
R02. Hook must create pattern interrupt, not just describe the product.
R03. Every idea must include 3 hook variations: primary + alt 1 + alt 2.
R04. Each angle must have a distinct angle type inside the same pillar.
R05. Angle means a genuinely different opening approach, not a paraphrase.
R06. Every visual scene must be executable without follow-up questions.
R07. script_vo must be speakable within roughly 25 seconds and must stay at 60 words or fewer.
R08. dontDo must be specific enough for QC to check.
R09. Do not make medical claims or prohibited health promises.
R10. Do not use before/after health outcome framing.
R11. Return JSON only, no markdown fences or extra prose.
R12. id must follow tracking format P{pillarIndex}-A{angleIndex}-I{ideaIndex}.
R13. Metadata must stay consistent and usable for tracking performance later.
R14. A selected angle is a narrow manifestation of the selected pain point, not a replacement for it.
R15. If an angle is provided, hook_primary and visual_scene_1 must externalize that exact angle in the first action, first spoken line, or first contrast.
R16. hook_alt_1 and hook_alt_2 must use different rhetorical approaches from hook_primary, not softer paraphrases.
R17. visual_scene_1 must stay concrete and dense: include camera/framing, exact blocker or pain object, location, and the first visible sign of the selected pain point or angle.
R18. hook_primary is a strategic headline, not automatically the spoken line. hook_voiceover must not repeat hook_primary word-for-word.
R19. Only use hook_character_speech when the speaker is visible and identified in visual_scene_1; otherwise leave it empty.
R20. Hook must include the bridge to PSP: after the pain moment, the viewer should understand why the app/action is the next natural step. Body can be a demo suggestion, but Hook must carry the sell-through logic.
R21. Before writing ideas, internally digest the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Pain Point into one shootable creative brief. Do not output that hidden brief.
R22. The selected Pain Point must become a specific moment, a real-life situation, and a visible first-3-second action. If it is abstract, sharpen it without changing its meaning.
R23. If visual_scene_1 describes a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required. Do not hide on-camera dialogue inside hook_voiceover or script_vo only.`;

export const PROMPT_SYSTEM_BUILDER_RULES = `## PROMPT SYSTEM BUILDER HTML V1 RULES
R01. hook_primary must be under 12 words. Count carefully.
R02. Hook must create pattern interrupt in the first 3 seconds.
R03. Every idea must include hook_primary, hook_alt_1, and hook_alt_2 as three different testing approaches.
R04. Within the same pillar, each angle should use a different angle_type when multiple angles are generated.
R05. Angle must be a genuinely different creative approach, not a paraphrase of the same idea.
R06. visual_scene_1, visual_scene_2, and visual_scene_3 must be executable by a video creator without follow-up questions.
R07. script_vo must be speakable in roughly 25 seconds and stay at 60 words or fewer.
R08. dont_do must be specific enough for QC to check.
R09. Do not make medical claims: no diagnosis, cure, treatment, disease detection, doctor replacement, or exact medical result promises.
R10. Do not use before/after health outcome framing.
R11. Return raw JSON array only. No preamble, no markdown fence, no explanation after JSON.
R12. id must follow P{pillar_index}-A{angle_index}-I{idea_index}, zero-indexed.
R13. Before writing ideas, internally digest the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Pain Point into one shootable creative brief. Do not output that hidden brief.
R14. The selected Pain Point must become a specific moment, a real-life situation, and a visible first-3-second action. If it is abstract, sharpen it without changing its meaning.
R15. If visual_scene_1 describes a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required. Do not hide on-camera dialogue inside hook_voiceover or script_vo only.
Language contract is defined by the output specification: user-facing copy follows the requested output language; visual and production descriptions can be Vietnamese for the internal team.`;

export const TOOL_COMPATIBILITY_GUARDRAILS = `## TOOL COMPATIBILITY GUARDRAILS
- Emotion means viewer emotion, not actor acting cues.
- Treat the five selected framework inputs as locked strategy, not loose labels. Before writing, internally answer: who is watching, which one emotion stops them, what visual format creates trust, why this PSP matters now, and what exact pain situation appears in the first 3 seconds.
- Pain Point must be a shootable situation: specific moment + real-life setting + visible object/blocker + first action. If the selected pain point is abstract, convert it into a concrete situation without changing the selected pain point.
- PSP must be translated into Feature -> Benefit -> Transformation before writing the hook, so the app action feels like the natural next step instead of a generic demo.
- Keep the selected pain point exact. Do not drift into an adjacent pain point.
- Treat the selected angle as one small branch of the selected pain point. Stay tight to it.
- Do not collapse the selected pain point or selected angle into a broader symptom like "old room", "needs help", or "wants change".
- If an angle exists, make it visible immediately through the first action, first line, or first contrast in the hook.
- hook_primary, hook_alt_1, hook_alt_2 must use 3 different rhetorical approaches, not 3 paraphrases. They can be descriptive if that makes the pain point clearer.
- On-camera speech must be characterSpeech; off-camera narrator/video voice must be voiceover. Do not merge both into one [VOICE] script.
- If visual_scene_1 contains a visible person talking to camera, replying to someone, asking a line, or being questioned, fill characterSpeech with that exact on-camera line. Leave characterSpeech empty only for silent visuals or pure off-camera narration.
- Do not fill a speech field with "-", "N/A", or an empty label. If nobody speaks, leave the field empty.
- Do not duplicate the same hook sentence across title, voiceover, and textOverlay. The overlay can be the headline, but the spoken line needs extra context or should be omitted.
- Hook is not just an opener. It must contain a clear bridge from viewer emotion/angle to the PSP, so the app action feels earned before the Body section.
- Hook visual_scene_1 should be a 0-3s stop-scroll beat: pain trigger, emotional contrast, or PSP bridge cue. Do not label it as 0-8s or 8-12s.
- Voice/speech must sound like a real person talking in-feed, not a polished ad.
- Keep the output social-first, UGC-friendly, handheld, relatable.
- visual_scene_1 should usually be 2-4 dense Vietnamese production sentences, not a vague one-liner.
- hook_primary should avoid keyword-fragment hooks like "Head rush standing up?" when a more natural sentence would land harder.
- Do not add fields outside the current output specification.
- For legacy/refine schemas only, keep visual, characterSpeech, voiceover, and textOverlay separated.
- When a batch requests multiple ideas, diversify creative type, opening action, blocker, reveal, and voice opening.
- Keep hooks, body, and CTA tied to the same problem-solution chain.`;

export const PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS = `## PROMPT SYSTEM BUILDER COMPATIBILITY GUARDRAILS
- Emotion means viewer emotion, not actor acting cues.
- Treat the five selected framework inputs as locked strategy, not loose labels. Before writing, internally answer: who is watching, which one emotion stops them, what visual format creates trust, why this PSP matters now, and what exact pain situation appears in the first 3 seconds.
- Pain Point must be a shootable situation: specific moment + real-life setting + visible object/blocker + first action. If the selected pain point is abstract, convert it into a concrete situation without changing the selected pain point.
- PSP must be translated into Feature -> Benefit -> Transformation before writing the hook, so the app action feels like the natural next step instead of a generic demo.
- Keep the selected pain point exact. Do not drift into an adjacent pain point.
- Treat the selected angle as one small branch of the selected pain point. Stay tight to it.
- Do not collapse the selected pain point or selected angle into a broader symptom like "old room", "needs help", or "wants change".
- If an angle exists, make it visible immediately through the first action, first line, or first contrast in visual_scene_1.
- hook_primary, hook_alt_1, hook_alt_2 must use 3 different rhetorical approaches, not 3 paraphrases. They can be descriptive if that makes the pain point clearer.
- If visual_scene_1 contains a visible person talking to camera, replying to someone, asking a line, or being questioned, fill hook_character_speech with that exact on-camera line. Leave hook_character_speech empty only for silent visuals or pure off-camera narration.
- visual_scene_1 is the full 0-3s hook/pattern-interrupt beat. Do not use old 3-5s hook timing or old 8-12s hook-section timing for this ruleset.
- Never write "0-8s", "0-8/12", "0-12s", or "8-12s" in visual_scene_1, hook labels, voice labels, or production notes for this ruleset.
- visual_scene_2 is the 3-15s demo/story beat. visual_scene_3 is the 15-25s reveal/proof beat.
- Hook is not just a headline: hook_primary plus visual_scene_1 must make the stop-scroll idea clear in the first 3 seconds.
- Voice/speech must sound like a real person talking in-feed, not a polished ad.
- Keep the output social-first, UGC-friendly, handheld, relatable.
- visual_scene_1 should usually be 2-4 dense Vietnamese production sentences, not a vague one-liner.
- hook_primary should avoid keyword-fragment hooks like "Head rush standing up?" when a more natural sentence would land harder.
- Do not add fields outside the current output specification.
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

## REQUIRED INTERNAL CREATIVE BRIEF DIGESTION
Do this silently before writing any idea. Do not output these notes.

Convert the selected filters above into one shootable brief:
1. Core User -> a concrete viewer situation, not just an age or demographic label.
2. Emotion Trigger -> one dominant emotion that must appear in the first 3 seconds.
3. Visual / Theme -> the native Meta format that creates trust immediately.
4. Product Selling Point -> Feature -> Benefit -> Transformation, ending with why the user should act now.
5. Pain Point -> a specific moment, real-life setting, visible object/blocker, and first action that can be filmed in 3 seconds.

If any selected filter is broad, sharpen it inside its original meaning. Do not invent a new core user, pain point, PSP, angle, or market. Every hook/body/CTA must come from this hidden brief.

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
- Language: ${input.language || 'English user-facing copy; Vietnamese visual and production notes'}
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
    "durationSeconds": 3,
    "visual": "Detailed opening visual in Vietnamese, 2-3 dense production sentences covering camera, location, exact blocker, and visible painpoint clue",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, 2-3 dense production sentences covering the transition from blocker to demo, the exact product action, and the visible proof beat",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short body text in ${options.language} that reinforces the same pain-to-solution chain"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, 1-2 concrete production sentences covering the final proof frame, the app/result screen, and the exact CTA beat",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short CTA text in ${options.language}",
    "endCard": "${options.appName} + short tagline"
  }`
    : `  "hook": {
    "durationSeconds": 3,
    "visual": "Detailed opening visual in Vietnamese, pure visual only, 2-4 dense production sentences covering camera, location, blocker, and visible painpoint clue",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point",
    "viTranslation": "Optional English recap of hook speech/voiceover + text",
    "viewerProfile": "${options.language} description of who stops scrolling",
    "viewerEmotion": "${options.language} description of what the viewer feels",
    "painpointImpact": "${options.language} description of why this pain lands",
    "whyTheyStopScrolling": "1 ${options.language} sentence explaining the stop-scroll reason"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, pure visual only",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short body text in ${options.language}",
    "viTranslation": "Optional English recap of body speech/voiceover + text"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, pure visual only",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short CTA text in ${options.language}",
    "viTranslation": "Optional English recap of CTA speech/voiceover + text",
    "endCard": "${options.appName} + short tagline"
  }`;
  const compactOutputRules = compact
    ? `- Fill every field listed above.
- Do not add server-derived legacy fields such as hook.voice, hook.text, viTranslation, viewerProfile, viewerEmotion, painpointImpact, whyTheyStopScrolling, or analogous body/cta legacy fields.
- Keep explanation to 1 short sentence.
- Keep hook.visual dense and specific: usually 2-3 sentences. Body should normally be 2-3 dense sentences, and CTA should still be concrete enough for production without follow-up questions.
- hook.durationSeconds must be an integer estimate of the opening hook beat, normally 3 seconds for prompt-builder style output.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it concise enough for the 0-3s hook beat.`
    : `- Fill every field. Use "N/A" only when genuinely not applicable.
- hook.durationSeconds must be an integer estimate of the opening hook beat, normally 3 seconds for prompt-builder style output.
- hook/body/cta.visual must stay visual-only. Do not mix voice, characterSpeech, voiceover, or textOverlay into visual.
- hook.visual must make the selected pain point and selected angle visible through the first object, first action, or first contrast. Avoid generic one-line visuals.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- Do not place [VOICE], [TEXT OVERLAY], [CHARACTER SPEECH], or [VOICEOVER] markers inside visual/script fields.
- hook.characterSpeech or hook.voiceover and hook.textOverlay must preserve the same stop-scroll thesis as meta.hookPrimary.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it concise enough for the 0-3s hook beat.`;

  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "Short ${options.language} concept title",
  "duration": "${options.duration}",
  "creativeType": "2D Animation|3D Animation|UGC|POV|Motion Graphic",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "pillar": "exact pillar text from input",
    "pillarIndex": 0,
    "angleName": "3-5 word angle name",
    "angleType": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
    "angleDesc": "1 sentence describing the unique approach",
    "hookPrimary": "Main hook text, natural stop-scroll line, 6-16 words",
    "hookAlt1": "Alternative hook variation A using a different rhetorical approach",
    "hookAlt2": "Alternative hook variation B using a different rhetorical approach",
    "pspBridge": "One concrete transition from the hook pain/emotion to the PSP/app action, 10-36 words",
    "visualRefNotes": "Specific production note",
    "talentProfile": "Age, look, clothing, or No talent",
    "dontDo": "1 specific thing not to do",
    "track": "A|B|C",
    "trackReason": "Why this track fits",
    "priority": "A|B|C"
  },
${selectedFiltersBlock}  "framework": {
    "coreUser": "${options.language} strategic summary of the target viewer",
    "painpoint": "${options.language} description of the exact pain point",
    "emotion": "${options.language} description of the viewer emotion journey",
    "psp": "${options.language} explanation of the product solution"
  },
  "explanation": "${options.language} explanation of why this idea works",
${hookBodyCtaBlock}
}]

## OUTPUT RULES
- id must follow P{pillarIndex}-A{angleIndex}-I{ideaIndex}.
- meta.hookPrimary must be natural, descriptive, and 6-16 words.
- meta.hookAlt1 and meta.hookAlt2 must not be paraphrases of meta.hookPrimary.
- meta.pspBridge is required. It must connect the hook emotion/angle to framework.psp before Body starts, 10-36 words.
${compactOutputRules}
- Speech/voiceover must sound native to the chosen market and natural to a real person.
- Keep hook/body/cta tightly connected to the same pillar and angle.
- Write user-facing copy in ${options.language}: title, hook lines, characterSpeech, voiceover, textOverlay, script_vo, and CTA text. Write visual and production descriptions in Vietnamese.
- Keep the response machine-parseable.`;
}

export function buildCreativeBriefOutputSpec(options: IdeaOutputSpecOptions): string {
  if (options.ruleset === 'builder') {
    const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';

    return `## OUTPUT SPECIFICATION - PROMPT SYSTEM BUILDER HTML V1

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${quantityLabel} idea objects inside that angle.
User-facing copy must be in ${options.language}: title/hook lines, on-camera character speech, voice/video voiceover, text overlay, script_vo, and CTA.
Visual shooting descriptions and production notes must be Vietnamese for the internal team.
The selected market controls setting, culture, behavior, and vibe only. Do not switch user-facing copy away from ${options.language}.

[
  {
    "pillar_index": 0,
    "pillar": "exact pillar text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "3-5 word ${options.language} internal name for this angle",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
        "angle_desc": "1 ${options.language} sentence describing the unique approach of this angle",
        "ideas": [
          {
            "id": "P{pillar_index}-A{angle_index}-I{idea_index}",
            "hook_primary": "Main hook text in ${options.language}, max 12 words, creates pattern interrupt",
            "hook_alt_1": "Alternative hook variation A in ${options.language}",
            "hook_alt_2": "Alternative hook variation B in ${options.language}",
            "hook_character_speech": "On-camera character speech in ${options.language}. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Optional voice/video narrator line in ${options.language}. Empty string if no narrator.",
            "hook_text_overlay": "On-screen hook text in ${options.language}, max 12 words.",
            "visual_scene_1": "Second 0-3 only: Exact Vietnamese visual description. Who, where, doing what. Never write 0-8s.",
            "visual_scene_2": "Second 3-15: Core demonstration or storytelling visual in Vietnamese.",
            "visual_scene_3": "Second 15-25: Reveal or proof visual in Vietnamese.",
            "script_vo": "Full voiceover script in ${options.language}, max 60 words.",
            "cta_text": "Exact CTA in ${options.language}, max 6 words.",
            "visual_ref_notes": "Specific Vietnamese visual reference for production team.",
            "talent_profile": "Age, gender, look, clothing if talent needed. Use No talent if pure demo.",
            "dont_do": "1 specific thing NOT to do in this video.",
            "track": "A|B|C",
            "track_reason": "1 Vietnamese sentence explaining why this track.",
            "priority": "A|B|C"
          }
        ]
      }
    ]
  }
]

## OUTPUT RULES
1. Output JSON array ONLY, no text before or after.
2. Every field is required. Use "N/A" only if truly not applicable.
3. hook_primary must be under 12 words.
4. visual_scene_1 must be the 0-3s hook beat only. Never output 0-8s, 0-8/12, 0-12s, or 8-12s for builder ideas.
5. visual_scene_1/2/3 must be specific enough that a video creator can shoot without asking.
6. script_vo must be speakable in 25 seconds, roughly 60 words max.
7. id must follow format exactly: P0-A0-I0, zero-indexed.
8. angle_type must be one of the allowed values.
9. Tracks: A = no real person needed | B = real person/UGC | C = motion/animation.
10. User-facing copy fields title/hook_primary/hook_alt_1/hook_alt_2/hook_character_speech/hook_voiceover/hook_text_overlay/script_vo/cta_text must be in ${options.language}. Internal visual and production notes must be Vietnamese.
11. If visual_scene_1 describes a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required and hook_voiceover must not carry that on-camera line.`;
  }

  if (options.ruleset === 'v7') {
    const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';

    return `## OUTPUT SPECIFICATION - V7 DIRECT ADS BRIEF

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${quantityLabel} idea objects inside that angle.

Use this existing JSON structure so the tool can render and save results, but fill it according to CREATIVE ADS GENERATION RULES V7.
User-facing copy must be in ${options.language}: title/concept, hook lines, character speech, voice/video narrator, text overlay, script_vo, and CTA. Visual scenes and production notes must be Vietnamese. The selected market controls behavior, setting, social context, and vibe only.

[
  {
    "pillar_index": 0,
    "pillar": "exact selected pain point text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "${options.language} direct angle name",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
        "angle_desc": "One ${options.language} sentence describing how this angle attacks the pain point directly",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "hook_primary": "Concept title + direct hook in ${options.language}. No old word-count limit.",
            "hook_alt_1": "Alternative hook direction in ${options.language}, different execution, not a paraphrase",
            "hook_alt_2": "Alternative hook direction in ${options.language}, different execution, not a paraphrase",
            "hook_character_speech": "Concise on-camera character speech in ${options.language}. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Concise voice/video narrator line in ${options.language}. Use a direct statement, not a rhetorical question. Empty string if no narrator.",
            "hook_text_overlay": "On-screen hook text in ${options.language}. A direct statement, not old word-count filler.",
            "reference_pattern": "V7 pattern name, e.g. UGC, 3D Scan, News Leak, Magic Feature, Real Disaster, Reaction Interruption",
            "interrupt_mechanism": "Specific action/image that shocks or creates curiosity at second 0.1",
            "first_frame_asset": "First-frame asset: talent, ethnicity, outfit, location, pose, expression, prop, or phone screen",
            "psp_bridge": "Solution pivot: concrete transition from consequence/pain point into the feature/app action. No old word-count limit.",
            "proof_object": "Number, chart, app screen, prop, or visual proof shown after the pivot",
            "app_demo_action": "Exact feature action: where the finger taps, what changes on screen, how numbers/charts/light/UI change",
            "overlay_sequence": ["0-3s hook overlay in ${options.language}", "3-6s pivot overlay in ${options.language}", "proof/demo overlay in ${options.language}", "CTA overlay in ${options.language}"],
            "edit_notes": "Production/edit notes in Vietnamese: camera angle, cut rhythm, close-up, zoom, crop, caption style, raw UGC level",
            "visual_scene_1": "Vietnamese direct opening (0-3s): detailed movement, camera angle, body state, expression, local setting, and shocking/curiosity action. Do not write generic setup.",
            "visual_scene_2": "Vietnamese solution pivot (3-6s): detailed hand action using the feature, where the finger taps, how the screen lights/changes UI, and how numbers/charts change.",
            "visual_scene_3": "Vietnamese proof/CTA continuation: simple producible visual that confirms the solution and leads to the app action.",
            "script_vo": "Short speakable voice/video script in ${options.language}. If the idea has 2+ people talking, write simple role-accurate dialogue; otherwise use voice-over.",
            "cta_text": "CTA in ${options.language}.",
            "visual_ref_notes": "MARKET & USER ADAPTATION in Vietnamese: ethnicity, clothing, architecture, behavior, culture, and home/work context specific to the market.",
            "talent_profile": "Talent detail in Vietnamese: age, ethnicity, gender, clothing, social relationship, or No talent if no person is needed.",
            "dont_do": "One specific V7 dont-do in Vietnamese.",
            "track": "A|B|C",
            "track_reason": "One Vietnamese sentence explaining why this production track was chosen.",
            "priority": "A|B|C"
          }
        ]
      }
    ]
  }
]

## V7 OUTPUT RULES
1. Output JSON array only.
2. Keep every idea inside the exact selected pain point and selected angle.
3. Do not apply old hook word-count limits, old 3-5s hook rules, or old one-line hook templates.
4. The first visible beat must attack the pain point with brutal directness at second 0.1.
5. visual_scene_1 must be specific enough for a creator or AI video tool to execute exactly.
6. Pivot visual_scene_2 must show the feature/app action in detail: finger position, screen state, light/animation, numbers/chart changes.
7. User-facing copy must be in ${options.language}: title/concept, character speech, text on screen, voice-over/video voice, script_vo, and CTA. Visual and production notes must be Vietnamese.
8. Speech, behavior, setting, props, social relationship, and vibe must feel native to the selected market. Describe the visual execution in Vietnamese.
9. If the idea has a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required. If 2+ people communicate, keep the exchange simple, natural, role-accurate, and include only the necessary dialogue.
10. Do not use rhetorical questions, wordplay, vague metaphors, generic UGC filler, or unnecessary sound design.
11. Use the selected feature/PSP as the Pivot solution.
12. Hyper-localize ethnicity, clothing, architecture, environment, behavior, culture, and social setting to the selected market.`;
  }

  const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';

  return `## OUTPUT SPECIFICATION - CREATIVE BRIEF TREE

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${quantityLabel} idea objects inside that angle.

The array must follow this exact structure:

[
  {
    "pillar_index": 0,
    "pillar": "exact selected pain point text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "3-5 word name for this angle",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
        "angle_desc": "1 sentence describing the unique approach of this angle",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "hook_primary": "Main hook text, 6-16 words, creates pattern interrupt",
            "hook_alt_1": "Alternative hook variation A, different rhetorical approach",
            "hook_alt_2": "Alternative hook variation B, different rhetorical approach",
            "hook_character_speech": "Concise on-camera line in ${options.language} for the 0-3s hook beat. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Concise off-camera narrator/video voice in ${options.language} for the 0-3s hook beat. Do not duplicate hook_primary or hook_text_overlay exactly. Empty string if no narrator.",
            "hook_text_overlay": "On-screen hook text, 6-14 words, punchy and readable. This can match hook_primary, but not hook_voiceover.",
            "reference_pattern": "Named video structure cue. Can be a proven cue, hybrid, or custom pattern, e.g. Siri Bridge, Shock Object, Phone Demo Proof, Transformation Demo, Comment Reply, Split-Screen Choice, Problem-Solution Handheld, or a new pattern name",
            "interrupt_mechanism": "Why the first frame stops scroll: visual oddity, sharp question, contradiction, proof object, social tension, or transformation gap",
            "first_frame_asset": "Exact first-frame asset/object/person/action visible before any explanation",
            "psp_bridge": "One concrete transition from the hook pain/emotion to the PSP/app action, 10-36 words. It explains why the viewer now needs this product, before the Body demo starts.",
            "proof_object": "The concrete object or screen that proves the promise later in the video",
            "app_demo_action": "Exact app action shown on screen: tap, scan, upload, measure, compare, render, clean, save, etc.",
            "overlay_sequence": ["0-3s hook overlay", "3-15s demo overlay", "15-25s proof overlay", "CTA overlay"],
            "edit_notes": "Concrete editing notes: cut rhythm, zoom, caption style, SFX, transition, or b-roll reference",
            "visual_scene_1": "Second 0-3 only: exact hook beat. Who, where, doing what, what pain object is visible. Never write 0-8s.",
            "visual_scene_2": "After hook: exact demo or story visual showing the product action tied to the same pain point.",
            "visual_scene_3": "Second 15-25: exact reveal, proof, result, or final CTA visual.",
            "script_vo": "Full speakable voiceover script, max 60 words.",
            "cta_text": "Exact CTA, max 6 words.",
            "visual_ref_notes": "Specific visual reference for production team.",
            "talent_profile": "Age, gender, look, clothing if talent needed. Use No talent if pure demo.",
            "dont_do": "1 specific thing NOT to do in this video.",
            "track": "A|B|C",
            "track_reason": "1 sentence explaining why this track.",
            "priority": "A|B|C"
          }
        ]
      }
    ]
  }
]

## OUTPUT RULES
1. Output JSON array only.
2. Every field above is required. Use "N/A" only if truly not applicable.
3. hook_primary must be 6-16 words.
4. hook_alt_1 and hook_alt_2 must not be paraphrases of hook_primary.
5. hook_character_speech must be empty unless visual_scene_1 clearly identifies the visible speaker. If visual_scene_1 shows that person speaking/asking/replying/reacting to camera or being asked a question, hook_character_speech is required. Never output "-" or "N/A" for speech.
6. hook_voiceover must be concise enough for the 0-3s hook beat. It must not be the same sentence as hook_primary or hook_text_overlay.
7. visual_scene_1, visual_scene_2, and visual_scene_3 must be specific enough that a video creator can shoot without asking questions.
8. psp_bridge is required and must connect the viewer's emotion/angle to the PSP before the Body starts.
9. reference_pattern, interrupt_mechanism, first_frame_asset, psp_bridge, proof_object, app_demo_action, overlay_sequence, and edit_notes are required production blueprint fields. reference_pattern is a flexible named structure cue, not a closed whitelist. The other blueprint fields must not be generic.
10. script_vo must be speakable in roughly 25 seconds, max 60 words.
11. id must follow P{pillar_index}-A{angle_index}-I{idea_index}, zero-indexed.
12. angle_type must be one of the allowed values and should be different from other angles in the same pillar.
13. track: A = no real person needed, B = real person / UGC, C = motion / animation.
14. Keep every idea inside the exact selected pillar and selected angle. Do not drift into adjacent pain points.
15. User-facing copy fields title, hook_primary, hook_alt_1, hook_alt_2, hook_character_speech, hook_voiceover, hook_text_overlay, script_vo, and cta_text must be in ${options.language}. Visual_scene_1/2/3 and production notes must be Vietnamese.
16. Do not make prohibited claims or before/after health outcome framing.
17. If returning more than 1 idea, no two ideas may use the same hook_primary, the same opening scene family, or the same first visible pain object unless explicitly requested. Reusing a reference_pattern is allowed only when the execution, first-frame asset, and proof object are clearly different.
18. Do not collapse the pain point into a broad symptom. The hook and visual_scene_1 must expose the exact trigger/context/cause from the selected pain point.
19. hook_primary should sound like a human confession, tension line, or pattern interrupt in-feed. Avoid search-query hooks like "Could X explain Y?" unless the user explicitly asks for educational SEO style.
20. visual_scene_1 + hook_voiceover/character_speech + psp_bridge should make the 0-3s hook clear without using old 0-8s or 8-12s timing labels.`;
}

function readFirstText(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const text = readText(record[key]);
    if (text) return text;
  }
  return fallback;
}

function normalizeHookTimingText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(?:second|sec|giây)\s*0\s*[-–]\s*(?:8|10|12)(?:\s*\/\s*12)?\s*s?\b/gi, 'Second 0-3')
    .replace(/\b0\s*[-–]\s*(?:8|10|12)(?:\s*\/\s*12)?\s*s\b/gi, '0-3s')
    .replace(/\b8\s*[-–]\s*12\s*s\b/gi, '0-3s');
}

function readArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(readRecord)
        .filter(item => Object.keys(item).length > 0)
    : [];
}

function normalizeCompareText(text: string): string {
  return text
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[đĐ]/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeCompareText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompareText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  tokensA.forEach(token => {
    if (tokensB.has(token)) intersection += 1;
  });

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

const ANCHOR_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'app',
  'because',
  'before',
  'being',
  'between',
  'cannot',
  'could',
  'every',
  'from',
  'general',
  'have',
  'into',
  'just',
  'like',
  'more',
  'need',
  'only',
  'that',
  'their',
  'them',
  'then',
  'this',
  'user',
  'users',
  'what',
  'when',
  'where',
  'while',
  'with',
  'without',
  'your',
  'cua',
  'cho',
  'con',
  'dang',
  'duoc',
  'khong',
  'minh',
  'mot',
  'nguoi',
  'nhung',
  'phai',
  'thay',
  'trong',
  'tren',
  'voi',
]);

const HEALTH_METRIC_ANCHORS = new Set([
  'blood',
  'pressure',
  'heart',
  'rate',
  'bpm',
  'pulse',
  'glucose',
  'sugar',
  'sleep',
  'calorie',
  'steps',
  'weight',
  'huyet',
  'tim',
  'nhip',
  'duong',
  'ngu',
]);

function extractAnchorTokens(value: string, limit = 14): string[] {
  const seen = new Set<string>();
  const tokens = normalizeCompareText(value)
    .split(' ')
    .filter(token => token.length >= 4 && !ANCHOR_STOP_WORDS.has(token));

  for (const token of tokens) {
    seen.add(token);
    if (seen.size >= limit) break;
  }

  return [...seen];
}

function addUniqueTokens(tokens: string[], additions: string[]) {
  const seen = new Set(tokens);
  additions.forEach(token => {
    if (token && !seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  });
}

function expandAnchorTokens(tokens: string[], source: string): string[] {
  const expanded = [...tokens];
  const normalized = normalizeCompareText(source);

  if (/\bhuyet\b|\bap\b|\bblood\b|\bpressure\b/.test(normalized)) {
    addUniqueTokens(expanded, ['blood', 'pressure', 'low']);
  }
  if (/\bchong\b|\bhoa\b|\bdizzy\b|\blightheaded\b|\bspinning\b/.test(normalized)) {
    addUniqueTokens(expanded, ['dizzy', 'lightheaded', 'spinning', 'head']);
  }
  if (/\bnau\b|\ban\b|\bcook\b|\bkitchen\b|\bstove\b/.test(normalized)) {
    addUniqueTokens(expanded, ['cooking', 'kitchen', 'stove', 'counter', 'pan']);
  }
  if (/\bsang\b|\bmorning\b|\bday\b|\bstand\b|\bdung\b|\bwake\b/.test(normalized)) {
    addUniqueTokens(expanded, ['morning', 'standing', 'wake', 'bed']);
  }
  if (/\bmet\b|\btired\b|\bfatigue\b/.test(normalized)) {
    addUniqueTokens(expanded, ['tired', 'fatigue']);
  }

  return expanded;
}

function countTokenHits(text: string, tokens: string[]): number {
  const normalized = new Set(normalizeCompareText(text).split(' ').filter(Boolean));
  return tokens.reduce((count, token) => count + (normalized.has(token) ? 1 : 0), 0);
}

function sanitizeHealthClaimText(text: string): string {
  if (!text) return text;

  return text
    .replace(/\bclinical diagnosis\b/gi, 'tracking note')
    .replace(/\bmedical results?\b/gi, 'health notes')
    .replace(/\bdetect disease\b/gi, 'notice a pattern')
    .replace(/\breplace doctor\b/gi, 'keep notes for a check-in')
    .replace(/\bdiagnos(?:e|is|ing)\b/gi, 'track')
    .replace(/\btreat(?:ment|ing)?\b/gi, 'track')
    .replace(/\bcure\b/gi, 'track')
    .replace(/\bheal(?:ed|ing)?\b/gi, 'track')
    .replace(/\bclinical\b/gi, 'personal')
    .replace(/\bchẩn đoán\b/gi, 'ghi lại xu hướng')
    .replace(/\bđiều trị\b/gi, 'theo dõi')
    .replace(/\bchữa(?: khỏi)?\b/gi, 'theo dõi')
    .replace(/\bphát hiện bệnh\b/gi, 'nhìn ra xu hướng')
    .replace(/\bthay thế bác sĩ\b/gi, 'ghi chú trước khi trao đổi thêm')
    .replace(/\bkết quả y tế chính xác\b/gi, 'ghi chú sức khỏe cá nhân');
}

function healthMetricLabel(tokens: string[], sourceText = ''): string {
  const tokenSet = new Set(tokens);
  const normalizedSource = normalizeCompareText(sourceText);
  if (tokenSet.has('blood') || tokenSet.has('pressure') || tokenSet.has('huyet')) {
    if (/\b(camera|iphone|measure|do|scan|cam)\b/.test(normalizedSource)) return 'đo huyết áp bằng camera';
    if (/\b(log|journal|diary|history|track|theo doi|ghi lai|nhat ky)\b/.test(normalizedSource)) return 'theo dõi huyết áp';
    return 'huyết áp';
  }
  if (tokenSet.has('heart') || tokenSet.has('rate') || tokenSet.has('bpm') || tokenSet.has('pulse') || tokenSet.has('tim') || tokenSet.has('nhip')) return 'nhip tim';
  if (tokenSet.has('glucose') || tokenSet.has('sugar') || tokenSet.has('duong')) return 'duong huyet';
  if (tokenSet.has('sleep') || tokenSet.has('ngu')) return 'xu huong giac ngu';
  if (tokenSet.has('calorie') || tokenSet.has('weight')) return 'xu huong suc khoe hang ngay';
  return '';
}

function hasContextCueInHook(hook: string, context: string): boolean {
  const normalizedHook = normalizeCompareText(hook);
  const normalizedContext = normalizeCompareText(context);
  if (!normalizedHook || !normalizedContext) return true;

  const cookingContext = /\b(nau|bep|cook|kitchen|stove|pan|chao|rau|counter)\b/.test(normalizedContext);
  if (cookingContext) {
    return /\b(nau|bep|cook|kitchen|stove|pan|chao|rau|counter|thai|dao)\b/.test(normalizedHook);
  }

  const standingContext = /\b(dung|stand|standing|sang|morning|giuong|wake|bam|vin|toi sam)\b/.test(normalizedContext);
  if (standingContext) {
    return /\b(dung|stand|standing|sang|morning|giuong|wake|bam|vin|toi sam)\b/.test(normalizedHook);
  }

  return true;
}

function buildHealthMetricHook(index: number, context = ''): string {
  const normalizedContext = normalizeCompareText(context);
  const cookingTemplates = [
    'Đang nấu ăn, tôi bỗng phải bám mép bếp.',
    'Tôi khựng lại giữa lúc đảo chảo.',
    'Đang thái rau, mắt tôi tối sầm.',
    'Một cơn choáng chen ngang bữa sáng.',
    'Tay vẫn cầm chảo, người đã phải vịn bếp.',
  ];
  const standingTemplates = [
    'Vừa đứng dậy, mắt tôi tối sầm.',
    'Bình thường thôi, cho đến lúc tôi đứng lên.',
    'Tôi phải vịn giường ngay khi đứng dậy.',
    'Sáng nào đứng lên cũng có một nhịp khựng.',
    'Đứng dậy quá nhanh, tôi phải bám tường.',
  ];
  const generalTemplates = [
    'Cơn choáng này có một điểm tôi bỏ sót.',
    'Tôi bắt đầu ghi lại những lần bị choáng.',
    'Không phải ngày nào tôi choáng cũng giống nhau.',
    'Tôi đã bỏ qua khoảnh khắc khựng này quá lâu.',
    'Khoảnh khắc khựng lại đó bắt đầu làm tôi lo.',
  ];
  const templates = /\b(nau|bep|cook|kitchen|stove|pan|chao|rau|counter)\b/.test(normalizedContext)
    ? cookingTemplates
    : /\b(dung|stand|standing|sang|morning|giuong|wake|bam|vin|toi sam)\b/.test(normalizedContext)
      ? standingTemplates
      : generalTemplates;
  const hook = templates[index % templates.length];
  return hook.charAt(0).toUpperCase() + hook.slice(1);
}

function looksEnglish(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;

  const englishTokens = normalized.match(/\b(?:the|this|that|with|without|because|every|again|just|why|what|when|where|how|your|you|does|did|was|were|from|into|while|before|after|thought|started|changed|older|dizzy|scary|morning|tap|drag|dropped|counter|kitchen|cooking)\b/g) || [];
  const spanishTokens = normalized.match(/\b(?:plano|primer|segundo|mujer|hombre|sentada|sentado|sala|sofa|mano|mesa|vaso|agua|vacio|camara|acerca|dice|dijo|mareo|presion|cocina|desayuno|cafe|izquierda|derecha|pantalla|persona|levant|pensaba|revisar|abri|abrir|incertidumbre|concreto|mientras|cuando|porque|estaba|pasando|preguntas|imaginar|escenarios)\b/g) || [];
  const vietnameseCueTokens = normalized.match(/\b(?:toi|ban|minh|nguoi|nha|phong|khach|noi|that|thiet|ke|chi|phi|bao|gia|sua|du|toan|anh|dep|mau|van|khong|chua|muon|roi|ro|mat|nhin|chon|can|truoc|sau|luc|nay|do|thay|biet|bat|dau|kho|roi|mo|ho)\b/g) || [];
  const foreignTokenCount = englishTokens.length + spanishTokens.length;
  if (vietnameseCueTokens.length >= 5 && foreignTokenCount < 6) return false;
  return englishTokens.length >= 4 || spanishTokens.length >= 4;
}

function looksVietnamese(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;

  const hasVietnameseDiacritics = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text);
  const vietnameseCueTokens = normalized.match(/\b(?:toi|ban|minh|nguoi|phu|nu|dan|ong|nha|phong|khach|trong|tron|noi|that|thiet|ke|chi|phi|bao|gia|sua|du|toan|anh|dep|mau|khong|chua|muon|roi|mat|nhin|chon|truoc|sau|luc|nay|thay|biet|bat|dau|kho|mo|ho|them|tren|man|hinh|goi|thang|dung|khoanh|khac|cat|sang|tinh|nang|theo|doi|don|gian|cho|nhu|mot|buoc|xu|ly|van|de|vua|lo|ra|giu|bang|chuyen|tao|lai|toan|bo)\b/g) || [];
  const englishTokens = normalized.match(/\b(?:the|this|that|with|without|because|every|again|just|why|what|when|where|how|your|you|does|did|was|were|from|into|while|before|after|thought|started|changed|room|living|empty|blank|app|style|decorating|design|first|problem|camera|screen|phone|upload|choose|tap|shows|final|find|try|save|saved)\b/g) || [];

  if (hasVietnameseDiacritics && vietnameseCueTokens.length >= 1) return true;
  return vietnameseCueTokens.length >= 6 && vietnameseCueTokens.length > englishTokens.length;
}

function isSearchQueryHook(text: string): boolean {
  return /^(?:could|is|are|can|does|do|did|why|how|what)\b.{12,}\?$/i.test(text.trim());
}

function firstSentenceSnippet(text: string, maxWords = 22): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function isSameLine(a: string, b: string): boolean {
  const left = normalizeCompareText(a);
  const right = normalizeCompareText(b);
  return Boolean(left && right && left === right);
}

function visualMentionsVisibleSpeaker(visual: string): boolean {
  const normalized = normalizeCompareText(visual);
  return /\b(?:nguoi|phu nu|dan ong|nam|nu|me|bo|vo|chong|con|ban|khach|nhan vat|talent|creator|host|user|woman|man|mom|dad|wife|husband|customer|teen)\b/.test(normalized);
}

function visualImpliesOnCameraSpeech(visual: string): boolean {
  const normalized = normalizeCompareText(visual);
  if (!visualMentionsVisibleSpeaker(visual)) return false;
  return /\b(?:noi|noi thang|hoi|tra loi|dap lai|keu|bao|thot|doc|phong van|hoi dap|doi thoai|talks?|speaks?|says?|asks?|replies?|answers?|responds?|tells?|confesses?|comments?|interviews?|talking to camera|speaking to camera|talking head)\b/.test(normalized);
}

function hasPatternInterrupt(text: string): boolean {
  const raw = text.toLowerCase();
  const normalized = normalizeCompareText(text);
  const interruptPattern = /(?:\?|\d|%|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|wait\b|mistake\b|wrong\b|hidden\b|secret\b|ruin\b|cost\b|missing\b|detail\b|clue\b|saved\b|real\b|actual\b|fit\b|zero\b|answer\b|truth\b|blood\b|pressure\b|heart\b|rate\b|standing\b|dizzy\b|lightheaded\b|morning\b|older\b|scary\b|pause\b|signal\b|ignoring\b|bothering\b|nobody\b|most\b|sao\b|tai sao\b|van\b|dung\b|khong can\b|thay vi\b|bao gio\b|te nhat\b|met\b|phien\b|kho\b|shock\b|hau het\b|su that\b|that ra\b|sai lam\b|nguoc\b|lo lang\b|so\b|huyet\b|nhip\b|tim\b|hoa mat\b|chong mat\b|choang\b|bep\b|nau\b|tuoi\b|khung\b|tin hieu\b|bi mat\b|thieu\b|an sau\b|thiet ke\b|noi that\b|phong khach\b|bao gia\b|chi phi\b|du toan\b|ngan sach\b|sua nha\b|anh dep\b|mau nha\b|ban ve\b|mat bang\b|khong ra nha\b|roi hon\b|mo ho\b|chon sai\b|doi chi phi\b)/i;
  return interruptPattern.test(raw)
    || interruptPattern.test(normalized)
    || /(?:\b60\b|\b70\b|\b80\b|\b90\b|\b1\b|\b3\b|\b5\b|\b7\b)/.test(normalized);
}

function normalizeBriefTrack(track: string): string {
  const normalized = track.trim().toUpperCase();
  return ['A', 'B', 'C'].includes(normalized) ? normalized : 'B';
}

function creativeTypeForTrack(track: string): string {
  if (track === 'A') return '2D Animation';
  if (track === 'C') return 'Motion Graphic';
  return 'UGC';
}

function createBriefValidationErrors(input: {
  id: string;
  angleType: string;
  hookPrimary: string;
  hookAlt1: string;
  hookAlt2: string;
  hookCharacterSpeech?: string;
  hookVoiceover?: string;
  hookTextOverlay?: string;
  pspBridge?: string;
  visualScene1: string;
  visualScene2: string;
  visualScene3: string;
  scriptVo: string;
  ctaText: string;
  dontDo: string;
  track: string;
  priority: string;
  painpointTokens?: string[];
  solutionTokens?: string[];
  language?: string;
  ruleset?: 'default' | 'v7' | 'builder';
}) {
  const errors: string[] = [];
  const trackingPattern = /^P\d+-A\d+-I\d+$/;
  const allowedAngleTypes = new Set(['fear', 'fact', 'comparison', 'pov', 'social', 'curiosity', 'relief']);

  if (!trackingPattern.test(input.id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!allowedAngleTypes.has(normalizeCompareText(input.angleType))) {
    errors.push('angle_type must be Fear, Fact, Comparison, POV, Social, Curiosity, or Relief');
  }
  if (!input.hookPrimary) errors.push('hook_primary is required');
  if (/vietnam/i.test(input.language || '')) {
    const languageText = [
      input.hookPrimary,
      input.hookAlt1,
      input.hookAlt2,
      input.hookCharacterSpeech || '',
      input.hookVoiceover || '',
      input.hookTextOverlay || '',
      input.pspBridge || '',
      input.visualScene1,
      input.visualScene2,
      input.visualScene3,
      input.scriptVo,
      input.ctaText,
    ].join(' ');
    if (looksEnglish(languageText)) {
      errors.push('all user-facing fields must be Vietnamese, not English/Spanish');
    }
  } else if (/english/i.test(input.language || '')) {
    const languageText = [
      input.hookPrimary,
      input.hookAlt1,
      input.hookAlt2,
      input.hookCharacterSpeech || '',
      input.hookVoiceover || '',
      input.hookTextOverlay || '',
      input.scriptVo,
      input.ctaText,
    ].join(' ');
    if (looksVietnamese(languageText)) {
      errors.push('copy fields must be English; Vietnamese is only allowed in visual/production fields');
    }
  }
  const isV7 = input.ruleset === 'v7';
  const isBuilder = input.ruleset === 'builder';
  const hookPrimaryWordCount = countWords(input.hookPrimary);
  if (isBuilder && input.hookPrimary && hookPrimaryWordCount > 12) {
    errors.push('hook_primary must be under 12 words for prompt_system_builder_html_v1');
  } else if (!isV7 && !isBuilder && input.hookPrimary && (hookPrimaryWordCount < 5 || hookPrimaryWordCount > 16)) {
    errors.push('hook_primary must be 5-16 words');
  }
  if (input.hookPrimary && !hasPatternInterrupt(input.hookPrimary)) {
    errors.push('hook_primary must create a clear pattern interrupt');
  }
  if (isV7) {
    const hookCopy = [input.hookPrimary, input.hookCharacterSpeech || '', input.hookVoiceover || '', input.hookTextOverlay || ''].join(' ');
    if (/\?/.test(hookCopy)) {
      errors.push('V7 forbids rhetorical question hooks; use a direct statement');
    }
  }
  if (!input.hookAlt1) errors.push('hook_alt_1 is required');
  if (!input.hookAlt2) errors.push('hook_alt_2 is required');
  if (input.hookPrimary && input.hookAlt1 && normalizeCompareText(input.hookPrimary) === normalizeCompareText(input.hookAlt1)) {
    errors.push('hook_alt_1 must not repeat hook_primary');
  }
  if (input.hookPrimary && input.hookAlt2 && normalizeCompareText(input.hookPrimary) === normalizeCompareText(input.hookAlt2)) {
    errors.push('hook_alt_2 must not repeat hook_primary');
  }
  if (input.hookPrimary && input.hookAlt1 && jaccardSimilarity(input.hookPrimary, input.hookAlt1) >= 0.78) {
    errors.push('hook_alt_1 must use a different hook approach, not a paraphrase');
  }
  if (input.hookPrimary && input.hookAlt2 && jaccardSimilarity(input.hookPrimary, input.hookAlt2) >= 0.78) {
    errors.push('hook_alt_2 must use a different hook approach, not a paraphrase');
  }
  const hookCharacterSpeech = readSpeechText(input.hookCharacterSpeech);
  const hookVoiceover = readSpeechText(input.hookVoiceover);
  const hookTextOverlay = readText(input.hookTextOverlay);
  if (!hookCharacterSpeech && !hookVoiceover && !hookTextOverlay) {
    errors.push('hook needs hook_character_speech, hook_voiceover, or hook_text_overlay');
  }
  if (hookCharacterSpeech && !visualMentionsVisibleSpeaker(input.visualScene1)) {
    errors.push('hook_character_speech requires a clearly visible speaker in visual_scene_1');
  }
  if (visualImpliesOnCameraSpeech(input.visualScene1) && !hookCharacterSpeech) {
    errors.push('hook_character_speech is required when visual_scene_1 describes visible on-camera speech or dialogue');
  }
  if (!isV7 && hookCharacterSpeech && countWords(hookCharacterSpeech) > 36) {
    errors.push('hook_character_speech must be 36 words or fewer');
  }
  if (!isV7 && hookVoiceover && countWords(hookVoiceover) > 48) {
    errors.push('hook_voiceover must be 48 words or fewer');
  }
  if (!isV7 && hookVoiceover && countWords(hookVoiceover) < 12 && !hookCharacterSpeech) {
    errors.push('hook_voiceover is too short to carry the hook beat');
  }
  if (hookVoiceover && isSameLine(hookVoiceover, input.hookPrimary)) {
    errors.push('hook_voiceover must not duplicate hook_primary');
  }
  if (hookCharacterSpeech && isSameLine(hookCharacterSpeech, input.hookPrimary)) {
    errors.push('hook_character_speech must not duplicate hook_primary; add speaker texture or omit it');
  }
  if (hookVoiceover && hookTextOverlay && isSameLine(hookVoiceover, hookTextOverlay)) {
    errors.push('hook_voiceover must not duplicate hook_text_overlay');
  }
  const pspBridge = readText(input.pspBridge);
  if (!pspBridge) {
    errors.push('psp_bridge is required');
  }
  if (!isV7 && pspBridge && countWords(pspBridge) > 38) {
    errors.push('psp_bridge must be 38 words or fewer');
  }
  if (!isV7 && pspBridge && countWords(pspBridge) < 7) {
    errors.push('psp_bridge is too short to connect hook to PSP');
  }
  if (pspBridge && input.hookPrimary && isSameLine(pspBridge, input.hookPrimary)) {
    errors.push('psp_bridge must not duplicate hook_primary');
  }
  if (!input.visualScene1 || input.visualScene1.split(/\s+/).filter(Boolean).length < 10) {
    errors.push('visual_scene_1 must be concrete and shootable');
  }
  if (isBuilder && /\b(?:0\s*[-–]\s*(?:8|10|12)|8\s*[-–]\s*12)(?:\s*\/\s*12)?\s*s?\b/i.test(input.visualScene1)) {
    errors.push('visual_scene_1 must be 0-3s only for prompt_system_builder_html_v1');
  }
  if (!input.visualScene2 || input.visualScene2.split(/\s+/).filter(Boolean).length < 10) {
    errors.push('visual_scene_2 must be concrete and shootable');
  }
  if (!input.visualScene3 || input.visualScene3.split(/\s+/).filter(Boolean).length < 8) {
    errors.push('visual_scene_3 must be concrete and shootable');
  }
  if ((input.painpointTokens || []).length >= 2) {
    const openingText = `${input.hookPrimary} ${input.hookAlt1} ${input.hookAlt2} ${input.visualScene1}`;
    const healthMetricAnchors = (input.solutionTokens || []).filter(token => HEALTH_METRIC_ANCHORS.has(token));
    void openingText;
    void healthMetricAnchors;
  }
  if (!input.scriptVo) errors.push('script_vo is required');
  if (input.scriptVo && input.scriptVo.split(/\s+/).filter(Boolean).length > 60) {
    errors.push('script_vo must be 60 words or fewer');
  }
  if (!input.ctaText) errors.push('cta_text is required');
  if (!isV7 && input.ctaText && input.ctaText.split(/\s+/).filter(Boolean).length > 6) {
    errors.push('cta_text must be 6 words or fewer');
  }
  if (!input.dontDo || input.dontDo.split(/\s+/).filter(Boolean).length < 5) {
    errors.push('dont_do must be specific enough for QC');
  }
  if (!['A', 'B', 'C'].includes(input.track)) errors.push('track must be A, B, or C');
  if (!['A', 'B', 'C'].includes(input.priority)) errors.push('priority must be A, B, or C');

  return errors;
}

export function normalizeCreativeBriefOutput(
  input: unknown,
  defaults: {
    duration: string;
    appName: string;
    pillar?: string;
    coreUser?: string;
    emotion?: string;
    psp?: string;
    angle?: string;
    ideaDescription?: string;
    language?: string;
    ruleset?: 'default' | 'v7' | 'builder';
  }
): { items: Record<string, unknown>[]; invalidReasons: string[] } {
  const rootItems = Array.isArray(input) ? input : [input];
  const items: Record<string, unknown>[] = [];
  const invalidReasons: string[] = [];
  const isV7Ruleset = defaults.ruleset === 'v7';

  rootItems.map(readRecord).forEach((pillarRecord, pillarFallbackIndex) => {
    if (Object.keys(pillarRecord).length === 0) return;

    const pillarIndex = Number(pillarRecord.pillar_index ?? pillarRecord.pillarIndex ?? pillarFallbackIndex) || 0;
    const pillar = readFirstText(pillarRecord, ['pillar'], defaults.pillar || 'General user friction');
    if (defaults.pillar && normalizeCompareText(pillar) !== normalizeCompareText(defaults.pillar)) {
      invalidReasons.push(`Pillar ${pillarIndex}: pillar must stay exact selected pain point`);
      return;
    }
    const angleRecords = readArray(pillarRecord.angles);

    if (angleRecords.length === 0) {
      invalidReasons.push(`Pillar ${pillarIndex}: angles array is required`);
      return;
    }

    const seenAngleTypes = new Set<string>();
    const selectedPainpointSource = [defaults.pillar, defaults.angle, defaults.ideaDescription].filter(Boolean).join(' ');
    const selectedPainpointTokens = expandAnchorTokens(
      extractAnchorTokens(selectedPainpointSource, 18),
      selectedPainpointSource
    );
    const selectedSolutionTokens = extractAnchorTokens(defaults.psp || '', 10);

    angleRecords.forEach((angleRecord, angleFallbackIndex) => {
      const angleIndex = Number(angleRecord.angle_index ?? angleRecord.angleIndex ?? angleFallbackIndex) || 0;
      const angleName = readFirstText(angleRecord, ['angle_name', 'angleName'], 'Core angle');
      const angleType = readFirstText(angleRecord, ['angle_type', 'angleType'], 'Curiosity');
      const angleDesc = readFirstText(angleRecord, ['angle_desc', 'angleDesc'], 'A distinct approach for this pillar.');
      const normalizedAngleType = angleType.trim();
      const angleTypeKey = normalizeCompareText(normalizedAngleType);

      if (seenAngleTypes.has(angleTypeKey)) {
        invalidReasons.push(`P${pillarIndex}-A${angleIndex}: angle_type duplicates another angle in this pillar`);
      }
      if (angleTypeKey) seenAngleTypes.add(angleTypeKey);

      const briefIdeas = readArray(angleRecord.ideas);
      if (briefIdeas.length === 0) {
        invalidReasons.push(`P${pillarIndex}-A${angleIndex}: ideas array is required`);
        return;
      }

      const acceptedHookPrimaries: string[] = [];
      const acceptedOpeningScenes: string[] = [];

      briefIdeas.forEach((ideaRecord, ideaFallbackIndex) => {
        const id = readFirstText(ideaRecord, ['id'], `P${pillarIndex}-A${angleIndex}-I${ideaFallbackIndex}`);
        let hookPrimary = readFirstText(ideaRecord, ['hook_primary', 'hookPrimary']);
        let hookAlt1 = readFirstText(ideaRecord, ['hook_alt_1', 'hookAlt1']);
        let hookAlt2 = readFirstText(ideaRecord, ['hook_alt_2', 'hookAlt2']);
        let hookCharacterSpeech = readSpeechText(readFirstText(ideaRecord, ['hook_character_speech', 'hookCharacterSpeech', 'character_speech', 'characterSpeech']));
        let hookVoiceover = readSpeechText(readFirstText(ideaRecord, ['hook_voiceover', 'hookVoiceover', 'voiceover', 'voice_over']));
        let hookTextOverlay = readFirstText(ideaRecord, ['hook_text_overlay', 'hookTextOverlay', 'text_overlay', 'textOverlay']);
        let visualScene1 = readFirstText(ideaRecord, ['visual_scene_1', 'visualScene1']);
        let visualScene2 = readFirstText(ideaRecord, ['visual_scene_2', 'visualScene2']);
        let visualScene3 = readFirstText(ideaRecord, ['visual_scene_3', 'visualScene3']);
        let scriptVo = readFirstText(ideaRecord, ['script_vo', 'scriptVo']);
        let ctaText = readFirstText(ideaRecord, ['cta_text', 'ctaText']);
        const referencePattern = readFirstText(ideaRecord, ['reference_pattern', 'referencePattern'], 'Custom Painpoint-Led Pattern');
        const interruptMechanism = readFirstText(ideaRecord, ['interrupt_mechanism', 'interruptMechanism'], hookPrimary || angleDesc);
        const firstFrameAsset = readFirstText(ideaRecord, ['first_frame_asset', 'firstFrameAsset'], visualScene1);
        let pspBridge = readFirstText(ideaRecord, ['psp_bridge', 'pspBridge']);
        const proofObject = readFirstText(ideaRecord, ['proof_object', 'proofObject'], visualScene3 || visualScene2);
        const appDemoAction = readFirstText(ideaRecord, ['app_demo_action', 'appDemoAction'], defaults.psp || defaults.appName);
        const overlaySequence = readTextArray(ideaRecord.overlay_sequence ?? ideaRecord.overlaySequence);
        const editNotes = readFirstText(
          ideaRecord,
          ['edit_notes', 'editNotes'],
          'Nhịp cắt nhanh kiểu UGC: mở bằng first-frame asset, chuyển sang demo app thật, giữ caption lớn và proof frame rõ.'
        );
        const visualRefNotes = readFirstText(ideaRecord, ['visual_ref_notes', 'visualRefNotes']);
        const talentProfile = readFirstText(ideaRecord, ['talent_profile', 'talentProfile'], 'No talent specified');
        let dontDo = readFirstText(ideaRecord, ['dont_do', 'dontDo']);
        const track = readFirstText(ideaRecord, ['track'], 'B').trim().toUpperCase();
        const trackReason = readFirstText(ideaRecord, ['track_reason', 'trackReason']);
        const priority = readFirstText(ideaRecord, ['priority'], 'A').trim().toUpperCase();
        const metricLabel = isV7Ruleset ? '' : healthMetricLabel(selectedSolutionTokens, defaults.psp || '');
        const metricAnchors = selectedSolutionTokens.filter(token => HEALTH_METRIC_ANCHORS.has(token));

        hookPrimary = sanitizeHealthClaimText(hookPrimary);
        hookAlt1 = sanitizeHealthClaimText(hookAlt1);
        hookAlt2 = sanitizeHealthClaimText(hookAlt2);
        hookCharacterSpeech = sanitizeHealthClaimText(hookCharacterSpeech);
        hookVoiceover = sanitizeHealthClaimText(hookVoiceover);
        hookTextOverlay = sanitizeHealthClaimText(hookTextOverlay);
        pspBridge = sanitizeHealthClaimText(pspBridge);
        visualScene1 = sanitizeHealthClaimText(visualScene1);
        visualScene2 = sanitizeHealthClaimText(visualScene2);
        visualScene3 = sanitizeHealthClaimText(visualScene3);
        scriptVo = sanitizeHealthClaimText(scriptVo);
        ctaText = sanitizeHealthClaimText(ctaText);
        dontDo = sanitizeHealthClaimText(dontDo);
        visualScene1 = normalizeHookTimingText(visualScene1);

        if (!hookTextOverlay) {
          hookTextOverlay = hookPrimary;
        }
        if (!hookVoiceover && !isV7Ruleset) {
          const candidateVoiceover = firstSentenceSnippet(scriptVo);
          if (candidateVoiceover && !isSameLine(candidateVoiceover, hookPrimary) && !isSameLine(candidateVoiceover, hookTextOverlay)) {
            hookVoiceover = candidateVoiceover;
          }
        }
        if (isSameLine(hookVoiceover, hookPrimary) || isSameLine(hookVoiceover, hookTextOverlay)) {
          hookVoiceover = '';
        }
        if (isSameLine(hookCharacterSpeech, hookPrimary) || !visualMentionsVisibleSpeaker(visualScene1)) {
          hookCharacterSpeech = '';
        }
        if (visualImpliesOnCameraSpeech(visualScene1) && !hookCharacterSpeech) {
          const speechCandidate = firstSentenceSnippet(scriptVo || hookVoiceover || hookTextOverlay || hookPrimary, 18);
          if (speechCandidate && !isSameLine(speechCandidate, hookTextOverlay)) {
            hookCharacterSpeech = speechCandidate;
          }
        }
        if (!pspBridge) {
          pspBridge = `Lúc này ${defaults.appName} là bước xử lý đúng vấn đề vừa lộ ra.`;
        }

        const hookContext = [selectedPainpointSource, angleName, angleDesc, visualScene1].filter(Boolean).join(' ');
        const shouldUseContextualHook = metricLabel
          && (
            !hasContextCueInHook(hookPrimary, hookContext)
            || (/vietnam/i.test(defaults.language || '') && looksEnglish(hookPrimary))
          );

        if (
          metricLabel
          && (
            !hasPatternInterrupt(hookPrimary)
            || isSearchQueryHook(hookPrimary)
            || shouldUseContextualHook
          )
        ) {
          hookPrimary = buildHealthMetricHook(
            ideaFallbackIndex,
            hookContext
          );
        }

        if (metricLabel && countTokenHits(`${hookPrimary} ${hookAlt1} ${hookAlt2} ${visualScene1}`, metricAnchors) < 1) {
          visualScene1 = `${visualScene1} Khung hình đầu có text hoặc ghi chú trên điện thoại: "${metricLabel}?" để khoảnh khắc này chỉ được hiểu là nhu cầu theo dõi xu hướng.`;
        }

        if (selectedPainpointTokens.length >= 2 && countTokenHits(`${hookPrimary} ${hookAlt1} ${hookAlt2} ${visualScene1}`, selectedPainpointTokens) < 2) {
          const selectedMoment = hookTextOverlay || hookPrimary || 'the selected user problem';
          visualScene1 = `${visualScene1} Thêm text trên màn hình gọi thẳng đúng khoảnh khắc: "${selectedMoment}".`;
        }

        if (selectedSolutionTokens.length >= 2 && countTokenHits(`${visualScene2} ${visualScene3} ${scriptVo} ${ctaText}`, selectedSolutionTokens) < 1) {
          visualScene2 = `${visualScene2} Cắt sang ${defaults.appName}, dùng ${defaults.psp || 'tính năng đã chọn'} như bước xử lý đơn giản cho đúng khoảnh khắc đó.`;
        }

        const errors = createBriefValidationErrors({
          id,
          angleType: normalizedAngleType,
          hookPrimary,
          hookAlt1,
          hookAlt2,
          hookCharacterSpeech,
          hookVoiceover,
          hookTextOverlay,
          pspBridge,
          visualScene1,
          visualScene2,
          visualScene3,
          scriptVo,
          ctaText,
          dontDo,
          track,
          priority,
          painpointTokens: selectedPainpointTokens,
          solutionTokens: selectedSolutionTokens,
          language: defaults.language,
          ruleset: defaults.ruleset,
        });

        if (acceptedHookPrimaries.some(existing => jaccardSimilarity(existing, hookPrimary) >= 0.72)) {
          errors.push('hook_primary duplicates another idea in this batch');
        }
        if (acceptedOpeningScenes.some(existing => jaccardSimilarity(existing, visualScene1) >= 0.74)) {
          errors.push('visual_scene_1 repeats the same opening scene family as another idea');
        }

        if (errors.length > 0) {
          invalidReasons.push(`${id}: ${errors.join('; ')}`);
          return;
        }

        acceptedHookPrimaries.push(hookPrimary);
        acceptedOpeningScenes.push(visualScene1);

        items.push(normalizeIdeaOutput({
          id,
          title: readFirstText(ideaRecord, ['title'], hookPrimary || angleName),
          duration: defaults.duration,
          creativeType: creativeTypeForTrack(normalizeBriefTrack(track)),
          meta: {
            builderVersion: 'prompt_system_builder_html_v1',
            pillar,
            pillarIndex,
            angleName,
            angleType: normalizedAngleType,
            angleDesc,
            hookPrimary,
            hookAlt1,
            hookAlt2,
            referencePattern,
            interruptMechanism,
            firstFrameAsset,
            pspBridge,
            proofObject,
            appDemoAction,
            overlaySequence,
            editNotes,
            visualRefNotes,
            talentProfile,
            dontDo,
            track: normalizeBriefTrack(track),
            trackReason,
            priority: normalizeBriefTrack(priority),
          },
          framework: {
            coreUser: defaults.coreUser || 'General viewer',
            painpoint: pillar,
            emotion: defaults.emotion || 'Create a clear viewer emotion',
            psp: defaults.psp || defaults.appName,
          },
          explanation: angleDesc,
          hook: {
            durationSeconds: 3,
            visual: visualScene1,
            characterSpeech: hookCharacterSpeech,
            voiceover: hookVoiceover,
            voice: hookVoiceover || hookCharacterSpeech,
            textOverlay: hookTextOverlay || hookPrimary,
            text: hookTextOverlay || hookPrimary,
            viTranslation: [hookCharacterSpeech, hookVoiceover, hookTextOverlay || hookPrimary].filter(Boolean).join(' / '),
            viewerProfile: defaults.coreUser || '',
            viewerEmotion: defaults.emotion || '',
            painpointImpact: pillar,
            whyTheyStopScrolling: angleDesc,
          },
          body: {
            visual: visualScene2,
            voiceover: scriptVo,
            voice: scriptVo,
            textOverlay: hookAlt1,
            text: hookAlt1,
            viTranslation: scriptVo,
          },
          cta: {
            visual: visualScene3,
            voiceover: ctaText,
            voice: ctaText,
            textOverlay: ctaText,
            text: ctaText,
            viTranslation: ctaText,
            endCard: `${defaults.appName} - ${ctaText}`,
          },
        }, {
          duration: defaults.duration,
          appName: defaults.appName,
          pillar,
        }));
      });
    });
  });

  return { items, invalidReasons };
}

export function buildHookOutputSpec(options: HookOutputSpecOptions): string {
  const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';
  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "${options.language} variant title",
  "explanation": "Vietnamese explanation of what changed and why it works",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "hookPrimary": "Natural hook line in ${options.language}, 6-16 words",
    "hookAlt1": "Alternative hook A in ${options.language} with a different rhetorical approach",
    "hookAlt2": "Alternative hook B in ${options.language} with a different rhetorical approach",
    "visualRefNotes": "Specific production note",
    "talentProfile": "Age, look, clothing, or No talent",
    "dontDo": "1 specific thing not to do"
  },
  "hook": {
    "durationSeconds": 3,
    "visual": "Detailed hook-only visual in Vietnamese",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen text in ${options.language}, around 6-16 words, aligned with meta.hookPrimary",
    "viTranslation": "Optional English recap of hook speech/voiceover + text",
    "viewerEmotion": "${options.language} description of what the viewer feels",
    "painpointImpact": "${options.language} description of why this pain lands",
    "whyTheyStopScrolling": "1 ${options.language} sentence explaining the stop-scroll reason"
  }
}]

## OUTPUT RULES
- Focus on the 0-3s hook beat only.
- Keep the winning hook DNA unless the user explicitly asks to change it.
- Hooks may be descriptive when needed. Avoid clipped keyword fragments; write native, speakable hook lines.
- hook.durationSeconds must estimate the actual hook runtime as an integer second count, normally 3 seconds.
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
