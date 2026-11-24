import * as path from "path";
import { z } from "zod";
import { ZodError } from "zod";
import type { FixturesSpec, ContractSpec, InvocationSpec } from "./measurement";
import { FixturesSpecSchema, formatZodError } from "./config";

export interface IdentifiedInvocation extends InvocationSpec {
  case_id: string;
}

export interface IdentifiedContract extends ContractSpec {
  logical_id: string;
  invocations: IdentifiedInvocation[];
  /** Setup return IDXDR from the committed create, when a contract has an
   *  explicit id and was successfully deployed during setup. */
  setup_return_xdr?: string;
}

export interface IdentifiedFixtures extends FixturesSpec {
  fixture_id: string;
  contracts: IdentifiedContract[];
  /** Parsed setup declarations, if any were present in the fixture spec. */
  setup_declarations?: ReadonlyArray<{
    contract_id: string;
    depends_on: string[];
  }>;
}

function relativePath(value: string): string {
  const portable = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:/.test(portable)) {
    throw new Error(
      `Comparison identity requires a relative path or an explicit id: ${value}`,
    );
  }
  return path.posix.normalize(portable);
}

// Argument object key order is irrelevant; argument array order is significant.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Resolve logical identities before any deployment or simulation side effects.
 * fixturePath is a stable workspace-relative path, shared by BASE and HEAD.
 * Explicit ids are scoped to their fixture/contract, not global names.
 */
export function parseFixtures(
  raw: string,
  fixturePath: string,
): IdentifiedFixtures {
  let fixtures: z.infer<typeof FixturesSpecSchema>;
  try {
    fixtures = FixturesSpecSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatZodError(err, fixturePath));
    }
    throw err;
  }

  // ------------------------------------------------------------------
  // 1. Derive fixture‑level identity
  // ------------------------------------------------------------------
  const fixture_id =
    fixtures.id === undefined
      ? `path:${relativePath(fixturePath)}`
      : `id:${fixtures.id}`;

  // ------------------------------------------------------------------
  // 2. Parse contract declarations (existing logic unchanged)
  // ------------------------------------------------------------------
  const contractIds = new Set<string>();
  const setupRaw = fixtures.setup ?? [];
  // Normalise setup declarations: ensure each entry has contract_id and optionally depends_on.
  const setupDecls: ReadonlyArray<{
    contract_id: string;
    depends_on: string[];
  }> = setupRaw.map((s: any) => ({
    contract_id: s.contract_id,
    depends_on: s.depends_on ?? [],
  }));
  const setupIdSet = new Set<string>(setupDecls.map((d) => d.contract_id));

  // Check for duplicate setup contract identities within the declarations themselves.
  if (setupIdSet.size !== setupDecls.length) {
    const dups = setupDecls
      .filter(
        (d, i) =>
          setupDecls.findIndex((x) => x.contract_id === d.contract_id) !== i,
      )
      .map((d) => d.contract_id);
    throw new Error(
      `Duplicate setup contract identity${dups.length > 1 ? "s" : ""}: ${dups.join(", ")}`,
    );
  }

  const contracts = fixtures.contracts.map((contract) => {
    const logical_id =
      contract.id === undefined
        ? `wasm:${relativePath(contract.wasm_path)}`
        : `id:${contract.id}`;
    if (contractIds.has(logical_id)) {
      throw new Error(
        `Duplicate logical contract identity in ${fixture_id}: ${logical_id}`,
      );
    }
    contractIds.add(logical_id);

    // Check that this contract's explicit id does not collide with a setup declaration's contract_id.
    for (const sd of setupDecls) {
      if (sd.contract_id === contract.id) {
        throw new Error(
          `Setup contract identity "${sd.contract_id}" collides with contract explicit id in ${fixture_id}`,
        );
      }
    }

    const caseIds = new Set<string>();
    const invocations = contract.invocations.map((invocation) => {
      // A bound argument is identified by its declared reference, never by the
      // runtime value it resolves to, so case identity survives redeployment.
      const args = invocation.args.map((arg) =>
        "binding" in arg
          ? { type: arg.type.toLowerCase(), binding: canonical(arg.binding) }
          : { type: arg.type.toLowerCase(), value: canonical(arg.value) },
      );
      const case_id =
        invocation.id === undefined
          ? `args:${JSON.stringify(args)}`
          : `id:${invocation.id}`;
      const key = JSON.stringify([invocation.function_name, case_id]);
      if (caseIds.has(key)) {
        throw new Error(
          `Duplicate benchmark identity in ${logical_id}: ${invocation.function_name} / ${case_id}. Set distinct invocation ids.`,
        );
      }
      caseIds.add(key);
      return { ...invocation, case_id };
    });
    return { ...contract, logical_id, invocations };
  });

  // ------------------------------------------------------------------
  // 3. Return identified fixtures with setup declarations attached
  // ------------------------------------------------------------------
  return {
    ...fixtures,
    fixture_id,
    contracts,
    setup_declarations: setupDecls.length > 0 ? setupDecls : undefined,
  };
}
