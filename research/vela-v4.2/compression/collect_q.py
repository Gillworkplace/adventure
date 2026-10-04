from pathlib import Path
import os,subprocess,json,time,hashlib,csv
R=Path(__file__).resolve().parent;W=R.parents[2]
env=os.environ.copy();env['PATH']='C:/msys64/ucrt64/bin;'+env.get('PATH','')
exe=R/'src/action_train/study.exe';full=R.parent/'full100/model/full100'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for part,n,seed in [('train',512,3520000000),('validation',128,3520100000)]:
 out=R/'data'/f'q_{part}.csv';marker=R/'results'/f'q_{part}_collection.json'
 if marker.exists():
  assert sha(out)==json.loads(marker.read_text())['csv_sha256'];continue
 if out.exists():raise RuntimeError('Unvalidated existing collection: '+str(out))
 start=time.time();cmd=[str(exe), 'collect',str(full.relative_to(W)),str(n),str(seed),'12','8',str(out.relative_to(W))]
 with (R/'logs'/f'collect_{part}.stdout.log').open('x') as so,(R/'logs'/f'collect_{part}.stderr.log').open('x') as se:
  subprocess.run(cmd,cwd=W,env=env,stdout=so,stderr=se,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
 rows=list(csv.DictReader(out.open()));episodes={int(row['episode']) for row in rows};assert max(episodes)<n
 rec={'phase':part,'whole_games':n,'seed_base':seed,'roots':len(rows),'episodes_with_roots':len(episodes),'csv_sha256':sha(out),'executable_sha256':sha(exe),'wall_seconds':time.time()-start,'policy':'FULL100 original Q2','root_stride':8}
 marker.write_text(json.dumps(rec,indent=2));print(json.dumps(rec),flush=True)
