const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const cli=path.resolve(__dirname,'..',require('../package.json').bin.weighin),RPC='http://127.0.0.1:9/rpc';
// Runs the declared bin in an empty directory. Valid usage stops at the missing fixtures read, before any RPC request.
// In JSON stdout mode the progress lines move to stderr and stdout must stay empty.
function run(args){
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'weighin-cli-args-'));
  try{
    const r=spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:10000});assert.ifError(r.error);
    return {status:r.status,stdout:r.stdout,stderr:r.stderr,files:fs.readdirSync(cwd)};
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
const field=(stdout,name)=>(stdout.match(new RegExp(`^${name}:\\s+(.*)$`,'m'))||[])[1];
function assertChosen(args,fixtures,output,rpc){
  const r=run(args),label=JSON.stringify(args),log=output==='stdout'?r.stderr:r.stdout;
  assert.deepEqual({fixtures:field(log,'Fixtures'),output:field(log,'Output'),rpc:field(log,'RPC URL')},{fixtures,output,rpc},label);
  if(output==='stdout')assert.equal(r.stdout,'',label);
  assert.equal(r.status,1,label);assert.match(r.stderr,/Benchmarking failed/,label);
  assert.ok(r.stderr.includes(`ENOENT: no such file or directory, open '${fixtures}'`),label);assert.deepEqual(r.files,[],label);
}
function assertRejected(args,diagnostic){
  const r=run(args),label=JSON.stringify(args),lines=r.stderr.trimEnd().split('\n');
  assert.equal(r.status,2,label);assert.equal(r.stdout,'',label);assert.equal(lines.length,2,label);
  assert.match(lines[0],diagnostic,label);assert.match(lines[1],/^Usage: weighin /,label);assert.deepEqual(r.files,[],label);
}
// JSON stdout mode plus an output file keeps the exit code and message of the stdout mode's own check.
function assertAmbiguous(args){
  const r=run(args),label=JSON.stringify(args);
  assert.equal(r.status,1,label);assert.equal(r.stdout,'',label);assert.deepEqual(r.files,[],label);
  assert.equal(r.stderr,'Ambiguous output configuration: cannot specify both JSON stdout mode and an output file path\n',label);
}
test('existing CLI usage keeps its defaults and positional fixtures',()=>{
  assertChosen([],'weighin-fixtures.json','weighin-results.json','http://localhost:8000/rpc');
  assertChosen(['fx.json'],'fx.json','weighin-results.json','http://localhost:8000/rpc');
  assertChosen(['fx.json','out.json'],'fx.json','out.json','http://localhost:8000/rpc');
  assertChosen(['fx.json','--rpc-url',RPC,'--output','out.json'],'fx.json','out.json',RPC);
});
test('explicit default-named fixture followed by legacy output keeps both paths',()=>{
  assertChosen(['weighin-fixtures.json','out.json'],'weighin-fixtures.json','out.json','http://localhost:8000/rpc');
  assertChosen(['weighin-fixtures.json','out.json','--rpc-url',RPC],'weighin-fixtures.json','out.json',RPC);
});
test('supported option orderings choose the same fixture, output and RPC paths',()=>{
  for(const args of [
    ['fx.json','--rpc-url',RPC,'--output','out.json'],['--output','out.json','--rpc-url',RPC,'fx.json'],
    ['--rpc-url',RPC,'fx.json','--output','out.json'],['fx.json','out.json','--rpc-url',RPC],
    ['--rpc-url',RPC,'fx.json','out.json'],['--rpc-url',RPC,'--','fx.json','out.json'],
  ])assertChosen(args,'fx.json','out.json',RPC);
});
test('end-of-options marker and single-dash values allow paths that begin with a dash',()=>{
  assertChosen(['--output','out.json','--','-fx.json'],'-fx.json','out.json','http://localhost:8000/rpc');
  assertChosen(['--','-fx.json','--out.json'],'-fx.json','--out.json','http://localhost:8000/rpc');
  assertChosen(['fx.json','--output','-out.json'],'fx.json','-out.json','http://localhost:8000/rpc');
});
test('JSON stdout forms still select stdout, and stdout plus an output file keeps exit 1',()=>{
  for(const args of [
    ['fx.json','--stdout'],['--json-stdout','fx.json'],['fx.json','-'],
    ['--output','-','fx.json'],['--rpc-url',RPC,'--','fx.json','-'],
  ])assertChosen(args,'fx.json','stdout',args.includes(RPC)?RPC:'http://localhost:8000/rpc');
  assertAmbiguous(['--json-stdout','fx.json','out.json']);
  assertAmbiguous(['fx.json','--stdout','--output','out.json']);
});
test('invalid usage exits 2 with a usage diagnostic before Git, fixture, RPC or helper side effects',()=>{
  assertRejected(['weighin-fixtures.json','out.json','--bogus'],/^weighin: unknown option --bogus$/);
  assertRejected(['-x','fx.json'],/^weighin: unknown option -x$/);
  assertRejected(['fx.json','--output=out.json'],/^weighin: unknown option --output=out\.json$/);
  assertRejected(['fx.json','--output'],/^weighin: option --output requires a value$/);
  assertRejected(['fx.json','--rpc-url'],/^weighin: option --rpc-url requires a value$/);
  assertRejected(['fx.json','--output','--rpc-url',RPC],/^weighin: option --output requires a value$/);
  assertRejected(['--rpc-url','--','fx.json'],/^weighin: option --rpc-url requires a value$/);
  assertRejected(['fx.json','--output',''],/^weighin: option --output requires a value$/);
  assertRejected(['fx.json','--output','a.json','--output','b.json'],/^weighin: duplicate option --output$/);
  assertRejected(['--rpc-url',RPC,'fx.json','--rpc-url',RPC],/^weighin: duplicate option --rpc-url$/);
  assertRejected(['fx.json','out.json','extra.json'],/^weighin: unexpected extra argument extra\.json$/);
  assertRejected(['--','fx.json','out.json','--output'],/^weighin: unexpected extra argument --output$/);
  assertRejected(['fx.json','out.json','--output','other.json'],/^weighin: output path given both as a positional argument and with --output$/);
  assertRejected(['--output','other.json','fx.json','out.json'],/^weighin: output path given both as a positional argument and with --output$/);
  assertRejected([''],/^weighin: path arguments must not be empty$/);
  assertRejected(['fx.json','--stdout','--stdout'],/^weighin: duplicate option --stdout$/);
  assertRejected(['fx.json','--stdout','--json-stdout'],/^weighin: duplicate option --json-stdout$/);
  assertRejected(['fx.json','-','--output','out.json'],/^weighin: output path given both as a positional argument and with --output$/);
});
