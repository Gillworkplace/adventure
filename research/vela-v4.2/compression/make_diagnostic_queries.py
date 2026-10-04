"""Common teacher queries; separate hand fit, time truncation and quantization."""
import os
os.environ['OPENBLAS_NUM_THREADS']='4'
from pathlib import Path
import sys,json
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'src'))
from common import *
NQ=20000
def summarize(v,ns,rs):
 return {'all':stats(v),'by_hand':{str(n):stats(v[ns==n]) for n in range(1,6)},'by_r':{f'{lo}-{hi}':stats(v[(rs>=lo)&(rs<=hi)]) for lo,hi in [(0,19),(20,39),(40,59),(60,79),(80,100)]}}
def run():
 base,tiers=read_tables();rng=np.random.default_rng(352090777)
 ns=np.repeat(np.arange(1,6),4000);hs=np.array([rng.integers(FIRST[n],FIRST[n+1]) for n in ns]);rs=rng.integers(0,101,NQ);xs=rng.integers(0,X,NQ)
 xs[xs%P==0]+=1
 truth=np.empty(NQ)
 for n in range(1,6):
  ii=ns==n;truth[ii]=tiers[n][rs[ii],xs[ii],hs[ii]-FIRST[n]]/32.
 np.savez(ROOT/'data/value_diagnostic_queries.npz',n=ns,h=hs,r=rs,x=xs,truth=truth)

if __name__=='__main__':run()
