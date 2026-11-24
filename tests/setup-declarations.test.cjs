const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFixtures } = require('../dist/identity');

test('successful setup declaration parsing (no explicit contract ids)', () => {
  const result = parseFixtures(
    JSON.stringify({
      id: 'setup-suite',
      contracts: [
        { wasm_path: 'callee.wasm', invocations: [{ function_name: 'work', args: [] }] },
        { wasm_path: 'caller.wasm', depends_on: ['callee'], invocations: [{ function_name: 'read_callee', args: [] }] }
      ],
      setup: [
        { contract_id: 'callee', depends_on: [] },
        { contract_id: 'caller', depends_on: ['callee'] }
      ]
    }),
    'fixtures.json'
  );
  assert.ok(result.setup_declarations !== undefined, 'setup_declarations should be defined');
  assert.strictEqual(result.setup_declarations.length, 2);
  assert.strictEqual(result.setup_declarations[0].contract_id, 'callee');
  assert.strictEqual(result.setup_declarations[0].depends_on, []);
  assert.strictEqual(result.setup_declarations[1].contract_id, 'caller');
  assert.strictEqual(result.setup_declarations[1].depends_on, ['callee']);
});

test('multiple setup declarations (no explicit contract ids)', () => {
  const result = parseFixtures(
    JSON.stringify({
      id: 'multi-suite',
      contracts: [
        { wasm_path: 'a.wasm', invocations: [{ function_name: 'run', args: [] }] },
        { wasm_path: 'b.wasm', depends_on: ['a'], invocations: [{ function_name: 'run', args: [] }] },
        { wasm_path: 'c.wasm', depends_on: ['a', 'b'], invocations: [{ function_name: 'run', args: [] }] }
      ],
      setup: [
        { contract_id: 'a', depends_on: [] },
        { contract_id: 'b', depends_on: ['a'] },
        { contract_id: 'c', depends_on: ['a', 'b'] }
      ]
    }),
    'fixtures.json'
  );
  assert.strictEqual(result.setup_declarations.length, 3);
  assert.strictEqual(result.setup_declarations[0].contract_id, 'a');
  assert.strictEqual(result.setup_declarations[1].contract_id, 'b');
  assert.strictEqual(result.setup_declarations[2].contract_id, 'c');
});

test('duplicate setup identifiers throws', () => {
  assert.throws(
    () => parseFixtures(
      JSON.stringify({
        id: 'suite',
        contracts: [
          { wasm_path: 'a.wasm', invocations: [{ function_name: 'hello', args: [] }] },
          { wasm_path: 'b.wasm', invocations: [{ function_name: 'hello', args: [] }] }
        ],
        setup: [
          { contract_id: 'a', depends_on: [] },
          { contract_id: 'a', depends_on: [] }
        ]
      }),
      'fixtures.json'
    ),
    /Duplicate setup contract identity/,
    'should throw on duplicate setup ids'
  );
});

test('setup/benchmark ID collisions throws', () => {
  assert.throws(
    () => parseFixtures(
      JSON.stringify({
        id: 'suite',
        contracts: [
          { id: 'mycontract', wasm_path: 'contract.wasm', invocations: [{ function_name: 'hello', args: [] }] }
        ],
        setup: [{ contract_id: 'mycontract', depends_on: [] }]
      }),
      'fixtures.json'
    ),
    /collides with contract explicit id/,
    'should throw on setup/benchmark ID collision'
  );
});

test('malformed setup calls rejected before any effects', () => {
  assert.throws(
    () => parseFixtures(
      JSON.stringify({
        id: 'suite',
        contracts: [
          { id: 'a', wasm_path: 'a.wasm', invocations: [{ function_name: 'hello', args: [] }] }
        ],
        setup: 'not-an-array'
      }),
      'fixtures.json'
    ),
    /Invalid WeighIn configuration/,
    'should reject malformed setup before side effects'
  );
});

test('existing fixtures without setup still work', () => {
  const result = parseFixtures(
    JSON.stringify({
      id: 'no-setup-suite',
      contracts: [
        { id: 'a', wasm_path: 'a.wasm', invocations: [{ function_name: 'hello', args: [] }] }
      ]
    }),
    'fixtures.json'
  );
  assert.strictEqual(result.setup_declarations, undefined, 'setup_declarations should be undefined');
  assert.strictEqual(result.contracts.length, 1);
  assert.strictEqual(result.contracts[0].logical_id, 'id:a');
});

test('backward compatibility - fixture without id field', () => {
  const result = parseFixtures(
    JSON.stringify({
      contracts: [
        { wasm_path: 'a.wasm', invocations: [{ function_name: 'hello', args: [] }] }
      ]
    }),
    'fixtures.json'
  );
  assert.strictEqual(result.fixture_id, 'path:fixtures.json');
  assert.strictEqual(result.setup_declarations, undefined);
});
