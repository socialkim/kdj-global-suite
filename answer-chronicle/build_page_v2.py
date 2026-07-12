# -*- coding: utf-8 -*-
"""v1: data.json + template.html -> v1.html / v2: data-v2.json + template-v2.html -> index.html"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))

def build(data_file, tpl_file, out_file):
    data = json.load(open(os.path.join(HERE, data_file), encoding='utf-8'))
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    tpl = open(os.path.join(HERE, tpl_file), encoding='utf-8').read()
    assert '__CHRONICLE_DATA__' in tpl, f'placeholder missing in {tpl_file}'
    html = tpl.replace('__CHRONICLE_DATA__', payload)
    open(os.path.join(HERE, out_file), 'w', encoding='utf-8').write(html)
    print(f'{out_file}: {len(html):,} bytes | topics={len(data.get("topics", []))} videos={len(data.get("videos", []))}')

build('data.json', 'template.html', 'v1.html')
build('data-v2.json', 'template-v2.html', 'index.html')
