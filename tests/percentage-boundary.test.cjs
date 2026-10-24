/**
 * Test suite for Issue #154: Percentage boundary precision and float-rounding isolation.
 */
const assert = require('assert');
const { evaluatePercentageBoundary } = require('./src/diff.js');

console.log("Running Issue #154 percentage boundary tests...");

// Test 1: Nonrepresentable thirds (base 3, head 4 => +33.333...%)
const res1 = evaluatePercentageBoundary(3, 4, 33.35);
assert.strictEqual(res1.passed, true, "Nonrepresentable third should pass within 33.35%");
assert.strictEqual(res1.displayPercentage, "+33.33%");

// Test 2: Nonrepresentable thirds strict bound (allowed 33.30%) -> should fail
const res2 = evaluatePercentageBoundary(3, 4, 33.30);
assert.strictEqual(res2.passed, false, "Nonrepresentable third should fail strict 33.30%");

// Test 3: Values near safe-integer limits
const baseSafe = Number.MAX_SAFE_INTEGER - 1000;
const headSafe = Number.MAX_SAFE_INTEGER;
const resSafe = evaluatePercentageBoundary(baseSafe, headSafe, 0.01);
assert.strictEqual(typeof resSafe.passed, 'boolean');
assert.strictEqual(typeof resSafe.actualBasisPoints, 'number');

console.log("All Issue #154 percentage boundary tests passed successfully!");
