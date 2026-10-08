exec(open('/home/mxr/Documents/localRepo/Weighin/.stage6b-work/run-optimizer.py').read().split('records=[]')[0])
records=[]
for mode in ['system-temp','workspace-temp']:
 for run in range(1,6):
  out=work/f'temp-{mode}-{run}.wasm';env=dict(os.environ)
  env.pop('TMPDIR',None);env.pop('BINARYEN_CORES',None)
  if mode=='workspace-temp':env['TMPDIR']=str(work)
  cmd=[str(root/'.stage6-cli/stellar'),'contract','optimize','--wasm',str(raw),'--wasm-out',str(out)]
  p=subprocess.run(cmd,env=env,cwd=work,capture_output=True,text=True)
  (work/f'temp-{mode}-{run}.log').write_text(p.stdout+p.stderr)
  rec={'mode':mode,'run':run,'command':cmd,'TMPDIR':env.get('TMPDIR'),'exit':p.returncode}
  if p.returncode==0:rec.update(sha256=hashlib.sha256(out.read_bytes()).hexdigest(),bytes=out.stat().st_size)
  records.append(rec);(work/'temp-results.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(rec),flush=True)
  if p.returncode:raise SystemExit(p.returncode)
