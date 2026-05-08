import { existsSync, readFileSync } from 'node:fs';

export type EntityStore = Record<string, Record<string, Record<string, unknown>>>;

export type GeminiFunctionCall = {
  name?: string;
  args?: Record<string, unknown>;
};

type GeminiFunctionParameterRow = {
  name: string;
  description: string;
  schemaEntity: string;
  schemaPath: string | null;
  /** Maps PK component name on schema_entity → sibling parameter name. */
  compositeKey: Record<string, string> | null;
  required: boolean;
  enumEnabled: boolean;
};

type GeminiFunctionCallRow = {
  functionName: string;
  description: string;
  providerId: string;
  enabled: boolean;
  sortOrder: number;
  parameters: GeminiFunctionParameterRow[];
  /** response_key → anchor parameter name (composite_key on anchor builds the object). */
  output: Record<string, string> | null;
};

type GeminiFunctionRuntimeOptions = {
  consolidatedSchemaPath: string;
  getEntityStore: () => EntityStore;
  providerId: string;
};

type GeminiResponseLike = {
  functionCalls?: GeminiFunctionCall[];
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: GeminiFunctionCall;
      }>;
    };
  }>;
};

export class XFrameGeminiFunctionRuntime {
  private cachedConsolidatedSchemaRoot: Record<string, unknown> | null = null;
  private cachedGeminiFunctionCalls: GeminiFunctionCallRow[] | null = null;
  private cachedGeminiFunctionDeclarations: Record<string, unknown>[] | null = null;

  constructor(private readonly options: GeminiFunctionRuntimeOptions) {}

  schemaDef(name: string): Record<string, unknown> {
    const parsed = this.loadConsolidatedSchemaRoot();
    const defs = parsed.$defs as Record<string, unknown> | undefined;
    const def = defs?.[name];
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      throw new Error(`${this.options.consolidatedSchemaPath} missing object $defs.${name}`);
    }
    return def as Record<string, unknown>;
  }

  functionDeclarations(): Record<string, unknown>[] {
    if (this.cachedGeminiFunctionDeclarations) return this.cachedGeminiFunctionDeclarations;
    this.cachedGeminiFunctionDeclarations = this.functionDeclarationsForProvider(this.options.providerId);
    return this.cachedGeminiFunctionDeclarations;
  }

  functionCalls(response: GeminiResponseLike): GeminiFunctionCall[] {
    const direct = response.functionCalls;
    if (Array.isArray(direct) && direct.length) return direct;
    const calls: GeminiFunctionCall[] = [];
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const call = part.functionCall;
        if (call?.name) calls.push(call);
      }
    }
    return calls;
  }

  executeFunctionCall(call: GeminiFunctionCall): Record<string, unknown> {
    const name = String(call.name ?? '').trim();
    const row = this.loadGeminiFunctionCalls().find((candidate) => candidate.enabled && candidate.functionName === name);
    if (!row) return { ok: false, error: `Unknown function ${name}` };

    if (row.output && Object.keys(row.output).length > 0) return this.executeDeclarativeFunction(row, call.args ?? {});
    return { ok: false, error: `No declarative implementation for function ${name}` };
  }

  private loadConsolidatedSchemaRoot(): Record<string, unknown> {
    if (this.cachedConsolidatedSchemaRoot) return this.cachedConsolidatedSchemaRoot;
    if (!existsSync(this.options.consolidatedSchemaPath)) {
      throw new Error(
        `Missing ${this.options.consolidatedSchemaPath}; run the xFrame consolidator with --working-dir pointing at this repo's xframe/ directory first.`
      );
    }
    try {
      this.cachedConsolidatedSchemaRoot = JSON.parse(
        readFileSync(this.options.consolidatedSchemaPath, 'utf-8')
      ) as Record<string, unknown>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON in ${this.options.consolidatedSchemaPath}: ${msg}`);
    }
    return this.cachedConsolidatedSchemaRoot;
  }

  private schemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const props = schema.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
    return props as Record<string, Record<string, unknown>>;
  }

  private schemaAtPath(entity: string, path: string): Record<string, unknown> {
    let schema = this.schemaDef(entity);
    for (const segment of path.split('.').map((s) => s.trim()).filter(Boolean)) {
      const next = this.schemaProperties(schema)[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        throw new Error(`${this.options.consolidatedSchemaPath} missing schema path $defs.${entity}.${path}`);
      }
      schema = next;
    }
    return schema;
  }

  /** Declared on each `$defs` entity when the model sets `include_x_fields` (consolidated schema). */
  private entityPrimaryKeyField(entity: string): string {
    const raw = this.schemaDef(entity)['x-primaryKey'];
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) {
      throw new Error(
        `${this.options.consolidatedSchemaPath}: $defs.${entity} missing x-primaryKey (enable include_x_fields and re-consolidate)`
      );
    }
    const props = this.schemaProperties(this.schemaDef(entity));
    if (!props[name] || typeof props[name] !== 'object' || Array.isArray(props[name])) {
      throw new Error(`${this.options.consolidatedSchemaPath}: $defs.${entity} x-primaryKey ${JSON.stringify(name)} has no property schema`);
    }
    return name;
  }

  private isCompositePrimaryKey(entity: string): boolean {
    const pk = this.entityPrimaryKeyField(entity);
    const prop = this.schemaProperties(this.schemaDef(entity))[pk] as Record<string, unknown>;
    return prop.type === 'object';
  }

  private primaryKeySchemaForEntity(entity: string): Record<string, unknown> {
    try {
      const pk = this.entityPrimaryKeyField(entity);
      const keySchema = this.schemaProperties(this.schemaDef(entity))[pk];
      if (keySchema && typeof keySchema === 'object' && !Array.isArray(keySchema)) return keySchema;
    } catch {
      /* fall through */
    }
    return {
      type: 'string',
      description: `Primary key for ${entity}.`,
    };
  }

  private inferSchemaPathFromCompositeKey(param: GeminiFunctionParameterRow): string | null {
    if (!param.compositeKey) return null;
    let pkField: string;
    try {
      pkField = this.entityPrimaryKeyField(param.schemaEntity);
    } catch {
      return null;
    }
    const props = this.schemaProperties(this.schemaDef(param.schemaEntity));
    const pkProp = props[pkField];
    const composite =
      pkProp &&
      typeof pkProp === 'object' &&
      !Array.isArray(pkProp) &&
      (pkProp as Record<string, unknown>).type === 'object';
    for (const [component, siblingName] of Object.entries(param.compositeKey)) {
      if (siblingName !== param.name) continue;
      if (composite) return `${pkField}.${component}`;
      if (props[component]) return component;
      return pkField;
    }
    return null;
  }

  private effectiveSchemaPathForParameter(param: GeminiFunctionParameterRow): string | null {
    if (param.schemaPath) return param.schemaPath;
    return this.inferSchemaPathFromCompositeKey(param);
  }

  private schemaForFunctionParameter(param: GeminiFunctionParameterRow): Record<string, unknown> {
    const path = this.effectiveSchemaPathForParameter(param);
    if (path) return this.schemaAtPath(param.schemaEntity, path);
    return this.primaryKeySchemaForEntity(param.schemaEntity);
  }

  private geminiFunctionParamSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const type = schema.type;
    if (typeof type === 'string') out.type = type.toUpperCase();
    for (const key of ['description', 'format', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems'] as const) {
      if (schema[key] !== undefined) out[key] = schema[key];
    }
    if (schema.min !== undefined) out.minimum = schema.min;
    if (schema.max !== undefined) out.maximum = schema.max;
    return out;
  }

  private valueAtPath(value: unknown, path: string): unknown {
    let current = value;
    for (const segment of path.split('.').map((s) => s.trim()).filter(Boolean)) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private isGeminiEnumScalar(value: unknown): value is string | number | boolean {
    return ['string', 'number', 'boolean'].includes(typeof value);
  }

  private compareEnumValues(a: string | number | boolean, b: string | number | boolean): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  private enumValuesForFunctionParameter(param: GeminiFunctionParameterRow): Array<string | number | boolean> {
    const bucket = this.options.getEntityStore()[param.schemaEntity];
    if (!bucket || typeof bucket !== 'object') return [];

    const values: Array<string | number | boolean> = [];
    const effectivePath = param.schemaPath ?? this.inferSchemaPathFromCompositeKey(param);
    if (effectivePath) {
      for (const row of Object.values(bucket)) {
        const value = this.valueAtPath(row, effectivePath);
        if (this.isGeminiEnumScalar(value)) values.push(value);
      }
    } else {
      let keyField: string | null = null;
      try {
        keyField = this.entityPrimaryKeyField(param.schemaEntity);
      } catch {
        keyField = null;
      }
      for (const [key, row] of Object.entries(bucket)) {
        const value = keyField ? this.valueAtPath(row, keyField) : key;
        if (this.isGeminiEnumScalar(value)) {
          values.push(value);
        } else {
          values.push(key);
        }
      }
    }

    const unique = new Map<string, string | number | boolean>();
    for (const value of values) {
      unique.set(`${typeof value}:${String(value)}`, value);
    }
    return [...unique.values()].sort((a, b) => this.compareEnumValues(a, b));
  }

  private parseCompositeKey(raw: unknown): Record<string, string> | null {
    if (raw == null) return null;
    const out: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const rec = row as Record<string, unknown>;
        const component = String(rec.component ?? '').trim();
        const parameterName = String(rec.parameter_name ?? '').trim();
        if (component && parameterName) out[component] = parameterName;
      }
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const parameterName = String(v ?? '').trim();
        if (parameterName) out[k.trim()] = parameterName;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  private parseFunctionOutput(r: Record<string, unknown>): Record<string, string> | null {
    const rows = r.output;
    if (!Array.isArray(rows) || !rows.length) return null;
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rec = row as Record<string, unknown>;
      const key = String(rec.response_key ?? '').trim();
      const anchor = String(rec.anchor_parameter ?? '').trim();
      if (key && anchor) out[key] = anchor;
    }
    return Object.keys(out).length ? out : null;
  }

  /**
   * Nesting locations from the model: `x-parents` on field schemas (and on composite-PK subfields).
   */
  private collectParentNestEdges(entity: string): { parentEntity: string; arrayField: string }[] {
    const def = this.schemaDef(entity);
    const props = this.schemaProperties(def);
    const seen = new Set<string>();
    const out: { parentEntity: string; arrayField: string }[] = [];

    const ingest = (fieldSchema: Record<string, unknown>) => {
      const parents = fieldSchema['x-parents'];
      if (!Array.isArray(parents)) return;
      for (const p of parents) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
        const pe = String((p as Record<string, unknown>).entity ?? '').trim();
        const pa = String((p as Record<string, unknown>).parent_array ?? '').trim();
        if (!pe || !pa) continue;
        const key = `${pe}\0${pa}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ parentEntity: pe, arrayField: pa });
      }
    };

    for (const fs of Object.values(props)) {
      if (fs && typeof fs === 'object' && !Array.isArray(fs)) ingest(fs as Record<string, unknown>);
    }

    const xpk = def['x-primaryKey'];
    if (typeof xpk === 'string') {
      const pkProp = props[xpk];
      if (
        pkProp &&
        typeof pkProp === 'object' &&
        !Array.isArray(pkProp) &&
        (pkProp as Record<string, unknown>).type === 'object'
      ) {
        for (const sub of Object.values(this.schemaProperties(pkProp as Record<string, unknown>))) {
          if (sub && typeof sub === 'object' && !Array.isArray(sub)) ingest(sub as Record<string, unknown>);
        }
      }
    }
    return out;
  }

  /** Component order for a composite PK object: `required` array from the schema, else property key order. */
  private compositePkComponentOrder(entity: string, pkField: string): string[] {
    const pkSchema = this.schemaProperties(this.schemaDef(entity))[pkField];
    if (!pkSchema || typeof pkSchema !== 'object' || Array.isArray(pkSchema)) return [];
    const req = (pkSchema as Record<string, unknown>).required;
    if (Array.isArray(req) && req.length) return req.map((x) => String(x));
    return Object.keys(this.schemaProperties(pkSchema as Record<string, unknown>));
  }

  /** Stable dedupe / sort key from `x-primaryKey` and composite `required` order. */
  private syntheticRowKeyForEntity(entity: string, row: Record<string, unknown>): string {
    let pkField: string;
    try {
      pkField = this.entityPrimaryKeyField(entity);
    } catch {
      return '';
    }
    if (this.isCompositePrimaryKey(entity)) {
      const order = this.compositePkComponentOrder(entity, pkField);
      if (!order.length) return '';
      const parts = order.map((c) => String(this.rowValueForCompositeComponent(row, pkField, c) ?? ''));
      if (parts.every((p) => p === '')) return '';
      return parts.join('\0');
    }
    const v = row[pkField];
    return v !== undefined && v !== null ? String(v) : '';
  }

  /**
   * When consolidated `data` has no top-level bucket for *entity*, collect instances nested under
   * parent rows (schema-driven parent_array locations).
   */
  private syntheticChildBucketFromNestedParents(
    childEntity: string,
    store: EntityStore
  ): Record<string, Record<string, unknown>> | null {
    const edges = this.collectParentNestEdges(childEntity);
    if (!edges.length) return null;
    const out: Record<string, Record<string, unknown>> = {};
    for (const { parentEntity, arrayField } of edges) {
      const parentBucket = store[parentEntity];
      if (!parentBucket || typeof parentBucket !== 'object' || Array.isArray(parentBucket)) continue;
      for (const parentRow of Object.values(parentBucket)) {
        if (!parentRow || typeof parentRow !== 'object' || Array.isArray(parentRow)) continue;
        const nested = (parentRow as Record<string, unknown>)[arrayField];
        if (!Array.isArray(nested)) continue;
        for (const row of nested) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          const r = row as Record<string, unknown>;
          const pk = this.syntheticRowKeyForEntity(childEntity, r);
          if (pk) out[pk] = r;
        }
      }
    }
    return Object.keys(out).length ? out : null;
  }

  /**
   * Top-level entity bucket used for tool execution lookups. When consolidated output nests rows
   * under parents only, synthesize a flat bucket using `x-parents` from the schema.
   */
  private lookupBucketForEntity(entity: string): Record<string, Record<string, unknown>> | null {
    const store = this.options.getEntityStore();
    const direct = store[entity];
    if (direct && typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length > 0) {
      return direct as Record<string, Record<string, unknown>>;
    }
    return this.syntheticChildBucketFromNestedParents(entity, store);
  }

  private rowValueForCompositeComponent(
    row: Record<string, unknown>,
    pkField: string,
    component: string
  ): unknown {
    const nested = this.valueAtPath(row, `${pkField}.${component}`);
    if (nested !== undefined) return nested;
    return row[component];
  }

  private valuesLooselyEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (typeof a === 'number' || typeof b === 'number') {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    }
    return String(a).trim() === String(b).trim();
  }

  private rowValueForExpectedComponent(row: Record<string, unknown>, entity: string, component: string): unknown {
    const pkField = this.entityPrimaryKeyField(entity);
    if (this.isCompositePrimaryKey(entity)) {
      return this.rowValueForCompositeComponent(row, pkField, component);
    }
    if (Object.prototype.hasOwnProperty.call(row, component)) return row[component];
    return row[pkField];
  }

  private rowMatchesPartialComposite(
    row: Record<string, unknown>,
    entity: string,
    expected: Record<string, unknown>
  ): boolean {
    for (const [component, ev] of Object.entries(expected)) {
      if (ev === null || ev === undefined) return false;
      const av = this.rowValueForExpectedComponent(row, entity, component);
      if (!this.valuesLooselyEqual(av, ev)) return false;
    }
    return true;
  }

  private compareRowsForStableOutput(a: Record<string, unknown>, b: Record<string, unknown>, entity: string): number {
    const c = this.syntheticRowKeyForEntity(entity, a).localeCompare(this.syntheticRowKeyForEntity(entity, b));
    if (c !== 0) return c;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  }

  /**
   * Match rows in the entity store (or synthesized nested data) against the composite key implied
   * by the anchor parameter. Returns null when no lookup source exists; otherwise an array (possibly empty).
   */
  private lookupRowsForOutputAnchor(
    parameters: GeminiFunctionParameterRow[],
    anchorName: string,
    args: Record<string, unknown>
  ): Record<string, unknown>[] | null {
    const anchor = parameters.find((p) => p.name === anchorName);
    if (!anchor?.compositeKey) return null;
    const entity = anchor.schemaEntity;
    const bucket = this.lookupBucketForEntity(entity);
    if (!bucket) return null;

    const expectedPartial = this.buildCompositeOutputFromAnchor(parameters, anchorName, args);
    const matches: Record<string, unknown>[] = [];
    for (const row of Object.values(bucket)) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      if (this.rowMatchesPartialComposite(row as Record<string, unknown>, entity, expectedPartial)) {
        matches.push(row as Record<string, unknown>);
      }
    }
    matches.sort((x, y) => this.compareRowsForStableOutput(x, y, entity));
    return matches;
  }

  private buildCompositeOutputFromAnchor(
    parameters: GeminiFunctionParameterRow[],
    anchorName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const anchor = parameters.find((p) => p.name === anchorName);
    if (!anchor?.compositeKey) {
      throw new Error(`Gemini function output anchor ${JSON.stringify(anchorName)} requires composite_key on that parameter`);
    }
    const built: Record<string, unknown> = {};
    for (const [component, paramName] of Object.entries(anchor.compositeKey)) {
      const sourceParam = parameters.find((p) => p.name === paramName);
      const path = sourceParam ? this.effectiveSchemaPathForParameter(sourceParam) : null;
      const schema =
        path && sourceParam ? this.schemaAtPath(sourceParam.schemaEntity, path) : null;
      let v = args[paramName];
      const st = schema?.type;
      if (st === 'integer' || st === 'number') {
        const n = typeof v === 'number' ? v : Number(v);
        v = Number.isFinite(n) ? n : null;
      }
      built[component] = v;
    }
    return built;
  }

  /** Tool parameter name: `parameter_key.name` (composite PK) or legacy top-level `name`. */
  private parameterNameFromRow(row: Record<string, unknown>): string {
    const pk = row.parameter_key;
    if (pk && typeof pk === 'object' && !Array.isArray(pk)) {
      const n = String((pk as Record<string, unknown>).name ?? '').trim();
      if (n) return n;
    }
    return String(row.name ?? '').trim();
  }

  private readGeminiFunctionParameter(row: Record<string, unknown>): GeminiFunctionParameterRow | null {
    const name = this.parameterNameFromRow(row);
    const schemaEntity = String(row.schema_entity ?? '').trim();
    const schemaPath = String(row.schema_path ?? '').trim();
    if (!name || !schemaEntity) return null;
    return {
      name,
      description: String(row.description ?? '').trim(),
      schemaEntity,
      schemaPath: schemaPath || null,
      compositeKey: this.parseCompositeKey(row.composite_key),
      required: Boolean(row.required),
      enumEnabled: row.enum !== false,
    };
  }

  private loadGeminiFunctionCalls(): GeminiFunctionCallRow[] {
    if (this.cachedGeminiFunctionCalls) return this.cachedGeminiFunctionCalls;
    const bucket = this.options.getEntityStore().gemini_function_call;
    if (!bucket || typeof bucket !== 'object') {
      this.cachedGeminiFunctionCalls = [];
      return this.cachedGeminiFunctionCalls;
    }
    const rows: GeminiFunctionCallRow[] = [];
    for (const row of Object.values(bucket)) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const functionName = String(r.function_name ?? '').trim();
      const providerId = String(r.provider_id ?? '').trim();
      const nestedParameters = Array.isArray(r.parameters) ? r.parameters : [];
      const paramBucket = this.options.getEntityStore().gemini_function_parameter;
      const parameters = nestedParameters
        .map((p) => {
          if (typeof p === 'string' && p.trim()) {
            const id = p.trim();
            let row = paramBucket?.[id];
            if (!row && paramBucket) {
              for (const cand of Object.values(paramBucket)) {
                if (!cand || typeof cand !== 'object' || Array.isArray(cand)) continue;
                if (this.parameterNameFromRow(cand as Record<string, unknown>) !== id) continue;
                const pk = (cand as Record<string, unknown>).parameter_key;
                const fn =
                  pk && typeof pk === 'object' && !Array.isArray(pk)
                    ? String((pk as Record<string, unknown>).function_name ?? '').trim()
                    : '';
                if (fn === functionName) {
                  row = cand as Record<string, unknown>;
                  break;
                }
              }
            }
            return row && typeof row === 'object' && !Array.isArray(row)
              ? (row as Record<string, unknown>)
              : null;
          }
          if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
          return null;
        })
        .filter((p): p is Record<string, unknown> => Boolean(p))
        .map((p) => this.readGeminiFunctionParameter(p))
        .filter((p): p is GeminiFunctionParameterRow => Boolean(p));
      const output = this.parseFunctionOutput(r);
      if (!functionName || !providerId) continue;
      rows.push({
        functionName,
        description: String(r.description ?? '').trim(),
        providerId,
        enabled: Boolean(r.enabled),
        sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
        parameters,
        output,
      });
    }
    this.cachedGeminiFunctionCalls = rows.sort((a, b) => a.sortOrder - b.sortOrder);
    return this.cachedGeminiFunctionCalls;
  }

  private functionDeclarationsForProvider(providerId: string): Record<string, unknown>[] {
    const all = this.loadGeminiFunctionCalls().filter((row) => row.enabled && row.providerId === providerId);
    return all.map((row) => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const param of row.parameters) {
        const paramSchema = this.geminiFunctionParamSchema(this.schemaForFunctionParameter(param));
        if (param.enumEnabled) {
          const enumValues = this.enumValuesForFunctionParameter(param);
          if (enumValues.length) paramSchema.enum = enumValues;
        }
        if (param.description) paramSchema.description = param.description;
        properties[param.name] = paramSchema;
        if (param.required) required.push(param.name);
      }
      return {
        name: row.functionName,
        description: row.description,
        parameters: {
          type: 'OBJECT',
          properties,
          required,
        },
      };
    });
  }

  private executeDeclarativeFunction(row: GeminiFunctionCallRow, rawArgs: Record<string, unknown>): Record<string, unknown> {
    const argsCtx = this.expressionArgs(rawArgs);
    if (row.output && Object.keys(row.output).length > 0) {
      const assembled: Record<string, unknown> = {};
      for (const [responseKey, anchorName] of Object.entries(row.output)) {
        const lookedUp = this.lookupRowsForOutputAnchor(row.parameters, anchorName, argsCtx);
        if (lookedUp !== null) {
          assembled[responseKey] = lookedUp;
        } else {
          assembled[responseKey] = this.buildCompositeOutputFromAnchor(row.parameters, anchorName, argsCtx);
        }
      }
      return assembled;
    }
    return { ok: true, body: null };
  }

  private expressionArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...args };
    for (const [key, value] of Object.entries(args)) {
      out[`${key}_lower`] = String(value ?? '').trim().toLowerCase();
    }
    return out;
  }
}
