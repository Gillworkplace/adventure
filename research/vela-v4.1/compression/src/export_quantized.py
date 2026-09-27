import os
os.environ['OPENBLAS_NUM_THREADS']='6'
from common import *
import struct,hashlib
manifest=json.loads((ROOT/'results/models.json').read_text());base=np.load(ROOT/'data/base.npy');t=np.load(ROOT/'data/time_basis.npy')
for q,k,tg in [(4,32,4),(8,0,0),(8,16,8),(8,32,8),(8,32,16),(8,48,8),(8,40,16),(6,64,8),(6,64,12)]:
    prefix=f'fit_q{q}_' if q!=4 else ''
    name=f'quant_q{q}_k{k}_t{tg}'
    if any(x['name']==name for x in manifest):continue
    if not (ROOT/f'data/{prefix}g_q{tg}.npy').exists():continue
    a=np.load(ROOT/f'data/low_q{q}.npy');phi=np.load(ROOT/f'data/{prefix}hand_phi.npy')[:,:k];gt=np.load(ROOT/f'data/{prefix}g_time.npy')[:,:tg];ga=np.load(ROOT/f'data/{prefix}g_q{tg}.npy')[:,:k] if k else np.empty(0,np.float32)
    path=ROOT/f'models/{name}.bin';quant_errors={}
    with path.open('wb') as f:
        f.write(struct.pack('<8i',0x56435332,48,P,q,k,tg,0,0))
        def fp(v):np.asarray(v,'<f4').tofile(f)
        def qi(label,v):
            scale=np.float32(np.max(np.abs(v))/32760) if v.size and np.max(np.abs(v)) else np.float32(1)
            fp([scale]);z=np.rint(v/scale).astype('<i2');z.tofile(f)
            quant_errors[label]=float(np.max(np.abs(v-z.astype(np.float32)*scale))) if v.size else 0
        fp(base);fp(t[:,:q]);qi('A',a);qi('phi',phi);fp(gt);qi('G',ga)
    rec=dict(name=name,q=q,k=k,tg=tg,j=0,quantized=True,bytes=path.stat().st_size,mib=path.stat().st_size/2**20,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),parameter_quantization_max_error=quant_errors)
    manifest=[x for x in manifest if x['name']!=name];manifest.append(rec);print(rec,flush=True)
write_json('results/models.json',manifest)
