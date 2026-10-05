"""一次固定的 learner-behavior 采集、三个 hinge epoch、混合 episode 选择。"""
from pathlib import Path
import os,sys,csv,json,subprocess,time,hashlib
R=Path(__file__).resolve().parent;W=R.parents[2]
from quant_balance import read_model
env=os.environ.copy();env['PATH']='C:/msys64/ucrt64/bin;'+env.get('PATH','')
exe=R/'src/action_train/study_student.exe';full=R.parent/'full100/model/full100'
model=R/'models/unified_k256_t16_balanced.bin'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rel(p):return str(p.relative_to(W))
def run(label,args):
 done=R/'results'/f'{label}_done.json'
 if done.exists():return
 start=time.time()
 with (R/'logs'/f'{label}.stdout.log').open('x') as so,(R/'logs'/f'{label}.stderr.log').open('x') as se:
  subprocess.run([str(exe)]+[str(x) for x in args],cwd=W,env=env,stdout=so,stderr=se,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
 done.write_text(json.dumps({'label':label,'args':[str(x) for x in args],'seconds':time.time()-start,'exe_sha256':sha(exe)},indent=2))
def main():
 gs=float(read_model(model)['gs']);trust=8*gs
 config={'model':rel(model),'model_sha256':sha(model),'executable_sha256':sha(exe),'train_seed':3520000000,'validation_seed':3520100000,'student_train_games':512,'student_validation_games':128,'epochs':3,'rate':.05,'trust_absolute':trust,'anchor':.005,'selection':'equal-source equal-episode validation teacher Q2 regret; epoch0 always included','same_seed_rollouts':'correlated trajectories, not additional independent seeds','score_data_used':False}
 protocol=R/'ACTION_REFINEMENT.json'
 if protocol.exists():assert json.loads(protocol.read_text())==config
 else:protocol.write_text(json.dumps(config,indent=2))
 replay=R/'data/q_teacher_replay8.csv'
 run('teacher_replay8',['collect',rel(full),8,3520000000,12,8,rel(replay)])
 original=list(csv.DictReader((R/'data/q_train.csv').open()));replayed=list(csv.DictReader(replay.open()))
 assert replayed==[x for x in original if int(x['episode'])<8]
 for part,n,seed in [('train',512,3520000000),('validation',128,3520100000)]:
  out=R/'data'/f'q_student_{part}.csv'
  run('student_'+part,['collect_student',rel(full),rel(model),n,seed,12,8,rel(out)])
 train=R/'data/q_train_mixed.csv'
 if not train.exists():
  with train.open('x',newline='') as f:
   writer=None
   for source in ['teacher','student']:
    path=R/'data'/('q_train.csv' if source=='teacher' else 'q_student_train.csv')
    for row in csv.DictReader(path.open()):
     row['rollout_source']=source;row['seed_input']=3520000000+int(row['episode'])
     if writer is None:writer=csv.DictWriter(f,fieldnames=list(row));writer.writeheader()
     writer.writerow(row)
 prefix=R/'models/hinge_k256'
 run('hinge_k256',['train',rel(model),rel(train),rel(R/'data/q_validation.csv'),rel(prefix),3,.05,trust,.005])
 epochs=[]
 for epoch in range(4):
  path=model if epoch==0 else R/'models'/f'hinge_k256_e{epoch}.bin';entry={'epoch':epoch,'model':str(path)}
  for source in ['teacher','student']:
   data=R/'data'/('q_validation.csv' if source=='teacher' else 'q_student_validation.csv');out=R/'results'/f'hinge_k256_e{epoch}_{source}.json'
   run(f'hinge_k256_e{epoch}_{source}',['validate',rel(path),rel(data),rel(out)])
   entry[source]=str(Path(str(out)+'.csv'))
  epochs.append(entry)
 manifest=R/'results/hinge_mixed_manifest.json';manifest.write_text(json.dumps({'seed_base':3520100000,'epochs':epochs},indent=2))
 output=R/'results/hinge_mixed_selection.json'
 if not output.exists():subprocess.run([sys.executable,str(R/'src/action_train/select_mixed.py'),str(manifest),str(output)],cwd=W,env=env,check=True)
 print(output.read_text(),flush=True)
if __name__=='__main__':main()
