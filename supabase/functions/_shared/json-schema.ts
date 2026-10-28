// Turns the extraction zod schemas into the JSON Schema subset that Claude structured outputs
// (output_config.format) accept, and turns Claude's JSON back into validated data.
// Runtime-agnostic: imports only zod, so vitest (Node) and the edge functions (Deno) share it.
//
// Claude's schema compiler accepts a subset of JSON Schema and caps how many properties may use
// unions (anyOf / type arrays) per request. The extraction schemas have dozens of nullable
// fields, so nullable *strings* are sent as plain strings where "" stands for null, and
// `parseStructuredOutput` maps "" back to null before zod validation. Nullable numbers and
// objects keep a real `anyOf [..., null]` union; together they fit comfortably in the budget.
// Structured outputs also don't guarantee the capitalization of enum / const values, so
// `parseStructuredOutput` maps a case-only mismatch ("Exam") back to the schema's value ("exam").

import { z } from 'zod';

export type JsonObject = { [key: string]: unknown };

/** Keywords the structured-outputs compiler accepts. Everything else is stripped. */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'anyOf',
  'allOf',
  'description',
  'default',
  'format',
  'minItems',
]);

export const SUPPORTED_STRING_FORMATS: ReadonlySet<string> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** Per-request limits from the structured-outputs docs ("Schema complexity limits"). */
export const MAX_UNION_PARAMETERS = 16;
export const MAX_OPTIONAL_PARAMETERS = 24;

const EMPTY_MEANS_NULL = 'Use "" (empty string) for null.';

/** Path into a JSON value: property names, with "*" meaning "every element of this array". */
export type ValuePath = readonly string[];

/** The string `enum` / `const` values allowed at one path. */
export interface EnumValues {
  path: ValuePath;
  values: readonly string[];
}

export interface ClaudeOutputSchema {
  /** Schema for `output_config.format = { type: 'json_schema', schema }`. */
  schema: JsonObject;
  /** Nullable string fields that were sent as plain strings; "" in the output means null. */
  emptyStringAsNull: readonly ValuePath[];
  /**
   * String enum / const values by path. Structured outputs don't guarantee their capitalization,
   * so `parseStructuredOutput` restores the schema's spelling before validation.
   */
  enumValues: readonly EnumValues[];
}

export interface SanitizeOptions {
  /** Send nullable strings as plain strings ("" = null) to stay within the union budget. Default true. */
  collapseNullableStrings?: boolean;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withSentence = (description: unknown, sentence: string): string =>
  typeof description === 'string' && description.trim()
    ? `${description.trim().replace(/[.;:,]?$/, '.')} ${sentence}`
    : sentence;

/** `{ type: ['string','null'] }` or `{ anyOf: [{ type: 'string' }, { type: 'null' }] }` without enum/const. */
function nullableStringDescription(node: JsonObject): { description: unknown } | null {
  const plainString = (n: JsonObject) => n.type === 'string' && !('enum' in n) && !('const' in n);
  if (Array.isArray(node.type)) {
    const types = node.type;
    if (types.length === 2 && types.includes('string') && types.includes('null') && !('enum' in node) && !('const' in node)) {
      return { description: node.description };
    }
    return null;
  }
  if (Array.isArray(node.anyOf) && node.anyOf.length === 2) {
    const [a, b] = node.anyOf;
    if (!isObject(a) || !isObject(b)) return null;
    const isNull = (n: JsonObject) => n.type === 'null';
    const str = isNull(a) ? b : isNull(b) ? a : null;
    if (str && plainString(str)) return { description: node.description ?? str.description };
  }
  return null;
}

/**
 * Rewrites a JSON Schema (as produced by `z.toJSONSchema`) into the supported subset:
 * unsupported keywords are dropped, every object is closed (`additionalProperties: false`) with
 * every property required, nullable type arrays become `anyOf [T, null]`, and (by default)
 * nullable strings become plain strings. Throws on constructs it cannot express faithfully
 * (`$ref`, tuple `items`, multi-type arrays) so a bad schema fails at boot, not as an API 400.
 */
export function sanitizeJsonSchema(input: JsonObject, options: SanitizeOptions = {}): ClaudeOutputSchema {
  const collapse = options.collapseNullableStrings ?? true;
  const emptyStringAsNull: ValuePath[] = [];
  const enumsByPath = new Map<string, { path: ValuePath; values: Set<string> }>();
  const recordEnum = (path: string[], values: unknown[]): void => {
    const strings = values.filter((v): v is string => typeof v === 'string');
    if (strings.length === 0) return;
    const key = JSON.stringify(path);
    const entry = enumsByPath.get(key) ?? { path, values: new Set<string>() };
    for (const value of strings) entry.values.add(value);
    enumsByPath.set(key, entry);
  };

  const visit = (node: unknown, path: string[]): JsonObject => {
    if (!isObject(node)) throw new Error(`Schema node at "${path.join('.') || '<root>'}" is not an object.`);
    if ('$ref' in node || '$defs' in node || 'definitions' in node) {
      throw new Error('Schema must be fully inlined (no $ref/$defs); generate it with reused: "inline".');
    }

    if (collapse) {
      const nullable = nullableStringDescription(node);
      if (nullable) {
        emptyStringAsNull.push(path);
        return { type: 'string', description: withSentence(nullable.description, EMPTY_MEANS_NULL) };
      }
    }

    if (Array.isArray(node.type)) {
      const types = node.type.filter((t): t is string => typeof t === 'string');
      const nonNull = types.filter((t) => t !== 'null');
      if (types.length !== node.type.length || nonNull.length !== 1 || nonNull.length === types.length) {
        throw new Error(`Unsupported type union at "${path.join('.')}": ${JSON.stringify(node.type)}.`);
      }
      const { description, type: _type, ...rest } = node;
      const out: JsonObject = { anyOf: [visit({ ...rest, type: nonNull[0] }, path), { type: 'null' }] };
      if (typeof description === 'string') out.description = description;
      return out;
    }

    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) continue;
      switch (key) {
        case 'properties': {
          if (!isObject(value)) throw new Error(`"properties" at "${path.join('.')}" is not an object.`);
          const props: JsonObject = {};
          for (const [name, child] of Object.entries(value)) props[name] = visit(child, [...path, name]);
          out.properties = props;
          break;
        }
        case 'items':
          if (!isObject(value)) throw new Error(`Tuple "items" at "${path.join('.')}" is not supported.`);
          out.items = visit(value, [...path, '*']);
          break;
        case 'anyOf':
        case 'allOf':
          if (!Array.isArray(value)) throw new Error(`"${key}" at "${path.join('.')}" is not an array.`);
          out[key] = value.map((branch) => visit(branch, path));
          break;
        case 'format':
          if (typeof value === 'string' && SUPPORTED_STRING_FORMATS.has(value)) out.format = value;
          break;
        case 'minItems':
          if (value === 0 || value === 1) out.minItems = value;
          break;
        case 'required':
        case 'additionalProperties':
          break; // recomputed below for every object
        default:
          out[key] = value;
      }
    }

    if (out.type === 'object' || 'properties' in out) {
      const props = isObject(out.properties) ? out.properties : {};
      out.properties = props;
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    if (Array.isArray(out.enum)) recordEnum(path, out.enum);
    if ('const' in out) recordEnum(path, [out.const]);
    return out;
  };

  const schema = visit(input, []);
  const enumValues = [...enumsByPath.values()].map(({ path, values }) => ({ path, values: [...values] }));
  return { schema, emptyStringAsNull, enumValues };
}

/** Every JSON Schema node in the tree (property schemas, items, union branches). */
function* schemaNodes(node: JsonObject): Generator<JsonObject> {
  yield node;
  if (isObject(node.properties)) for (const child of Object.values(node.properties)) if (isObject(child)) yield* schemaNodes(child);
  if (isObject(node.items)) yield* schemaNodes(node.items);
  for (const key of ['anyOf', 'allOf'] as const) {
    const branches = node[key];
    if (Array.isArray(branches)) for (const b of branches) if (isObject(b)) yield* schemaNodes(b);
  }
}

/** Property schemas that use `anyOf` or a type array (counted against MAX_UNION_PARAMETERS). */
export function countUnionParameters(schema: JsonObject): number {
  let count = 0;
  for (const node of schemaNodes(schema)) {
    if (!isObject(node.properties)) continue;
    for (const child of Object.values(node.properties)) {
      if (isObject(child) && (Array.isArray(child.anyOf) || Array.isArray(child.type))) count++;
    }
  }
  return count;
}

/** Properties missing from their object's `required` list (counted against MAX_OPTIONAL_PARAMETERS). */
export function countOptionalParameters(schema: JsonObject): number {
  let count = 0;
  for (const node of schemaNodes(schema)) {
    if (!isObject(node.properties)) continue;
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    for (const name of Object.keys(node.properties)) if (!required.has(name)) count++;
  }
  return count;
}

/** All keywords used anywhere in the schema (property names excluded). */
export function collectKeywords(schema: JsonObject): Set<string> {
  const keywords = new Set<string>();
  for (const node of schemaNodes(schema)) for (const key of Object.keys(node)) keywords.add(key);
  return keywords;
}

/** zod schema -> sanitized structured-output schema, asserting the complexity limits. */
export function toClaudeOutputSchema(schema: z.ZodType, options?: SanitizeOptions): ClaudeOutputSchema {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', reused: 'inline', cycles: 'throw', unrepresentable: 'throw' });
  const result = sanitizeJsonSchema(raw as JsonObject, options);
  const unions = countUnionParameters(result.schema);
  const optional = countOptionalParameters(result.schema);
  if (unions > MAX_UNION_PARAMETERS || optional > MAX_OPTIONAL_PARAMETERS) {
    throw new Error(`Output schema too complex for structured outputs: ${unions} union and ${optional} optional parameters.`);
  }
  return result;
}

/** In place: for each path, replace "" (or whitespace) with null. Missing intermediate values are skipped. */
export function restoreEmptyStringsAsNull(value: unknown, paths: readonly ValuePath[]): unknown {
  const apply = (target: unknown, path: ValuePath): void => {
    if (path.length === 0 || target == null) return;
    const [head, ...rest] = path;
    if (head === '*') {
      if (Array.isArray(target)) for (const el of target) apply(el, rest);
      return;
    }
    if (!isObject(target) || !(head in target)) return;
    if (rest.length === 0) {
      const leaf = target[head];
      if (typeof leaf === 'string' && leaf.trim() === '') target[head] = null;
      return;
    }
    apply(target[head], rest);
  };
  for (const path of paths) apply(value, path);
  return value;
}

/**
 * In place: a string at an enum path that matches one allowed value only case-insensitively
 * becomes that value ("Exam" -> "exam"). Exact matches, ambiguous matches, and other values are
 * left for validation to judge. "*" at the end of a path covers every array element.
 */
export function restoreEnumCasing(value: unknown, enums: readonly EnumValues[]): unknown {
  const canonical = (allowed: readonly string[], leaf: unknown): unknown => {
    if (typeof leaf !== 'string' || allowed.includes(leaf)) return leaf;
    const lower = leaf.toLowerCase();
    const matches = allowed.filter((v) => v.toLowerCase() === lower);
    return matches.length === 1 ? matches[0] : leaf;
  };
  const apply = (target: unknown, path: ValuePath, allowed: readonly string[]): void => {
    if (path.length === 0 || target == null) return;
    const [head, ...rest] = path;
    if (head === '*') {
      if (!Array.isArray(target)) return;
      if (rest.length === 0) for (let i = 0; i < target.length; i++) target[i] = canonical(allowed, target[i]);
      else for (const el of target) apply(el, rest, allowed);
      return;
    }
    if (!isObject(target) || !(head in target)) return;
    if (rest.length === 0) target[head] = canonical(allowed, target[head]);
    else apply(target[head], rest, allowed);
  };
  for (const { path, values } of enums) apply(value, path, values);
  return value;
}

export type StructuredParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'invalid_json' | 'schema_mismatch'; detail: string };

/**
 * JSON text from Claude -> validated data. `detail` names failing paths only (never values),
 * so it is safe to log.
 */
export function parseStructuredOutput<S extends z.ZodType>(
  text: string,
  schema: S,
  output: Pick<ClaudeOutputSchema, 'emptyStringAsNull' | 'enumValues'>,
): StructuredParseResult<z.output<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'invalid_json', detail: err instanceof Error ? err.name : 'parse error' };
  }
  const restored = restoreEnumCasing(restoreEmptyStringsAsNull(raw, output.emptyStringAsNull), output.enumValues);
  const parsed = schema.safeParse(restored);
  if (parsed.success) return { ok: true, data: parsed.data };
  const paths = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.code}`);
  return { ok: false, reason: 'schema_mismatch', detail: `${parsed.error.issues.length} issue(s): ${paths.join('; ')}` };
}
