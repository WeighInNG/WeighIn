// Controlled responses and virtual time for the startup script subprocess only.
const { xdr } = require('@stellar/stellar-sdk');
const rows=require('../../docs/experiments/fixture-migration/bridge/rpc.json').flatMap(c=>c.raw.result?.entries||[]);
const template=rows.find(e=>{try{return xdr.LedgerEntryData.fromXDR(e.xdr,'base64').switch().name==='account';}catch{return false;}});
let elapsed=0,funded=false;
Date.now=()=>elapsed;
globalThis.setTimeout=(callback,delay,...args)=>{elapsed+=delay;return setImmediate(callback,...args);};
globalThis.fetch=async(url,options)=>{
  const mode=process.env.WEIGHIN_STARTUP_UNIT_MODE;
  if(!options?.method){
    if(mode==='funding-failure')return new Response('warming',{status:503});
    funded=true;return new Response('{}');
  }
  const request=JSON.parse(options.body);
  if(request.method==='getHealth')return new Response(JSON.stringify({result:
    mode==='metadata-only'?{passphrase:'Standalone Network ; February 2017'}:
      {status:mode==='unhealthy'?'starting':'healthy'}}));
  const key=request.params.keys[0],entries=[];
  if(funded){const value=xdr.LedgerEntryData.fromXDR(template.xdr,'base64');
    value.account().accountId(xdr.LedgerKey.fromXDR(key,'base64').account().accountId());entries.push({key,xdr:value.toXDR('base64')});}
  return new Response(JSON.stringify({result:{entries,latestLedger:100}}));
};
