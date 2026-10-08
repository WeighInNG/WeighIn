// Stage 4B live smoke/repeatability check. Existing verified WASMs are reused;
// RPC, deployment, native execution and comparison are real, with no IO injection.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {rpc,Asset,Address,Operation,Keypair,TransactionBuilder,xdr}=require('@stellar/stellar-sdk');
const root=path.resolve(__dirname,'../..'),destination=path.resolve(process.argv[2]||'/tmp/weighin-snapshot-recovery');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-stage4b-'));
const endpoint=process.env.WEIGHIN_EXPERIMENT_RPC_URL||'http://localhost:18000/rpc';
const passphrase='Standalone Network ; February 2017';
const helper=path.join(root,'native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const hash=data=>createHash('sha256').update(data).digest('hex');
fs.mkdirSync(destination,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(destination,name),JSON.stringify(value,null,2)+'\n');
const calls=[],native=[],warnings=[];
const fetchOriginal=globalThis.fetch,execOriginal=cp.execFile,warnOriginal=console.warn;
globalThis.fetch=async(...args)=>{
  const response=await fetchOriginal(...args);
  if(args[1]?.method==='POST'){
    calls.push({request:JSON.parse(args[1].body),raw:await response.clone().json()});write('rpc.json',calls);
  }return response;
};
console.warn=(...args)=>{warnings.push(args.join(' '));write('warnings.json',warnings);warnOriginal(...args);};
cp.execFile=function(file,args,options,callback){
  if(file!==helper)return execOriginal.apply(this,arguments);
  let input;
  const child=execOriginal(file,args,options,(error,stdout,stderr)=>{
    native.push({input,output:error?null:JSON.parse(stdout),error:error?stderr:null});write('native.json',native);
    callback(error,stdout,stderr);
  });
  const end=child.stdin.end.bind(child.stdin);
  child.stdin.end=function(data,...rest){input=JSON.parse(data);return end(data,...rest);};return child;
};
const {runMeasurement}=require('../../dist/measurement');
const {diffBenchmarks}=require('../../dist/diff');
const {enforceThresholds}=require('../../dist/threshold');
async function main(){
  const server=new rpc.Server(endpoint,{allowHttp:true});
  for(let attempt=0;attempt<60;attempt++){
    try{if((await server.getHealth()).status==='healthy')break;}catch{}
    if(attempt===59)throw new Error('RPC not healthy');await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const network=await server.getNetwork();assert.equal(network.protocolVersion,28);assert.equal(network.passphrase,passphrase);
  const stage4=path.join(root,'docs/experiments/repeatability/completed');
  const stage4Environment=JSON.parse(fs.readFileSync(path.join(stage4,'environment.json')));
  const referenceWasm=fs.readFileSync(path.join(stage4,'run-1-reference.wasm'));
  const auditWasm=fs.readFileSync(path.join(stage4,'audit.wasm'));
  assert.equal(hash(referenceWasm),JSON.parse(fs.readFileSync(path.join(stage4,'runs.json')))[0].reference_build.wasm_sha256);
  assert.equal(hash(auditWasm),stage4Environment.audit_wasm_sha256);
  for(const [name,bytes]of [['reference.wasm',referenceWasm],['audit.wasm',auditWasm]]){
    fs.writeFileSync(path.join(temporary,name),bytes);fs.writeFileSync(path.join(destination,name),bytes);
  }
  const publicKey=Keypair.random(),keyFile=path.join(temporary,'deployer.key');
  fs.writeFileSync(keyFile,publicKey.secret(),{mode:0o600});
  const funding=[];
  for(let i=0;i<10;i++){
    const result=await fetch(`${endpoint.replace(/\/rpc$/,'')}/friendbot?addr=${publicKey.publicKey()}`,{signal:AbortSignal.timeout(15000)});
    funding.push({status:result.status,body:await result.text()});write('funding.json',funding);
    if(result.ok)break;
    if(![429,500,502,503,504].includes(result.status)||i===9)throw new Error(`Funding failed: HTTP ${result.status}`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const assetId=Asset.native().contractId(passphrase);
  const instance=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:Address.fromString(assetId).toScAddress(),
    key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));
  const preexisting=(await server.getLedgerEntries(instance)).entries.length>0;
  if(!preexisting){
    const tx=new TransactionBuilder(await server.getAccount(publicKey.publicKey()),{fee:'1000000',networkPassphrase:passphrase})
      .addOperation(Operation.createStellarAssetContract({asset:Asset.native()})).setTimeout(30).build();
    const prepared=await server.prepareTransaction(tx);prepared.sign(publicKey);const sent=await server.sendTransaction(prepared);
    for(let i=0;i<30;i++){
      const result=await server.getTransaction(sent.hash);
      if(result.status!=='NOT_FOUND'){assert.equal(result.status,'SUCCESS',JSON.stringify(result));break;}
      if(i===29)throw new Error('SAC deployment timed out');await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  const reference=JSON.parse(fs.readFileSync(path.join(stage4,'source/weighin-fixtures.json')));
  reference.contracts[0].wasm_path='reference.wasm';
  const audit=JSON.parse(fs.readFileSync(path.join(stage4,'audit-fixtures.json')));
  audit.contracts[0].wasm_path='audit.wasm';
  for(const invocation of audit.contracts[0].invocations){invocation.args[1].value=assetId;invocation.args[2].value=publicKey.publicKey();}
  for(const [name,fixture]of [['reference-fixtures.json',reference],['audit-fixtures.json',audit]]){
    fs.writeFileSync(path.join(temporary,name),JSON.stringify(fixture));write(name,fixture);
  }
  write('environment.json',{repository_sha:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    dirty_worktree_snapshot:true,node:process.version,network,rpc_version:await server.getVersionInfo(),
    helper_sha256:hash(fs.readFileSync(helper)),simulation_source_sha256:hash(fs.readFileSync(path.join(root,'src/simulation.ts'))),
    reference_wasm_sha256:hash(referenceWasm),audit_wasm_sha256:hash(auditWasm),wasms_reused_no_new_build_claim:true,
    sac_preexisting:preexisting,public_ci_proven:false,io_observers_only_no_injected_responses:true});
  const runs=[],diffs=[],violations=[];
  for(let run=1;run<=5;run++){
    const measurements=[];
    for(const name of ['reference-fixtures.json','audit-fixtures.json'])measurements.push(...await runMeasurement({
      fixturesPath:path.join(temporary,name),keyFile,rpcUrl:endpoint,helperPath:helper,sdkVersion:'28.0.0',gitCommit:'stage4b-worktree-snapshot'}));
    runs.push(measurements);write('runs.json',runs);
    const diff=diffBenchmarks(runs[0],measurements);diffs.push(diff);write('diffs.json',diffs);
    const policy={thresholds:{global:{fail_on_any_regression:true},functions:Object.fromEntries(['hello','bench'].map(name=>[name,
      {historical_data_read_bytes:'ignore',contract_data_hard_limit:'ignore',tx_size_bytes:'ignore'}]))}};
    violations.push(enforceThresholds(diff,policy));write('violations.json',violations);write('policy.json',policy);
    assert.equal(violations.at(-1).length,0);
    for(let i=0;i<measurements.length;i++)for(let j=0;j<measurements[i].benchmarks.length;j++){
      const benchmark=measurements[i].benchmarks[j],baseline=runs[0][i].benchmarks[j];
      for(const name of Object.keys(benchmark.metrics))assert.equal(benchmark.metrics[name].consumed,baseline.metrics[name].consumed);
      const replay=native.find(row=>hash(JSON.stringify(row.input))===benchmark.provenance.input_sha256);
      assert.ok(replay?.output);
      assert.ok(calls.some(call=>call.request.method==='simulateTransaction'&&call.raw.result?.latestLedger===benchmark.provenance.ledger
        &&call.raw.result?.transactionData===replay.output.transaction_data_xdr&&call.raw.result?.results?.[0]?.xdr===replay.output.retval_xdr));
    }
    console.log(`Live cycle ${run}/5: seven genuine measurements, stable metrics and zero policy violations`);
  }
  const observed=calls.filter(call=>call.request.method==='getLedgerEntries'&&call.raw.error?.code===-32603
    &&call.raw.error?.message==='could not query captive core: http request failed with non-200 status code (404)').length;
  write('warnings.json',warnings);
  write('verification.json',{status:'LIVE_CAPTURE_PASS',cycles:5,measurement_count:35,all_supported_metrics_stable:true,
    policy_violations:0,observed_genuine_transient_read_errors:observed,retry_warnings:warnings.length,
    automatic_recovery_observed_live:observed>0,controlled_error_tests_are_separate:true,no_io_substitution:true,
    wasms_reused:true,public_ci_proven:false});
}
main().catch(error=>{write('failure.json',{message:error.message,stack:error.stack});console.error(error);process.exitCode=1;});
