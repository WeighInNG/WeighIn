// Forwarding observers only: no SDK/build/checkout/helper response substitution.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const directory=process.env.WEIGHIN_MIGRATION_EVIDENCE,helper=process.env.WEIGHIN_HELPER_PATH;
const calls=[],native=[];
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
const fetchOriginal=globalThis.fetch;
globalThis.fetch=async(...args)=>{
  const response=await fetchOriginal(...args);
  if(args[1]?.method==='POST'){
    calls.push({request:JSON.parse(args[1].body),raw:await response.clone().json()});write('rpc.json',calls);
  }return response;
};
const execOriginal=cp.execFile;
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
