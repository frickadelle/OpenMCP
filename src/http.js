import { assert, redact, UserError } from './errors.js';
import { validateData } from './schema.js';

export function credentials(config, env = process.env) {
  const values = new Map();
  for (const source of config.sources) {
    if (source.auth.type === 'none') continue;
    const value = env[source.auth.env];
    assert(typeof value === 'string' && value.trim() !== '', `Source ${source.id}: environment variable ${source.auth.env} is missing or empty. Set it in the MCP client's launch environment.`);
    assert(!/[\r\n]/.test(value), `Source ${source.id}: credential contains invalid newline characters.`);
    values.set(source.id, value);
  }
  return values;
}
function pathValue(value) {
  const raw = String(value);
  assert(raw !== '.' && raw !== '..', 'Path parameters cannot be dot segments.');
  return encodeURIComponent(raw).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function setHeader(headers, name, value) {
  for (const existing of Object.keys(headers)) if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
  headers[name] = value;
}
export function buildRequest(tool, args, secret) {
  validateData(tool.checkInput, args, 'Invalid tool input');
  validateData(tool.checkMapping, args, 'Input does not match the API parameter mapping');
  let path = tool.path;
  const query = new URLSearchParams();
  const headers = { Accept: 'application/json' };
  for (const p of tool.parameters) {
    const value = args[p.in === 'header' ? 'headers' : p.in]?.[p.name];
    if (value === undefined) continue;
    if (p.in === 'path') path = path.split(`{${p.name}}`).join(pathValue(value));
    if (p.in === 'query') {
      if (Array.isArray(value)) {
        if (p.explode) value.forEach(v => query.append(p.name, String(v)));
        else {
          assert(value.every(v => !String(v).includes(',')), `Query parameter ${p.name}: comma-containing items need explode: true.`);
          query.set(p.name, value.map(String).join(','));
        }
      } else query.set(p.name, String(value));
    }
    if (p.in === 'header') {
      assert(!/[\r\n]/.test(String(value)), 'Header parameters cannot contain newlines.');
      setHeader(headers, p.name, String(value));
    }
  }
  const auth = tool.source.auth;
  if (auth.type !== 'none') {
    assert(secret, `Missing credentials for source ${tool.source.id}.`);
    if (auth.type === 'bearer') setHeader(headers, 'Authorization', `Bearer ${secret}`);
    else if (auth.in === 'header') setHeader(headers, auth.name, secret);
    else query.set(auth.name, secret);
  }
  const base = tool.source.baseUrl.replace(/\/+$/, '');
  const url = `${base}${path}${query.size ? `?${query}` : ''}`;
  const body = args.body === undefined ? undefined : JSON.stringify(args.body);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return { url, options: { method: tool.method, headers, body, redirect: 'manual' } };
}
const MAX_RESPONSE = 1024 * 1024;
async function responseText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE) { await reader.cancel(); throw new UserError('API response exceeds the 1 MiB limit. Use a smaller query or pagination.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function callApi(tool, args, { secrets = new Map(), timeoutMs = 10000, signal, fetchImpl = fetch } = {}) {
  const { url, options } = buildRequest(tool, args, secrets.get(tool.source.id));
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response; let text;
  try {
    response = await fetchImpl(url, { ...options, signal: combined });
    text = await responseText(response);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (timeout.aborted) throw new UserError(`API request timed out after ${timeoutMs} ms. Check the API or increase timeoutMs.`);
    if (signal?.aborted) throw new UserError('API request cancelled.');
    throw new UserError('API connection failed. Check the base URL, network and TLS certificate.');
  }
  assert(response.status < 300 || response.status >= 400, `API returned HTTP ${response.status}: redirects are disabled to protect credentials. Configure the final base URL.`);
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? 'Check authentication and permissions.' :
      response.status === 429 ? 'Rate limit reached; retry manually later.' : 'Check the API request and upstream service.';
    // Do not log upstream bodies: they can echo inputs and secrets.
    throw new UserError(`API returned HTTP ${response.status}. ${hint}`);
  }
  const type = response.headers.get('content-type') ?? '';
  assert(!text || /^(application\/(?:[\w.+-]*\+)?json|text\/)/i.test(type), 'Unsupported API response content type; only JSON and text are supported.');
  if (text && /json/i.test(type)) {
    try { JSON.parse(text); } catch { throw new UserError('API returned malformed JSON. Check the upstream response.'); }
  }
  return redact(text || '(empty response)', [...secrets.values()]);
}
