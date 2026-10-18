import { describe, it, expect } from "vitest";
import { validateGitRef, resolveBaseRef } from "../src/ref-validation";

describe("validateGitRef", () => {
  it("accepts standard branch names and paths", () => {
    expect(validateGitRef("main")).toBe("main");
    expect(validateGitRef("master")).toBe("master");
    expect(validateGitRef("develop")).toBe("develop");
    expect(validateGitRef("feat/issue-112")).toBe("feat/issue-112");
    expect(validateGitRef("release/v1.0.0")).toBe("release/v1.0.0");
    expect(validateGitRef("refs/heads/main")).toBe("refs/heads/main");
    expect(validateGitRef("refs/tags/v2.1.0")).toBe("refs/tags/v2.1.0");
    expect(validateGitRef("refs/remotes/origin/HEAD")).toBe(
      "refs/remotes/origin/HEAD",
    );
  });

  it("accepts full and short commit SHAs", () => {
    expect(validateGitRef("80d446f58cd4c1946ae7fbf68ff9e5477e1d0aeb")).toBe(
      "80d446f58cd4c1946ae7fbf68ff9e5477e1d0aeb",
    );
    expect(validateGitRef("c3de51f")).toBe("c3de51f");
  });

  it("rejects empty or whitespace-only inputs", () => {
    expect(() => validateGitRef("")).toThrow(/cannot be empty or whitespace/);
    expect(() => validateGitRef("   ")).toThrow(
      /cannot be empty or whitespace/,
    );
    expect(() => validateGitRef("\t\n")).toThrow(
      /cannot be empty or whitespace/,
    );
  });

  it("rejects option-like inputs (starting with '-')", () => {
    expect(() => validateGitRef("-o")).toThrow(
      /option-like refs are not permitted/,
    );
    expect(() => validateGitRef("--upload-pack=exploit")).toThrow(
      /option-like refs are not permitted/,
    );
    expect(() => validateGitRef("--")).toThrow(
      /option-like refs are not permitted/,
    );
    expect(() => validateGitRef("-b")).toThrow(
      /option-like refs are not permitted/,
    );
  });

  it("rejects whitespace and ASCII control characters", () => {
    expect(() => validateGitRef("main branch")).toThrow(
      /whitespace or control characters/,
    );
    expect(() => validateGitRef("main\tbranch")).toThrow(
      /whitespace or control characters/,
    );
    expect(() => validateGitRef("main\nbranch")).toThrow(
      /whitespace or control characters/,
    );
    expect(() => validateGitRef("main\x00branch")).toThrow(
      /whitespace or control characters/,
    );
  });

  it("rejects invalid Git characters (~, ^, :, ?, *, [, \\)", () => {
    expect(() => validateGitRef("HEAD~1")).toThrow(/invalid characters/);
    expect(() => validateGitRef("HEAD^2")).toThrow(/invalid characters/);
    expect(() => validateGitRef("refs:heads")).toThrow(/invalid characters/);
    expect(() => validateGitRef("refs/heads/?")).toThrow(/invalid characters/);
    expect(() => validateGitRef("refs/heads/*")).toThrow(/invalid characters/);
    expect(() => validateGitRef("refs/heads/[a-z]")).toThrow(
      /invalid characters/,
    );
    expect(() => validateGitRef("refs\\heads\\main")).toThrow(
      /invalid characters/,
    );
  });

  it("rejects consecutive dots, consecutive slashes, leading/trailing slashes", () => {
    expect(() => validateGitRef("main..feature")).toThrow(/consecutive dots/);
    expect(() => validateGitRef("main//feature")).toThrow(
      /consecutive slashes/,
    );
    expect(() => validateGitRef("/main")).toThrow(
      /cannot begin or end with "\/"/,
    );
    expect(() => validateGitRef("main/")).toThrow(
      /cannot begin or end with "\/"/,
    );
  });

  it("rejects components ending with dot or .lock", () => {
    expect(() => validateGitRef("main.")).toThrow(
      /cannot end with "\." or "\.lock"/,
    );
    expect(() => validateGitRef("main.lock")).toThrow(
      /cannot end with "\." or "\.lock"/,
    );
    expect(() => validateGitRef("feat/.hidden")).toThrow(
      /component cannot begin with "\." or end with "\.lock"/,
    );
    expect(() => validateGitRef("feat/foo.lock/bar")).toThrow(
      /component cannot begin with "\." or end with "\.lock"/,
    );
  });

  it("rejects '@{' sequence and standalone '@'", () => {
    expect(() => validateGitRef("main@{1}")).toThrow(/cannot contain "@\{"/);
    expect(() => validateGitRef("@")).toThrow(/cannot be a single "@"/);
  });
});

describe("resolveBaseRef", () => {
  it("resolves valid explicitly provided base-ref", () => {
    expect(resolveBaseRef("release/v2", "main")).toBe("release/v2");
    expect(resolveBaseRef("v1.0.0")).toBe("v1.0.0");
    expect(resolveBaseRef("80d446f58cd4c1946ae7fbf68ff9e5477e1d0aeb")).toBe(
      "80d446f58cd4c1946ae7fbf68ff9e5477e1d0aeb",
    );
  });

  it("falls back to PR base branch or 'main' when omitted", () => {
    expect(resolveBaseRef(undefined, "develop")).toBe("develop");
    expect(resolveBaseRef("", "develop")).toBe("develop");
    expect(resolveBaseRef(undefined, undefined)).toBe("main");
    expect(resolveBaseRef("", "")).toBe("main");
  });

  it("rejects explicitly supplied empty or whitespace input without falling back", () => {
    expect(() => resolveBaseRef("   ", "main")).toThrow(
      /cannot be empty or whitespace/,
    );
    expect(() => resolveBaseRef("\t", "develop")).toThrow(
      /cannot be empty or whitespace/,
    );
  });

  it("rejects option-like or malformed explicit input", () => {
    expect(() => resolveBaseRef("--upload-pack=evil", "main")).toThrow(
      /option-like refs are not permitted/,
    );
    expect(() => resolveBaseRef("feature branch", "main")).toThrow(
      /whitespace or control characters/,
    );
  });
});
