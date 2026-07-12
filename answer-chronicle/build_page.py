# -*- coding: utf-8 -*-
"""data.json을 template.html에 주입해 index.html을 생성한다."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
data_path = os.path.join(HERE, 'data.json')
tpl_path = os.path.join(HERE, 'template.html')
out_path = os.path.join(HERE, 'index.html')

data = json.load(open(data_path, encoding='utf-8'))
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
payload = payload.replace('</', '<\\/')  # script 태그 조기 종료 방지

tpl = open(tpl_path, encoding='utf-8').read()
assert '__CHRONICLE_DATA__' in tpl, 'placeholder missing'
html = tpl.replace('__CHRONICLE_DATA__', payload)

open(out_path, 'w', encoding='utf-8').write(html)
print(f'index.html written: {len(html):,} bytes, topics={len(data.get("topics", []))}, videos={len(data.get("videos", []))}')
