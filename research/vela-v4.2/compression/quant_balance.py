"""在现有全局 int16 量化器之前进行的保函数通道缩放。

不涉及训练、Q 挖掘、对局或对原始制品的修改。选择依据是偶数诊断行上
相对冻结浮点函数的量化误差；奇数行是固定的诊断保留集，
并非对整局独立性的声明。
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '4')
from pathlib import Path
import argparse, hashlib, json, struct, time
from itertools import combinations_with_replacement
import numpy as np

ROOT = Path(__file__).resolve().parent
X, P, NH = 5798, 2899, 80730
DEFAULT_NAMES = ['unified_k192_t24', 'unified_k256_t16', 'exact_singleton_k128_t24']
NAMES = DEFAULT_NAMES + ['exact_singleton_k192_t16']
ALPHAS = [None, 0., .25, .5, .75, 1.]

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024), b''):h.update(b)
    return h.hexdigest()

def stats(e):
    e=np.asarray(e,np.float64);a=np.abs(e)
    return dict(n=len(e),mae=float(a.mean()),rmse=float(np.sqrt(np.mean(e*e))),max_abs=float(a.max()),p99_abs=float(np.quantile(a,.99)))

def read_model(path):
    with path.open('rb') as f: h=struct.unpack('<8i',f.read(32))
    magic,r,p,q,k,tg,anchor,sparse=h
    assert magic in (0x56435332,0x56435333) and r==100 and p==P and q==0 and sparse==0
    assert anchor==(magic==0x56435333)
    prefix_len=32+101*X*4+(101*X*22*2 if anchor else 0)+4
    pos=prefix_len
    ps=np.memmap(path,'<f4',mode='r',offset=pos,shape=1)[0];pos+=4
    pq=np.memmap(path,'<i2',mode='r',offset=pos,shape=(NH,k));pos+=NH*k*2
    gt=np.memmap(path,'<f4',mode='r',offset=pos,shape=(101,tg));pos+=101*tg*4
    gs=np.memmap(path,'<f4',mode='r',offset=pos,shape=1)[0];pos+=4
    gq=np.memmap(path,'<i2',mode='r',offset=pos,shape=(X,k,tg));pos+=X*k*tg*2
    assert pos==path.stat().st_size
    single=np.memmap(path,'<i2',mode='r',offset=32+101*X*4,shape=(101,X,22)) if anchor else None
    return dict(k=k,tg=tg,anchor=anchor,prefix_len=prefix_len,ps=ps,pq=pq,gt=gt,gs=gs,gq=gq,single=single)

def quant(a):
    maximum=float(np.max(np.abs(a)))
    scale=np.float32(maximum/32760 if maximum else 1)
    q=np.rint(a/scale).astype('<i2')
    assert np.abs(q.astype(np.int32)).max()<=32760
    return scale,q

def predict(phi,ga,gt,query,extra,ps=None,gs=None,row_float=True):
    h,r,x=query['h'],query['r'],query['x'];out=np.empty(len(h),np.float64)
    for lo in range(0,len(h),256):
        hi=min(len(h),lo+256);hh,rr,xx=h[lo:hi],r[lo:hi],x[lo:hi]
        pp=phi[hh];gg=ga[xx]
        if ps is not None: pp=(pp*ps).astype(np.float32)
        if gs is not None: gg=(gg*gs).astype(np.float32)
        cc=np.einsum('ij,ikj->ik',gt[rr].astype(np.float64),gg.astype(np.float64))
        if row_float:cc=cc.astype(np.float32)
        out[lo:hi]=extra[lo:hi]+(pp.astype(np.float64)*cc).sum(axis=1)
    terminal=(r==0)&(x<P)
    out[terminal]=query['truth'][terminal]
    return out

def write_model(out,original,info,pq,ps,gq,gs):
    assert not out.exists(), f'output exists: {out}'
    with original.open('rb') as f: prefix=f.read(info['prefix_len'])
    with out.open('xb') as f:
        f.write(prefix);np.array([ps],'<f4').tofile(f);pq.tofile(f)
        np.asarray(info['gt'],'<f4').tofile(f);np.array([gs],'<f4').tofile(f);gq.tofile(f)
    assert out.stat().st_size==original.stat().st_size<100000000
    with out.open('rb') as f: assert f.read(info['prefix_len'])==prefix

def run(name,query):
    start=time.monotonic();source=ROOT/'models'/f'{name}.bin';source_hash=digest(source)
    info=read_model(source);k=info['k'];tag=('singleton192' if name=='exact_singleton_k192_t16' else 'singleton') if info['anchor'] else 'unified'
    phi=np.load(ROOT/'data'/f'{tag}_phi.npy',mmap_mode='r')[:,:k]
    ga=np.load(ROOT/'data'/f'{name}_coeff.npy',mmap_mode='r')
    gt=np.load(ROOT/'data'/f'{name}_time.npy',mmap_mode='r')
    assert ga.shape==(X,k,info['tg']) and np.array_equal(gt,info['gt'])
    extra=np.zeros(len(query['h']),np.float64)
    if info['anchor']:
        counts=np.zeros((NH,22),np.int8)
        index=0
        for n in range(6):
            for hand in combinations_with_replacement(range(22),n):
                for c in hand:counts[index,c]+=1
                index+=1
        extra=(info['single'][query['r'],query['x']].astype(np.float64)/32*counts[query['h']]).sum(axis=1)
    target=predict(phi,ga,gt,query,extra)
    target64=predict(phi,ga,gt,query,extra,row_float=False)
    original_prediction=predict(info['pq'],info['gq'],gt,query,extra,info['ps'],info['gs'])
    pm=np.max(np.abs(phi),axis=0).astype(np.float64)
    gm=np.max(np.abs(ga),axis=(0,2)).astype(np.float64)
    valid=(pm>0)&(gm>0);cal=np.arange(len(target))%2==0;hold=~cal
    results=[];best_score=float('inf');best=None
    for alpha in ALPHAS:
        a=np.ones(k,np.float64)
        if alpha is not None:a[valid]=np.exp(alpha*np.log(gm[valid])-(1-alpha)*np.log(pm[valid]))
        assert np.isfinite(a).all() and (a>0).all()
        pp=(phi.astype(np.float64)*a).astype(np.float32)
        gg=(ga.astype(np.float64)/a[None,:,None]).astype(np.float32)
        ps,pq=quant(pp);gs,gq=quant(gg)
        pred=predict(pq,gq,gt,query,extra,ps,gs)
        fp=predict(pp,gg,gt,query,extra)
        fp64=predict(pp,gg,gt,query,extra,row_float=False)
        qe=pred-target;record={'alpha':alpha,'name':'identity' if alpha is None else f'balance_{alpha:g}',
            'calibration_quant_error':stats(qe[cal]),'holdout_quant_error':stats(qe[hold]),'all_quant_error':stats(qe),
            'all_teacher_error':stats(pred-query['truth']),
            'by_hand_teacher_error':{str(n):stats((pred-query['truth'])[query['n']==n]) for n in range(1,6)},
            'float32_rescale_invariance':stats(fp-target),'float64_contraction_rescale_invariance':stats(fp64-target64),
            'phi_scale':float(ps),'ga_scale':float(gs),'a_min':float(a.min()),'a_max':float(a.max()),
            'zero_phi_columns':int((pm==0).sum()),'zero_ga_columns':int((gm==0).sum())}
        # 实数运算下完全等价，剩余差异仅来自浮点存储/收缩。
        assert record['float32_rescale_invariance']['max_abs']<.001
        assert record['float64_contraction_rescale_invariance']['max_abs']<.001
        if alpha is None:
            assert np.array_equal(pq,info['pq']) and np.array_equal(gq,info['gq'])
            assert ps==info['ps'] and gs==info['gs']
            assert np.max(np.abs(pred-original_prediction))<1e-10
        score=record['calibration_quant_error']['rmse']
        if score<best_score:
            best_score=score;best=(alpha,a.copy(),ps,gs)
        results.append(record)
        print(json.dumps({'model':name,'case':record['name'],'quant_mae':record['all_quant_error']['mae'],'cal_quant_rmse':score,'seconds':time.monotonic()-start}),flush=True)
    alpha,a,ps,gs=best
    pp=(phi.astype(np.float64)*a).astype(np.float32);gg=(ga.astype(np.float64)/a[None,:,None]).astype(np.float32)
    ps,pq=quant(pp);gs,gq=quant(gg)
    out=ROOT/'models'/f'{name}_balanced.bin';write_model(out,source,info,pq,ps,gq,gs)
    reloaded=read_model(out);assert np.array_equal(reloaded['pq'],pq) and np.array_equal(reloaded['gq'],gq)
    assert reloaded['ps']==ps and reloaded['gs']==gs and np.array_equal(reloaded['gt'],gt)
    assert digest(source)==source_hash
    report={'source':str(source),'source_sha256':source_hash,'output':str(out),'output_sha256':digest(out),'bytes':out.stat().st_size,
        'selection':'Minimum quantization RMSE against frozen float function on even rows; identity included. Odd rows diagnostic holdout.',
        'selected_alpha':alpha,'selected_a':a.tolist(),'cases':results,'query_sha256':digest(ROOT/'data/value_diagnostic_queries.npz'),
        'immutable_prefix_verified':True,'time_basis_bytes_verified':True,'roundtrip_quantized_arrays_verified':True,'original_sha_unchanged':True,
        'float_data_sources':{p.name:digest(p) for p in [ROOT/'data'/f'{tag}_phi.npy',ROOT/'data'/f'{name}_coeff.npy',ROOT/'data'/f'{name}_time.npy']},
        'seconds':time.monotonic()-start,'games':0,'status':'DEVELOPMENT_VALUE_DIAGNOSTICS_ONLY'}
    report_path=ROOT/'results'/f'{name}_quant_balance.json'
    with report_path.open('x',encoding='utf8') as f:json.dump(report,f,indent=2)
    return report

def verify_existing(name):
    path=ROOT/'results'/f'{name}_quant_balance.json'
    report=json.loads(path.read_text(encoding='utf8'))
    assert digest(report['source'])==report['source_sha256']
    assert digest(report['output'])==report['output_sha256']
    assert digest(ROOT/'data/value_diagnostic_queries.npz')==report['query_sha256']
    for filename,sha in report['float_data_sources'].items():assert digest(ROOT/'data'/filename)==sha
    assert Path(report['output']).stat().st_size==report['bytes']<100000000
    print(json.dumps({'model':name,'status':'EXISTING_ARTIFACT_HASHES_VERIFIED','games':0}),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('models',nargs='*',choices=NAMES);ap.add_argument('--verify-existing',action='store_true');args=ap.parse_args()
    with np.load(ROOT/'data/value_diagnostic_queries.npz') as q:query={key:q[key] for key in q.files}
    pending=[]
    for name in args.models or DEFAULT_NAMES:
        exists=(ROOT/'models'/f'{name}_balanced.bin').exists() or (ROOT/'results'/f'{name}_quant_balance.json').exists()
        if exists:
            assert args.verify_existing, f'output exists for {name}; use --verify-existing to verify and reuse'
            verify_existing(name)
        else:pending.append(name)
    for name in pending:run(name,query)
