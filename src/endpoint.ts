/**
 * Shared endpoint diagnostic policy.
 *
 * Diagnostics must never echo the configured RPC URL verbatim: the URL may
 * carry credentials in its userinfo or query string. `sanitizeEndpoint` keeps
 * the scheme, host, port and path while stripping userinfo, redacting query
 * values (keys are preserved) and dropping the fragment. Malformed input is
 * replaced with a fixed placeholder so the raw value is never printed.
 *
 * This is a shape-based redaction for display only. It does not prove that a
 * URL is secret-free and must never be used to rewrite the endpoint actually
 * used for requests.
 */

export const REDACTED_VALUE = "REDACTED";
export const INVALID_ENDPOINT = "[invalid endpoint]";

export function sanitizeEndpoint(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return INVALID_ENDPOINT;
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  const params = new URLSearchParams();
  for (const key of url.searchParams.keys()) {
    params.append(key, REDACTED_VALUE);
  }
  url.search = params.toString();
  return url.toString();
}

function endpointSecrets(rawUrl: string): string[] {
  const secrets = new Set<string>();
  try {
    const url = new URL(rawUrl);
    if (url.username) secrets.add(url.username);
    if (url.password) secrets.add(url.password);
    if (url.username || url.password) {
      secrets.add(`${url.username}:${url.password}`);
    }
    for (const value of url.searchParams.values()) {
      if (value) secrets.add(value);
    }
  } catch {
    // Malformed input: `redactEndpointSecrets` still replaces the raw value.
  }
  return [...secrets].filter((secret) => secret.length > 0);
}

/** Replace any occurrence of the raw endpoint and its credential components. */
export function redactEndpointSecrets(message: string, rawUrl: string): string {
  let result = message;
  if (rawUrl) result = result.split(rawUrl).join(sanitizeEndpoint(rawUrl));
  for (const secret of endpointSecrets(rawUrl)) {
    for (const variant of new Set([secret, encodeURIComponent(secret)])) {
      result = result.split(variant).join(REDACTED_VALUE);
    }
  }
  return result;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export type ValidatedJsonRpcEnvelope =
  { ok: true; result: unknown } | { ok: false; error: JsonRpcErrorObject };

/**
 * Validate a decoded JSON-RPC 2.0 response envelope against the issued request ID.
 * Rejects non-object payloads, unsupported/missing jsonrpc version, missing or
 * mismatched response ID, conflicting or absent result/error fields, unknown
 * top-level keys, and malformed error objects.
 */
export function validateJsonRpcEnvelope(
  rawBody: unknown,
  expectedId: number | string,
  method: string,
  rpcUrl: string,
): ValidatedJsonRpcEnvelope {
  const endpoint = sanitizeEndpoint(rpcUrl);
  const fail = (reason: string): never => {
    throw new Error(
      `Invalid JSON-RPC envelope for ${method} at ${endpoint}: ${redactEndpointSecrets(reason, rpcUrl)}`,
    );
  };

  if (
    typeof rawBody !== "object" ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return fail("response body must be a JSON object");
  }

  const record = rawBody as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== "jsonrpc" &&
      key !== "id" &&
      key !== "result" &&
      key !== "error"
    ) {
      return fail(`unexpected top-level field "${key}"`);
    }
  }

  if (record.jsonrpc !== "2.0") {
    return fail(
      `expected jsonrpc "2.0", got ${JSON.stringify(record.jsonrpc)}`,
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(record, "id") ||
    record.id !== expectedId
  ) {
    return fail(
      `response id ${JSON.stringify(record.id)} does not match request id ${JSON.stringify(expectedId)}`,
    );
  }

  const hasResult =
    Object.prototype.hasOwnProperty.call(record, "result") &&
    record.result !== undefined;
  const hasError =
    Object.prototype.hasOwnProperty.call(record, "error") &&
    record.error !== undefined;

  if (hasResult && hasError) {
    return fail("response must not contain both result and error");
  }
  if (!hasResult && !hasError) {
    return fail("response must contain either result or error");
  }

  if (hasError) {
    const errObj = record.error;
    if (
      typeof errObj !== "object" ||
      errObj === null ||
      Array.isArray(errObj)
    ) {
      return fail("error field must be a JSON object");
    }
    const errRecord = errObj as Record<string, unknown>;
    if (
      typeof errRecord.code !== "number" ||
      !Number.isInteger(errRecord.code) ||
      typeof errRecord.message !== "string"
    ) {
      return fail(
        "error object must contain an integer code and string message",
      );
    }
    return {
      ok: false,
      error: errRecord as unknown as JsonRpcErrorObject,
    };
  }

  return { ok: true, result: record.result };
}

export function parseJsonRpcResponse(
  rawText: string,
  expectedId: number | string,
  method: string,
  rpcUrl: string,
): ValidatedJsonRpcEnvelope {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawText);
  } catch (error: any) {
    throw new Error(
      `Invalid JSON-RPC envelope for ${method} at ${sanitizeEndpoint(rpcUrl)}: malformed JSON (${redactEndpointSecrets(String(error?.message ?? error), rpcUrl)})`,
    );
  }
  return validateJsonRpcEnvelope(decoded, expectedId, method, rpcUrl);
}
