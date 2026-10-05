from pathlib import Path
from itertools import combinations_with_replacement
import json, numpy as np
ROOT=Path(__file__).resolve().parents[1]
WS=ROOT.parents[2]
FULL=ROOT.parent/'full100/model/full100'
P=2899; X=2*P; R=100
FIRST=np.array([0,1,23,276,2300,14950,80730])
HANDS=[h for n in range(6) for h in combinations_with_replacement(range(22),n)]
RANK={h:i for i,h in enumerate(HANDS)}
COUNTS=np.zeros((80730,22),np.float32)
SUB=np.full((80730,15),-1,np.int32)
for i,h in enumerate(HANDS):
    for c in h: COUNTS[i,c]+=1
    terms=list(h)+[RANK[tuple(sorted((h[a],h[b])))]-1 for a in range(len(h)) for b in range(a+1,len(h))]
    SUB[i,:len(terms)]=terms
# 稀疏特征项：前 22 个是 I_c，随后是 253 个锚定的 I_cd。
PAIR_FEATURE=np.zeros((80730,275),np.float32)
for j in range(15):
    valid=SUB[:,j]>=0;PAIR_FEATURE[np.where(valid)[0],SUB[valid,j]]+=1
def read_tables():
    base=np.memmap(FULL/'tier0.f32',dtype='<f4',mode='r',offset=32,shape=(101,X))
    tiers=[None]+[np.memmap(FULL/f'tier{n}.i16',dtype='<i2',mode='r',offset=32,shape=(101,X,int(FIRST[n+1]-FIRST[n]))) for n in range(1,6)]
    return base,tiers
def coefficients(tiers):
    one=np.array(tiers[1],dtype=np.float32)/32
    out=np.empty((101,X,275),np.float32);out[:,:,:22]=one
    for i,h in enumerate(HANDS[23:276]):out[:,:,22+i]=tiers[2][:,:,i]/32.-one[:,:,h[0]]-one[:,:,h[1]]
    return out
def values(tiers,rows,hs):
    out=np.zeros((len(rows),len(hs)),np.float32)
    rr=np.asarray(rows)//X;xx=np.asarray(rows)%X;hs=np.asarray(hs)
    for n in range(1,6):
        ix=np.where((hs>=FIRST[n])&(hs<FIRST[n+1]))[0]
        if len(ix):out[:,ix]=tiers[n][rr[:,None],xx[:,None],(hs[ix]-FIRST[n])[None,:]]/32.
    return out
def stats(e):
    e=np.asarray(e,np.float64);a=np.abs(e)
    return dict(mae=float(a.mean()),rmse=float(np.sqrt(np.mean(e*e))),max_abs=float(a.max()),p99_abs=float(np.quantile(a,.99)))
def write_json(name,obj):
    p=ROOT/name;p.parent.mkdir(exist_ok=True,parents=True);p.write_text(json.dumps(obj,indent=2),encoding='utf8')
for d in ['results','data','models','logs','bin','tmp']: (ROOT/d).mkdir(exist_ok=True)
