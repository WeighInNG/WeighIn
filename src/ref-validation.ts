/**
 * Git ref validation and baseline ref resolution.
 *
 * Enforces Git reference naming rules and security boundaries. Rejects
 * empty/whitespace inputs, option-like flags (e.g., `-o`, `--upload-pack`),
 * control characters, and malformed ref syntax before invoking Git commands.
 */

/**
 * Validate a git ref according to Git's reference naming rules and security boundaries.
 * Throws an Error with a contextual diagnostic if the ref is invalid.
 */
export function validateGitRef(ref: string, paramName = "base-ref"): string {
  if (!ref || typeof ref !== "string" || ref.trim().length === 0) {
    throw new Error(`Invalid ${paramName}: ref cannot be empty or whitespace`);
  }

  const trimmed = ref.trim();

  // Option-like check: reject if starts with '-' (e.g., -o, --upload-pack, --)
  if (trimmed.startsWith("-")) {
    throw new Error(
      `Invalid ${paramName}: option-like refs are not permitted: "${trimmed}"`,
    );
  }

  // Check for ASCII control chars (<= 0x20 or 0x7f) or any whitespace
  if (/[\x00-\x20\x7f\s]/.test(trimmed)) {
    throw new Error(
      `Invalid ${paramName}: ref cannot contain whitespace or control characters: "${trimmed}"`,
    );
  }

  // Reject git-illegal characters: ~ ^ : ? * [ \
  if (/[~^:?*\[\\]/.test(trimmed)) {
    throw new Error(
      `Invalid ${paramName}: ref contains invalid characters (~, ^, :, ?, *, [, \\): "${trimmed}"`,
    );
  }

  // Reject consecutive dots '..'
  if (trimmed.includes("..")) {
    throw new Error(
      `Invalid ${paramName}: ref cannot contain consecutive dots "..": "${trimmed}"`,
    );
  }

  // Reject consecutive slashes '//'
  if (trimmed.includes("//")) {
    throw new Error(
      `Invalid ${paramName}: ref cannot contain consecutive slashes "//": "${trimmed}"`,
    );
  }

  // Reject leading or trailing slash '/'
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    throw new Error(
      `Invalid ${paramName}: ref cannot begin or end with "/": "${trimmed}"`,
    );
  }

  // Reject ending with a dot '.' or '.lock'
  if (trimmed.endsWith(".") || trimmed.endsWith(".lock")) {
    throw new Error(
      `Invalid ${paramName}: ref cannot end with "." or ".lock": "${trimmed}"`,
    );
  }

  // Reject any path segment beginning with '.' or ending with '.lock'
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment.startsWith(".") || segment.endsWith(".lock")) {
      throw new Error(
        `Invalid ${paramName}: ref component cannot begin with "." or end with ".lock": "${trimmed}"`,
      );
    }
  }

  // Reject '@{' sequence
  if (trimmed.includes("@{")) {
    throw new Error(
      `Invalid ${paramName}: ref cannot contain "@{": "${trimmed}"`,
    );
  }

  // Reject single '@'
  if (trimmed === "@") {
    throw new Error(
      `Invalid ${paramName}: ref cannot be a single "@": "${trimmed}"`,
    );
  }

  return trimmed;
}

/**
 * Resolves and validates the baseline ref.
 * - If base-ref was explicitly provided as whitespace: rejects with error.
 * - If base-ref was omitted (empty string or undefined): falls back to PR base branch or 'main'.
 * - If base-ref was provided: validates it against git ref syntax and security rules.
 */
export function resolveBaseRef(
  rawInput: string | undefined,
  prBaseRef?: string,
): string {
  if (rawInput !== undefined && rawInput !== "") {
    if (rawInput.trim().length === 0) {
      throw new Error(`Invalid base-ref: ref cannot be empty or whitespace`);
    }
    return validateGitRef(rawInput.trim(), "base-ref");
  }

  // When omitted, default to PR base ref if present, otherwise 'main'
  const fallback = prBaseRef && prBaseRef.trim() ? prBaseRef.trim() : "main";
  return validateGitRef(fallback, "base-ref");
}
