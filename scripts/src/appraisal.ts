/**
 * Gemini stamp listing / xFrame catalog JSON from a local image (e.g. CI).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import process from 'node:process';
import {
  GoogleGenAI,
  type GenerateContentConfig,
  type GenerateContentResponse,
  ThinkingLevel,
} from '@google/genai';
import { repoRoot } from './paths.js';

const CONSOLIDATED_SCHEMA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated.schema.json');
const PROMPTS_DIR = join(repoRoot, 'prompts');
const PROMPT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

type Meta = Record<string, unknown>;

const promptPackCache = new Map<string, { preferredModel: string; template: string }>();

function promptIdFromMeta(meta: Meta): string {
  const raw = String(meta.prompt ?? '').trim();
  if (!raw) return 'stamp_listing';
  if (!PROMPT_ID_RE.test(raw)) {
    throw new Error(`Invalid prompt id in commit metadata: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function loadPromptPack(promptBasename: string): { preferredModel: string; template: string } {
  const hit = promptPackCache.get(promptBasename);
  if (hit) return hit;

  if (!PROMPT_ID_RE.test(promptBasename)) {
    throw new Error(`Invalid prompt id: ${JSON.stringify(promptBasename)}`);
  }
  const path = join(PROMPTS_DIR, `${promptBasename}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing prompt template: ${path}`);
  }
  const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const model = String(data.preferred_model ?? 'gemini-3-flash-preview').trim();
  let template: string;
  if ('template_lines' in data) {
    const lines = data.template_lines;
    if (!Array.isArray(lines)) {
      throw new TypeError('template_lines must be a JSON array of strings');
    }
    template = lines.map((line) => String(line)).join('\n');
  } else if ('template' in data && data.template != null) {
    template = String(data.template);
  } else {
    throw new Error(`${path} needs template_lines or template`);
  }
  const pack = { preferredModel: model, template };
  promptPackCache.set(promptBasename, pack);
  return pack;
}

function generateConfigForModel(model: string): GenerateContentConfig | undefined {
  if (!model.toLowerCase().includes('gemini-3')) return undefined;
  return {
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
  };
}

function parsePhilatelisterCommit(message: string | undefined): {
  raw: string;
  firstLine: string;
  meta: Meta;
} {
  const raw = (message ?? '').trim();
  const out = { raw: message ?? '', firstLine: '', meta: {} as Meta };
  if (!raw) return out;
  const sep = raw.indexOf('\n\n');
  if (sep !== -1) {
    out.firstLine = raw.slice(0, sep).trim();
    try {
      out.meta = JSON.parse(raw.slice(sep + 2).trim()) as Meta;
    } catch {
      out.meta = {};
    }
  } else {
    out.firstLine = raw;
  }
  return out;
}

function fileMismatchGap(imageBasename: string, meta: Meta): string {
  const fileMeta = meta.file;
  if (typeof fileMeta === 'string' && fileMeta && fileMeta !== imageBasename) {
    return `\nNote: Commit metadata file field is ${JSON.stringify(fileMeta)} but this run is for ${JSON.stringify(imageBasename)}; still apply target price and notes if they are relevant.\n`;
  }
  return '\n';
}

function consolidatedSchemaJsonForPrompt(): string {
  if (!existsSync(CONSOLIDATED_SCHEMA_PATH)) {
    throw new Error(
      `Missing ${CONSOLIDATED_SCHEMA_PATH}; run the xFrame consolidator with --working-dir pointing at this repo's xframe/ directory first.`
    );
  }
  const raw = readFileSync(CONSOLIDATED_SCHEMA_PATH, 'utf-8');
  try {
    return JSON.stringify(JSON.parse(raw) as object, null, 2);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in ${CONSOLIDATED_SCHEMA_PATH}: ${msg}`);
  }
}

function buildGeminiPrompt(imageBasename: string, parsed: ReturnType<typeof parsePhilatelisterCommit>): string {
  const meta = parsed.meta ?? {};
  const promptId = promptIdFromMeta(meta);
  const { template: tmpl } = loadPromptPack(promptId);
  const firstLine = parsed.firstLine || '';
  const metaJson = JSON.stringify(meta, null, 2);
  const target = meta.targetPrice;
  const notes = meta.notes;
  const gap = fileMismatchGap(imageBasename, meta);
  const firstDisplay = firstLine || '(none)';
  const stampSuggestedId = basename(imageBasename, extname(imageBasename));

  let text = tmpl;
  if (text.includes('__CONSOLIDATED_SCHEMA_JSON__')) {
    text = text.replace('__CONSOLIDATED_SCHEMA_JSON__', consolidatedSchemaJsonForPrompt());
  }
  text = text.replaceAll('__IMAGE_BASENAME__', imageBasename);
  text = text.replaceAll('__FILE_MISMATCH_GAP__', gap);
  text = text.replaceAll('__FIRST_LINE__', firstDisplay);
  text = text.replaceAll('__META_JSON__', metaJson);
  text = text.replaceAll('__TARGET_JSON__', JSON.stringify(target));
  text = text.replaceAll('__NOTES_JSON__', JSON.stringify(notes));
  text = text.replaceAll('__STAMP_SUGGESTED_ID__', stampSuggestedId);
  return text;
}

function guessMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  const ext = extname(lower);
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext] ?? 'image/jpeg';
}

function stripMarkdownJsonFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  const lines = t.split('\n');
  if (lines.length && lines[0].startsWith('```')) lines.shift();
  if (lines.length && lines[lines.length - 1].trim() === '```') lines.pop();
  return lines.join('\n').trim();
}

function responseText(response: GenerateContentResponse): string {
  const t = response.text;
  if (t) return t;
  const parts: string[] = [];
  const candidates = response.candidates;
  if (!candidates) return '';
  for (const c of candidates) {
    const content = c.content;
    if (!content?.parts) continue;
    for (const p of content.parts) {
      if (p.text) parts.push(p.text);
    }
  }
  return parts.join('\n');
}

function parseArgs(): { imagePath: string; commitMessage: string } {
  const argv = process.argv.slice(2);
  let commitMessage = process.env.COMMIT_MESSAGE ?? '';
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--commit-message' && argv[i + 1]) {
      commitMessage = argv[++i];
    } else if (!argv[i].startsWith('-')) {
      positional.push(argv[i]);
    }
  }
  return { imagePath: positional[0] ?? '', commitMessage };
}

async function runAppraisal(imagePath: string, commitMessage: string | undefined): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not set.');
    process.exit(1);
  }

  const path = join(process.cwd(), imagePath);
  if (!existsSync(path)) {
    console.error(`Error: File ${imagePath} not found.`);
    process.exit(1);
  }

  const parsed = parsePhilatelisterCommit(commitMessage);
  let prompt: string;
  try {
    prompt = buildGeminiPrompt(basename(imagePath), parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  const imgBytes = readFileSync(path);
  const mime = guessMime(imagePath);
  const meta = parsed.meta ?? {};
  const promptId = promptIdFromMeta(meta);
  const { preferredModel } = loadPromptPack(promptId);
  const model = (process.env.GEMINI_MODEL ?? '').trim() || preferredModel;
  const config = generateConfigForModel(model);

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mime,
              data: imgBytes.toString('base64'),
            },
          },
          { text: prompt },
        ],
      },
    ],
    config,
  });

  const text = responseText(response);
  if (!text.trim()) {
    console.error('Error: Empty model response.');
    process.exit(1);
  }

  const baseName = basename(imagePath, extname(imagePath));
  const listingsDir = join(process.cwd(), 'listings');
  mkdirSync(listingsDir, { recursive: true });

  if (promptId === 'xframe') {
    const body = stripMarkdownJsonFence(text);
    const outPath = join(listingsDir, `${baseName}.json`);
    try {
      const parsedJson = JSON.parse(body) as unknown;
      writeFileSync(outPath, `${JSON.stringify(parsedJson, null, 2)}\n`, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Warning: model output is not valid JSON (${msg}); writing raw text.`);
      writeFileSync(outPath, body, 'utf-8');
    }
    console.log(`xFrame catalog JSON written: ${outPath}`);
  } else {
    const outPath = join(listingsDir, `${baseName}.txt`);
    writeFileSync(outPath, text, 'utf-8');
    console.log(`Listing created: ${outPath}`);
  }
}

const { imagePath, commitMessage } = parseArgs();
if (!imagePath) {
  console.error('Usage: node appraisal.js <image_path> [--commit-message TEXT]');
  process.exit(1);
}

void runAppraisal(imagePath, commitMessage);
