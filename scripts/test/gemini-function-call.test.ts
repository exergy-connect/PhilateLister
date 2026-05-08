/**
 * Emulates: attach tool declarations → model returns a functionCall → local executor returns structured args (tool response).
 * No network; uses xframe/output/consolidated_data.json (entity store) + consolidated.schema.json.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { XFrameGeminiFunctionRuntime, type EntityStore, type GeminiFunctionCall } from '../src/xframe-gemini-functions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(__dirname, '..');
const repoRoot = join(scriptsDir, '..');

const CONSOLIDATED_SCHEMA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated.schema.json');
const CONSOLIDATED_DATA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated_data.json');

function loadEntityStoreFromConsolidated(): EntityStore {
  const raw = JSON.parse(readFileSync(CONSOLIDATED_DATA_PATH, 'utf-8')) as { data?: EntityStore };
  if (!raw.data || typeof raw.data !== 'object') {
    throw new Error(`Missing data in ${CONSOLIDATED_DATA_PATH}`);
  }
  return raw.data;
}

function simulatedLlmToolResponse(call: GeminiFunctionCall): {
  candidates: Array<{ content: { parts: Array<{ functionCall?: GeminiFunctionCall }> } }>;
} {
  return {
    candidates: [
      {
        content: {
          parts: [{ functionCall: call }],
        },
      },
    ],
  };
}

test('gemini function workflow: declarations → LLM functionCall → local tool result', () => {
  if (!existsSync(CONSOLIDATED_SCHEMA_PATH)) {
    throw new Error(
      `Missing ${CONSOLIDATED_SCHEMA_PATH}; run the xFrame consolidator for xframe/ first.`
    );
  }
  if (!existsSync(CONSOLIDATED_DATA_PATH)) {
    throw new Error(
      `Missing ${CONSOLIDATED_DATA_PATH}; run the xFrame consolidator for xframe/ first.`
    );
  }

  const store = loadEntityStoreFromConsolidated();

  const runtime = new XFrameGeminiFunctionRuntime({
    consolidatedSchemaPath: CONSOLIDATED_SCHEMA_PATH,
    getEntityStore: () => store,
    providerId: 'google_gemini',
    functionCallEntity: 'gemini_function_call',
    functionParameterEntity: 'gemini_function_parameter',
  });

  const declarations = runtime.functionDeclarations();
  assert.ok(declarations.length >= 1, 'expected at least one tool declaration');
  const lookupDecl = declarations.find((d) => (d as { name?: string }).name === 'lookup_numeral_cancel');
  assert.ok(lookupDecl, 'expected lookup_numeral_cancel in declarations');

  const modelSays: GeminiFunctionCall = {
    name: 'lookup_numeral_cancel',
    args: {
      country: 'dk',
      number: 152,
    },
  };

  const rawResponse = simulatedLlmToolResponse(modelSays);
  const calls = runtime.functionCalls(rawResponse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, 'lookup_numeral_cancel');

  const toolResult = runtime.executeFunctionCall(calls[0]!);
  const rows = toolResult.numeral_cancel;
  assert.ok(Array.isArray(rows), 'expected numeral_cancel to be an array of consolidated rows');
  assert.equal(rows.length, 2);

  const towns = (rows as Record<string, unknown>[]).map((r) => r.town_name).sort();
  assert.deepEqual(towns, ['Flensborg', 'Skibby']);

  const periodStarts = (rows as Record<string, unknown>[])
    .map((r) => (r.numeral_cancel_key as Record<string, unknown>)?.period_start)
    .sort();
  assert.deepEqual(periodStarts, ['1851-04-01', '1864-10-01']);
});

test('functionCallModelPartsForReplay preserves thoughtSignature on function call parts', () => {
  const store = loadEntityStoreFromConsolidated();
  const runtime = new XFrameGeminiFunctionRuntime({
    consolidatedSchemaPath: CONSOLIDATED_SCHEMA_PATH,
    getEntityStore: () => store,
    providerId: 'google_gemini',
    functionCallEntity: 'gemini_function_call',
    functionParameterEntity: 'gemini_function_parameter',
  });

  const response = {
    candidates: [
      {
        content: {
          parts: [
            { functionCall: { name: 'lookup_stamp_catalog', args: { q: 'a' } }, thoughtSignature: 'sig1' },
            { functionCall: { name: 'lookup_numeral_cancel', args: { country: 'dk', number: 1 } }, thoughtSignature: 'sig2' },
          ],
        },
      },
    ],
  };

  const replay = runtime.functionCallModelPartsForReplay(response);
  assert.ok(replay);
  assert.equal(replay.length, 2);
  const p0 = replay[0] as { thoughtSignature?: string; functionCall?: { name?: string } };
  const p1 = replay[1] as { thoughtSignature?: string; functionCall?: { name?: string } };
  assert.equal(p0.thoughtSignature, 'sig1');
  assert.equal(p0.functionCall?.name, 'lookup_stamp_catalog');
  assert.equal(p1.thoughtSignature, 'sig2');
  assert.equal(p1.functionCall?.name, 'lookup_numeral_cancel');
});

test('gemini function workflow resolves referenced parameter rows without function_name in the key', () => {
  const store = structuredClone(loadEntityStoreFromConsolidated());
  const calls = store.gemini_function_call;
  assert.ok(calls, 'expected gemini_function_call bucket');
  const lookup = calls.lookup_numeral_cancel;
  assert.ok(lookup, 'expected lookup_numeral_cancel row');
  const parameters = lookup.parameters;
  assert.ok(Array.isArray(parameters), 'expected nested parameters');

  store.gemini_function_parameter = {};
  for (const p of parameters) {
    assert.ok(p && typeof p === 'object' && !Array.isArray(p), 'expected object parameter');
    const name = ((p as Record<string, unknown>).parameter_key as Record<string, unknown> | undefined)?.name;
    assert.ok(typeof name === 'string');
    store.gemini_function_parameter[name] = p as Record<string, unknown>;
  }
  lookup.parameters = ['country', 'number', 'scott_number'];

  const runtime = new XFrameGeminiFunctionRuntime({
    consolidatedSchemaPath: CONSOLIDATED_SCHEMA_PATH,
    getEntityStore: () => store,
    providerId: 'google_gemini',
    functionCallEntity: 'gemini_function_call',
    functionParameterEntity: 'gemini_function_parameter',
  });

  const toolResult = runtime.executeFunctionCall({
    name: 'lookup_numeral_cancel',
    args: {
      country: 'dk',
      number: 152,
    },
  });

  const rows = toolResult.numeral_cancel;
  assert.ok(Array.isArray(rows), 'expected numeral_cancel to be an array of consolidated rows');
  assert.equal(rows.length, 2);
});
