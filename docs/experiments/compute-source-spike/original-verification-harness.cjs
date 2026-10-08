const fs=require('node:fs');const crypto=require('node:crypto');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
const repo='/home/mxr/Documents/localRepo/Weighin';const {xdr,rpc}=require(`${repo}/node_modules/@stellar/stellar-sdk`);
const {parseFixtures}=require(`${repo}/dist/identity`);const {diffBenchmarks}=require(`${repo}/dist/diff`);const {enforceThresholds}=require(`${repo}/dist/threshold`);
const dir=__dirname;const exe=`${dir}/helper/target/release/weighin-compute-spike`;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');const write=(name,obj)=>fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(obj,null,2)+'\n');
function invoke(input){const r=spawnSync(exe,[],{input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',timeout:15000});if(r.error)throw r.error;return r;}
function parseOutput(stdout){const result=JSON.parse(stdout);for(const key of ['cpu_instructions_consumed','memory_bytes_consumed','instruction_budget','disk_read_bytes','write_bytes'])assert.ok(Number.isSafeInteger(result[key])&&result[key]>=0, `Invalid or missing ${key}`);return result;}
function success(input){const r=invoke(input);assert.equal(r.status,0,r.stderr);return parseOutput(r.stdout);}
const baseInput=require('./base-input.json'),headInput=require('./head-input.json');
assert.equal(baseInput.header_xdr,headInput.header_xdr);assert.deepEqual(baseInput.entries,headInput.entries);assert.deepEqual(baseInput.seed,headInput.seed);
const outputs={},repeats={},provenance={};
for(const [label,input] of [['base',baseInput],['head',headInput]]){
 repeats[label]=Array.from({length:5},()=>success(input));outputs[label]=repeats[label][0];for(const result of repeats[label])assert.deepEqual(result,outputs[label]);
 const captured=require(`./${label}-rpc.json`);const parsed=rpc.parseRawSimulation(captured.raw.result);
 assert.equal(outputs[label].transaction_data_xdr,captured.raw.result.transactionData,`${label}: entire transaction-data XDR must agree`);
 assert.equal(outputs[label].retval_xdr,captured.raw.result.results[0].xdr);
 assert.deepEqual(outputs[label].read_only_keys,parsed.transactionData.build().resources().footprint().readOnly().map(k=>k.toXDR('base64')));
 assert.deepEqual(outputs[label].read_write_keys,parsed.transactionData.build().resources().footprint().readWrite().map(k=>k.toXDR('base64')));
 const leeway=success({...input,instruction_leeway:5000000});assert.equal(leeway.cpu_instructions_consumed,outputs[label].cpu_instructions_consumed);assert.equal(leeway.memory_bytes_consumed,outputs[label].memory_bytes_consumed);assert.ok(leeway.instruction_budget>outputs[label].instruction_budget);write(`${label}-leeway-output`,leeway);
 const fixtureFile=`/tmp/weighin-stage1a-lixw19tq/${label}/weighin-fixtures.json`;const identified=parseFixtures(fs.readFileSync(fixtureFile,'utf8'),'weighin-fixtures.json');const contract=identified.contracts[0];
 const contractId=xdr.HostFunction.fromXDR(input.host_function_xdr,'base64').invokeContract().contractAddress();
 const {Address}=require(`${repo}/node_modules/@stellar/stellar-sdk`);
 const wasm=fs.readFileSync(`/tmp/weighin-stage1a-lixw19tq/${label}/contract/target/wasm32v1-none/release/contract_test.wasm`);
 provenance[label]={fixture_id:identified.fixture_id,logical_id:contract.logical_id,function_name:contract.invocations[0].function_name,case_id:contract.invocations[0].case_id,wasm_sha256:hash(wasm),contract_id:Address.fromScAddress(contractId).toString(),snapshot_sha256:hash(JSON.stringify(input.entries)),input_sha256:hash(JSON.stringify(input)),helper_sha256:hash(fs.readFileSync(exe)),seed:input.seed,host_features:['recording_mode','testutils']};
 write(`${label}-output`,outputs[label]);
}
assert.equal(provenance.base.logical_id,provenance.head.logical_id);assert.equal(provenance.base.fixture_id,provenance.head.fixture_id);assert.equal(provenance.base.case_id,provenance.head.case_id);assert.notEqual(provenance.base.wasm_sha256,provenance.head.wasm_sha256);assert.notEqual(provenance.base.contract_id,provenance.head.contract_id);
const cpuDelta=outputs.head.cpu_instructions_consumed-outputs.base.cpu_instructions_consumed;assert.ok(cpuDelta>0);
const memDelta=outputs.head.memory_bytes_consumed-outputs.base.memory_bytes_consumed;
const negative=[];
assert.throws(()=>parseOutput('{invalid'));negative.push({name:'malformed output',result:'rejected by experiment transport validator'});
const incompleteOutput={...outputs.base};delete incompleteOutput.cpu_instructions_consumed;assert.throws(()=>parseOutput(JSON.stringify(incompleteOutput)),/Invalid or missing/);negative.push({name:'missing measured output field',result:'rejected by experiment transport validator'});
function reject(name,input,expected){const r=invoke(input);assert.notEqual(r.status,0,`${name} should fail`);assert.equal(r.stdout,'');assert.match(r.stderr,expected);negative.push({name,status:r.status,error:r.stderr.trim()});}
reject('malformed input','{invalid',/key must|expected|EOF|invalid/);
reject('missing config',{...baseInput,entries:baseInput.entries.filter(row=>xdr.LedgerKey.fromXDR(row.key,'base64').switch().name!=='configSetting')},/UNCAPTURED_KEY|network configuration/);
reject('uncaptured contract state',{...baseInput,entries:baseInput.entries.filter(row=>!['contractCode','contractData'].includes(xdr.LedgerKey.fromXDR(row.key,'base64').switch().name))},/UNCAPTURED_KEY/);
const header=xdr.LedgerHeader.fromXDR(baseInput.header_xdr,'base64');header.ledgerVersion(27);reject('protocol mismatch',{...baseInput,header_xdr:header.toXDR('base64')},/unsupported protocol 27/);
const badFunction=xdr.HostFunction.fromXDR(baseInput.host_function_xdr,'base64');badFunction.invokeContract().functionName('missing');reject('failed invocation',{...baseInput,host_function_xdr:badFunction.toXDR('base64')},/host invocation failed/);
reject('malformed seed',{...baseInput,seed:[0]},/32 bytes/);
// Test the current consumer boundary honestly: partial real results cannot be
// passed to the 11-metric comparison schema without fabricating missing values.
function partial(label){const p=provenance[label],o=outputs[label];return [{schema_version:2,fixture_id:p.fixture_id,logical_id:p.logical_id,contract_id:p.contract_id,git_commit:`temporary-${label}`,soroban_sdk_version:'25.3.1',timestamp:0,benchmarks:[{function_name:p.function_name,case_id:p.case_id,wasm_sha256:p.wasm_sha256,metrics:{cpu_instructions:{consumed:o.cpu_instructions_consumed,limit:o.cpu_limit},memory_bytes:{consumed:o.memory_bytes_consumed,limit:o.memory_limit}}}]}];}
let adapterError;try{diffBenchmarks(partial('base'),partial('head'));}catch(error){adapterError=error.message;}assert.ok(adapterError,'Current full-schema diff should reject partial measurements');
// The threshold evaluator accepts metric diffs. Feed it the genuine measured
// compute delta; this proves threshold evaluation only, not integrated diff/CI.
const cpuMetric={key:'cpu_instructions',base:{consumed:outputs.base.cpu_instructions_consumed,limit:outputs.base.cpu_limit},head:{consumed:outputs.head.cpu_instructions_consumed,limit:outputs.head.cpu_limit},delta:cpuDelta,pct:cpuDelta/outputs.base.cpu_instructions_consumed*100,regression:true};
const partialDiff={contracts:[{fixture_id:provenance.head.fixture_id,logical_id:provenance.head.logical_id,contract_id:provenance.head.contract_id,base_contract_id:provenance.base.contract_id,head_contract_id:provenance.head.contract_id,functions:[{function_name:'hello',case_id:provenance.head.case_id,metrics:[cpuMetric],hasRegression:true}],hasRegression:true,newFunctions:[],removedFunctions:[],newBenchmarks:[],removedBenchmarks:[]}],hasRegression:true,newContracts:[],removedContracts:[]};
const violations=enforceThresholds(partialDiff,{thresholds:{functions:{hello:{cpu_instructions:'strict_zero_tolerance'}}}});assert.equal(violations.length,1);assert.equal(violations[0].delta,cpuDelta);write('threshold-diff-input',partialDiff);write('threshold-violations',violations);
write('repeatability',repeats);write('negative-cases',negative);write('provenance',provenance);
const summary={status:'COMPUTE_SOURCE_FEASIBLE',rpc_xdr_parity:true,repeatability_runs_per_revision:5,leeway_independent_consumption:true,cpu:{base:outputs.base.cpu_instructions_consumed,head:outputs.head.cpu_instructions_consumed,delta:cpuDelta,pct:cpuMetric.pct},memory:{base:outputs.base.memory_bytes_consumed,head:outputs.head.memory_bytes_consumed,delta:memDelta},logical_identity_stable:true,wasm_and_runtime_address_changed:true,threshold_evaluator_violations:violations.length,negative_cases:negative.length,production_measurement_integrated:false,existing_diff_integration:false,existing_diff_adapter_error:adapterError,ci_failure_proven:false};write('verification',summary);console.log(JSON.stringify(summary,null,2));
