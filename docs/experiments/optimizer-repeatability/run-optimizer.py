import hashlib,json,os,pathlib,subprocess,time
root=pathlib.Path('/home/mxr/Documents/localRepo/Weighin')
work=root/'.stage6b-work'
raw=root/'.stage6-delivery/docs/experiments/external-soroban-forge/provenance-checks/original-unoptimized.wasm'
records=[]
for mode in ['default','1','2','4']:
 for run in range(1,6):
  out=work/f'{mode}-{run}.wasm'
  env=dict(os.environ)
  env.pop('BINARYEN_CORES',None)
  if mode!='default': env['BINARYEN_CORES']=mode
  start=time.monotonic()
  p=subprocess.run([str(root/'.stage6-cli/stellar'),'contract','optimize','--wasm',str(raw),'--wasm-out',str(out)],env=env,cwd=work,capture_output=True,text=True)
  (work/f'{mode}-{run}.log').write_text(p.stdout+p.stderr)
  rec={'mode':mode,'run':run,'exit':p.returncode,'elapsed_seconds':round(time.monotonic()-start,3),'input_sha256':hashlib.sha256(raw.read_bytes()).hexdigest()}
  if p.returncode==0: rec.update(sha256=hashlib.sha256(out.read_bytes()).hexdigest(),bytes=out.stat().st_size)
  records.append(rec)
  (work/'results.json').write_text(json.dumps(records,indent=2)+'\n')
  print(json.dumps(rec),flush=True)
  if p.returncode: raise SystemExit(p.returncode)
