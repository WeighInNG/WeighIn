// Controlled transport tests using real saved schema-4 RPC/native records.
// Injected failures and altered ledgers are not live network evidence.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const cp=require('node:child_process');
const {Transaction,Keypair,xdr}=require('@stellar/stellar-sdk');
const {measureInvocation}=require('../dist/simulation');
const calls=require('../docs/experiments/repeatability/completed/run-1-rpc.json');
const replay=require('../docs/experiments/repeatability/completed/run-1-native.json')[0];
const saved=calls.find(c=>c.request.method==='simulateTransaction'
  &&c.raw.result?.transactionData===replay.output.transaction_data_xdr);
const transient={code:-32603,message:'could not query captive core: http request failed with non-200 status code (404)'};

function scenario(t,options={}){
  const state={simulations:0,reads:0,helpers:[],methods:[],delays:[],warnings:[]};
  const output=structuredClone(replay.output),simulation=structuredClone(saved.raw.result);
  if(options.multibatch){
    const data=xdr.SorobanTransactionData.fromXDR(simulation.transactionData,'base64');
    const extra=Array.from({length:205},(_,i)=>{
      const seed=Buffer.alloc(32);seed.writeUInt32BE(i+1,28);
      return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId:Keypair.fromRawEd25519Seed(seed).xdrPublicKey()}));
    });
    data.resources().footprint().readOnly([...data.resources().footprint().readOnly(),...extra]);
    simulation.transactionData=data.toXDR('base64');output.transaction_data_xdr=simulation.transactionData;
    output.read_only_keys=data.resources().footprint().readOnly().map(k=>k.toXDR('base64'));
  }
  const transaction=new Transaction(saved.request.params.transaction,replay.input.network_passphrase);
  const baseLedger=saved.raw.result.latestLedger;
  const entries=replay.input.entries.filter(row=>row.xdr);
  t.mock.method(console,'warn',message=>state.warnings.push(message));
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{state.delays.push(delay);return setImmediate(callback);});
  t.mock.method(globalThis,'fetch',async(url,fetchOptions)=>{
    const request=JSON.parse(fetchOptions.body);state.methods.push(request.method);
    let result;
    if(request.method==='getNetwork')result={passphrase:replay.input.network_passphrase,protocolVersion:28};
    if(request.method==='simulateTransaction'){
      state.simulations++;result={...simulation,latestLedger:baseLedger+state.simulations-1};
    }
    if(request.method==='getLedgerEntries'){
      state.reads++;
      const ledger=baseLedger+state.simulations-1;
      result={latestLedger:ledger,entries:entries.filter(row=>request.params.keys.includes(row.key)).map(row=>({
        key:row.key,xdr:row.xdr,extXdr:row.extension_xdr,lastModifiedLedgerSeq:ledger,
        ...(row.live_until===null?{}:{liveUntilLedgerSeq:row.live_until})}))};
      if(options.driftFirst&&state.reads===1)result.latestLedger++;
      if(options.driftReads?.includes(state.reads))result.latestLedger++;
      if(options.malformed)result.entries=[{key:'invalid'}];
    }
    if(request.method==='getLedgers'){
      const header=xdr.LedgerHeader.fromXDR(replay.input.header_xdr,'base64');
      header.ledgerSeq(baseLedger+state.simulations-1+(options.headerMismatch?1:0));
      const history=new xdr.LedgerHeaderHistoryEntry({hash:Buffer.alloc(32),header,ext:new xdr.LedgerHeaderHistoryEntryExt(0)});
      result={ledgers:[{sequence:baseLedger+state.simulations-1,headerXdr:history.toXDR('base64')}]};
    }
    const error=options.error?.(request.method,state);
    return {ok:!options.httpFailure,status:options.httpFailure?404:200,json:async()=>error?{error}:{result}};
  });
  t.mock.method(cp,'execFile',(file,args,childOptions,callback)=>{
    assert.equal(file,__filename);
    const stdin=new EventEmitter();stdin.end=data=>{
      state.helpers.push(JSON.parse(data));
      const actual=structuredClone(output);
      if(options.parityMismatch)actual.retval_xdr=xdr.ScVal.scvU32(999).toXDR('base64');
      setImmediate(()=>callback(null,JSON.stringify(actual),''));
    };return {stdin};
  });
  return {state,run:()=>measureInvocation('http://controlled.invalid/rpc',transaction,__filename),baseLedger};
}

test('observed ledger-read failure recovers by re-simulating and returning only the new snapshot',async t=>{
  const {state,run,baseLedger}=scenario(t,{error:(method,s)=>method==='getLedgerEntries'&&s.reads===1?transient:null});
  const result=await run();assert.equal(result.output.cpu_instructions_consumed,replay.output.cpu_instructions_consumed);
  assert.equal(result.provenance.ledger,baseLedger+1);assert.equal(state.simulations,2);
  assert.equal(state.helpers.length,1);assert.deepEqual(state.delays,[250]);assert.equal(state.warnings.length,1);
});
test('three transient read failures recover on the fourth complete capture with bounded delays',async t=>{
  const {state,run}=scenario(t,{error:(method,s)=>method==='getLedgerEntries'&&s.reads<=3?transient:null});
  await run();assert.equal(state.simulations,4);assert.deepEqual(state.delays,[250,500,1000]);
  assert.equal(state.helpers.length,1);
});
test('persistent observed errors exhaust retries and return no successful or zero-valued measurement',async t=>{
  const {state,run}=scenario(t,{error:method=>method==='getLedgerEntries'?transient:null});
  await assert.rejects(run(),/retry limit exhausted.*RPC getLedgerEntries failed/);
  assert.equal(state.reads,4);assert.equal(state.simulations,4);assert.equal(state.helpers.length,0);
  assert.deepEqual(state.delays,[250,500,1000]);
});
test('a failure after a successful first batch discards its rows before the next full capture',async t=>{
  const {state,run,baseLedger}=scenario(t,{multibatch:true,error:(method,s)=>method==='getLedgerEntries'&&s.reads===2?transient:null});
  const result=await run();assert.equal(result.provenance.ledger,baseLedger+1);
  assert.equal(state.simulations,2);assert.equal(state.reads,4);assert.equal(state.helpers.length,1);
  assert.ok(state.helpers[0].entries.length>200);
  for(const entry of state.helpers[0].entries.filter(row=>row.xdr))assert.equal(entry.last_modified,baseLedger+1);
});
test('unrelated RPC codes/messages and HTTP 404 fail immediately without recovery',async t=>{
  for(const options of [
    {error:method=>method==='getLedgerEntries'?{...transient,code:-32602}:null},
    {error:method=>method==='getLedgerEntries'?{...transient,message:'another server failure (404)'}:null},
    {httpFailure:true},
  ]){
    const {state,run}=scenario(t,options);await assert.rejects(run(),/RPC/);
    assert.equal(state.delays.length,0);assert.equal(state.helpers.length,0);t.mock.restoreAll();
  }
});
test('the same error from simulation or ledger-header RPC is not treated as a snapshot-read failure',async t=>{
  for(const method of ['simulateTransaction','getLedgers']){
    const {state,run}=scenario(t,{error:requestMethod=>requestMethod===method?transient:null});
    await assert.rejects(run(),new RegExp(`RPC ${method} failed`));
    assert.equal(state.simulations,1);assert.equal(state.delays.length,0);assert.equal(state.helpers.length,0);t.mock.restoreAll();
  }
});
test('malformed ledger rows, header disagreement and native parity disagreement still fail closed',async t=>{
  for(const options of [{malformed:true},{headerMismatch:true},{parityMismatch:true}]){
    const {state,run}=scenario(t,options);await assert.rejects(run());
    assert.equal(state.simulations,1);assert.equal(state.delays.length,0);t.mock.restoreAll();
  }
});
test('ledger drift still recaptures, and transient failures do not bypass the fresh-ledger guard',async t=>{
  const {state,run,baseLedger}=scenario(t,{driftFirst:true,error:(method,s)=>method==='getLedgerEntries'&&s.reads===2?transient:null});
  const result=await run();assert.equal(result.provenance.ledger,baseLedger+2);
  assert.equal(state.simulations,3);assert.equal(state.helpers.length,1);
});
test('transient errors cannot extend the existing 30-capture budget',async t=>{
  const {state,run}=scenario(t,{driftReads:Array.from({length:29},(_,i)=>i+1),
    error:(method,s)=>method==='getLedgerEntries'&&s.reads===30?transient:null});
  await assert.rejects(run(),/retry limit exhausted/);assert.equal(state.simulations,30);
  assert.equal(state.helpers.length,0);assert.equal(state.delays.length,0);
});
test('recovery does not permit a subsequent native/RPC parity disagreement',async t=>{
  const {state,run}=scenario(t,{parityMismatch:true,
    error:(method,s)=>method==='getLedgerEntries'&&s.reads===1?transient:null});
  await assert.rejects(run(),/Local simulation disagrees with RPC/);
  assert.equal(state.simulations,2);assert.equal(state.helpers.length,1);
});
