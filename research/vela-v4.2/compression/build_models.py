"""Joint hand/time compression. All teacher values come from cap5 FULL100."""
import os
os.environ['OPENBLAS_NUM_THREADS']='8'
from pathlib import Path
import sys,json,time,hashlib,struct
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'src'))
from common import *

SEED=352090001
CONFIG={'seed':SEED,'basis_positions_per_r_bonus':8,'training_by_size':{'1':22,'2':253,'3':512,'4':1024,'5':2048},
 'basis_mass_by_size':{'1':.01,'2':.08,'3':.16,'4':.25,'5':.50},
 'singleton_basis_mass_by_size':{'2':.10,'3':.20,'4':.30,'5':.40},
 'ridge_relative':1e-7,'models':{'unified_k192_t24':[192,24],'unified_k256_t16':[256,16],'exact_singleton_k128_t24':[128,24]},
 'teacher':'FULL100 F-B from cap5 original; physical multiplicity patterns retained',
 'method':'joint weighted hand subspace then full-r coefficient time SVD; no separately fitted pair branch',
 'splits':'No game results used. Diagnostic fit and held-out hands are development value data, not final games.'}

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for x in iter(lambda:f.read(8*1024*1024),b''):h.update(x)
 return h.hexdigest()
def atom(path,obj):
 path=Path(path);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(obj,indent=2),encoding='utf8');os.replace(tmp,path)
def fp(f,a):np.asarray(a,'<f4').tofile(f)
def quant(f,a):
 scale=np.float32(np.max(np.abs(a))/32760 if np.any(a) else 1);fp(f,[scale]);np.rint(a/scale).astype('<i2').tofile(f)
def singleton_values(tiers,rows):
 return np.asarray(tiers[1][np.asarray(rows)//X,np.asarray(rows)%X,:],dtype=np.float32)/32
def export(name,base,tiers,phi,gt,ga,anchor):
 out=ROOT/'models'/f'{name}.bin'
 with out.open('xb') as f:
  K=phi.shape[1];TG=gt.shape[1]
  f.write(struct.pack('<8i',0x56435333 if anchor else 0x56435332,100,P,0,K,TG,1 if anchor else 0,0))
  fp(f,base)
  if anchor:np.asarray(tiers[1],dtype='<i2').tofile(f)
  fp(f,[1]) # empty low coefficient quantizer scale (Q=0)
  quant(f,phi);fp(f,gt);quant(f,ga)
 assert out.stat().st_size<100000000
 return {'path':str(out.relative_to(WS)),'bytes':out.stat().st_size,'MiB':out.stat().st_size/2**20,'sha256':digest(out),'K':K,'TG':TG,'exact_singleton':anchor}

def fit(anchor,groups_override=None,tag_override=None):
 start=time.time();tag=tag_override or ('singleton' if anchor else 'unified');rng=np.random.default_rng(SEED+int(anchor));base,tiers=read_tables()
 groups=groups_override or ({'exact_singleton_k128_t24':(128,24)} if anchor else {'unified_k192_t24':(192,24),'unified_k256_t16':(256,16)})
 maxk=max(k for k,t in groups.values());mass=CONFIG['singleton_basis_mass_by_size'] if anchor else CONFIG['basis_mass_by_size']
 rows=np.array([r*X+b*P+p for r in range(101) for b in range(2) for p in rng.choice(np.arange(1,P),8,False)])
 v=values(tiers,rows,np.arange(80730))
 if anchor:v-=singleton_values(tiers,rows)@COUNTS.T
 weights=np.zeros(80730,np.float32)
 for n in range(1,6):weights[FIRST[n]:FIRST[n+1]]=float(mass.get(str(n),0))/(FIRST[n+1]-FIRST[n])*80730
 if anchor:v[:,:23]=0
 sw=np.sqrt(weights);vw=v*sw[None,:]
 eigen,u=np.linalg.eigh(vw@vw.T);ii=np.argsort(eigen)[::-1][:maxk];ev=eigen[ii];u=u[:,ii]
 # Undo the hand weighting after finding the shared subspace.
 phi=(u.T@v).T/np.sqrt(np.maximum(ev,1e-20))[None,:]*np.sqrt(80730)
 phi=phi.astype(np.float32);phi[0]=0
 if anchor:phi[:23]=0
 np.save(ROOT/'data'/f'{tag}_phi.npy',phi)
 atom(ROOT/'results'/f'{tag}_basis.json',{'rows':rows.tolist(),'eigenvalues':ev.tolist(),'seconds':time.time()-start,'weights':mass})
 del v,vw,u
 trains=[]
 for n in range(1 if not anchor else 2,6):
  whole=np.arange(FIRST[n],FIRST[n+1]);count=CONFIG['training_by_size'][str(n)]
  chosen=whole if count>=len(whole) else rng.choice(whole,count,False)
  anchors=[RANK[tuple([c]*n)] for c in range(22)]
  trains.extend(np.union1d(chosen,anchors))
 train=np.array(sorted(set(trains)),dtype=np.int32)
 val=np.concatenate([rng.choice(np.setdiff1d(np.arange(FIRST[n],FIRST[n+1]),train),min(256,len(np.setdiff1d(np.arange(FIRST[n],FIRST[n+1]),train))),False) for n in range(2,6)])
 w=np.zeros(len(train),np.float64)
 for n in range(1,6):
  mask=(train>=FIRST[n])&(train<FIRST[n+1]);w[mask]=float(mass.get(str(n),0))/max(1,sum(mask))
 np.savez(ROOT/'data'/f'{tag}_split.npz',train=train,validation=val,basis_rows=rows)
 maps=[];ks=[]
 for k,t in groups.values():
  ph=phi[train,:k].astype(np.float64);gram=ph.T@(w[:,None]*ph);ridge=CONFIG['ridge_relative']*np.trace(gram)/k
  maps.append(np.linalg.solve(gram+np.eye(k)*ridge,ph.T*w[None,:]).T.astype(np.float32));ks.append(k)
 mapper=np.concatenate(maps,axis=1)
 coeff=np.lib.format.open_memmap(ROOT/'data'/f'{tag}_full_coeff.npy',mode='w+',dtype=np.float32,shape=(101*X,sum(ks)))
 for lo in range(0,101*X,512):
  rr=np.arange(lo,min(101*X,lo+512));vv=values(tiers,rr,train)
  if anchor:vv-=singleton_values(tiers,rr)@COUNTS[train].T
  coeff[rr]=vv@mapper
  if lo%32768==0:
   atom(ROOT/'BUILD_STATUS.json',{'phase':tag+'_fit','rows_done':lo,'rows_total':101*X,'elapsed_seconds':time.time()-start});print(tag,'fit',lo,'/',101*X,'seconds',time.time()-start,flush=True)
 coeff.flush();offset=0;results={}
 for (name,(k,t)) in groups.items():
  mat=np.asarray(coeff[:,offset:offset+k]).reshape(101,-1).astype(np.float64);offset+=k
  eg,gt=np.linalg.eigh(mat@mat.T);ix=np.argsort(eg)[::-1];gt=gt[:,ix[:t]].astype(np.float32)
  ga=(gt.T@mat).reshape(t,X,k).transpose(1,2,0).astype(np.float32)
  np.save(ROOT/'data'/f'{name}_time.npy',gt);np.save(ROOT/'data'/f'{name}_coeff.npy',ga)
  results[name]=export(name,base,tiers,phi[:,:k],gt,ga,anchor)
  results[name]['time_eigenvalues']=eg[ix].tolist();results[name]['build_elapsed_seconds']=time.time()-start
  del mat
 atom(ROOT/'results'/f'{tag}_models.json',results)
 print(json.dumps({'built':list(results),'elapsed_seconds':time.time()-start}),flush=True)
if __name__=='__main__':
 p=ROOT/'BUILD_PROTOCOL.json'
 if not p.exists():atom(p,CONFIG)
 assert json.loads(p.read_text())==CONFIG
 fit(sys.argv[1]=='singleton')
