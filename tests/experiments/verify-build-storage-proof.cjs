// Recheck retained real Action runs, deployed code, RPC/native parity and policy.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{xdr}=require('@stellar/stellar-sdk');
const {enforceThresholds}=require('../../dist/threshold');
const root=path.resolve(__dirname,'../..'),dir=path.resolve(process.argv[2]||path.join(root,'docs/experiments/build-storage-safeguard'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file)));
const executions=read('execution.json');assert.equal(executions.length,7);
const rows=[];let referenceMetrics,referenceEnvironment,referenceConfig;
const dynamicConfigurationChanges=[];
for(const execution of executions){
 const label=execution.label,proof=read(`${label}/verification.json`),diff=read(`${label}/diff.json`),run=read(`${label}/process.json`);
 const expected=execution.scenario==='threshold'?1:0;
 assert.equal(proof.status,'VERIFIED');assert.equal(proof.engine_sha,'2185c603312df25b87b80f825f8495befe10894e');
 assert.equal(proof.bundle_sha256,'104be8ef72ebc176986f577a4479d040be7684f4e1a9f5a4e0928eeee32591a0');
 assert.equal(execution.exit,expected);assert.equal(run.status,expected);assert.equal(proof.action_exit,expected);
 assert.deepEqual(diff.newContracts,[]);assert.deepEqual(diff.removedContracts,[]);assert.equal(diff.contracts.length,1);
 const contract=diff.contracts[0],fn=contract.functions[0];assert.equal(contract.functions.length,1);
 assert.deepEqual(contract.newBenchmarks,[]);assert.deepEqual(contract.removedBenchmarks,[]);
 const native=read(`${label}/native.json`),rpc=read(`${label}/rpc.json`),returns=[];
 const values=fn.metrics.filter(m=>m.availability==='comparable');assert.equal(values.length,8);
 for(const side of ['base','head']){
  const p=fn[`${side}_provenance`],sample=native.find(r=>r.output&&hash(JSON.stringify(r.input))===p.input_sha256);assert.ok(sample);
  const env=Object.fromEntries(['source_version','protocol','helper_sha256','network_id','resource_limits_sha256','compute_config_sha256','seed','auth_mode','host_features'].map(k=>[k,p[k]]));
  if(referenceEnvironment)assert.deepEqual(env,referenceEnvironment);else referenceEnvironment=env;
  const settings=new Map(sample.input.entries.filter(e=>e.xdr).map(e=>xdr.LedgerEntryData.fromXDR(e.xdr,'base64')).filter(e=>e.switch().name==='configSetting').map(e=>[e.configSetting().switch().name,e.configSetting().toXDR('base64')]));
  if(referenceConfig){
   assert.deepEqual([...settings.keys()].sort(),[...referenceConfig.keys()].sort());
   for(const [name,value]of settings)if(value!==referenceConfig.get(name)){
    assert.equal(name,'configSettingLiveSorobanStateSizeWindow','Unexpected network setting changed');
    dynamicConfigurationChanges.push({label,side,setting:name});
   }
  }else referenceConfig=settings;
  const wasm=fs.readFileSync(path.join(dir,label,`${side}.wasm`));
  assert.ok(sample.input.entries.some(entry=>{if(!entry.xdr)return false;const e=xdr.LedgerEntryData.fromXDR(entry.xdr,'base64');return e.switch().name==='contractCode'&&hash(e.contractCode().code())===hash(wasm);}));
  assert.equal(values.find(m=>m.key==='cpu_instructions')[side].consumed,sample.output.cpu_instructions_consumed);
  assert.ok(rpc.some(c=>c.request.method==='simulateTransaction'&&c.raw.result?.latestLedger===p.ledger&&c.raw.result?.transactionData===sample.output.transaction_data_xdr&&c.raw.result?.results?.[0]?.xdr===sample.output.retval_xdr));
  returns.push(sample.output.retval_xdr);
 }
 assert.equal(returns[0],returns[1]);
 for(const m of values)assert.equal(m.delta,m.head.consumed-m.base.consumed);
 const cpu=values.find(m=>m.key==='cpu_instructions');assert.equal(cpu.base.consumed,565371);
 if(execution.scenario==='control'){
  assert.equal(hash(fs.readFileSync(path.join(dir,label,'base.wasm'))),'103874c717632bb9b51d3ff6effc9869433fcbdf8e3c719c927eb7b6aa14f398');
  assert.equal(hash(fs.readFileSync(path.join(dir,label,'base.wasm'))),hash(fs.readFileSync(path.join(dir,label,'head.wasm'))));
  assert.ok(values.every(m=>m.delta===0));const metrics=values.map(m=>[m.key,m.base.consumed]);
  if(referenceMetrics)assert.deepEqual(metrics,referenceMetrics);else referenceMetrics=metrics;
 }else{
  assert.equal(cpu.head.consumed,679455);assert.equal(cpu.delta,114084);
  assert.notEqual(contract.base_contract_id,contract.head_contract_id);
  assert.notEqual(hash(fs.readFileSync(path.join(dir,label,'base.wasm'))),hash(fs.readFileSync(path.join(dir,label,'head.wasm'))));
 }
 const config=execution.scenario==='regression'?{}:{thresholds:{functions:{escrows_for_participant:{cpu_instructions:'strict_zero_tolerance'}}}};
 assert.equal(enforceThresholds(diff,config).length,expected);
 for(const [file,expectedHash] of Object.entries(read(`${label}/sha256.json`)))assert.equal(hash(fs.readFileSync(path.join(dir,label,file))),expectedHash,`${label}/${file}`);
 rows.push({label,cpu:{base:cpu.base.consumed,head:cpu.head.consumed,delta:cpu.delta},action_exit:run.status});
}
assert.equal(executions.filter(row=>row.scenario==='control').length,5);
if(fs.existsSync(path.join(dir,'sha256.json')))for(const [file,expectedHash]of Object.entries(read('sha256.json')))assert.equal(hash(fs.readFileSync(path.join(dir,file))),expectedHash,file);
console.log(JSON.stringify({status:'VERIFIED',five_real_action_controls:true,changed_wasm_compared:true,actual_threshold_exit:1,raw_rpc_native_parity:true,matched_compute_and_resource_settings:true,dynamic_configuration_changes:dynamicConfigurationChanges,cargo_cache_reused:true,cold_builds_proven:false,rows},null,2));
