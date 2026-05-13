import { GLOBAL_EMOTION_PROMPT_GUIDE } from './emotionOptions';

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
  visualType?: string;
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

function trimWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : text;
}

function splitOverlayLanguageParts(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const separators = [' / ', ' | ', ' — ', ' -- ', '\n'];
  const separator = separators.find(item => clean.includes(item));
  return (separator ? clean.split(separator) : [clean])
    .map(part => part.trim())
    .filter(Boolean);
}

function trimOverlayWords(text: string, maxWordsPerLanguage: number): string {
  const clean = text.trim();
  if (!clean) return '';
  const separators = [' / ', ' | ', ' — ', ' -- ', '\n'];
  const separator = separators.find(item => clean.includes(item));
  if (!separator) return trimWords(clean, maxWordsPerLanguage);
  return clean
    .split(separator)
    .map(part => trimWords(part.trim(), maxWordsPerLanguage))
    .filter(Boolean)
    .join(separator);
}

function maxOverlayWordsPerLanguage(text: string): number {
  return Math.max(0, ...splitOverlayLanguageParts(text).map(countWords));
}

function vietnameseOverlayPart(text: string): string {
  return splitOverlayLanguageParts(text)[0] || text.trim();
}

function stripOverlayTimePrefix(text: string): string {
  return text
    .replace(/^\s*(?:sec\s*)?\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*s?\s*:\s*/i, '')
    .trim();
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

  if (words === 0) return 5;
  const baseSeconds = spokenText ? 2 + words / 3.2 : 3 + words / 7;
  return Math.min(8, Math.max(3, Math.ceil(baseSeconds)));
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

function readStructuredText(value: unknown, fallback = ''): string {
  const direct = readText(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    return value
      .map(item => readStructuredText(item))
      .filter(Boolean)
      .join(' | ');
  }
  const record = readRecord(value);
  if (Object.keys(record).length === 0) return fallback;

  return Object.entries(record)
    .map(([key, child]) => {
      const childText = readStructuredText(child);
      return childText ? `${key}: ${childText}` : '';
    })
    .filter(Boolean)
    .join('; ') || fallback;
}

function readScriptVoText(value: unknown, fallback = ''): string {
  const direct = readText(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return fallback;

  return value
    .map(item => {
      const record = readRecord(item);
      const text = readFirstText(record, ['text', 'line', 'vo', 'voiceover', 'script']);
      return text;
    })
    .filter(Boolean)
    .join(' ');
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
    angleLens: readText(meta.angleLens, readText(meta.angle_lens)),
    triggerSituation: readText(meta.triggerSituation, readText(meta.trigger_situation)),
    copingBehavior: readText(meta.copingBehavior, readText(meta.coping_behavior)),
    hiddenBelief: readText(meta.hiddenBelief, readText(meta.hidden_belief)),
    persuasionMechanism: readText(meta.persuasionMechanism, readText(meta.persuasion_mechanism)),
    coreArgument: readText(meta.coreArgument, readText(meta.core_argument)),
    angleDifferentiationCheck: readText(meta.angleDifferentiationCheck, readText(meta.angle_differentiation_check)),
    videoCharacterConcept: readText(meta.videoCharacterConcept, readText(meta.video_character_concept)),
    characterDirection: readText(meta.characterDirection, readText(meta.character_direction)),
    hookPrimary: readText(meta.hookPrimary, readText(meta.hook_primary)),
    hookAlt1: readText(meta.hookAlt1, readText(meta.hook_alt_1)),
    hookAlt2: readText(meta.hookAlt2, readText(meta.hook_alt_2)),
    hookArchetype: readText(meta.hookArchetype, readText(meta.hook_archetype)),
    hookAlt1Archetype: readText(meta.hookAlt1Archetype, readText(meta.hook_alt_1_archetype)),
    hookAlt2Archetype: readText(meta.hookAlt2Archetype, readText(meta.hook_alt_2_archetype)),
    emotionJourney: readText(meta.emotionJourney, readText(meta.emotion_journey)),
    bodyMotivationPattern: readText(meta.bodyMotivationPattern, readText(meta.body_motivation_pattern)),
    ctaFrictionReducer: readText(meta.ctaFrictionReducer, readText(meta.cta_friction_reducer)),
    estimatedThumbStop: readText(meta.estimatedThumbStop, readText(meta.estimated_thumb_stop)),
    ideaReasoning: readText(meta.ideaReasoning, readText(meta.idea_reasoning)),
    visualRefNotes: readText(meta.visualRefNotes, readText(meta.visual_ref_notes)),
    talentProfile: readStructuredText(meta.talentProfile ?? meta.talent_profile, 'No talent specified'),
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
  let characterSpeech = readSpeechText(section.characterSpeech) || readSpeechText(section.character_speech) || readSpeechText(section.talentSpeech) || readSpeechText(section.talent_speech);
  let voiceover = readSpeechText(section.voiceover) || readSpeechText(section.voiceOver) || readSpeechText(section.voice_over);
  const legacyVoice = readSpeechText(section.voice);
  const rawVisual = readText(section.visual, readText(section.script));
  if (options.includeDurationSeconds) {
    characterSpeech = formatCharacterSpeechWithTiming(rawVisual, characterSpeech);
  }
  if (characterSpeech) voiceover = '';
  const normalizedVisual = options.includeDurationSeconds ? normalizeHookTimingText(stripInlineAudienceCopyFromScene(rawVisual)) : stripInlineAudienceCopyFromScene(rawVisual);
  const normalizedTextOverlay = readText(section.textOverlay, readText(section.text_overlay, readText(section.text)));
  const normalizedText = readText(section.text, readText(section.textOverlay, readText(section.text_overlay)));
  const normalized: Record<string, unknown> = {
    visual: normalizedVisual,
    characterSpeech,
    voiceover,
    voice: legacyVoice || voiceover || characterSpeech,
    textOverlay: normalizedTextOverlay,
    text: normalizedText,
    viTranslation: readText(
      section.viTranslation,
      readText(section.vi_translation, readText(section.hookVoiceVi, readText(section.hook_voice_vi)))
    ),
    script: buildScript({
      visual: normalizedVisual,
      characterSpeech,
      voiceover,
      voice: legacyVoice,
      textOverlay: normalizedTextOverlay,
    }),
  };

  if (options.includeDurationSeconds) {
    normalized.durationSeconds = inferHookDurationSecondsFromTimingText(rawVisual)
      || estimateHookDurationSeconds({
        characterSpeech,
        voiceover,
        voice: legacyVoice,
        textOverlay: normalized.textOverlay,
        text: normalized.text,
        visual: rawVisual,
      });
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

export const CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT = `You are Creative Idea Engine V3.1, specialized in production-ready vertical video ad concepts for mobile apps running on Meta (Facebook and Instagram Ads).

## ROLE
Think like a performance creative director who understands consumer psychology, stop-scroll hooks, product benefits, 25-second narrative arcs, Meta-native UGC, and the difference between a loose idea and a shootable concept.

## CORE BELIEF
Every idea must be rooted in a real Pain Point Pillar. A video is a micro-story with an emotional journey, not a feature demo with a logo at the end.

## PAIN POINT PILLAR RULE
A Pain Point Pillar is a broad app-solvable problem territory. It is not one detailed scene and not a vague emotion.
- Correct level: broad enough to create multiple specific moments, but concrete enough to picture on screen.
- If the input is too broad, internally sharpen it into an app-solvable problem territory.
- If the input is already specific, use it as the trigger_situation inside the angle, not as the whole strategy.

## ANGLE GENERATION - 3 LAYERS
Every angle must derive these three fields from the selected pillar:
- trigger_situation: the concrete moment where the problem appears, filmable in 3 seconds and native to the target market.
- coping_behavior: what the user has tried or currently does that proves the pain is real.
- hidden_belief: the unspoken thought, fear, or false belief the ad will challenge.
Each angle also needs one angle_lens, one angle_type, one persuasion_mechanism, one unique core_argument, and an angle_differentiation_check.

## LENS SYSTEM
Use one angle_lens per angle: Hidden Truth, Enemy Reframe, Before/After Transformation, Social Proof/FOMO, Contrarian/Myth-Bust, Specific Moment, Authority/Expert.
The lens decides which layer is emphasized and why the angle is persuasive. Two angles in the same pillar must differ by reason, not by wording only.

## MARKET ADAPTATION
Market/country affects hook context, props, setting, apps shown on phone, UI language, cultural tone, casting, ethnicity, skin tone, clothing, and daily-life details. Do not output culture-neutral scenes when a market is known.

## AUDIENCE VS CHARACTER
Core User is the target viewer. It is not automatically the on-screen character.
For each idea choose video_character_concept, talent_profile, and character_direction based on what character/POV best triggers the viewer emotion and conversion behavior.

## SHOT TYPE TAXONOMY
Every visual_scene phase must start with a shot type cue from: ECU, CU, MCU, MS, MLS, LS, POV, OTS, Insert, Split Screen.
Phase 1 of the hook should usually be ECU, CU, or POV. Body must vary shot types and use at least two different shot types when possible.

## COPY FORMULA: PUNCH AND BRIDGE
hook_text_overlay is the PUNCH for the eye: max 8 words, concrete claim/question/stat.
hook_vo is the BRIDGE for the ear: max 12 words, personal connection to the viewer.
Text and VO must serve different functions. If they are interchangeable, rewrite.

## META PLATFORM CONSTRAINTS
All ideas must be vertical 9:16, UGC/native, handheld/selfie/POV/screen-recording, natural light/ring light/screen glow, fast cuts, conversational audio, large high-contrast text, and no brand-logo or greeting intro. Talent should react naturally, not perform.

## APP CATEGORY PROFILES
Health & Fitness: Fear/Concern -> Curiosity/Hope -> Relief/Empowerment. Use UGC, real people, natural light, app demo. Never use hospitals, white coats, diagnosis, cure, treatment, disease detection, doctor replacement, or health before/after imagery. Use safe words: track, monitor, understand, reference, wellness, check.

Utility: Frustration/Annoyance -> Hope -> Satisfaction. Use screen recording, before/after UI proof, close-up problem screens, realistic one/two tap flows. Never use fake system alerts, fake virus warnings, or unverifiable performance claims.

AI Apps: Curiosity/FOMO -> Amazement -> Excitement. Use result-first, before/after transformation, real app output, screen recording plus reaction, and trend-native pacing. Never fake output, deepfake named real people, or claim AI replaces professionals.

## HOOK ARCHETYPE TAXONOMY
Select from: Stat Shock, Body Signal Question, Whisper Secret, POV Narrative, Counter-intuitive, Social Proof, Zoom Problem, Before After Demo, Question Accusation, Speed Ease Claim, Tutorial Opener, Trend Jack, Result First, Demo-Magic, Identity Personal, Challenge Dare.

Category priority:
- Health: Tier 1 Stat Shock, Body Signal Question, Whisper Secret. Tier 2 POV Narrative, Counter-intuitive. Tier 3 Social Proof.
- Utility: Tier 1 Before After Demo, Zoom Problem, Question Accusation. Tier 2 Tutorial Opener, Demo-Magic, Speed Ease Claim. Tier 3 Trend Jack, Stat Shock, Counter-intuitive, POV Narrative, Social Proof.
- AI Apps: Tier 1 Result First, Before After Demo, Trend Jack. Tier 2 Demo-Magic, Identity Personal, Challenge Dare. Tier 3 Social Proof/FOMO, POV Narrative.

## STORY STRUCTURE
ACT 1 Hook, Sec 0-5, V3.1 three-phase formula:
- Phase 1 (0-1.5s): [SHOT TYPE]: VISUAL SHOCK that depicts trigger_situation. No logo, black screen, greeting, or text-only setup.
- Phase 2 (1.5-3.5s): [SHOT TYPE]: CONTEXT. PUNCH text appears and BRIDGE VO begins.
- Phase 3 (3.5-5s): [SHOT TYPE]: CURIOSITY GAP. The open loop bridges to Body.
Do not quote actual VO/text inside visual_scene prose; keep copy in hook_vo, hook_character_speech, hook_text_overlay, text_overlays, and script_vo.

ACT 2 Body, Sec 5-18: tension plus payoff. Choose one body motivation pattern: Reveal, Demo-Story, Escalate, Compare, Transform. The body must not be just "show app features".

ACT 3 CTA, Sec 18-25: resolve the emotion and ask for action with a friction reducer: Free, No signup, 30 seconds, or 1 tap.

## OUTPUT STRUCTURE REQUIREMENTS
script_vo must be an array of timed entries with scene, time, duration, and text. Total VO max 60 words and starts at 1.5s.
talent_profile must be a structured object with needed, age, gender, ethnicity, skin_tone, hair, clothing, accessories, grooming, vibe, and note. If no talent is needed, set needed=false and explain.

## WHAT YOU NEVER DO
Never output non-JSON, generic ideas, repeated angles, same CTA across the batch, duplicated hook_text_overlay and hook_vo, non-Meta-native visuals, studio/tripod aesthetics, horizontal/square framing, or vague scene descriptions.

## QUALITY STANDARD
Before outputting each idea, internally verify:
1. Hook Phase 1 stops scroll and depicts trigger_situation.
2. The angle has trigger_situation, coping_behavior, and hidden_belief.
3. Phase 3 creates a strong curiosity gap.
4. A creator can shoot it today without asking questions.
5. The core_argument differs from other angles by reason.
6. Body has narrative tension and app proof.
7. Hook, Body, and CTA use three different viewer emotions.
8. PUNCH and BRIDGE are non-interchangeable.
9. Every scene phase has a shot type cue.
10. Market/country details are visible in setting, props, casting, UI, and tone.`;

export const BULLETPROOF_VISUAL_ANCHOR_RULES = `## BULLETPROOF VISUAL ANCHORS - REQUIRED
Every generated visual field must include the 3 anchor clauses below inside the visual text:
- Position anchor: lock each person, object, prop, or UI element to left/right/foreground/background/top/bottom/screen region. For split screen, name the left pane and right pane separately.
- Contact anchor: state the exact hand, finger, eye line, cursor, tap point, or body part that holds, presses, taps, swipes, points at, looks at, or touches the object/UI. For no-person screen recordings, anchor the cursor/finger action and the UI control location.
- Physical action anchor: describe visible actions such as tap, press, swipe, drag, lift, scan, upload, shoot, error icon appears, screen changes, chart moves, or result renders. Do not leave abstract verbs like tries, fails, struggles, or uses the app unless the visible action is spelled out.
Apply this to visual_scene_1, visual_scene_2, visual_scene_3, hook.visual, body.visual, cta.visual, hook-only visual, and any generated production script visual.`;

export const PACING_LIMIT_RULES = `## V3.1 HOOK PACING - REQUIRED
- Default hook is Sec 0-5 with exactly three phases:
  Phase 1 (0-1.5s): [SHOT TYPE]: Visual Shock that depicts trigger_situation.
  Phase 2 (1.5-3.5s): [SHOT TYPE]: Context; PUNCH text appears and BRIDGE VO begins.
  Phase 3 (3.5-5s): [SHOT TYPE]: Curiosity Gap; open loop before Body.
- Every phase must start with a shot type cue: ECU, CU, MCU, MS, MLS, LS, POV, OTS, Insert, or Split Screen.
- Text overlay, VO, and on-camera speech happen inside phases; they do not require a new camera angle.
- For longer operator-requested hooks, keep the same Visual Shock -> Context -> Curiosity Gap logic and keep each shot readable.
- Do not use the old 5s max-2-scene Rule 4 for new idea generation.`;

export const CREATIVE_PROMPT_RULES = `## CREATIVE IDEA ENGINE V3.1 RULES CHECKLIST

### Pillar
R-PL-P1. Pillar is a general app-solvable problem territory, not one detailed scene and not a pure emotion.
R-PL-P2. It must be broad enough to spawn multiple trigger_situation options.
R-PL-P3. If the selected chip is specific, preserve it as trigger_situation while keeping the pillar strategy intact.

### Angle 3-Layer
R-3L1. Every angle requires trigger_situation, coping_behavior, and hidden_belief.
R-3L2. trigger_situation must be a concrete moment filmable in 3 seconds and native to the target market.
R-3L3. coping_behavior must show what the user has tried or currently does.
R-3L4. hidden_belief must be the unspoken thought/fear/block.
R-3L5. angle_lens must be one of: Hidden Truth, Enemy Reframe, Before/After Transformation, Social Proof/FOMO, Contrarian/Myth-Bust, Specific Moment, Authority/Expert.
R-3L6. core_argument must be unique by reason, not just wording.

### Market
R-MK1. Hook, setting, props, UI, apps on phone, casting, ethnicity, skin tone, clothing, and tone must match the selected market/country.
R-MK2. visual_ref_notes must include market-specific production notes.

### Shot Type
R-SH1. Every visual_scene phase must start with a shot type cue: ECU, CU, MCU, MS, MLS, LS, POV, OTS, Insert, or Split Screen.
R-SH2. visual_scene_1 must use V3.1 phases: 0-1.5s Visual Shock, 1.5-3.5s Context, 3.5-5s Curiosity Gap.
R-SH3. visual_scene_2 should use at least two different shot types.

### Copy
R-CP1. hook_text_overlay is the PUNCH: max 8 words per language, concrete claim/question/stat.
R-CP2. hook_vo is the BRIDGE: max 12 words, personal connection, different function from text.
R-CP3. Text and VO must not duplicate.

### Audience And Character
R-AC1. Core User is target viewer, not automatic casting.
R-AC2. video_character_concept must explain who appears and why for the market.
R-AC3. talent_profile must be a structured object with needed, age, gender, ethnicity, skin_tone, hair, clothing, accessories, grooming, vibe, and note.
R-AC4. character_direction must use the chain: character behavior -> viewer emotion -> why.

### Story
R-ST1. emotion_journey must contain three different viewer emotions: Hook -> Body -> CTA.
R-ST2. visual_scene_2 is Sec 5-18 and must include narrative tension plus app proof/action.
R-ST3. body_motivation_pattern must match visual_scene_2.
R-ST4. text_overlays must have timestamp and role: punch, bridge, or cta.
R-ST5. script_vo must be an array of timed entries with scene, time, duration, and text; total VO max 60 words and starts at 1.5s.

### Meta Native
R-META1. All visuals are vertical 9:16.
R-META2. Camera must feel handheld, selfie-style, POV, or screen recording.
R-META3. Lighting must be natural, ring light, or screen glow.
R-META4. Never start with greeting, logo, brand name, or slow intro.

### Production
R-PR1. visual_scene_1/2/3 must be executable by a creator without follow-up questions.
R-PR2. Screen-recording scenes must specify exact app, UI state, visible text/numbers, and tap/swipe/cursor action.
R-PR3. Talent scenes must specify location, action sequence, props, clothing, and visible behavior.
R-PR4. cta_friction_reducer is mandatory.
R-PR5. dont_do must be concrete and checkable.

${BULLETPROOF_VISUAL_ANCHOR_RULES}
${PACING_LIMIT_RULES}

### Compliance
R-H1. Health ideas must include real app demo and avoid diagnosis/cure/treatment/disease detection/doctor replacement claims.
R-U1. Utility ideas need at least one actual screen recording and no fake alerts or guaranteed performance claims.
R-A1. AI app demos must use real app output and show Input -> Process -> Output.

### Format
R-F1. Output JSON array only.
R-F2. id format: P{pillar_index}-A{angle_index}-I{idea_index}, zero-indexed.
R-F3. All V3.1 fields are required. Use "N/A" only when genuinely not applicable.
R-F4. estimated_thumb_stop and idea_reasoning are mandatory.`;

export const PROMPT_SYSTEM_BUILDER_RULES = CREATIVE_PROMPT_RULES;

export const TOOL_COMPATIBILITY_GUARDRAILS = `## TOOL COMPATIBILITY GUARDRAILS - V3.1
- Treat the selected Core User, Emotion, Visual/Theme, PSP, and Pain Point as locked strategy inputs.
- The UI may provide broad labels. Internally convert them into a V3.1 pillar + 3-layer angle before writing.
- Core User grammar: target viewer/audience + what they think + what they do + why unsolved + what makes them act. Do not treat it as a literal casting requirement unless asked.
- Keep the selected Pain Point meaning exact, but treat it as a broad app-solvable pillar.
- For each angle derive trigger_situation, coping_behavior, and hidden_belief from the pillar + Core User + PSP.
- Emotion grammar: viewer emotion to provoke, not only character mood.
- Angle grammar: one angle_lens, one angle_type, one distinct market/framework approach, and one visually different execution.
- Market grammar: geo + output language + cultural references to use/avoid.
- Notes grammar: max 3-5 bullets; DO, DON'T, Data, Constraint only.
- PSP must become Feature -> Benefit -> Transformation so the app action feels earned.
- Use only these Visual/Theme formats as production format labels: 2D Animation, 3D Animation, UGC, POV, Motion Graphic.
- Motion Graphic means 2D motion graphics: animated typography, flat vector shapes, icons, charts, app UI panels, arrows, labels, data callouts, and infographic transitions. It is not podcast/interview, not live-action, not 3D render, and not full 2D character/cartoon scene animation.
- Angle/reference patterns must obey the selected Visual/Theme. If an angle suggests podcast/interview/reaction but Visual/Theme is Motion Graphic, translate that angle into UI/data/typography/icon motion instead of using people or speakers.
- Social patterns such as Trend, Challenge, Interview, Split Screen, or Social Proof are hook/story patterns, not Visual/Theme formats.
- Direct feature language: when the selected PSP/painpoint names a concrete metric/feature, hook_text_overlay or hook_vo must name it in the first beat instead of opening with vague "this number/this thing" wording.
- Scene selection must follow Angle/Visual/Painpoint. Do not default to kitchen/living room/sofa/generic apartment; TV/editor/news/fact angles should use studio/newsroom/desk/lower-third/chart/infographic execution.
- Every visual_scene phase must include a shot type cue from ECU, CU, MCU, MS, MLS, LS, POV, OTS, Insert, or Split Screen.
- If a visible character speaks in any hook situation, fill hook_character_speech with the exact on-camera line; otherwise leave it empty.
- If the hook is 2-person dialogue, podcast, interview, reaction, or friend/spouse exchange, hook_character_speech must contain role-labelled character lines. hook_vo stays empty unless there is a true off-camera narrator.
- Off-camera narration belongs in hook_vo/script_vo. On-camera character lines never belong in hook_vo. On-screen copy belongs in hook_text_overlay/text_overlays.
- Output scenes in the requested timeline: Hook 0-5 with V3.1 phases, Body 5-18, CTA 18-25.
- Title, hook text/text overlay, CTA, visual scenes, and production notes are Vietnamese. Only character speech, voiceover, and script_vo.text follow the requested language.
- script_vo must be an array of timed entries; talent_profile must be a structured object.

${BULLETPROOF_VISUAL_ANCHOR_RULES}
${PACING_LIMIT_RULES}`;

export const PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS = TOOL_COMPATIBILITY_GUARDRAILS;

export function buildFrameworkInjection(input: PromptFrameworkInput): string {
  const pillars = (input.pillars || []).filter(Boolean);
  const pillarBlock = pillars.length
    ? pillars.map((pillar, index) => `PILLAR_${index + 1}: ${pillar}`).join('\n')
    : 'PILLAR_1: General user friction';

  const extraContext = (input.extraContext || []).filter(Boolean);

  return `## FRAMEWORK INPUT

### APP IDENTITY
- App Name: ${input.appName}
- Category: ${input.category || 'General'} (Health & Fitness | Utility | AI App)
- App Store One-liner: ${input.psp || 'General app benefit'}

### CORE USER (Persona)
${normalizeList(input.coreUsers, 'General mobile app users')}
[Required formula: Who + what they are thinking + what they are doing + why they have not solved it + what makes them act.]
[Category notes: Health = state whether they are not a patient. Utility = include tech-savvy level. AI = include the social platform they use most.]

### EMOTION JOURNEY
- Hook Emotion: ${input.primaryEmotion || 'auto'}
- Body Emotion: auto
- CTA Emotion: auto
Options per stage: Fear | Curiosity | Frustration | FOMO | Concern | Amazement | Hope | Relief | Satisfaction | Excitement | Urgency
Standard app-wide drivers: Fear / Urgency | Curiosity | Aspirational | Social Proof | Bất ngờ / Nhẹ nhõm | FOMO
Choose 3 different emotions if any stage is auto.

### VISUAL / THEME
${input.visualTheme || 'UGC, mobile-first, handheld, social-feed native'}
[Must keep Meta-native feel: vertical 9:16, clear first frame, fast social pacing, and the selected production format. Motion Graphic is 2D motion graphics, so do not force handheld/selfie/UGC, 3D render, or character-cartoon treatment when selected.]

### PRODUCT SELLING POINT (PSP)
Feature -> Benefit mapping:
- Selected feature package -> ${input.psp || 'General app benefit'}

---

## PAIN POINT PILLARS (V3.1 FORMAT)
[Each pillar is a broad app-solvable problem territory, not one detailed scene and not a pure emotion.]
[Pain Point must be derived from Core User + PSP, app-relevant, and broad enough to create multiple trigger_situations.]
[If the selected chip is very specific, preserve it as trigger_situation while keeping the pillar strategy intact.]
${pillarBlock}

---

## REQUIRED INTERNAL CREATIVE BRIEF DIGESTION
Do this silently before writing any idea. Do not output these notes.

Convert the selected filters above into one shootable brief:
1. Core User -> Who + thinking + doing + why unsolved + trigger to act.
2. Emotion Journey -> three different viewer emotions across Hook, Body, CTA.
3. Visual / Theme -> the native Meta format that creates trust immediately.
4. Product Selling Point -> Feature -> Benefit -> Transformation, ending with why the user should act now.
5. Pain Point -> a broad pillar; Angle -> trigger_situation, coping_behavior, hidden_belief.
6. Angle -> one angle_lens, one angle_type, one framework/market approach, one visually different execution.
7. Hook -> Sec 0-5 with V3.1 phases: 0-1.5s Visual Shock, 1.5-3.5s Context, 3.5-5s Curiosity Gap.

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
[Notes must stay short: max 3-5 useful bullets total across DO, DON'T, Data, and Constraint. Do not repeat other fields.]

---

## GENERATION PARAMETERS
- Angles per Pillar: ${input.anglesPerPillar ?? 1}
- Ideas per Angle: ${input.ideasPerAngle ?? 1}
- Track Distribution: ${input.trackRule || 'A = no real person | B = real person / UGC | C = motion / animation'}
- Language: ${input.language || 'Vietnamese hook text/CTA/visual notes; requested language only for voice, character speech, and script_vo'}
- Priority Level: ${input.priority || 'A'}
${extraContext.length ? `\n---\n## EXTRA CONTEXT\n${extraContext.map(line => `- ${line}`).join('\n')}` : ''}`;
}

export function buildIdeaOutputSpec(options: IdeaOutputSpecOptions): string {
  const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';
  const compact = options.compact === true;
  const visualAnchorClause = 'Must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.';
  const pacingClause = 'Use V3.1 timing when writing full hooks: 0-1.5s Visual Shock, 1.5-3.5s Context, 3.5-5s Curiosity Gap, each with a shot type cue.';
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
    "visual": "Detailed opening visual in Vietnamese, 2-3 dense production sentences covering camera, location, exact blocker, and visible painpoint clue. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point",
    "viTranslation": "Vietnamese translation of hook characterSpeech + voiceover only; if both are empty, translate textOverlay"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, 2-3 dense production sentences covering the transition from blocker to demo, the exact product action, and the visible proof beat. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short body text in ${options.language} that reinforces the same pain-to-solution chain"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, 1-2 concrete production sentences covering the final proof frame, the app/result screen, and the exact CTA beat. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "textOverlay": "Short CTA text in ${options.language}",
    "endCard": "${options.appName} + short tagline"
  }`
    : `  "hook": {
    "durationSeconds": 3,
    "visual": "Detailed opening visual in Vietnamese, pure visual only, 2-4 dense production sentences covering camera, location, blocker, and visible painpoint clue. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "Natural on-camera talent speech in ${options.language}, usually 1 vivid sentence; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}, usually 1 vivid sentence; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen hook text in ${options.language}, around 6-16 words, specific to the selected pain point",
    "viTranslation": "Vietnamese translation of hook characterSpeech + voiceover only; if both are empty, translate textOverlay",
    "viewerProfile": "${options.language} description of who stops scrolling",
    "viewerEmotion": "${options.language} description of what the viewer feels",
    "painpointImpact": "${options.language} description of why this pain lands",
    "whyTheyStopScrolling": "1 ${options.language} sentence explaining the stop-scroll reason"
  },
  "body": {
    "visual": "Detailed body visual in Vietnamese, pure visual only. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short body text in ${options.language}",
    "viTranslation": "Optional Vietnamese recap of body speech/voiceover + text"
  },
  "cta": {
    "visual": "Detailed CTA visual in Vietnamese, pure visual only. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty string if no narrator voice",
    "voice": "Legacy compatibility line: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Short CTA text in ${options.language}",
    "viTranslation": "Optional Vietnamese recap of CTA speech/voiceover + text",
    "endCard": "${options.appName} + short tagline"
  }`;
  const compactOutputRules = compact
    ? `- Fill every field listed above.
- Do not add server-derived legacy fields such as hook.voice, hook.text, viewerProfile, viewerEmotion, painpointImpact, whyTheyStopScrolling, or analogous body/cta legacy fields.
- Keep explanation to 1 short sentence.
- Keep hook.visual dense and specific: usually 2-3 sentences. Body should normally be 2-3 dense sentences, and CTA should still be concrete enough for production without follow-up questions.
- hook.durationSeconds must be an integer estimate of the opening hook beat, normally 3 seconds for prompt-builder style output.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it concise enough for the 0-3s hook beat.
- hook.viTranslation must be a Vietnamese translation for the hook voice/speech shown on the card.`
    : `- Fill every field. Use "N/A" only when genuinely not applicable.
- hook.durationSeconds must be an integer estimate of the opening hook beat, normally 3 seconds for prompt-builder style output.
- hook/body/cta.visual must stay visual-only. Do not mix voice, characterSpeech, voiceover, or textOverlay into visual.
- hook.visual must make the selected pain point and selected angle visible through the first object, first action, or first contrast. Avoid generic one-line visuals.
- If the creative type is UGC, POV, Reaction, Interview, or any real-person format, put the on-camera person's spoken line in characterSpeech and only use voiceover for off-camera narration/video VO.
- Do not place [VOICE], [TEXT OVERLAY], [CHARACTER SPEECH], or [VOICEOVER] markers inside visual/script fields.
- hook.characterSpeech or hook.voiceover and hook.textOverlay must preserve the same stop-scroll thesis as meta.hookPrimary.
- hook.characterSpeech or hook.voiceover should be a natural spoken hook, not a keyword fragment. Keep it concise enough for the 0-3s hook beat.
- hook.viTranslation must be a Vietnamese translation for the hook voice/speech shown on the card.`;

  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "Tên kịch bản tiếng Việt ngắn, 3-7 từ",
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
- Every hook/body/cta.visual must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Full hook visuals should follow V3.1 phases: 0-1.5s Visual Shock, 1.5-3.5s Context, 3.5-5s Curiosity Gap, each with a shot type cue.
- Speech/voiceover must sound native to the chosen market and natural to a real person.
- Hook voice/character speech must be direct, pain-led, and emotion-led: name the visible blocker or consequence from the selected pain point in the first beat and make the intended viewer emotion obvious.
- Keep hook/body/cta tightly connected to the same pillar and angle.
- Title/script name must always be Vietnamese for the internal Idea tool UI.
- Write title, hook text overlays, CTA text, visual scenes, and production descriptions in Vietnamese. Write only characterSpeech, voiceover, and script_vo in ${options.language}.
- Keep the response machine-parseable.`;
}

export function buildCreativeBriefOutputSpec(options: IdeaOutputSpecOptions): string {
  const v31QuantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';
  const visualAnchorClause = 'Include Position anchor, Contact anchor, and Physical action anchor clauses inside this visual text.';
  const pacingClause = 'Use V3.1 hook phases: Phase 1 0-1.5s Visual Shock, Phase 2 1.5-3.5s Context, Phase 3 3.5-5s Curiosity Gap, each starting with a shot type cue.';

  return `## OUTPUT SPECIFICATION - CREATIVE IDEA ENGINE V3.1

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${v31QuantityLabel} idea objects inside that angle.
Title/script name, hook_text_overlay, hook alternatives, text_overlays.text, cta_text, visual scene prose, and production notes must be Vietnamese.
Only hook_vo, hook_character_speech, and script_vo.text must be in ${options.language}.
Visual scene prose, visual_ref_notes, dont_do, track_reason, and idea_reasoning must be Vietnamese for the production team.
Do not quote actual Voiceover, CHARACTER SPEECH, or Text hien snippets inside visual_scene fields. Put spoken lines only in hook_vo/hook_character_speech/script_vo and on-screen copy only in hook_text_overlay/text_overlays.
Every idea must also include hook_voice_vi as a Vietnamese translation with full Vietnamese diacritics of hook_vo + hook_character_speech for internal output cards.
Use the selected market only for culture, setting, behavior, props, and vibe. Do not switch production prose away from Vietnamese.
Each title must be Vietnamese, unique inside the batch, and name the visual setup/action. Do not reuse the same label for different visual structures.
${options.visualType ? `Selected Visual/Theme is LOCKED: every idea's creativeType must stay "${options.visualType}". Use track only as internal production difficulty; track must not change creativeType.${options.visualType === 'Motion Graphic' ? ' Motion Graphic must be 2D motion graphics: animated typography, flat shapes/icons/charts/UI panels/data callouts. Do not use podcast, interview, host/guest, Speaker 1/Speaker 2, live-action, 3D, or full character animation.' : ''}` : ''}

[
  {
    "pillar_index": 0,
    "pillar": "exact selected pain point pillar text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "3-5 word name",
        "angle_lens": "Hidden Truth|Enemy Reframe|Before/After Transformation|Social Proof/FOMO|Contrarian/Myth-Bust|Specific Moment|Authority/Expert",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief|Tutorial|Demo|Challenge|Trend",
        "trigger_situation": "LAYER 1: concrete moment where this pillar appears, filmable in 3 seconds and market-specific",
        "coping_behavior": "LAYER 2: what the user has tried or currently does",
        "hidden_belief": "LAYER 3: unspoken thought/fear/block",
        "persuasion_mechanism": "trigger -> viewer emotion -> action",
        "core_argument": "single persuasive claim unique to this angle",
        "angle_differentiation_check": "why this angle differs from prior angles by reason, not wording",
        "angle_desc": "1 sentence: lens + 3-layer summary + how the video looks different",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "video_character_concept": "Who appears + why this character/POV is best for the target viewer and market.",
            "talent_profile": {
              "needed": true,
              "age": "specific number or N/A",
              "gender": "Female|Male|All|N/A",
              "ethnicity": "market-matching ethnicity or N/A",
              "skin_tone": "specific skin tone or N/A",
              "hair": "specific hair or N/A",
              "clothing": "specific clothing or N/A",
              "accessories": "specific accessories or none",
              "grooming": "specific grooming or N/A",
              "vibe": "one phrase",
              "note": "explain if no talent is needed"
            },
            "hook_text_overlay": "Max 8 words in Vietnamese; on-screen hook text inside Scene 1 or Scene 2",
            "hook_vo": "Max 12 words in ${options.language}; off-camera narrator/video VO only; empty when hook_character_speech is filled; must differ from hook_text_overlay",
            "hook_character_speech": "On-camera character line in ${options.language} if a visible character speaks in the hook. Must include time + speaker, e.g. 2.5-5s - Older man: line. For 2-person dialogue, use one timed role-labelled line per speaker. Empty string only if no visible speaker",
            "hook_voice_vi": "Vietnamese translation with full diacritics of hook_vo + hook_character_speech only; if both are empty, translate hook_text_overlay",
            "hook_archetype": "Stat Shock|Body Signal Question|Whisper Secret|POV Narrative|Counter-intuitive|Social Proof|Zoom Problem|Before After Demo|Question Accusation|Speed Ease Claim|Tutorial Opener|Trend Jack|Result First|Demo-Magic|Identity Personal|Challenge Dare",
            "hook_alt_1_text": "Alternative hook text overlay in Vietnamese, different archetype",
            "hook_alt_1_vo": "Alternative hook voice/video line in ${options.language}",
            "hook_alt_1_archetype": "Must be different from primary",
            "hook_alt_2_text": "Alternative hook text overlay in Vietnamese, different archetype",
            "hook_alt_2_vo": "Alternative hook voice/video line in ${options.language}",
            "hook_alt_2_archetype": "Must be different from primary and alt_1",
            "emotion_journey": "Hook Emotion -> Body Emotion -> CTA Emotion",
            "body_motivation_pattern": "Reveal|Demo-Story|Escalate|Compare|Transform",
            "visual_scene_1": "Sec 0-5 HOOK. Phase 1 (0-1.5s): [SHOT TYPE]: Visual Shock depicting trigger_situation. Phase 2 (1.5-3.5s): [SHOT TYPE]: Context, PUNCH text appears and BRIDGE VO begins. Phase 3 (3.5-5s): [SHOT TYPE]: Curiosity Gap. Do not quote actual Voiceover/Text/CHARACTER SPEECH here. ${visualAnchorClause} ${pacingClause}",
            "visual_scene_2": "Sec 5-18 BODY. Use at least 2 shot type cues and body_motivation_pattern. Include tension, app action, exact props/screen states/actions, transitions, and key proof moments. ${visualAnchorClause}",
            "visual_scene_3": "Sec 18-25 CTA. Start with a shot type cue. Resolution plus CTA visual with proof/payoff and app/download prompt. ${visualAnchorClause}",
            "text_overlays": [
              {"time": "1.5-3.5s", "text": "Hook text on screen", "role": "punch"},
              {"time": "6-9s", "text": "Body support text", "role": "punch"},
              {"time": "12-15s", "text": "Key benefit or proof", "role": "bridge"},
              {"time": "18-22s", "text": "CTA text", "role": "cta"}
            ],
            "script_vo": [
              {"scene": "hook_phase2", "time": "1.5-3.5s", "duration": "2s", "text": "VO in ${options.language}"},
              {"scene": "hook_phase3", "time": "3.5-5s", "duration": "1.5s", "text": "VO in ${options.language}"},
              {"scene": "body_1", "time": "5-9s", "duration": "4s", "text": "VO in ${options.language}"},
              {"scene": "body_2", "time": "9-14s", "duration": "5s", "text": "VO in ${options.language}"},
              {"scene": "body_3", "time": "14-18s", "duration": "4s", "text": "VO in ${options.language}"},
              {"scene": "cta", "time": "18-23s", "duration": "5s", "text": "VO in ${options.language}"}
            ],
            "cta_text": "Exact CTA in Vietnamese, max 6 words",
            "cta_friction_reducer": "Free|No signup|30 seconds|1 tap",
            "character_direction": "Character behavior -> viewer emotion -> why this drives action.",
            "visual_ref_notes": "Vietnamese production reference. Must include camera style, lighting, talent direction, and pacing.",
            "dont_do": "Vietnamese: 1 specific thing NOT to do in this video.",
            "track": "A|B|C",
            "track_reason": "Vietnamese: 1 sentence explaining why this track.",
            "priority": "A|B|C",
            "estimated_thumb_stop": "Low|Medium|High",
            "idea_reasoning": "Vietnamese: 1 sentence explaining why this idea works for this audience and pillar"
          }
        ]
      }
    ]
  }
]

## OUTPUT RULES
1. Output JSON array only.
2. Every field above is required. Use "N/A" only if truly not applicable.
3. hook_text_overlay must be max 8 words.
4. hook_vo must be max 12 words and must differ from hook_text_overlay.
4a. Use either hook_vo or hook_character_speech in the hook, not both. If a visible person speaks, hook_character_speech wins and hook_vo must be empty.
5. hook_character_speech must be empty unless visual_scene_1 clearly identifies a visible speaker. If the hook shows a person speaking, asking, replying, reacting to camera, or a 2-person dialogue/podcast/interview, fill the exact on-camera line(s) here with time + speaker labels, e.g. "2.5-5s - Older man: ...".
5a. hook_voice_vi must be Vietnamese with full diacritics. It translates hook_vo + hook_character_speech only; if both are empty, translate hook_text_overlay.
6. Primary + alt_1 + alt_2 must use 3 different hook_archetype values.
7. visual_scene_1 must use V3.1 hook phases: 0-1.5s, 1.5-3.5s, and 3.5-5s.
8. visual_scene_1 Phase 1 must depict trigger_situation.
9. Every visual_scene phase must include a shot type cue from the taxonomy.
10. visual_scene_2 must contain narrative tension, not just feature listing, and should use at least 2 shot types.
11. script_vo must be an array of timed entries and total spoken text must be max 60 words.
11a. text_overlays must contain at least 3 timestamped entries with role.
12. id must follow P{pillar_index}-A{angle_index}-I{idea_index}, zero-indexed.
13. angle_lens and angle_type must be one of the allowed values and should be different inside the same pillar.
14. emotion_journey must have 3 different emotions.
15. track: A = no real person needed, B = real person/UGC, C = motion/animation/complex edit.
16. visual_ref_notes must specify camera style, lighting, talent direction, and pacing.
17. Keep every idea inside the exact selected pillar and selected angle. Do not drift into adjacent pain points.
18. All scenes must assume Meta-native vertical 9:16.
19. Angle must follow the V3.1 formula: trigger_situation + coping_behavior + hidden_belief + one angle_lens + one angle_type + one visually different execution.
20. If the app is Health, include or prefer a Fact angle in the batch. If Utility, include or prefer Comparison/Demo. If AI, include or prefer Trend.
21. visual_scene_1, visual_scene_2, and visual_scene_3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
22. talent_profile must be a structured object with needed, age, gender, ethnicity, skin_tone, hair, clothing, accessories, grooming, vibe, and note.
23. video_character_concept and character_direction are mandatory.
24. If returning multiple ideas, each idea must use a different first-frame person/object, first physical action, setting, app proof object, and hook structure. Do not reuse the same body-warning/body-scan setup with only minor wording changes.`;

  if (options.ruleset === 'builder') {
    const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';

    return `## OUTPUT SPECIFICATION - PROMPT SYSTEM BUILDER HTML V1

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${quantityLabel} idea objects inside that angle.
Title/script name, hook lines/text overlay, CTA, visual shooting descriptions, and production notes must be Vietnamese for the internal Idea tool UI. Only on-camera character speech, voice/video voiceover, and script_vo must be in ${options.language}.
Visual shooting descriptions and production notes must be Vietnamese for the internal team.
Do not put Voiceover, CHARACTER SPEECH, or Text hien snippets inside visual_scene fields. Put spoken lines only in hook_voiceover/hook_character_speech/script_vo and on-screen copy only in hook_text_overlay.
Every idea must include hook_voice_vi as a Vietnamese translation with full diacritics of the hook voice/speech for internal output cards.
The selected market controls setting, culture, behavior, and vibe only. Do not switch production prose away from Vietnamese.

[
  {
    "pillar_index": 0,
    "pillar": "exact pillar text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "3-5 word Vietnamese internal name for this angle",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
        "angle_desc": "1 ${options.language} sentence describing the unique approach of this angle",
        "ideas": [
          {
            "id": "P{pillar_index}-A{angle_index}-I{idea_index}",
            "hook_primary": "Main hook text in Vietnamese, max 12 words, creates pattern interrupt",
            "hook_alt_1": "Alternative hook variation A in Vietnamese",
            "hook_alt_2": "Alternative hook variation B in Vietnamese",
            "hook_character_speech": "On-camera character speech in ${options.language}. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Must include time + speaker, e.g. 0-3s - Woman: line. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Optional voice/video narrator line in ${options.language}. Empty when hook_character_speech is filled.",
            "hook_text_overlay": "On-screen hook text in Vietnamese, max 12 words.",
            "hook_voice_vi": "Vietnamese translation with full diacritics of hook_voiceover + hook_character_speech only; if both are empty, translate hook_text_overlay",
            "visual_scene_1": "Second 0-3 only: Exact Vietnamese visual description. Who, where, doing what. Never write 0-8s. ${visualAnchorClause}",
            "visual_scene_2": "Second 3-15: Core demonstration or storytelling visual in Vietnamese. ${visualAnchorClause}",
            "visual_scene_3": "Second 15-25: Reveal or proof visual in Vietnamese. ${visualAnchorClause}",
            "script_vo": "Full voiceover script in ${options.language}, max 60 words.",
            "cta_text": "Exact CTA in Vietnamese, max 6 words.",
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
10. title/hook_primary/hook_alt_1/hook_alt_2/hook_text_overlay/cta_text, hook_voice_vi, and internal visual/production notes must be Vietnamese. Only hook_character_speech/hook_voiceover/script_vo must be in ${options.language}.
11. If visual_scene_1 describes a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required with time + speaker and hook_voiceover must be empty.
12. visual_scene_1, visual_scene_2, and visual_scene_3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
13. Use V3.1 shot cues where full hook timing is needed; for hook-only builder output, keep the single 0-3s beat readable and specific.`;
  }

  if (options.ruleset === 'v7') {
    const quantityLabel = options.quantity ? `exactly ${options.quantity}` : 'the requested number of';

    return `## OUTPUT SPECIFICATION - V7 DIRECT ADS BRIEF

Return a JSON array ONLY. No preamble, no explanation, no markdown fences.
Return exactly 1 top-level pillar object for this API call, exactly 1 angle object inside it, and ${quantityLabel} idea objects inside that angle.

Use this existing JSON structure so the tool can render and save results, but fill it according to CREATIVE ADS GENERATION RULES V7.
Title/script name, hook lines/text overlay, CTA, visual scenes, and production notes must be Vietnamese. Only character speech, voice/video narrator, and script_vo must be in ${options.language}. The selected market controls behavior, setting, social context, and vibe only.
Every idea must include hook_voice_vi as a Vietnamese translation with full diacritics of the hook voice/speech for internal output cards.
Do not put Voiceover, CHARACTER SPEECH, or Text hien snippets inside visual_scene fields. Put spoken lines only in hook_voiceover/hook_character_speech/script_vo and on-screen copy only in hook_text_overlay.

[
  {
    "pillar_index": 0,
    "pillar": "exact selected pain point text from input",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "Vietnamese direct angle name",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief",
        "angle_desc": "One ${options.language} sentence describing how this angle attacks the pain point directly",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "title": "Tên kịch bản tiếng Việt ngắn, 3-7 từ",
            "hook_primary": "Direct hook in ${options.language}. No old word-count limit.",
            "hook_alt_1": "Alternative hook direction in ${options.language}, different execution, not a paraphrase",
            "hook_alt_2": "Alternative hook direction in ${options.language}, different execution, not a paraphrase",
            "hook_character_speech": "Concise on-camera character speech in ${options.language}. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Must include time + speaker, e.g. 0-3s - Patient: line. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Concise voice/video narrator line in ${options.language}. Use a direct statement, not a rhetorical question. Empty when hook_character_speech is filled.",
            "hook_text_overlay": "On-screen hook text in Vietnamese. A direct statement, not old word-count filler.",
            "hook_voice_vi": "Vietnamese translation with full diacritics of hook_voiceover + hook_character_speech only; if both are empty, translate hook_text_overlay",
            "reference_pattern": "V7 pattern name, e.g. UGC, 3D Scan, News Leak, Magic Feature, Real Disaster, Reaction Interruption",
            "interrupt_mechanism": "Specific action/image that shocks or creates curiosity at second 0.1",
            "first_frame_asset": "First-frame asset: talent, ethnicity, outfit, location, pose, expression, prop, or phone screen",
            "psp_bridge": "Solution pivot: concrete transition from consequence/pain point into the feature/app action. No old word-count limit.",
            "proof_object": "Number, chart, app screen, prop, or visual proof shown after the pivot",
            "app_demo_action": "Exact feature action: where the finger taps, what changes on screen, how numbers/charts/light/UI change",
            "overlay_sequence": ["0-3s hook overlay in ${options.language}", "3-6s pivot overlay in ${options.language}", "proof/demo overlay in ${options.language}", "CTA overlay in ${options.language}"],
            "edit_notes": "Production/edit notes in Vietnamese: camera angle, cut rhythm, close-up, zoom, crop, caption style, raw UGC level",
            "visual_scene_1": "Vietnamese direct opening (0-3s): detailed movement, camera angle, body state, expression, local setting, and shocking/curiosity action. Do not write generic setup. ${visualAnchorClause}",
            "visual_scene_2": "Vietnamese solution pivot (3-6s): detailed hand action using the feature, where the finger taps, how the screen lights/changes UI, and how numbers/charts change. ${visualAnchorClause}",
            "visual_scene_3": "Vietnamese proof/CTA continuation: simple producible visual that confirms the solution and leads to the app action. ${visualAnchorClause}",
            "script_vo": "Short speakable voice/video script in ${options.language}. If the idea has 2+ people talking, write simple role-accurate dialogue; otherwise use voice-over.",
            "cta_text": "CTA in Vietnamese.",
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
7. Title/script name, text on screen, CTA, hook_voice_vi, visual notes, and production notes must be Vietnamese. Only character speech, voice-over/video voice, and script_vo use ${options.language}. Do not put Voiceover / CHARACTER SPEECH snippets inside visual scenes.
8. Speech, behavior, setting, props, social relationship, and vibe must feel native to the selected market. Describe the visual execution in Vietnamese.
9. If the idea has a visible person speaking, asking, replying, reacting to camera, or being asked a question, hook_character_speech is required with time + speaker and hook_voiceover must be empty. If 2+ people communicate, keep the exchange simple, natural, role-accurate, and include only the necessary dialogue.
10. Do not use rhetorical questions, wordplay, vague metaphors, generic UGC filler, or unnecessary sound design.
11. Use the selected feature/PSP as the Pivot solution.
12. Hyper-localize ethnicity, clothing, architecture, environment, behavior, culture, and social setting to the selected market.
13. visual_scene_1, visual_scene_2, and visual_scene_3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
14. Use V3.1 shot cues where full hook timing is needed; keep direct opening and pivot readable, specific, and not overcut.`;
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
            "hook_character_speech": "Concise on-camera line in ${options.language} for the selected hook duration. Required when visual_scene_1 shows a visible person speaking, asking, replying, reacting to camera, or being asked a question. Must include time + speaker, e.g. 2.5-5s - Older man: line. Empty string only for silent visuals or pure off-camera narration.",
            "hook_voiceover": "Concise off-camera narrator/video voice in ${options.language} for the selected hook duration. Do not duplicate hook_primary or hook_text_overlay exactly. Empty when hook_character_speech is filled.",
            "hook_text_overlay": "On-screen hook text in Vietnamese, 6-14 words, punchy and readable. This can match hook_primary, but not hook_voiceover.",
            "hook_voice_vi": "Vietnamese translation with full diacritics of hook_voiceover + hook_character_speech only; if both are empty, translate hook_text_overlay",
            "reference_pattern": "Named video structure cue. Can be a proven cue, hybrid, or custom pattern, e.g. Siri Bridge, Shock Object, Phone Demo Proof, Transformation Demo, Comment Reply, Split-Screen Choice, Problem-Solution Handheld, or a new pattern name",
            "interrupt_mechanism": "Why the first frame stops scroll: visual oddity, sharp question, contradiction, proof object, social tension, or transformation gap",
            "first_frame_asset": "Exact first-frame asset/object/person/action visible before any explanation",
            "psp_bridge": "One concrete transition from the hook pain/emotion to the PSP/app action, 10-36 words. It explains why the viewer now needs this product, before the Body demo starts.",
            "proof_object": "The concrete object or screen that proves the promise later in the video",
            "app_demo_action": "Exact app action shown on screen: tap, scan, upload, measure, compare, render, clean, save, etc.",
            "overlay_sequence": ["hook overlay inside visual_scene_1", "demo overlay", "proof overlay", "CTA overlay"],
            "edit_notes": "Concrete editing notes: cut rhythm, zoom, caption style, SFX, transition, or b-roll reference",
            "visual_scene_1": "Timed hook scene using V3.1 phases where applicable: 0-1.5s Visual Shock, 1.5-3.5s Context, 3.5-5s Curiosity Gap. Include shot type cues, who, where, doing what, and visible pain object. Do not include Voiceover/Text hien/CHARACTER SPEECH in this visual text. ${visualAnchorClause}",
            "visual_scene_2": "After hook: exact demo or story visual showing the product action tied to the same pain point. ${visualAnchorClause}",
            "visual_scene_3": "Second 15-25: exact reveal, proof, result, or final CTA visual. ${visualAnchorClause}",
            "script_vo": "Full speakable voiceover script, max 60 words.",
            "cta_text": "Exact CTA in Vietnamese, max 6 words.",
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
5. hook_character_speech must be empty unless visual_scene_1 clearly identifies the visible speaker. If visual_scene_1 shows that person speaking/asking/replying/reacting to camera or being asked a question, hook_character_speech is required with time + speaker. Never output "-" or "N/A" for speech.
6. hook_voiceover must be concise enough for the selected hook duration. It must not be the same sentence as hook_primary or hook_text_overlay. Use either hook_voiceover or hook_character_speech, not both.
7. visual_scene_1, visual_scene_2, and visual_scene_3 must be specific enough that a video creator can shoot without asking questions.
8. psp_bridge is required and must connect the viewer's emotion/angle to the PSP before the Body starts.
9. reference_pattern, interrupt_mechanism, first_frame_asset, psp_bridge, proof_object, app_demo_action, overlay_sequence, and edit_notes are required production blueprint fields. reference_pattern is a flexible named structure cue, not a closed whitelist. The other blueprint fields must not be generic.
10. script_vo must be speakable in roughly 25 seconds, max 60 words.
11. id must follow P{pillar_index}-A{angle_index}-I{idea_index}, zero-indexed.
12. angle_type must be one of the allowed values and should be different from other angles in the same pillar.
13. track: A = no real person needed, B = real person / UGC, C = motion / animation.
14. Keep every idea inside the exact selected pillar and selected angle. Do not drift into adjacent pain points.
15. title, hook_primary, hook_alt_1, hook_alt_2, hook_text_overlay, cta_text, hook_voice_vi, visual_scene_1/2/3 production prose, and production notes must be Vietnamese. Only hook_character_speech, hook_voiceover, and script_vo use ${options.language}; do not put Voiceover / CHARACTER SPEECH snippets inside visual scenes.
16. Do not make prohibited claims or before/after health outcome framing.
17. If returning more than 1 idea, no two ideas may use the same hook_primary, the same opening scene family, or the same first visible pain object unless explicitly requested. Reusing a reference_pattern is allowed only when the execution, first-frame asset, and proof object are clearly different.
18. Do not collapse the pain point into a broad symptom. The hook and visual_scene_1 must expose the exact trigger/context/cause from the selected pain point.
19. hook_primary should sound like a human confession, tension line, or pattern interrupt in-feed. Avoid search-query hooks like "Could X explain Y?" unless the user explicitly asks for educational SEO style.
20. visual_scene_1 + hook_voiceover/character_speech + psp_bridge should make the selected hook duration clear. If no seconds are provided, infer 3-8s from the operator idea description and content complexity.
21. visual_scene_1, visual_scene_2, and visual_scene_3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
22. Use V3.1 hook phases and shot type cues for full hooks; keep longer hooks readable and not overcut.`;
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
    .replace(/\b8\s*[-–]\s*12\s*s\b/gi, '0-10s')
    .replace(/\b0\s*[-–]\s*12\s*s\b/gi, '0-10s');
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

function hasVietnameseDiacritics(text: string): boolean {
  return /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text);
}

function looksVietnamese(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;

  const vietnameseCueTokens = normalized.match(/\b(?:toi|ban|minh|nguoi|phu|nu|dan|ong|nha|phong|khach|trong|tron|noi|that|thiet|ke|chi|phi|bao|gia|sua|du|toan|anh|dep|mau|khong|chua|muon|roi|mat|nhin|chon|truoc|sau|luc|nay|thay|biet|bat|dau|kho|mo|ho|them|tren|man|hinh|goi|thang|dung|khoanh|khac|cat|sang|tinh|nang|theo|doi|don|gian|cho|nhu|mot|buoc|xu|ly|van|de|vua|lo|ra|giu|bang|chuyen|tao|lai|toan|bo|huyet|ap|nhip|tim|suc|khoe|kiem|tra|dien|thoai|con|so|lo|lang|binh|tinh|ngay)\b/g) || [];
  const englishTokens = normalized.match(/\b(?:the|this|that|with|without|because|every|again|just|why|what|when|where|how|your|you|does|did|was|were|from|into|while|before|after|thought|started|changed|room|living|empty|blank|app|style|decorating|design|first|problem|camera|screen|phone|upload|choose|tap|shows|final|find|try|save|saved)\b/g) || [];

  if (hasVietnameseDiacritics(text) && vietnameseCueTokens.length >= 1) return true;
  return vietnameseCueTokens.length >= 2 && vietnameseCueTokens.length >= englishTokens.length;
}

function looksLikeUntranslatedAudienceCopy(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;

  const foreignTokens = normalized.match(/\b(?:speaker|perdeu|foto|viagem|memoria|cheia|camara|telemovel|espaco|proxima|duplicados|desfocados|lixo|limpa|quando|espera|travou|ficheiros|recupera|fotografar|sem|para|comecar|esta|estao|voce|uma|the|you|your|camera|storage|photo|video|clean|duplicate|blurred|trash|cuando|llena|viaje|espacio|siguiente|basura)\b/g) || [];
  const vietnameseCueTokens = normalized.match(/\b(?:nguoi|ban|toi|minh|bo|lo|anh|chuyen|di|du|lich|bo|nho|day|don|dep|trung|video|mo|rac|may|dien|thoai|neu|khi|hay|da|dang|vua|roi|sach|nhanh)\b/g) || [];

  return foreignTokens.length >= 2 && foreignTokens.length > vietnameseCueTokens.length;
}

function stripAudienceCopyFromVisualScene(text: string): string {
  return text
    .replace(/"[^"]*"/g, ' ')
    .replace(/\[[^\]]*(?:CHARACTER SPEECH|VOICEOVER|VOICE|TEXT OVERLAY)[^\]]*\][^.;\n]*/gi, ' ')
    .replace(/\b(?:Position anchor|Contact anchor|Physical action anchor|Text hien|Text hiện|Voiceover|CHARACTER SPEECH|VOICEOVER|Patient|Speaker|VO)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visualProductionLooksVietnamese(text: string): boolean {
  const productionText = stripAudienceCopyFromVisualScene(text);
  if (!productionText) return false;
  return looksVietnamese(productionText) && !looksEnglish(productionText);
}

function looksForeignScriptTitle(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  const foreignTokens = normalized.match(/\b(?:when|why|what|how|before|after|still|only|one|tap|morning|notebook|cuaderno|cuando|sube|baja|solo|toque|antes|salir|manana|hoy|presion|normal)\b/g) || [];
  const vietnameseTitleTokens = normalized.match(/\b(?:huyet|ap|nhip|tim|pin|sac|mot|cham|truoc|khi|ra|ngoai|buoi|sang|khong|so|tay|phong|cho|kham|chi|so|len|xuong|cu|moi|nong|may|do|kiem|tra|don|gian|bat|ngo|hom|nay)\b/g) || [];
  return foreignTokens.length > 0 && foreignTokens.length >= vietnameseTitleTokens.length;
}

function looksVietnameseScriptTitle(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  if (/[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) return !looksForeignScriptTitle(text);
  const vietnameseTitleTokens = normalized.match(/\b(?:huyet|ap|nhip|tim|pin|sac|mot|cham|truoc|khi|ra|ngoai|buoi|sang|khong|so|tay|phong|cho|kham|chi|so|len|xuong|cu|moi|nong|may|do|kiem|tra|don|gian|bat|ngo|hom|nay)\b/g) || [];
  return vietnameseTitleTokens.length >= 2 && !looksForeignScriptTitle(text);
}

function coerceVietnameseScriptTitle(rawTitle: string, context: string, index: number): string {
  const title = rawTitle.trim();
  if (looksVietnameseScriptTitle(title)) return title;

  const normalizedTitle = normalizeCompareText(title);
  const titleIsGeneric = !normalizedTitle || /^(?:idea|y tuong|concept|script|kich ban|hook|untitled|p\d+\s*a\d+\s*i\d+)\b/.test(normalizedTitle);
  const normalized = titleIsGeneric ? normalizeCompareText([title, context].filter(Boolean).join(' ')) : normalizedTitle;
  if (/\b(?:solo|one)\b.*\b(?:toque|tap)\b|\bmot\b.*\bcham\b/.test(normalized)) return 'Chỉ một chạm';
  if (/\b(?:antes|before)\b.*\b(?:salir|leave|leaving)\b|\btruoc\b.*\b(?:ra|di)\b/.test(normalized)) return 'Trước khi ra ngoài';
  if (/\b(?:manana|morning)\b.*\b(?:cuaderno|notebook)\b|\bbuoi\b.*\bsang\b.*\bso\b.*\btay\b/.test(normalized)) return 'Buổi sáng không sổ tay';
  if (/\b(?:hoy|today)\b.*\b(?:sube|baja|pressure|presion)\b/.test(normalized)) return 'Huyết áp hôm nay';
  if (/\b(?:normal|normal)\b/.test(normalized)) return 'Có bình thường không';
  if (/\b(?:sube|baja|presion|pressure)\b|\bhuyet\b.*\bap\b|\bchi\b.*\bso\b.*\b(?:len|xuong)\b/.test(normalized)) return 'Huyết áp lên xuống';
  if (/\b(?:waiting|clinic|consulta|doctor|phong|kham)\b/.test(normalized)) return 'Trong phòng chờ';
  if (/\b(?:iphone|camera|measure|kiem|tra|do)\b/.test(normalized)) return 'Đo nhanh bằng iPhone';

  return `Khoảnh khắc sức khỏe ${index + 1}`;
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

function stripInlineAudienceCopyFromScene(text: string): string {
  if (!text) return text;
  return text
    .split(/\r?\n/)
    .map(line => line
      .replace(/\bText\s+(?:hien|hi[eệ]n)\s*:\s*"[^"]*"\s*\|\s*/gi, '')
      .replace(/\b(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|VOICE)\s*:\s*"[^"]*"\s*\|\s*/gi, '')
      .replace(/\s*\|\s*(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|VOICE)\s*:\s*"[^"]*"/gi, '')
      .replace(/\s*\|\s*\[(?:VOICEOVER|VOICE|CHARACTER SPEECH|TEXT OVERLAY)\][^|.;\n]*/gi, '')
      .replace(/^\s*\[(?:VOICEOVER|VOICE|CHARACTER SPEECH|TEXT OVERLAY)\].*$/gi, '')
      .replace(/\s+\|\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n');
}

function isSameLine(a: string, b: string): boolean {
  const left = normalizeCompareText(a);
  const right = normalizeCompareText(b);
  return Boolean(left && right && left === right);
}

function visualMentionsVisibleSpeaker(visual: string): boolean {
  const normalized = normalizeCompareText(visual);
  return /\b(?:nguoi|phu nu|dan ong|nam|nu|me|bo|vo|chong|con|ban|khach|khach moi|nhan vat|talent|creator|host|mc|podcaster|chuyen gia|bac si|benh nhan|nguoi benh|nguoi dung|doctor|patient|specialist|expert|guest|interviewer|interviewee|user|woman|man|mom|dad|wife|husband|customer|teen)\b/.test(normalized);
}

function visualImpliesOnCameraSpeech(visual: string): boolean {
  const normalized = normalizeCompareText(visual);
  if (!visualMentionsVisibleSpeaker(visual)) return false;
  return /\b(?:noi|noi thang|hoi|tra loi|dap lai|keu|bao|thot|doc|phong van|hoi dap|doi thoai|tro chuyen|trao doi|thao luan|toa dam|podcast|micro|mic|talks?|speaks?|says?|asks?|replies?|answers?|responds?|tells?|confesses?|comments?|interviews?|conversation|dialogue|talking to camera|speaking to camera|talking head)\b/.test(normalized);
}

function visualImpliesTwoPersonDialogue(visual: string): boolean {
  const normalized = normalizeCompareText(visual);
  if (!visualMentionsVisibleSpeaker(visual)) return false;
  return /\b(?:two people|2 people|two men|two women|two friends|2 friends|two person|2 person|hai nguoi|2 nguoi|hai nhan vat|2 nhan vat|nguoi thu hai|nguoi con lai|ban be|friend|friends|couple|husband|wife|doctor|patient|host|guest|interviewer|interviewee|podcast|interview|conversation|dialogue|doi thoai|tro chuyen|phong van|hoi dap|toa dam)\b/.test(normalized);
}

function extractSpeakerLabel(visual: string): string {
  const clean = visual.replace(/\s+/g, ' ');
  const labelledMatch = clean.match(/\b(?:Speaker|Host|Guest|Doctor|Patient)\s*\d*\b/i);
  if (labelledMatch) return labelledMatch[0].trim();

  const vietnamesePersonMatch = clean.match(/\b(?:một|mot)\s+((?:người|nguoi)\s+(?:đàn ông|dan ong|phụ nữ|phu nu|nam|nữ|nu|bác sĩ|bac si|bệnh nhân|benh nhan)[^,.;]{0,70})/i)
    || clean.match(/\b((?:người|nguoi)\s+(?:đàn ông|dan ong|phụ nữ|phu nu|nam|nữ|nu|bác sĩ|bac si|bệnh nhân|benh nhan)[^,.;]{0,70})/i);
  if (vietnamesePersonMatch?.[1]) {
    return vietnamesePersonMatch[1]
      .replace(/\b(?:ngồi|ngoi|đứng|dung|cầm|cam|nhìn|nhin|mở|mo)\b.*$/i, '')
      .trim();
  }

  const englishPersonMatch = clean.match(/\b(?:a|an)\s+((?:black|white|asian|latino|older|young|middle-aged|male|female|man|woman|doctor|patient|host|guest)[^,.;]{0,70})/i);
  if (englishPersonMatch?.[1]) return englishPersonMatch[1].trim();

  if (/\bdoctor|bac si|bác sĩ\b/i.test(clean)) return 'Bác sĩ';
  if (/\bpatient|benh nhan|bệnh nhân\b/i.test(clean)) return 'Bệnh nhân';
  if (/\bwoman|phu nu|phụ nữ\b/i.test(clean)) return 'Người phụ nữ';
  if (/\bman|dan ong|đàn ông\b/i.test(clean)) return 'Người đàn ông';
  return 'Nhân vật';
}

function pickSpeechTimeRange(visual: string): string {
  const lines = visual.split(/\r?\n/);
  const speechLine = lines.find(line => /\b(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|says?|speaks?|noi|nói|hoi|hỏi)\b/i.test(line));
  const source = speechLine || (lines.length > 1 ? lines[1] : lines[0]) || visual;
  const sourceRange = source.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*s/i);
  if (sourceRange) return `${sourceRange[1].replace(',', '.')}-${sourceRange[2].replace(',', '.')}s`;

  const firstRange = visual.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*s/i);
  if (firstRange) return `${firstRange[1].replace(',', '.')}-${firstRange[2].replace(',', '.')}s`;
  return '0-2.5s';
}

function formatCharacterSpeechWithTiming(visual: string, speech: string): string {
  const cleanSpeech = readSpeechText(speech);
  if (!cleanSpeech) return '';
  const lines = cleanSpeech
    .split(/\r?\n|\/\s*(?=(?:Speaker|Host|Guest|Doctor|Patient)\s*\d*\s*:)/i)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  const time = pickSpeechTimeRange(visual);
  const fallbackSpeaker = extractSpeakerLabel(visual);
  return lines.map(line => {
    if (/^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*s\s*[-:]/i.test(line)) return line;
    if (/^(?:Speaker|Host|Guest|Doctor|Patient|Man|Woman|Bác sĩ|Bệnh nhân|Người[^:]{0,40}|Nhân vật)\s*\d*\s*:/i.test(line)) {
      return `${time} - ${line}`;
    }
    return `${time} - ${fallbackSpeaker}: ${line}`;
  }).join('\n');
}

function moveOnCameraVoiceoverToCharacterSpeech(
  visual: string,
  characterSpeech: string,
  voiceover: string
): { characterSpeech: string; voiceover: string } {
  const spokenVoiceover = readSpeechText(voiceover);
  if (!spokenVoiceover) return { characterSpeech, voiceover: '' };
  if (!visualImpliesOnCameraSpeech(visual) && !visualImpliesTwoPersonDialogue(visual)) {
    return { characterSpeech, voiceover: spokenVoiceover };
  }

  const spokenCharacter = readSpeechText(characterSpeech);
  if (!spokenCharacter) return { characterSpeech: spokenVoiceover, voiceover: '' };
  if (isSameLine(spokenCharacter, spokenVoiceover)) return { characterSpeech: spokenCharacter, voiceover: '' };

  const alreadyLabelled = /\b(?:speaker|host|guest|person|man|woman|doctor|patient|nhan vat|nguoi)\s*\d?\s*:/i.test(`${spokenVoiceover}\n${spokenCharacter}`);
  return {
    characterSpeech: alreadyLabelled
      ? `${spokenVoiceover}\n${spokenCharacter}`
      : `Speaker 1: ${spokenVoiceover}\nSpeaker 2: ${spokenCharacter}`,
    voiceover: '',
  };
}

function normalizeHookVoiceTranslation(translation: string, characterSpeech: string, voiceover: string): string {
  const clean = readText(translation);
  if (!clean) return clean;
  if (characterSpeech && !voiceover && clean.includes('/')) {
    return clean.split('/').map(part => part.trim()).filter(Boolean)[0] || clean;
  }
  return clean;
}

function buildIdeaDiversitySignature(values: string[]): string {
  return extractAnchorTokens(values.filter(Boolean).join(' '), 24).join(' ');
}

function hasPatternInterrupt(text: string): boolean {
  const raw = text.toLowerCase();
  const normalized = normalizeCompareText(text);
  const interruptPattern = /(?:\?|\d|%|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|wait\b|mistake\b|wrong\b|hidden\b|secret\b|ruin\b|cost\b|missing\b|detail\b|clue\b|saved\b|real\b|actual\b|fit\b|zero\b|answer\b|truth\b|blood\b|pressure\b|heart\b|rate\b|standing\b|dizzy\b|lightheaded\b|morning\b|older\b|scary\b|pause\b|signal\b|ignoring\b|bothering\b|nobody\b|most\b|sao\b|tai sao\b|van\b|dung\b|khong can\b|thay vi\b|bao gio\b|te nhat\b|met\b|phien\b|kho\b|shock\b|hau het\b|su that\b|that ra\b|sai lam\b|nguoc\b|lo lang\b|so\b|huyet\b|nhip\b|tim\b|hoa mat\b|chong mat\b|choang\b|bep\b|nau\b|tuoi\b|khung\b|tin hieu\b|bi mat\b|thieu\b|an sau\b|thiet ke\b|noi that\b|phong khach\b|bao gia\b|chi phi\b|du toan\b|ngan sach\b|sua nha\b|anh dep\b|mau nha\b|ban ve\b|mat bang\b|khong ra nha\b|roi hon\b|mo ho\b|chon sai\b|doi chi phi\b)/i;
  return interruptPattern.test(raw)
    || interruptPattern.test(normalized)
    || /(?:\b60\b|\b70\b|\b80\b|\b90\b|\b1\b|\b3\b|\b5\b|\b7\b)/.test(normalized);
}

function parseTimeNumber(value: string): number {
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTimeRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*s/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = parseTimeNumber(match[1]);
    const end = parseTimeNumber(match[2]);
    if (end > start) ranges.push({ start, end });
  }

  return ranges;
}

function inferHookDurationSecondsFromTimingText(text: string): number | null {
  const ranges = extractTimeRanges(text);
  if (ranges.length === 0) return null;
  const duration = Math.max(...ranges.filter(range => range.start < 10.5).map(range => range.end));
  return Number.isFinite(duration) && duration >= 3 && duration <= 10 ? Math.round(duration * 10) / 10 : null;
}

function getRule4MaxSceneCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.min(4, Math.floor(durationSeconds / 2.5)));
}

function hasV31HookPhases(ranges: Array<{ start: number; end: number }>): boolean {
  if (ranges.length !== 3) return false;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const maxEnd = Math.max(...sorted.map(range => range.end));
  const startsAtZero = sorted[0].start <= 0.25;
  const contiguous = sorted.every((range, index) => (
    index === 0 || Math.abs(range.start - sorted[index - 1].end) <= 0.35
  ));
  const readableDurations = sorted.every(range => range.end - range.start >= 1);
  return startsAtZero && contiguous && maxEnd <= 5.35 && readableDurations;
}

function hasPacingCompliantHook(text: string): boolean {
  const ranges = extractTimeRanges(text);
  if (ranges.length === 0) return false;

  const hookRanges = ranges.filter(range => range.start < 10.5);
  if (hookRanges.length === 0) return false;

  if (hasV31HookPhases(hookRanges)) return true;

  const maxEnd = Math.max(...hookRanges.map(range => range.end));
  if (maxEnd > 10.25) return false;
  const maxScenes = getRule4MaxSceneCount(maxEnd);
  const minSceneSeconds = 2.35;

  if (hookRanges.length > maxScenes) return false;
  if (/\b(?:split[-\s]?screen|chia\s+doi\s+man\s+hinh|chia\s+doi|side[-\s]?by[-\s]?side)\b/i.test(text) && maxEnd < 6) {
    return false;
  }
  return hookRanges.every(range => {
    const duration = range.end - range.start;
    return hookRanges.length === 1 || duration >= minSceneSeconds;
  });
}

function hasShotTypeCue(text: string): boolean {
  return /\b(?:ECU|CU|MCU|MS|MLS|LS|POV|OTS|Insert(?:\s+Shot)?|Split\s+Screen)\s*:/i.test(text);
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

const FRAMEWORK_VISUAL_FORMATS = ['2D Animation', '3D Animation', 'UGC', 'POV', 'Motion Graphic'] as const;

function normalizeFrameworkVisualFormat(value?: string): string {
  const raw = readText(value);
  const normalized = normalizeCompareText(raw);
  if (!normalized) return '';
  if (/\bmotion\b/.test(normalized) || /\bgraphic\b/.test(normalized) || /\bdata visual\b/.test(normalized)) return 'Motion Graphic';
  if (/\b2d\b/.test(normalized)) return '2D Animation';
  if (/\b3d\b/.test(normalized)) return '3D Animation';
  if (/\bpov\b/.test(normalized) || /\bscreen recording\b/.test(normalized) || /\bdemo app\b/.test(normalized)) return 'POV';
  if (/\bugc\b/.test(normalized) || /\bnguoi that\b/.test(normalized)) return 'UGC';
  return FRAMEWORK_VISUAL_FORMATS.includes(raw as typeof FRAMEWORK_VISUAL_FORMATS[number]) ? raw : '';
}

function creativeTypeForTrackWithLock(track: string, lockedVisualType?: string): string {
  return normalizeFrameworkVisualFormat(lockedVisualType) || creativeTypeForTrack(track);
}

function enforceSelectedVisualFormatInScene(text: string, visualType?: string): string {
  const scene = text.trim();
  const lockedVisualType = normalizeFrameworkVisualFormat(visualType);
  const normalizedScene = normalizeCompareText(scene);
  if (!scene || !lockedVisualType) return scene;

  if (lockedVisualType === 'Motion Graphic') {
    const hasOffFormatCue = /\b(?:podcast|interview|talk show|host|guest|speaker\s*[12]|two people|2 people|two men|two women|living room|sofa|armchair|camera iphone|eye line|doi thoai|tro chuyen|phong van|hai nguoi|2 nguoi|nguoi that|dien vien|nhan vat)\b/.test(normalizedScene);
    if (hasOffFormatCue) {
      return 'Motion Graphic 2D thuần: khung app UI/phone screen, typography lớn, icon flat, arrows, waveform/heart-rate line và animated chart/data callout chuyển động theo beat. Không có podcast, host/speaker, người thật, sofa hay phòng ghi hình.';
    }
  }

  if (lockedVisualType === '2D Animation' && !/\b(?:2d|animation|animated|minh hoa|hoat hinh|vector|cartoon)\b/.test(normalizedScene)) {
    return `Trong khung 2D animation minh họa, ${scene}`;
  }
  if (lockedVisualType === '3D Animation' && !/\b(?:3d|cgi|render|animated|animation)\b/.test(normalizedScene)) {
    return `Trong khung 3D animation/render, ${scene}`;
  }
  if (lockedVisualType === 'Motion Graphic' && !/\b(?:motion graphic|2d motion|kinetic typography|animated ui|ui motion|shape animation|icon animation|infographic|typography|data visual|animated chart|bieu do)\b/.test(normalizedScene)) {
    return `Theo phong cách Motion Graphic 2D: typography/shape/icon/UI chuyển động, ${scene}`;
  }
  if (lockedVisualType === 'POV' && !/\b(?:pov|goc nhin|screen recording|man hinh|over the shoulder)\b/.test(normalizedScene)) {
    return `Theo góc POV/screen-perspective, ${scene}`;
  }
  if (lockedVisualType === 'UGC' && !/\b(?:ugc|nguoi that|doi thuong|cam tay|handheld|selfie)\b/.test(normalizedScene)) {
    return `Theo phong cách UGC đời thường, ${scene}`;
  }
  return scene;
}

function isMotionGraphicVisual(visualType?: string) {
  return normalizeFrameworkVisualFormat(visualType || '') === 'Motion Graphic';
}

function stripRoleLabelsForVoiceover(text: string) {
  return text
    .replace(/\bSpeaker\s*\d+\s*:\s*/gi, '')
    .replace(/\b(?:Host|Guest)\s*:\s*/gi, '')
    .replace(/\s*\/\s*/g, ' ')
    .trim();
}

const HOOK_ARCHETYPE_LABELS: Record<string, string> = {
  'stat shock': 'Stat Shock',
  'body signal question': 'Body Signal Question',
  'whisper secret': 'Whisper Secret',
  'pov narrative': 'POV Narrative',
  'counter intuitive': 'Counter-intuitive',
  'social proof': 'Social Proof',
  'social proof fomo': 'Social Proof',
  'zoom problem': 'Zoom Problem',
  'before after demo': 'Before After Demo',
  'question accusation': 'Question Accusation',
  'speed ease claim': 'Speed Ease Claim',
  'tutorial opener': 'Tutorial Opener',
  'trend jack': 'Trend Jack',
  'result first': 'Result First',
  'demo magic': 'Demo-Magic',
  'identity personal': 'Identity Personal',
  'challenge dare': 'Challenge Dare',
};

function getCategoryHookRules(category?: string): { allowed: Set<string>; tier1: Set<string>; label: string } | null {
  const normalized = normalizeCompareText(category || '');
  const healthAllowed = new Set(['stat shock', 'body signal question', 'whisper secret', 'pov narrative', 'counter intuitive', 'social proof']);
  const utilityAllowed = new Set([
    'before after demo',
    'zoom problem',
    'question accusation',
    'tutorial opener',
    'demo magic',
    'speed ease claim',
    'trend jack',
    'stat shock',
    'counter intuitive',
    'pov narrative',
    'social proof',
  ]);
  const aiAllowed = new Set([
    'result first',
    'before after demo',
    'trend jack',
    'demo magic',
    'identity personal',
    'challenge dare',
    'social proof',
    'social proof fomo',
    'pov narrative',
  ]);

  if (/\bhealth\b|\bfitness\b|\bcardiac\b|\bheart\b/.test(normalized)) {
    return {
      label: 'Health & Fitness',
      allowed: healthAllowed,
      tier1: new Set(['stat shock', 'body signal question', 'whisper secret']),
    };
  }
  if (/\butility\b|\bcleaner\b|\bstorage\b|\bphone\b/.test(normalized)) {
    return {
      label: 'Utility',
      allowed: utilityAllowed,
      tier1: new Set(['before after demo', 'zoom problem', 'question accusation']),
    };
  }
  if (/\bai\b|\bartificial intelligence\b/.test(normalized)) {
    return {
      label: 'AI App',
      allowed: aiAllowed,
      tier1: new Set(['result first', 'before after demo', 'trend jack']),
    };
  }
  return null;
}

function getCategoryHookPreference(category?: string, context = ''): string[] {
  const rules = getCategoryHookRules(category);
  const normalizedContext = normalizeCompareText(context);
  if (!rules) return Object.keys(HOOK_ARCHETYPE_LABELS);

  if (rules.label === 'AI App') {
    if (/\btrend\b|\btiktok\b|\breel\b|\bviral\b/.test(normalizedContext)) {
      return ['trend jack', 'result first', 'before after demo', 'demo magic', 'identity personal', 'challenge dare', 'pov narrative', 'social proof'];
    }
    if (/\bcompare\b|\bcomparison\b|\bbefore\b|\bafter\b/.test(normalizedContext)) {
      return ['before after demo', 'result first', 'trend jack', 'demo magic', 'identity personal', 'challenge dare', 'pov narrative', 'social proof'];
    }
    return ['result first', 'before after demo', 'trend jack', 'demo magic', 'identity personal', 'challenge dare', 'pov narrative', 'social proof'];
  }

  if (rules.label === 'Utility') {
    return ['before after demo', 'zoom problem', 'question accusation', 'tutorial opener', 'demo magic', 'speed ease claim', 'trend jack', 'stat shock', 'counter intuitive', 'pov narrative', 'social proof'];
  }

  return ['stat shock', 'body signal question', 'whisper secret', 'pov narrative', 'counter intuitive', 'social proof'];
}

function coerceHookArchetypeForCategory(category: string | undefined, value: string, used: Set<string>, context: string): string {
  const rules = getCategoryHookRules(category);
  const currentKey = normalizeCompareText(value);
  if (currentKey && (!rules || rules.allowed.has(currentKey)) && !used.has(currentKey)) {
    used.add(currentKey);
    return HOOK_ARCHETYPE_LABELS[currentKey] || value;
  }

  const preference = getCategoryHookPreference(category, context);
  const fallbackKey = preference.find(key => !used.has(key) && (!rules || rules.allowed.has(key)));
  if (fallbackKey) {
    used.add(fallbackKey);
    return HOOK_ARCHETYPE_LABELS[fallbackKey] || fallbackKey;
  }

  if (currentKey) used.add(currentKey);
  return value || 'POV Narrative';
}

function createBriefValidationErrors(input: {
  id: string;
  title: string;
  category?: string;
  angleType: string;
  hookPrimary: string;
  hookAlt1: string;
  hookAlt2: string;
  hookArchetype?: string;
  hookAlt1Archetype?: string;
  hookAlt2Archetype?: string;
  hookCharacterSpeech?: string;
  hookVoiceover?: string;
  hookTextOverlay?: string;
  hookVoiceVi?: string;
  emotionJourney?: string;
  bodyMotivationPattern?: string;
  ctaFrictionReducer?: string;
  estimatedThumbStop?: string;
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
  const allowedAngleTypes = new Set(['fear', 'fact', 'comparison', 'pov', 'social', 'curiosity', 'relief', 'tutorial', 'demo', 'challenge', 'trend']);

  if (!trackingPattern.test(input.id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!looksVietnameseScriptTitle(input.title)) errors.push('title/script name must be Vietnamese');
  if (!allowedAngleTypes.has(normalizeCompareText(input.angleType))) {
    errors.push('angle_type must be Fear, Fact, Comparison, POV, Social, Curiosity, Relief, Tutorial, Demo, Challenge, or Trend');
  }
  if (!input.hookPrimary) errors.push('hook_text_overlay is required');
  const vietnameseTextFields = [
    input.hookPrimary,
    input.hookAlt1,
    input.hookAlt2,
    input.hookTextOverlay,
    input.ctaText,
  ].filter(Boolean).map(value => vietnameseOverlayPart(value || ''));
  if (vietnameseTextFields.some(value => !looksVietnamese(value || ''))) {
    errors.push('hook text overlays, hook alternatives, and cta_text must be Vietnamese; only voice/speech fields use the market language');
  }
  if (/vietnam/i.test(input.language || '')) {
    const languageText = [
      input.hookPrimary,
      input.hookAlt1,
      input.hookAlt2,
      input.hookCharacterSpeech || '',
      input.hookVoiceover || '',
      input.hookTextOverlay || '',
      input.pspBridge || '',
      input.scriptVo,
      input.ctaText,
    ].join(' ');
    if (looksEnglish(languageText)) {
      errors.push('all user-facing fields must be Vietnamese, not English/Spanish');
    }
  }
  const visualScenes = [input.visualScene1, input.visualScene2, input.visualScene3].filter(Boolean);
  if (visualScenes.some(scene => !visualProductionLooksVietnamese(scene))) {
    errors.push('visual_scene prose must be Vietnamese and must not contain Voiceover/CHARACTER SPEECH snippets');
  }
  const hookTextOverlayForCount = input.hookTextOverlay || input.hookPrimary;
  if (hookTextOverlayForCount && maxOverlayWordsPerLanguage(hookTextOverlayForCount) > 8) {
    errors.push('hook_text_overlay must be 8 words or fewer per language');
  }
  if (input.hookVoiceover && countWords(input.hookVoiceover) > 12) {
    errors.push('hook_vo must be 12 words or fewer');
  }
  const hookArchetypes = [input.hookArchetype, input.hookAlt1Archetype, input.hookAlt2Archetype]
    .map(value => normalizeCompareText(value || ''))
    .filter(Boolean);
  if (hookArchetypes.length === 3 && new Set(hookArchetypes).size !== 3) {
    errors.push('primary and alternative hooks must use 3 different archetypes');
  }
  const categoryHookRules = getCategoryHookRules(input.category);
  if (categoryHookRules && hookArchetypes.length > 0) {
    const invalidArchetypes = hookArchetypes.filter(archetype => !categoryHookRules.allowed.has(archetype));
    if (invalidArchetypes.length > 0) {
      errors.push(`hook_archetype must match ${categoryHookRules.label}; invalid: ${Array.from(new Set(invalidArchetypes)).join(', ')}`);
    }
    if (!hookArchetypes.some(archetype => categoryHookRules.tier1.has(archetype))) {
      errors.push(`at least one hook variation must use a Tier 1 ${categoryHookRules.label} archetype`);
    }
  }
  const isV7 = false;
  const isBuilder = false;
  if (!input.hookAlt1) errors.push('hook_alt_1_text is required');
  if (!input.hookAlt2) errors.push('hook_alt_2_text is required');
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
  const hookVoiceVi = readText(input.hookVoiceVi);
  if (!hookCharacterSpeech && !hookVoiceover && !hookTextOverlay) {
    errors.push('hook needs hook_character_speech, hook_voiceover, or hook_text_overlay');
  }
  if (!hookVoiceVi) {
    errors.push('hook_voice_vi is required for Vietnamese hook voice translation');
  } else if (!hasVietnameseDiacritics(hookVoiceVi) || !looksVietnamese(hookVoiceVi) || looksLikeUntranslatedAudienceCopy(hookVoiceVi)) {
    errors.push('hook_voice_vi must be Vietnamese with full diacritics, not the original market copy');
  }
  if (hookCharacterSpeech && !visualMentionsVisibleSpeaker(input.visualScene1)) {
    errors.push('hook_character_speech requires a clearly visible speaker in visual_scene_1');
  }
  if (visualImpliesOnCameraSpeech(input.visualScene1) && !hookCharacterSpeech) {
    errors.push('hook_character_speech is required when visual_scene_1 describes visible on-camera speech or dialogue');
  }
  if (hookCharacterSpeech && countWords(hookCharacterSpeech) > 36) {
    errors.push('hook_character_speech must be 36 words or fewer');
  }
  if (hookVoiceover && countWords(hookVoiceover) > 12) {
    errors.push('hook_vo must be 12 words or fewer');
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
  if (hookCharacterSpeech && hookVoiceover) {
    errors.push('use either hook_character_speech or hook_voiceover in the hook, not both');
  }
  if (hookCharacterSpeech && !/^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*s\s*[-:]\s*[^:]{2,80}:/m.test(hookCharacterSpeech)) {
    errors.push('hook_character_speech must include time + speaker label, e.g. 2.5-5s - Older man: line');
  }
  if (/\b(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|VOICE|Text\s+(?:hien|hi[eệ]n))\s*:/i.test(input.visualScene1)) {
    errors.push('visual_scene_1 must not contain inline Voiceover, Character speech, or Text hien labels');
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
  if (input.visualScene1 && !hasPacingCompliantHook(input.visualScene1)) {
    errors.push('visual_scene_1 must use V3.1 hook phases: 0-1.5s, 1.5-3.5s, 3.5-5s, or another valid timed hook');
  }
  if ([input.visualScene1, input.visualScene2, input.visualScene3].some(scene => scene && !hasShotTypeCue(scene))) {
    errors.push('visual_scene_1/2/3 must include shot type cues such as ECU:, CU:, POV:, Insert:, or Split Screen:');
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
  if (!isV7 && input.ctaText && maxOverlayWordsPerLanguage(input.ctaText) > 6) {
    errors.push('cta_text must be 6 words or fewer per language');
  }
  if (!readText(input.ctaFrictionReducer)) {
    errors.push('cta_friction_reducer is required');
  }
  if (!readText(input.bodyMotivationPattern)) {
    errors.push('body_motivation_pattern is required');
  }
  if (!readText(input.emotionJourney)) {
    errors.push('emotion_journey is required');
  }
  if (!readText(input.estimatedThumbStop)) {
    errors.push('estimated_thumb_stop is required');
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
    category?: string;
    pillar?: string;
    coreUser?: string;
    emotion?: string;
    psp?: string;
    angle?: string;
    ideaDescription?: string;
    language?: string;
    visualType?: string;
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
      const angleLens = readFirstText(angleRecord, ['angle_lens', 'angleLens'], 'Specific Moment');
      const triggerSituation = readFirstText(angleRecord, ['trigger_situation', 'triggerSituation']);
      const copingBehavior = readFirstText(angleRecord, ['coping_behavior', 'copingBehavior']);
      const hiddenBelief = readFirstText(angleRecord, ['hidden_belief', 'hiddenBelief']);
      const persuasionMechanism = readFirstText(angleRecord, ['persuasion_mechanism', 'persuasionMechanism']);
      const coreArgument = readFirstText(angleRecord, ['core_argument', 'coreArgument']);
      const angleDifferentiationCheck = readFirstText(angleRecord, ['angle_differentiation_check', 'angleDifferentiationCheck']);
      const angleType = readFirstText(angleRecord, ['angle_type', 'angleType'], 'Curiosity');
      const angleDesc = readFirstText(
        angleRecord,
        ['angle_desc', 'angleDesc'],
        coreArgument || persuasionMechanism || 'A distinct approach for this pillar.'
      );
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
      const acceptedIdeaSignatures: string[] = [];
      const acceptedTitles: string[] = [];

      briefIdeas.forEach((ideaRecord, ideaFallbackIndex) => {
        const id = readFirstText(ideaRecord, ['id'], `P${pillarIndex}-A${angleIndex}-I${ideaFallbackIndex}`);
        let hookPrimary = readFirstText(ideaRecord, ['hook_text_overlay', 'hookTextOverlay', 'hook_primary', 'hookPrimary']);
        let hookAlt1 = readFirstText(ideaRecord, ['hook_alt_1_text', 'hookAlt1Text', 'hook_alt_1', 'hookAlt1']);
        let hookAlt2 = readFirstText(ideaRecord, ['hook_alt_2_text', 'hookAlt2Text', 'hook_alt_2', 'hookAlt2']);
        const hookArchetypeContext = `${normalizedAngleType} ${angleName} ${angleDesc} ${hookPrimary} ${hookAlt1} ${hookAlt2}`;
        const usedHookArchetypes = new Set<string>();
        const hookArchetype = coerceHookArchetypeForCategory(
          defaults.category,
          readFirstText(ideaRecord, ['hook_archetype', 'hookArchetype']),
          usedHookArchetypes,
          hookArchetypeContext
        );
        const hookAlt1Archetype = coerceHookArchetypeForCategory(
          defaults.category,
          readFirstText(ideaRecord, ['hook_alt_1_archetype', 'hookAlt1Archetype']),
          usedHookArchetypes,
          hookArchetypeContext
        );
        const hookAlt2Archetype = coerceHookArchetypeForCategory(
          defaults.category,
          readFirstText(ideaRecord, ['hook_alt_2_archetype', 'hookAlt2Archetype']),
          usedHookArchetypes,
          hookArchetypeContext
        );
        const hookAlt1Vo = readFirstText(ideaRecord, ['hook_alt_1_vo', 'hookAlt1Vo']);
        const hookAlt2Vo = readFirstText(ideaRecord, ['hook_alt_2_vo', 'hookAlt2Vo']);
        const emotionJourney = readFirstText(ideaRecord, ['emotion_journey', 'emotionJourney']);
        const bodyMotivationPattern = readFirstText(ideaRecord, ['body_motivation_pattern', 'bodyMotivationPattern']);
        const ctaFrictionReducer = readFirstText(ideaRecord, ['cta_friction_reducer', 'ctaFrictionReducer']);
        const estimatedThumbStop = readFirstText(ideaRecord, ['estimated_thumb_stop', 'estimatedThumbStop']);
        const ideaReasoning = readFirstText(ideaRecord, ['idea_reasoning', 'ideaReasoning']);
        const textOverlayRecords = readArray(ideaRecord.text_overlays ?? ideaRecord.textOverlays);
        const textOverlays = textOverlayRecords
          .map(record => {
            const time = readFirstText(record, ['time']);
            const text = readFirstText(record, ['text']);
            return time && text ? `${time}: ${text}` : text;
          })
          .filter(Boolean);
        let hookCharacterSpeech = readSpeechText(readFirstText(ideaRecord, ['hook_character_speech', 'hookCharacterSpeech', 'character_speech', 'characterSpeech']));
        let hookVoiceover = readSpeechText(readFirstText(ideaRecord, ['hook_vo', 'hookVoiceover', 'hook_voiceover', 'voiceover', 'voice_over']));
        let hookTextOverlay = readFirstText(ideaRecord, ['hook_text_overlay', 'hookTextOverlay', 'text_overlay', 'textOverlay']);
        let hookVoiceVi = readFirstText(ideaRecord, ['hook_voice_vi', 'hookVoiceVi', 'hook_vi_translation', 'hookViTranslation', 'vi_translation', 'viTranslation']);
        let visualScene1 = readFirstText(ideaRecord, ['visual_scene_1', 'visualScene1']);
        let visualScene2 = readFirstText(ideaRecord, ['visual_scene_2', 'visualScene2']);
        let visualScene3 = readFirstText(ideaRecord, ['visual_scene_3', 'visualScene3']);
        const scriptTitle = coerceVietnameseScriptTitle(
          readFirstText(ideaRecord, ['title'], hookPrimary || angleName),
          [hookPrimary, hookTextOverlay, visualScene1, visualScene2, visualScene3, angleName, angleDesc].join(' '),
          ideaFallbackIndex
        );
        let scriptVo = readScriptVoText(ideaRecord.script_vo ?? ideaRecord.scriptVo);
        let ctaText = readFirstText(ideaRecord, ['cta_text', 'ctaText']);
        const videoCharacterConcept = readFirstText(ideaRecord, ['video_character_concept', 'videoCharacterConcept']);
        const characterDirection = readFirstText(ideaRecord, ['character_direction', 'characterDirection']);
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
        const talentProfile = readStructuredText(ideaRecord.talent_profile ?? ideaRecord.talentProfile, 'No talent specified');
        let dontDo = readFirstText(ideaRecord, ['dont_do', 'dontDo']);
        const track = readFirstText(ideaRecord, ['track'], 'B').trim().toUpperCase();
        const trackReason = readFirstText(ideaRecord, ['track_reason', 'trackReason']);
        const priority = readFirstText(ideaRecord, ['priority'], 'A').trim().toUpperCase();
        const metricLabel = '';
        const metricAnchors: string[] = [];

        hookPrimary = sanitizeHealthClaimText(hookPrimary);
        hookAlt1 = sanitizeHealthClaimText(hookAlt1);
        hookAlt2 = sanitizeHealthClaimText(hookAlt2);
        hookCharacterSpeech = sanitizeHealthClaimText(hookCharacterSpeech);
        hookVoiceover = sanitizeHealthClaimText(hookVoiceover);
        hookTextOverlay = sanitizeHealthClaimText(hookTextOverlay);
        hookVoiceVi = sanitizeHealthClaimText(hookVoiceVi);
        pspBridge = sanitizeHealthClaimText(pspBridge);
        visualScene1 = sanitizeHealthClaimText(visualScene1);
        visualScene2 = sanitizeHealthClaimText(visualScene2);
        visualScene3 = sanitizeHealthClaimText(visualScene3);
        scriptVo = sanitizeHealthClaimText(scriptVo);
        ctaText = sanitizeHealthClaimText(ctaText);
        dontDo = sanitizeHealthClaimText(dontDo);
        visualScene1 = normalizeHookTimingText(visualScene1);
        visualScene1 = enforceSelectedVisualFormatInScene(visualScene1, defaults.visualType);
        visualScene2 = enforceSelectedVisualFormatInScene(visualScene2, defaults.visualType);
        visualScene3 = enforceSelectedVisualFormatInScene(visualScene3, defaults.visualType);
        const rawVisualScene1ForSpeech = visualScene1;
        if (isMotionGraphicVisual(defaults.visualType) && hookCharacterSpeech) {
          hookVoiceover = hookVoiceover || trimWords(stripRoleLabelsForVoiceover(hookCharacterSpeech), 12);
          hookCharacterSpeech = '';
        }

        if (!hookTextOverlay) {
          hookTextOverlay = hookPrimary;
        }
        hookTextOverlay = trimOverlayWords(hookTextOverlay, 8);
        hookPrimary = trimOverlayWords(hookPrimary || hookTextOverlay, 8);
        hookVoiceover = trimWords(hookVoiceover, 12);
        hookAlt1 = trimOverlayWords(hookAlt1, 8);
        hookAlt2 = trimOverlayWords(hookAlt2, 8);
        ctaText = trimOverlayWords(ctaText, 6);
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
        ({ characterSpeech: hookCharacterSpeech, voiceover: hookVoiceover } = moveOnCameraVoiceoverToCharacterSpeech(
          rawVisualScene1ForSpeech,
          hookCharacterSpeech,
          hookVoiceover
        ));
        hookCharacterSpeech = formatCharacterSpeechWithTiming(rawVisualScene1ForSpeech, hookCharacterSpeech);
        if (hookCharacterSpeech) {
          hookVoiceover = '';
        }
        if (!hookVoiceVi && /^vietnamese$/i.test(defaults.language || '')) {
          hookVoiceVi = [hookCharacterSpeech, hookVoiceover, hookTextOverlay || hookPrimary].filter(Boolean).join(' / ');
        }
        hookVoiceVi = normalizeHookVoiceTranslation(hookVoiceVi, hookCharacterSpeech, hookVoiceover);
        if (hookVoiceVi && (!hasVietnameseDiacritics(hookVoiceVi) || !looksVietnamese(hookVoiceVi) || looksLikeUntranslatedAudienceCopy(hookVoiceVi))) {
          hookVoiceVi = '';
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
          void selectedMoment;
          visualScene1 = `${visualScene1} Khung hình phải làm rõ pain point đã chọn qua hành động, đạo cụ hoặc trạng thái UI đầu tiên.`;
        }

        if (selectedSolutionTokens.length >= 2 && countTokenHits(`${visualScene2} ${visualScene3} ${scriptVo} ${ctaText}`, selectedSolutionTokens) < 1) {
          visualScene2 = `${visualScene2} Cắt sang ${defaults.appName}, dùng ${defaults.psp || 'tính năng đã chọn'} như bước xử lý đơn giản cho đúng khoảnh khắc đó.`;
        }

        visualScene1 = stripInlineAudienceCopyFromScene(visualScene1);
        visualScene2 = stripInlineAudienceCopyFromScene(visualScene2);
        visualScene3 = stripInlineAudienceCopyFromScene(visualScene3);

        const hookDurationSeconds = inferHookDurationSecondsFromTimingText(visualScene1)
          || estimateHookDurationSeconds({
            characterSpeech: hookCharacterSpeech,
            voiceover: hookVoiceover,
            textOverlay: hookTextOverlay || hookPrimary,
            visual: visualScene1,
          });

        const errors = createBriefValidationErrors({
          id,
          title: scriptTitle,
          category: defaults.category,
          angleType: normalizedAngleType,
          hookPrimary,
          hookAlt1,
          hookAlt2,
          hookArchetype,
          hookAlt1Archetype,
          hookAlt2Archetype,
          hookCharacterSpeech,
          hookVoiceover,
          hookTextOverlay,
          hookVoiceVi,
          emotionJourney,
          bodyMotivationPattern,
          ctaFrictionReducer,
          estimatedThumbStop,
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
        if (acceptedTitles.some(existing => jaccardSimilarity(existing, scriptTitle) >= 0.72)) {
          errors.push('title/script name duplicates another idea in this batch');
        }
        if (acceptedOpeningScenes.some(existing => jaccardSimilarity(existing, visualScene1) >= 0.74)) {
          errors.push('visual_scene_1 repeats the same opening scene family as another idea');
        }
        const ideaDiversitySignature = buildIdeaDiversitySignature([
          scriptTitle,
          hookPrimary,
          referencePattern,
          visualScene1,
          firstFrameAsset,
          proofObject,
          appDemoAction,
        ]);
        if (ideaDiversitySignature && acceptedIdeaSignatures.some(existing => jaccardSimilarity(existing, ideaDiversitySignature) >= 0.58)) {
          errors.push('idea repeats the same first-frame/action/proof family as another idea');
        }

        if (errors.length > 0) {
          invalidReasons.push(`${id}: ${errors.join('; ')}`);
          return;
        }

        acceptedHookPrimaries.push(hookPrimary);
        acceptedOpeningScenes.push(visualScene1);
        acceptedIdeaSignatures.push(ideaDiversitySignature);
        acceptedTitles.push(scriptTitle);
        const bodyOverlay = stripOverlayTimePrefix(textOverlays.find(line => /\b(?:6|9|12|15)\b/.test(line)) || hookAlt1);
        const ctaOverlay = stripOverlayTimePrefix(textOverlays.find(line => /\b(?:18|22|25)\b/.test(line)) || ctaText);

        items.push(normalizeIdeaOutput({
          id,
          title: scriptTitle,
          duration: defaults.duration,
          creativeType: creativeTypeForTrackWithLock(normalizeBriefTrack(track), defaults.visualType),
          meta: {
            builderVersion: 'creative_idea_engine_v3_1',
            pillar,
            pillarIndex,
            angleName,
            angleType: normalizedAngleType,
            angleDesc,
            angleLens,
            triggerSituation,
            copingBehavior,
            hiddenBelief,
            persuasionMechanism,
            coreArgument,
            angleDifferentiationCheck,
            videoCharacterConcept,
            characterDirection,
            hookPrimary,
            hookAlt1,
            hookAlt2,
            hookArchetype,
            hookAlt1Archetype,
            hookAlt2Archetype,
            hookAlt1Vo,
            hookAlt2Vo,
            emotionJourney,
            bodyMotivationPattern,
            ctaFrictionReducer,
            estimatedThumbStop,
            ideaReasoning,
            referencePattern,
            interruptMechanism,
            firstFrameAsset: stripInlineAudienceCopyFromScene(firstFrameAsset || visualScene1),
            pspBridge,
            proofObject: stripInlineAudienceCopyFromScene(proofObject),
            appDemoAction,
            overlaySequence: textOverlays.length ? textOverlays : overlaySequence,
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
            durationSeconds: hookDurationSeconds,
            visual: visualScene1,
            characterSpeech: hookCharacterSpeech,
            voiceover: hookVoiceover,
            voice: hookVoiceover || hookCharacterSpeech,
            textOverlay: hookTextOverlay || hookPrimary,
            text: hookTextOverlay || hookPrimary,
            viTranslation: hookVoiceVi,
            viewerProfile: defaults.coreUser || '',
            viewerEmotion: defaults.emotion || '',
            painpointImpact: pillar,
            whyTheyStopScrolling: angleDesc,
          },
          body: {
            visual: visualScene2,
            voiceover: scriptVo,
            voice: scriptVo,
            textOverlay: bodyOverlay,
            text: bodyOverlay,
            viTranslation: scriptVo,
          },
          cta: {
            visual: visualScene3,
            voiceover: ctaText,
            voice: ctaText,
            textOverlay: ctaOverlay,
            text: ctaOverlay,
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
  const visualAnchorClause = 'Must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.';
  const pacingClause = 'Hook-only output should remain one readable 0-3s beat; full idea hooks use V3.1 phases.';
  return `## OUTPUT SPECIFICATION

Return a JSON array ONLY. No markdown fences. No explanation.
Return ${quantityLabel} objects in this exact schema:

[{
  "id": "P0-A0-I0",
  "title": "Tên biến thể tiếng Việt",
  "explanation": "Vietnamese explanation of what changed and why it works",
  "meta": {
    "builderVersion": "prompt_system_builder_v1",
    "hookPrimary": "Natural hook text overlay in Vietnamese, 6-16 words",
    "hookAlt1": "Alternative hook A in Vietnamese with a different rhetorical approach",
    "hookAlt2": "Alternative hook B in Vietnamese with a different rhetorical approach",
    "visualRefNotes": "Specific Vietnamese production note",
    "talentProfile": "Vietnamese age, look, clothing, or No talent",
    "dontDo": "1 specific Vietnamese thing not to do"
  },
  "hook": {
    "durationSeconds": 3,
    "visual": "Detailed hook-only visual in Vietnamese. Do not include Voiceover/Text hien/Text hiện/CHARACTER SPEECH in this visual text. ${visualAnchorClause} ${pacingClause}",
    "characterSpeech": "On-camera character/talent speech in ${options.language}; include time + speaker when filled, e.g. 0-3s - Creator: line; empty string if nobody speaks on camera",
    "voiceover": "Off-camera narrator or video voice in ${options.language}; empty when characterSpeech is filled",
    "voice": "Legacy compatibility line in ${options.language}: same as characterSpeech or voiceover, not a merged script",
    "textOverlay": "Readable on-screen text in Vietnamese, around 6-16 words, aligned with meta.hookPrimary",
    "viTranslation": "Vietnamese translation of hook characterSpeech + voiceover only; if both are empty, translate textOverlay",
    "viewerEmotion": "Vietnamese description of what the viewer feels",
    "painpointImpact": "Vietnamese description of why this pain lands",
    "whyTheyStopScrolling": "1 Vietnamese sentence explaining the stop-scroll reason"
  }
}]

## OUTPUT RULES
- Focus on the 0-3s hook beat only.
- Keep the winning hook DNA unless the user explicitly asks to change it.
- Hooks may be descriptive when needed. Avoid clipped keyword fragments; write native, speakable hook lines.
- hook.durationSeconds must estimate the actual hook runtime as an integer second count, normally 3 seconds.
- For UGC/POV/Reaction/Interview, put on-camera talent speech into characterSpeech with time + speaker and leave voiceover empty for that hook.
- visual must stay visual-only; do not include [VOICE] or [TEXT OVERLAY] markers inside visual.
- visual must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- visual must stay one readable hook-only beat; do not use split-screen or multiple cuts unless the user asks for a longer hook.
- title, meta hook text fields, hook.textOverlay, hook.visual, and production notes must be Vietnamese. Only characterSpeech, voiceover, and voice use ${options.language}.
- If characterSpeech is filled, voiceover must be empty. Do not duplicate the same spoken line across both fields.
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
  defaults: {
    duration: string;
    appName: string;
    pillar?: string;
    visualType?: string;
    coreUser?: string;
    emotion?: string;
    psp?: string;
  }
): Record<string, unknown> {
  const item = readRecord(input);
  const framework = readRecord(item.framework);
  const hook = normalizeSection(item.hook, { includeViewerFields: true, includeDurationSeconds: true });
  const body = normalizeSection(item.body);
  const cta = normalizeSection(item.cta, { includeEndCard: true });
  const enforceSectionVisual = (section: Record<string, unknown>) => {
    const visual = stripInlineAudienceCopyFromScene(enforceSelectedVisualFormatInScene(readText(section.visual), defaults.visualType));
    const script = stripInlineAudienceCopyFromScene(enforceSelectedVisualFormatInScene(readText(section.script), defaults.visualType));
    const sourceVisual = visual || script;
    const speech = moveOnCameraVoiceoverToCharacterSpeech(
      sourceVisual,
      readText(section.characterSpeech),
      readText(section.voiceover)
    );
    const characterSpeech = formatCharacterSpeechWithTiming(sourceVisual, speech.characterSpeech);
    const voiceover = characterSpeech ? '' : speech.voiceover;
    return {
      ...section,
      visual,
      script: script || visual,
      characterSpeech,
      voiceover,
      voice: voiceover || characterSpeech,
    };
  };
  const rawTitle = readText(item.title, `Y tuong ${defaults.appName}`);
  const titleContext = [
    rawTitle,
    readText(readRecord(item.hook).visual),
    readText(readRecord(item.hook).textOverlay),
    readText(readRecord(item.meta).hookPrimary),
  ].filter(Boolean).join(' ');

  return {
    id: item.id ?? 1,
    title: coerceVietnameseScriptTitle(rawTitle, titleContext, 0),
    duration: readText(item.duration, defaults.duration),
    creativeType: normalizeFrameworkVisualFormat(defaults.visualType) || readText(item.creativeType, 'UGC'),
    meta: normalizeMeta(item.meta, { pillar: defaults.pillar }),
    selectedFilters: readRecord(item.selectedFilters),
    framework: {
      coreUser: readText(defaults.coreUser, readText(framework.coreUser, 'General viewer')),
      painpoint: readText(defaults.pillar, readText(framework.painpoint, 'General user friction')),
      emotion: readText(defaults.emotion, readText(framework.emotion, 'Create a clear viewer emotion')),
      psp: readText(defaults.psp, readText(framework.psp, defaults.appName)),
    },
    explanation: readText(item.explanation),
    hook: enforceSectionVisual(hook),
    body: enforceSectionVisual(body),
    cta: enforceSectionVisual(cta),
  };
}

export function normalizeHookOutput(input: unknown): Record<string, unknown> {
  const item = readRecord(input);
  const hook = normalizeSection(item.hook, { includeViewerFields: true, includeDurationSeconds: true });
  const rawTitle = readText(item.title, 'Biến thể hook');
  const titleContext = [
    rawTitle,
    readText(readRecord(item.hook).visual),
    readText(readRecord(item.hook).textOverlay),
    readText(readRecord(item.meta).hookPrimary),
  ].filter(Boolean).join(' ');
  return {
    id: item.id ?? 1,
    title: coerceVietnameseScriptTitle(rawTitle, titleContext, 0),
    explanation: readText(item.explanation),
    meta: normalizeMeta(item.meta),
    hook,
  };
}
