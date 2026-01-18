import { sendJson } from './http.js';

// Minimal structured error helpers that preserve existing shapes.
// Use only where status code and body shape match current behavior.

export function jsonError(res, status, message) {
  return sendJson(res, status, { error: message });
}

export function notFound(res, message = 'not found') {
  return jsonError(res, 404, message);
}

export function badRequest(res, message = 'bad request') {
  return jsonError(res, 400, message);
}

// Only use if 405 is already part of existing behavior.
export function methodNotAllowed(res, message = 'method not allowed') {
  return jsonError(res, 405, message);
}

