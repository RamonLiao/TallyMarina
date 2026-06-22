/**
 * One-shot brand-asset generator (spec §8.7). Run manually:
 *   GEMINI_API_KEY=<key> npx tsx scripts/gen-assets.ts
 *
 * REQUIRES A PAID GEMINI KEY — image-generation free-tier quota is 0.
 * HTTP 429 "limit: 0" means the key is free-tier; upgrade or use a paid project key.
 * NEVER commit GEMINI_API_KEY. NEVER use VITE_ prefix. Read from shell env only.
 *
 * MODEL: gemini-2.5-flash-image (configurable via GEMINI_IMAGE_MODEL env var).
 *
 * Output:
 *   web/src/assets/generated/app-background.png  — subtle nautical-chart texture
 *   web/src/assets/generated/hero.png             — otter captain hero scene
 *   web/src/assets/generated/celebration.png      — otter celebrating anchor close
 *   docs/brand/banner-16x9.png                    — social banner 16:9
 *   (mascot-wave.png / mascot-calm.png already copied from docs/logo_*.png)
 *
 * VERIFY-AT-EXECUTION: inspect node_modules/@google/genai types for the exact
 * generateContent signature. If ai.models.generateContent is unavailable, try
 * ai.interactions.create({ model, contents, config: { responseModalities: ['IMAGE'] } }).
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');   // repo root (web/scripts -> web -> track -> root)
const DOCS = resolve(ROOT, 'docs');
const GEN = resolve(__dirname, '../src/assets/generated');
const BRAND = resolve(DOCS, 'brand');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY not set — aborting (no keys in repo).');
  process.exit(1);
}

mkdirSync(GEN, { recursive: true });
mkdirSync(BRAND, { recursive: true });

// Mascot fallbacks the Mascot component imports (Task 6): copy the source logos.
copyFileSync(resolve(DOCS, 'logo_2.png'), resolve(GEN, 'mascot-wave.png'));
copyFileSync(resolve(DOCS, 'logo_3.png'), resolve(GEN, 'mascot-calm.png'));
console.log('copied mascot-wave.png + mascot-calm.png');

// Dynamic import to avoid crashing if @google/genai is not installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { GoogleGenAI } = await import('@google/genai' as any);
const ai = new GoogleGenAI({ apiKey: KEY });
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

const refs = ['logo_1.png', 'logo_2.png', 'logo_3.png'].map((f) => ({
  inlineData: { mimeType: 'image/png', data: readFileSync(resolve(DOCS, f)).toString('base64') },
}));

const STYLE =
  'Match this cute glasses-wearing sailor-capped otter accountant brand: warm cream (#F4ECD8) ' +
  'parchment, deep navy (#16203B), brass (#C9A24B), Sui aqua (#2E9FBC) accents, ' +
  'nautical-chart / ledger motif, lighthearted anime style that still reads as trustworthy enterprise finance.';

const TASKS: { prompt: string; out: string; dir: string }[] = [
  {
    prompt: `${STYLE} A SUBTLE low-contrast nautical-chart parchment TEXTURE background, ` +
      `<=8% visual busyness, must sit UNDER data tables without reducing legibility, tinted toward cream. ` +
      `16:9, 2K. No text, no characters.`,
    out: 'app-background.png',
    dir: GEN,
  },
  {
    prompt: `${STYLE} A rich otter-captain hero scene for a landing splash. 5:4, 2K.`,
    out: 'hero.png',
    dir: GEN,
  },
  {
    prompt: `${STYLE} A celebratory otter raising an anchor, confetti, "period closed" energy. 5:4, 2K.`,
    out: 'celebration.png',
    dir: GEN,
  },
  {
    prompt: `${STYLE} A 16:9 social banner with the otter and the lockup text "TallyMarina — AI-Assisted On-Chain Subledger". 16:9, 2K.`,
    out: 'banner-16x9.png',
    dir: BRAND,
  },
];

for (const t of TASKS) {
  try {
    // Primary: ai.models.generateContent with responseModalities IMAGE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: t.prompt }, ...refs] }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { responseModalities: ['IMAGE'] as any },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      console.error(`No image returned for ${t.out} — skipping`);
      continue;
    }
    writeFileSync(resolve(t.dir, t.out), Buffer.from(part.inlineData.data, 'base64'));
    console.log(`wrote ${t.out}`);
  } catch (err) {
    console.error(`Failed ${t.out}:`, err);
  }
}

console.log('Done. Hand-curate (regenerate for best of N), then commit the PNGs.');
console.log('For the 1500×500 Twitter banner, crop docs/brand/banner-16x9.png with any image tool.');
