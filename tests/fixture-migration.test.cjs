const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseFixtures}=require('../dist/identity');
const {diffBenchmarks}=require('../dist/diff');
const {enforceThresholds}=require('../dist/threshold');
const {renderComment}=require('../dist/comment');
const historical=require('./fixtures/fixture-migration/historical.json');
const bridge=require('../weighin-fixtures.json');
const stable=require('./fixtures/fixture-migration/stable.json');
const captured=require('../docs/experiments/repeatability/completed/runs.json')[0].reference_measurements[0];
const legacy='wasm:'+historical.contracts[0].wasm_path;
const policy={thresholds:{functions:{hello:{cpu_instructions:'strict_zero_tolerance'}}}};
// Real schema-4 measurement shape, with fixture identities resolved by the
// public API. Altered meters/addresses here are controlled behavior tests only.
function measured(fixture,cpu=266842){
  const spec=parseFixtures(JSON.stringify(fixture),'weighin-fixtures.json');
  return spec.contracts.map(contract=>{
    const record=structuredClone(captured);record.fixture_id=spec.fixture_id;record.logical_id=contract.logical_id;
    record.benchmarks[0].case_id=contract.invocations[0].case_id;
    record.benchmarks[0].metrics.cpu_instructions.consumed=cpu;return record;
  });
}
test('direct historical path to stable ID has no match and must not guess by filename',()=>{
  const diff=diffBenchmarks(measured(historical),measured(stable));
  assert.equal(diff.contracts.length,0);assert.equal(diff.newContracts.length,1);assert.equal(diff.removedContracts.length,1);
});
test('first migration retains the exact historical contract/function/case and adds a distinct stable identity',()=>{
  const diff=diffBenchmarks(measured(historical),measured(bridge));
  assert.equal(diff.contracts.length,1);assert.equal(diff.contracts[0].logical_id,legacy);
  assert.equal(diff.contracts[0].functions.length,1);assert.equal(diff.newContracts.length,1);
  assert.deepEqual(diff.removedContracts,[]);assert.equal(diff.hasRegression,false);
  assert.deepEqual(bridge.contracts.find(c=>!c.id),historical.contracts[0]);
});
test('strict policy still evaluates the matched historical benchmark during migration',()=>{
  const diff=diffBenchmarks(measured(historical),measured(bridge,300000));
  assert.equal(enforceThresholds(diff,policy).length,1);
  assert.ok(diff.contracts[0].functions[0].metrics.find(m=>m.key==='cpu_instructions').delta>0);
});
test('second migration can remove the bridge only when BASE already contains the stable ID',()=>{
  const diff=diffBenchmarks(measured(bridge),measured(stable));
  assert.equal(diff.contracts.length,1);assert.equal(diff.contracts[0].logical_id,'id:reference-contract');
  assert.deepEqual(diff.newContracts,[]);assert.equal(diff.removedContracts.length,1);
  assert.deepEqual(enforceThresholds(diff,policy),[]);
});
test('a changed WASM/address regression remains comparable after bridge retirement',()=>{
  const head=measured(stable,300000);
  // Valid diagnostic addresses and artifact hashes from the genuine Stage 3 regression.
  const real=require('../docs/experiments/metric-provenance/action/regression-diff.json');
  head[0].contract_id=real.contracts[0].head_contract_id;
  head[0].benchmarks[0].wasm_sha256='5878fa37dfcec8eaebc72111dfdbfa92447cb735bd88d23dcaf0e8edf9f7f3e8';
  const diff=diffBenchmarks(measured(bridge),head);
  assert.equal(diff.contracts[0].logical_id,'id:reference-contract');assert.equal(diff.hasRegression,true);
  assert.equal(enforceThresholds(diff,policy).length,1);
});
test('bridge reports show the matched historical benchmark and the new stable identity explicitly',()=>{
  const report=renderComment(diffBenchmarks(measured(historical),measured(bridge)),[],'historical','bridge');
  assert.ok(report.includes(legacy));assert.ok(report.includes('id:reference-contract'));
});
test('unrelated contracts at the same basename do not gain a migration match',()=>{
  const unrelated=structuredClone(historical);unrelated.contracts[0].wasm_path='other/target/wasm32-unknown-unknown/release/contract_test.wasm';
  assert.equal(diffBenchmarks(measured(unrelated),measured(bridge)).contracts.length,0);
});
