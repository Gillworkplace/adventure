import os
os.environ['OPENBLAS_NUM_THREADS']='6'
from common import *
import time
start=time.perf_counter();base,tiers=read_tables();coef=coefficients(tiers)
mat=coef.reshape(49,-1)
gram=mat.astype(np.float64)@mat.astype(np.float64).T
ev,t=np.linalg.eigh(gram);ix=np.argsort(ev)[::-1];ev=np.maximum(0,ev[ix]);t=t[:,ix]
np.save(ROOT/'data/time_basis.npy',t.astype(np.float32))
np.save(ROOT/'data/base.npy',np.asarray(base))
report={'singular_values':np.sqrt(ev).tolist(),'ranks':{},'source':'cap5 stored FULL48 tiers; all r,b,p,275 coefficients'}
for q in [2,4,6,8,12,16,24,49]:
    a=(t[:,:q].T@mat).reshape(q,X,275).transpose(1,2,0).astype(np.float32)
    rec=np.einsum('rq,xcq->rxc',t[:,:q],a,optimize=True)
    err=rec-coef
    per=np.max(np.abs(err),axis=2)
    report['ranks'][str(q)]={**stats(err),'squared_energy_fraction':float(ev[:q].sum()/ev.sum()),'worst_r_x':list(map(int,np.unravel_index(np.argmax(per),per.shape))),'bytes':int(base.nbytes+a.nbytes+49*q*4)}
    np.save(ROOT/f'data/low_q{q}.npy',a)
    print(q,report['ranks'][str(q)],flush=True)
    write_json('results/low_rank_spectrum.json',report)
report['seconds']=time.perf_counter()-start;write_json('results/low_rank_spectrum.json',report)
