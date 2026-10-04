"""Select a checkpoint on fixed teacher/student roots with episode clustering.

Input JSON: {"seed_base":3520100000,"epochs":[{"epoch":0,"model":"...",
"teacher":"...validation.csv","student":"...validation.csv"}, ...]}.
This uses diagnostic teacher Q regret, not whole-game scores or their CI.
"""
from pathlib import Path
import argparse, csv, hashlib, json, math
from collections import defaultdict
import numpy as np

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()

def read(path):
    episodes=defaultdict(list);values=[];keys=set()
    with Path(path).open(newline='',encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            ep=int(row['episode']);step=int(row['step']);v=float(row['regret'])
            assert math.isfinite(v) and v>=-1e-8
            assert (ep,step) not in keys,'duplicate root within one rollout source'
            keys.add((ep,step));episodes[ep].append(v);values.append(v)
    assert values
    means={ep:float(np.mean(v)) for ep,v in episodes.items()}
    return means,{'states':len(values),'episodes':len(means),'root_weighted_mean_regret':float(np.mean(values)),
                  'episode_weighted_mean_regret':float(np.mean(list(means.values()))),'root_p99_regret':float(np.quantile(values,.99))}

def select(manifest_path,out):
    assert not out.exists()
    config=json.loads(manifest_path.read_text(encoding='utf8'));assert isinstance(config['seed_base'],int)
    records=sorted(config['epochs'],key=lambda x:x['epoch']);assert records[0]['epoch']==0
    assert len({r['epoch'] for r in records})==len(records)
    reference_episodes=None;rows=[]
    for record in records:
        a,am=read(record['teacher']);b,bm=read(record['student'])
        assert set(a)==set(b),'teacher/student episode coverage differs; report missing clusters before selection'
        if reference_episodes is None:reference_episodes=set(a)
        assert set(a)==reference_episodes,'checkpoint validation root clusters differ'
        ep=sorted(a);cluster=np.array([.5*(a[g]+b[g]) for g in ep])
        rows.append(dict(epoch=record['epoch'],model=record['model'],model_sha256=sha(record['model']),
            teacher=am,student=bm,cluster_count=len(ep),combined_mean_regret=float(cluster.mean()),
            combined_cluster_sd=float(cluster.std(ddof=1)) if len(ep)>1 else None,
            combined_cluster_se=float(cluster.std(ddof=1)/math.sqrt(len(ep))) if len(ep)>1 else None,
            tie_tail=max(am['root_p99_regret'],bm['root_p99_regret']),
            teacher_diagnostic_sha256=sha(record['teacher']),student_diagnostic_sha256=sha(record['student'])))
    best=min(rows,key=lambda x:(x['combined_mean_regret'],x['tie_tail'],x['epoch']))
    report={'scope':'Fixed development teacher/student root Q2 regret; not whole-game score evidence',
        'seed_base':config['seed_base'],'cluster_key':'seed_base + episode; two behavior rollouts share one episode cluster',
        'formula':'R_g=(mean_teacher_roots_regret_g + mean_student_roots_regret_g)/2; criterion=mean_g R_g',
        'selection':'minimum combined mean regret, then smaller maximum source root P99, then earlier epoch; epoch0 included',
        'unique_validation_episode_clusters':len(reference_episodes),'new_independent_games_claimed':False,
        'selected_epoch':best['epoch'],'selected_model':best['model'],'selected_model_sha256':best['model_sha256'],
        'epochs':rows,'manifest_sha256':sha(manifest_path)}
    with out.open('x',encoding='utf8') as f:json.dump(report,f,indent=2)
    print(json.dumps({'selected_epoch':best['epoch'],'combined_mean_regret':best['combined_mean_regret'],'clusters':len(reference_episodes)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('manifest',type=Path);p.add_argument('output',type=Path);a=p.parse_args();select(a.manifest,a.output)
