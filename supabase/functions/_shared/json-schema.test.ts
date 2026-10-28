import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXTRACTION_ITEM_KINDS, SyllabusExtraction, TERM_EVENT_KINDS, TocExtraction, WARNING_KINDS } from './extraction.ts';
import {
  collectKeywords,
  countOptionalParameters,
  countUnionParameters,
  MAX_OPTIONAL_PARAMETERS,
  MAX_UNION_PARAMETERS,
  parseStructuredOutput,
  restoreEmptyStringsAsNull,
  restoreEnumCasing,
  sanitizeJsonSchema,
  SUPPORTED_KEYWORDS,
  toClaudeOutputSchema,
  type JsonObject,
} from './json-schema.ts';

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function* objectNodes(node: unknown): Generator<JsonObject> {
  if (Array.isArray(node)) {
    for (const v of node) yield* objectNodes(v);
    return;
  }
  if (!isObject(node)) return;
  if (node.type === 'object' || 'properties' in node) yield node;
  if (isObject(node.properties)) for (const v of Object.values(node.properties)) yield* objectNodes(v);
  yield* objectNodes(node.items);
  yield* objectNodes(node.anyOf);
  yield* objectNodes(node.allOf);
}

describe.each([
  ['SyllabusExtraction', SyllabusExtraction],
  ['TocExtraction', TocExtraction],
] as const)('toClaudeOutputSchema(%s)', (_name, zodSchema) => {
  const { schema, emptyStringAsNull } = toClaudeOutputSchema(zodSchema);

  it('uses only supported keywords', () => {
    for (const keyword of collectKeywords(schema)) expect(SUPPORTED_KEYWORDS.has(keyword), keyword).toBe(true);
    const text = JSON.stringify(schema);
    for (const banned of ['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'minLength', 'maxLength', 'pattern', '$ref', '$defs']) {
      expect(text).not.toContain(`"${banned}"`);
    }
  });

  it('closes every object and requires every property', () => {
    const objects = [...objectNodes(schema)];
    expect(objects.length).toBeGreaterThan(2);
    for (const obj of objects) {
      expect(obj.additionalProperties).toBe(false);
      expect(isObject(obj.properties)).toBe(true);
      expect([...(obj.required as string[])].sort()).toEqual(Object.keys(obj.properties as JsonObject).sort());
    }
    expect(countOptionalParameters(schema)).toBe(0);
  });

  it('stays within the structured-output union budget', () => {
    expect(countUnionParameters(schema)).toBeLessThanOrEqual(MAX_UNION_PARAMETERS);
    expect(countOptionalParameters(schema)).toBeLessThanOrEqual(MAX_OPTIONAL_PARAMETERS);
    // Nullable unions are expressed as anyOf with a null branch, never as type arrays.
    for (const keyword of collectKeywords(schema)) expect(keyword).not.toBe('nullable');
    expect(JSON.stringify(schema)).not.toMatch(/"type":\[/);
  });

  it('records the collapsed nullable strings', () => {
    expect(emptyStringAsNull.length).toBeGreaterThan(0);
  });
});

describe('SyllabusExtraction wire schema', () => {
  const { schema, emptyStringAsNull } = toClaudeOutputSchema(SyllabusExtraction);
  const props = (node: unknown) => (node as { properties: Record<string, JsonObject> }).properties;

  it('keeps nullable numbers and the reading object as anyOf unions', () => {
    const item = (props(schema).items as { items: JsonObject }).items;
    expect(props(item).weight_percent.anyOf).toEqual([{ type: 'number' }, { type: 'null' }]);
    expect(props(item).estimated_minutes.anyOf).toEqual([{ type: 'integer' }, { type: 'null' }]);
    const reading = props(item).reading.anyOf as JsonObject[];
    expect(reading[1]).toEqual({ type: 'null' });
    expect(reading[0].additionalProperties).toBe(false);
  });

  it('sends nullable strings as plain strings and keeps their descriptions', () => {
    const item = (props(schema).items as { items: JsonObject }).items;
    const due = props(item).due_date;
    expect(due.type).toBe('string');
    expect(due.description).toMatch(/^Resolved YYYY-MM-DD; null if TBD or unresolvable\. Use "" \(empty string\) for null\.$/);
    expect(emptyStringAsNull).toContainEqual(['items', '*', 'due_date']);
    expect(emptyStringAsNull).toContainEqual(['items', '*', 'reading', 'textbook_title']);
    expect(emptyStringAsNull).toContainEqual(['course', 'code']);
    expect(emptyStringAsNull).toContainEqual(['textbooks', '*', 'chapters', '*', 'title']);
  });

  it('keeps enums and integer types', () => {
    const item = (props(schema).items as { items: JsonObject }).items;
    expect(props(item).kind).toMatchObject({ type: 'string', enum: expect.arrayContaining(['exam', 'reading']) });
    const days = props(props(schema).course).meeting_days as { items: JsonObject };
    expect(days.items).toEqual({ type: 'integer' });
  });

  it('records every enum path for case restoration', () => {
    const { enumValues } = toClaudeOutputSchema(SyllabusExtraction);
    const byPath = new Map(enumValues.map((e) => [e.path.join('.'), e.values]));
    expect([...byPath.keys()].sort()).toEqual(['items.*.kind', 'term_events.*.kind', 'warnings.*.kind']);
    expect(byPath.get('items.*.kind')).toEqual([...EXTRACTION_ITEM_KINDS]);
    expect(byPath.get('term_events.*.kind')).toEqual([...TERM_EVENT_KINDS]);
    expect(byPath.get('warnings.*.kind')).toEqual([...WARNING_KINDS]);
  });
});

describe('sanitizeJsonSchema', () => {
  it('strips unsupported keywords and keeps supported formats', () => {
    const { schema } = sanitizeJsonSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      title: 'X',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 9, pattern: '^a' },
        when: { type: 'string', format: 'date' },
        color: { type: 'string', format: 'color' },
        n: { type: 'integer', minimum: 0, maximum: 3, multipleOf: 1 },
        list: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
        one: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['name'],
      additionalProperties: true,
    });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        when: { type: 'string', format: 'date' },
        color: { type: 'string' },
        n: { type: 'integer' },
        list: { type: 'array', items: { type: 'string' } },
        one: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['name', 'when', 'color', 'n', 'list', 'one'],
      additionalProperties: false,
    });
  });

  it('turns nullable type arrays into anyOf when strings are not collapsed', () => {
    const { schema, emptyStringAsNull } = sanitizeJsonSchema(
      { type: 'object', properties: { a: { type: ['string', 'null'], description: 'd' }, b: { type: ['number', 'null'] } } },
      { collapseNullableStrings: false },
    );
    expect(schema.properties).toEqual({
      a: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'd' },
      b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    });
    expect(emptyStringAsNull).toEqual([]);
  });

  it('rejects constructs it cannot express', () => {
    expect(() => sanitizeJsonSchema({ type: 'object', properties: { a: { $ref: '#/$defs/A' } } })).toThrow(/inlined/);
    expect(() => sanitizeJsonSchema({ type: ['string', 'number'] })).toThrow(/Unsupported type union/);
  });

  it('refuses schemas over the union budget', () => {
    const wide = z.object(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`n${i}`, z.number().nullable()])));
    expect(() => toClaudeOutputSchema(wide)).toThrow(/too complex/);
  });
});

describe('restoreEmptyStringsAsNull', () => {
  it('maps "" to null along paths, through arrays and null objects', () => {
    const value = {
      course: { code: '', title: 'Bio' },
      items: [
        { due_date: '', reading: { textbook_title: '  ' } },
        { due_date: '2026-09-01', reading: null },
      ],
    };
    restoreEmptyStringsAsNull(value, [
      ['course', 'code'],
      ['course', 'title'],
      ['items', '*', 'due_date'],
      ['items', '*', 'reading', 'textbook_title'],
      ['missing', 'path'],
    ]);
    expect(value).toEqual({
      course: { code: null, title: 'Bio' },
      items: [
        { due_date: null, reading: { textbook_title: null } },
        { due_date: '2026-09-01', reading: null },
      ],
    });
  });
});

describe('restoreEnumCasing', () => {
  it('maps case-only mismatches to the schema value, through arrays, nested paths and consts', () => {
    const { enumValues } = sanitizeJsonSchema({
      type: 'object',
      properties: {
        mode: { anyOf: [{ type: 'string', enum: ['fast', 'slow'] }, { type: 'null' }] },
        tags: { type: 'array', items: { type: 'string', enum: ['Biology', 'Chemistry'] } },
        rows: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', const: 'no_class' } } } },
      },
    });
    const value = { mode: 'FAST', tags: ['biology', 'CHEMISTRY', 'Physics'], rows: [{ kind: 'No_Class' }, { kind: 'no_class' }, {}] };
    restoreEnumCasing(value, enumValues);
    expect(value).toEqual({ mode: 'fast', tags: ['Biology', 'Chemistry', 'Physics'], rows: [{ kind: 'no_class' }, { kind: 'no_class' }, {}] });
  });

  it('leaves exact, ambiguous, non-string and null values alone', () => {
    const enums = [{ path: ['a'], values: ['Topic 3', 'topic 3'] }, { path: ['b'], values: ['x'] }, { path: ['c'], values: ['x'] }];
    const value = { a: 'TOPIC 3', b: 7, c: null };
    restoreEnumCasing(value, enums);
    expect(value).toEqual({ a: 'TOPIC 3', b: 7, c: null });
    const exact = { a: 'topic 3' };
    expect(restoreEnumCasing(exact, enums)).toEqual({ a: 'topic 3' });
  });
});

describe('parseStructuredOutput', () => {
  const output = toClaudeOutputSchema(TocExtraction);

  it('accepts enum values whose capitalization drifted', () => {
    const text = JSON.stringify({
      textbook: { title: 'Biology', authors: '', edition: '', chapters: [] },
      warnings: [
        { kind: 'Low_Quality_Scan', message: 'Page 3 is blurry.', related_item_title: '' },
        { kind: 'other', message: 'Check the appendix.', related_item_title: '' },
      ],
    });
    const result = parseStructuredOutput(text, TocExtraction, output);
    expect(result.ok && result.data.warnings.map((w) => w.kind)).toEqual(['low_quality_scan', 'other']);
    const unknown = parseStructuredOutput(text.replace('Low_Quality_Scan', 'blurry'), TocExtraction, output);
    expect(unknown).toMatchObject({ ok: false, reason: 'schema_mismatch' });
  });

  it('parses, restores nulls, and validates', () => {
    const text = JSON.stringify({
      textbook: { title: 'Biology', authors: '', edition: '12th', chapters: [{ number: '1', title: '', start_page: 1, end_page: null }] },
      warnings: [],
    });
    const result = parseStructuredOutput(text, TocExtraction, output);
    expect(result).toEqual({
      ok: true,
      data: {
        textbook: { title: 'Biology', authors: null, edition: '12th', chapters: [{ number: '1', title: null, start_page: 1, end_page: null }] },
        warnings: [],
      },
    });
  });

  it('reports invalid JSON and schema mismatches without echoing values', () => {
    expect(parseStructuredOutput('{"textbook": ', TocExtraction, output)).toMatchObject({ ok: false, reason: 'invalid_json' });
    const bad = parseStructuredOutput(JSON.stringify({ textbook: { title: 'Secret Title' }, warnings: [] }), TocExtraction, output);
    expect(bad).toMatchObject({ ok: false, reason: 'schema_mismatch' });
    if (!bad.ok) {
      expect(bad.detail).toContain('textbook.authors');
      expect(bad.detail).not.toContain('Secret Title');
    }
  });
});
