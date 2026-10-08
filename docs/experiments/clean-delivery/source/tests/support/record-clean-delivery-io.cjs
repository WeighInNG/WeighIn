// Forwarding observers only. The helper path is recorded, never overridden.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const directory=process.env.WEIGHIN_CLEAN_CAPTURE,calls=[],native=[];
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2)+'\n');
const fetchOriginal=globalThis.fetch;
globalThis.fetch=async(...args)=>{const r=await fetchOriginal(...args);calls.push({url:String(args[0]),
  request:args[1]?.body?JSON.parse(args[1].body):null,status:r.status,body:await r.clone().text()});write('http.json',calls);return r;};
const execOriginal=cp.execFile;
cp.execFile=function(file,args,options,callback){
  if(path.basename(file)!=='weighin-simulation')return execOriginal.apply(this,arguments);
  let input;const child=execOriginal(file,args,options,(error,stdout,stderr)=>{
    native.push({file,input,output:error?null:JSON.parse(stdout),error:error?stderr:null});write('native.json',native);callback(error,stdout,stderr);});
  const end=child.stdin.end.bind(child.stdin);child.stdin.end=function(data,...rest){input=JSON.parse(data);return end(data,...rest);};return child;
};
