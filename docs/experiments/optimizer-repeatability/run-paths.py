exec(open('/home/mxr/Documents/localRepo/Weighin/.stage6b-work/run-optimizer.py').read().split('records=[]')[0])
records=[]
for inp in ['absolute','relative']:
 for outp in ['absolute','relative']:
  for run in range(1,6):
   name=f'path-{inp}-{outp}-{run}.wasm';out=work/name
   inputarg=str(raw) if inp=='absolute' else os.path.relpath(raw,work)
   outputarg=str(out) if outp=='absolute' else name
   cmd=[str(root/'.stage6-cli/stellar'),'contract','optimize','--wasm',inputarg,'--wasm-out',outputarg]
   p=subprocess.run(cmd,cwd=work,capture_output=True,text=True)
   (work/name.replace('.wasm','.log')).write_text(p.stdout+p.stderr)
   rec={'input_path':inp,'output_path':outp,'run':run,'command':cmd,'exit':p.returncode}
   if p.returncode==0: rec.update(sha256=hashlib.sha256(out.read_bytes()).hexdigest(),bytes=out.stat().st_size)
   records.append(rec);(work/'path-results.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(rec),flush=True)
   if p.returncode:raise SystemExit(p.returncode)
