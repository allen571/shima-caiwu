"""校验源码 zip：逐条比对本机源码哈希，并核对包内 package.json 版本号一致。"""
import hashlib
import json
import os
import sys
import zipfile

SRC = r'D:/WORKBUDDYache/2026-10-26-09-38-44/shima'
PREFIX = '诗玛财务AI工作台/'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main(zip_path):
    bad = []
    missing = []
    total = 0
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        manifest = json.loads(z.read(PREFIX + 'source-files.json').decode('utf-8'))
        version = json.loads(z.read(PREFIX + 'package.json').decode('utf-8'))['version']
        tracked = manifest.get('files') or manifest
        for rel, expect in tracked.items():
            total += 1
            if PREFIX + rel not in names:
                missing.append(rel)
                continue
            if sha256(z.read(PREFIX + rel)) != expect:
                bad.append(rel)
        # 包内每个条目都要与本机源码一致，防止打进旧文件
        drift = []
        for name in names:
            rel = name[len(PREFIX):]
            local = os.path.join(SRC, rel)
            if not os.path.exists(local):
                drift.append(rel + '(本机缺失)')
                continue
            with open(local, 'rb') as fh:
                if sha256(fh.read()) != sha256(z.read(name)):
                    drift.append(rel)
        print('zip版本:', version)
        print('清单条目:', total, '缺失:', len(missing), '哈希不符:', len(bad), '内容漂移:', len(drift))
        for label, items in (('缺失', missing), ('哈希不符', bad), ('内容漂移', drift)):
            for item in items[:10]:
                print(' ', label, item)
    ok = version == manifest.get('version') and not missing and not bad and not drift
    print('期望版本:', manifest.get('version'))
    print('VERIFY_SOURCE_ZIP', 'OK' if ok else 'FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
