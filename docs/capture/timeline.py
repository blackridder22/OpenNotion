"""Merge collector output into one events.json and print a timeline: python3 timeline.py ./out events.json"""
import json, glob, os, sys
d = sys.argv[1]; ev=[]
for f in sorted(glob.glob(os.path.join(d,'*.json'))):
    kind = os.path.basename(f).split('-')[0]
    try: o = json.load(open(f))
    except Exception: continue
    o['kind']=kind; ev.append(o)
ev.sort(key=lambda o:o.get('t',0))
json.dump(ev, open(sys.argv[2],'w'))
ev=[o for o in ev if "t" in o]; t0=ev[0]["t"]
for o in ev:
    k=o['kind']
    if k=='mark': print(f"\n=== {o['t']-t0:>6} MARK {o['label']}")
    elif k=='http': print(f"{o['t']-t0:>6} HTTP {o['url'].split('/api/v3/')[1]} req={len(o.get('req') or '')} res={len(o.get('res') or '')}")
    elif k=='ws': print(f"{o['t']-t0:>6} WS {o['dir']} {o['host']} {o['d'][:150]}")
