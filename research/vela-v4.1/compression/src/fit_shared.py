import os
os.environ['OPENBLAS_NUM_THREADS']='6'
from common import *
import time
import sys
q=int(sys.argv[1]) if len(sys.argv)>1 else 4
prefix=f'fit_q{q}_' if q!=4 else ''
def save(name,value):np.save(ROOT/('data/'+prefix+name),value)
rng=np.random.default_rng(27092701);start=time.perf_counter();base,tiers=read_tables()
t=np.load(ROOT/'data/time_basis.npy')[:,:q];a=np.load(ROOT/f'data/low_q{q}.npy')
def low(rows):return np.einsum('iq,icq->ic',t[np.asarray(rows)//X],a[np.asarray(rows)%X],optimize=True)
# All hand multisets are represented, including repeated copies. No class-number ordering assumption.
rows=np.array([r*X+b*P+p for r in range(49) for b in range(2) for p in rng.choice(np.arange(1,P),8,replace=False)])
v=values(tiers,rows,np.arange(80730));v-=low(rows)@PAIR_FEATURE.T
v[:,:276]=0
print('basis data',v.shape,'seconds',time.perf_counter()-start,flush=True)
gram=v@v.T;ev,u=np.linalg.eigh(gram);ix=np.argsort(ev)[::-1][:64];ev=ev[ix];u=u[:,ix]
phi=(u.T@v).T/np.sqrt(ev)[None,:]*np.sqrt(80730)
phi=phi.astype(np.float32);save('hand_phi.npy',phi)
write_json(f'results/{prefix}shared_basis.json',dict(rows=rows.tolist(),eigenvalues=ev.tolist(),residual_stats=stats(v),method=f'sampled-row residual SVD; all 80730 hand multisets; multiplicities retained; q{q} anchored reconstruction subtracted'))
del v,gram,u
train=np.concatenate([rng.choice(np.arange(FIRST[n],FIRST[n+1]),count,False) for n,count in [(3,96),(4,256),(5,672)]])
validate=np.concatenate([rng.choice(np.setdiff1d(np.arange(FIRST[n],FIRST[n+1]),train),count,False) for n,count in [(3,64),(4,128),(5,320)]])
np.savez(ROOT/('data/'+prefix+'hand_fit_split.npz'),train=train,validate=validate,basis_rows=rows)
pinv=np.linalg.pinv(phi[train].astype(np.float64),rcond=1e-7).astype(np.float32)
coeff=np.empty((49*X,64),np.float32)
for lo in range(0,49*X,256):
    rr=np.arange(lo,min(49*X,lo+256));res=values(tiers,rr,train)-low(rr)@PAIR_FEATURE[train].T
    coeff[rr]=res@pinv.T
    if lo%32768==0:print('fit rows',lo,'/',49*X,'seconds',time.perf_counter()-start,flush=True)
save('g_coeff_direct.npy',coeff.reshape(49,X,64))
# Shared time basis for high residual; retain position and bonus resolution.
mat=coeff.reshape(49,-1);ev,tg=np.linalg.eigh(mat.astype(np.float64)@mat.astype(np.float64).T);ix=np.argsort(ev)[::-1];tg=tg[:,ix]
save('g_time.npy',tg.astype(np.float32))
report={'time_eigenvalues':ev[ix].tolist(),'time_ranks':{},'seconds':time.perf_counter()-start}
for q in [2,4,8,12,16]:
    ag=(tg[:,:q].T@mat).reshape(q,X,64).transpose(1,2,0).astype(np.float32);save(f'g_q{q}.npy',ag)
    report['time_ranks'][str(q)]=stats(np.einsum('rq,xkq->rxk',tg[:,:q],ag,optimize=True)-coeff.reshape(49,X,64))
write_json(f'results/{prefix}shared_fit.json',report)
print('DONE',report['seconds'],flush=True)
