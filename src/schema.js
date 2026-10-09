import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { assert, UserError } from './errors.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true, ownProperties: true });
addFormats(ajv);
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'description', 'title', 'default', 'examples', 'example', 'format', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'nullable', 'deprecated', 'readOnly', 'writeOnly', '$schema']);
const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
export function safeName(name) {
  assert(typeof name === 'string' && name.length > 0 && !dangerous.has(name), 'Invalid or reserved parameter/property name.');
}
// Deliberately bounded schema dialect; do not silently drop validation keywords.
export function normalizeSchema(raw, version = '3.1', seen = new Set()) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'Schema must be an object; boolean schemas are not supported.');
  assert(!seen.has(raw), 'Recursive schemas are not supported.');
  const nextSeen = new Set(seen).add(raw);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    assert(keywords.has(key) || key.startsWith('x-'), `Unsupported schema keyword: ${key}.`);
    if (key.startsWith('x-') || ['nullable', 'example', 'deprecated', 'readOnly', 'writeOnly', '$schema'].includes(key)) continue;
    if (key === 'properties') {
      out.properties = {};
      for (const [name, schema] of Object.entries(value)) {
        safeName(name);
        out.properties[name] = normalizeSchema(schema, version, nextSeen);
      }
    } else if (key === 'items' || (key === 'additionalProperties' && typeof value === 'object')) {
      out[key] = normalizeSchema(value, version, nextSeen);
    } else out[key] = value;
  }
  if (raw.$schema) assert(raw.$schema === 'https://json-schema.org/draft/2020-12/schema', 'Only JSON Schema 2020-12 is supported.');
  if (raw.readOnly) throw new UserError('readOnly input properties are not supported; remove them from the request schema.');
  if (version.startsWith('3.0')) {
    for (const bound of ['Minimum', 'Maximum']) {
      if (typeof raw[`exclusive${bound}`] === 'boolean') {
        delete out[`exclusive${bound}`];
        if (raw[`exclusive${bound}`]) {
          const inclusive = bound.toLowerCase();
          assert(typeof raw[inclusive] === 'number', `exclusive${bound} needs ${inclusive}.`);
          out[`exclusive${bound}`] = raw[inclusive];
          delete out[inclusive];
        }
      }
    }
  }
  if (raw.nullable === true) {
    assert(typeof raw.type === 'string', 'nullable needs an explicit type.');
    out.type = [raw.type, 'null'];
  }
  assert(out.type !== undefined, 'Every input schema needs an explicit type.');
  if (out.type === 'array') assert(out.items, 'Array schemas need items.');
  return out;
}
export function validator(schema, label = 'Input schema') {
  try { return ajv.compile(schema); }
  catch (error) { throw new UserError(`${label} is invalid: ${error.message}`); }
}
export function validateData(check, data, label) {
  if (!check(data)) {
    // Never include the provided values in errors.
    const messages = check.errors.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new UserError(`${label}: ${messages}`);
  }
}
