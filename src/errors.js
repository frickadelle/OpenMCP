export class UserError extends Error {}
export function assert(condition, message) {
  if (!condition) throw new UserError(message);
}
export function redact(text, secrets = []) {
  let result = String(text);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
      result = result.split(form).join('[REDACTED]');
    }
  }
  return result.replace(/(Bearer\s+)[^\s"<]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s,&"<]+/gi, '$1[REDACTED]');
}
