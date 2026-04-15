# Manager Status

## 2026-04-15 - Result card structure and language repair

- Status: local-tested
- Scope:
  - `src/components/FilterGenerator.tsx`: result cards show Hook first; Body and CTA appear only after More details.
  - `src/components/FilterGenerator.tsx`: repaired broken Vietnamese UI text/encoding in the idea creation flow.
  - `src/components/HookLibrary.tsx`: updated modified-hook result cards to the compact approval/favorite layout.
  - `src/app/api/generate-ideas/route.ts`: repaired broken Vietnamese prompt text/encoding.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - Nano3 direct image generation is not wired.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Seasonal visual context for Hook

- Status: local-tested
- Scope:
  - `src/components/FilterGenerator.tsx`: added month-level season/event mapping. Selecting a season opens month choices; selecting a month auto maps events, costumes, behaviors, colors, props, and mood.
  - `src/components/FilterGenerator.tsx`: removed the old behavior that appended season/event text into the optional idea description.
  - `src/components/FilterGenerator.tsx`: sends `seasonalVisualContext` as a dedicated API payload field.
  - `src/app/api/generate-ideas/route.ts`: added prompt rules forcing season/month/event context into Hook visual/script instead of idea description.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - Seasonal details are visual direction only. They should not replace the selected painpoint.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Simplified month event selector

- Status: local-tested
- Scope:
  - `src/components/FilterGenerator.tsx`: simplified the seasonal UI to a 12-month selector.
  - `src/components/FilterGenerator.tsx`: selecting a month now automatically derives the season and shows only the events that will apply.
  - `src/components/FilterGenerator.tsx`: removed the visible costume, behavior, color, props, and mood sections from the UI.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - Changes are not committed or pushed yet.

## 2026-04-15 - Full-brief parallel generation speedup

- Status: local-tested
- Scope:
  - `src/components/FilterGenerator.tsx`: changed generate flow from one large multi-idea request to concurrent full-brief requests, one idea per request, capped at 3 concurrent calls.
  - `src/app/api/generate-ideas/route.ts`: added variation metadata so parallel single-idea requests produce different concepts while keeping the same mandatory context.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
  - GPT-5.4 test with 3 full briefs in parallel: 41.633s total.
  - Previous GPT-5.4 single request for 3 full briefs: 98.598s total.
- Notes:
  - Full mandatory output is preserved: framework, explanation, Hook, Body, CTA, viewer analysis, market, seasonal context, and selected filters.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Limit model selector to latest two

- Status: local-tested
- Scope:
  - `src/components/NavBar.tsx`: removed old model options from the selector. Only `Gemini 3 Pro` and `GPT-5.4` remain visible.
  - `src/app/page.tsx`: default model is now `Gemini 3 Pro`; saved old localStorage model values fall back to `Gemini 3 Pro`.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - Backend mapping still supports older aliases if called directly, but the UI only exposes the two latest comparison models.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Optional event selection

- Status: local-tested
- Scope:
  - `src/components/FilterGenerator.tsx`: event chips are now clickable buttons.
  - `src/components/FilterGenerator.tsx`: added a `Không chọn sự kiện` option.
  - `src/components/FilterGenerator.tsx`: `seasonalVisualContext.events` now includes only events selected by the user; empty selection sends no specific event.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - Month selection still derives the season automatically.
  - Changes are not committed or pushed yet.

## 2026-04-15 - OpenAI latest model API comparison

- Status: local-tested
- Scope:
  - `src/components/NavBar.tsx`: added `GPT-5.4 Pro` and `GPT-5.4 Mini` to the model selector.
  - `src/app/api/generate-ideas/route.ts`: mapped `gpt-5.4-pro` to `openai/gpt-5.4-pro-2026-03-05`.
  - `src/app/api/generate-ideas/route.ts`: mapped `gpt-5.4-mini` to `openai/gpt-5.4-mini`.
  - API comparison used the same Home Design / Bathroom / January / no-event configuration.
- Validation:
  - `GET /v1/models` through the configured gateway: found GPT-5.4 Pro and GPT-5.4 Mini.
  - `GPT-4.1`: generated 3 ideas successfully.
  - `GPT-5.4 Pro`: small request worked, full generate prompt returned gateway 524 timeout.
  - `GPT-5.4 Mini`: generated 3 ideas successfully with the same configuration.
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
- Notes:
  - GPT-5.4 Pro likely needs either shorter prompt, lower output size, or a longer gateway timeout for this workflow.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Gemini 3 Pro vs GPT-5.4 idea comparison

- Status: local-tested
- Scope:
  - `src/components/NavBar.tsx`: added `Gemini 3 Pro` and standard `GPT-5.4` to the model selector.
  - `src/app/api/generate-ideas/route.ts`: mapped `gemini-3-pro` to `gemini/gemini-3-pro-preview`.
  - `src/app/api/generate-ideas/route.ts`: mapped `gpt-5.4` to `openai/gpt-5.4`.
  - `.manager/model-compare-gemini3-vs-gpt54.json`: saved raw API comparison output.
- Validation:
  - `Gemini 3 Pro`: generated 3 ideas successfully with the Home Design / Bathroom / January / no-event configuration.
  - `GPT-5.4`: generated 3 ideas successfully with the same configuration.
  - `npm run build`: passed on 2026-04-15.
- Notes:
  - GPT-5.4 followed the selected painpoint more naturally for this configuration.
  - Gemini 3 Pro produced more dramatic concepts but introduced the app and extra finance angle earlier than requested.
  - Changes are not committed or pushed yet.

## 2026-04-15 - Comparison report format

- Status: completed
- Scope:
  - `.manager/model-compare-gemini3-vs-gpt54.md`: added a readable comparison report with speed, scores, idea-by-idea comparison, and final verdict.
- Notes:
  - Changes are not committed or pushed yet.

## 2026-04-15 - GPT-5.4 angle generation and split visual/voice output

- Status: local-tested
- Scope:
  - `src/app/api/generate-ideas/route.ts`: `generate-angles` now uses `openai/gpt-5.4`.
  - `src/app/api/generate-ideas/route.ts`: angle prompt now forces outputs to stay on the selected painpoint, stay short, and avoid `Fear:` / `FOMO:` / CTA-style prefixes.
  - `src/app/api/generate-ideas/route.ts`: idea-generation prompt now requires separate `visual`, `voice`, `textOverlay` fields and explicitly discourages TVC/cinematic writing.
  - `src/app/api/generate-ideas/route.ts`: refine prompt and seasonal visual guidance were updated to match the split-field output format.
  - `src/components/FilterGenerator.tsx`: result mapping, copy/export, edit UI, and refine merge now support split `visual / voice / textOverlay` blocks for hook/body/cta.
  - `src/types/database.ts`: widened `IdeaContent` and `GeneratedIdea` types to match the live payload shape already used by the app.
- Validation:
  - `npm run build`: passed on 2026-04-15.
  - Local dev server `http://127.0.0.1:3000/`: HTTP 200.
  - Local `POST /api/generate-ideas` with `mode=generate-angles`: returned painpoint-based angles without `Fear:` / `FOMO:` prefixes.
  - Local `POST /api/generate-ideas` with `selectedModel=gpt-5.4` and `quantity=1`: returned separated `hook.visual`, `hook.voice`, `hook.textOverlay` and completed in about `34s`.
- Notes:
  - Output tone is now less TVC because the prompt forbids polished ad copy and asks for social-first UGC phrasing.
  - Changes are not committed or pushed yet.
