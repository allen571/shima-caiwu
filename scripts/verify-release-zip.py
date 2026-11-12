"""校验完整交付包：源码逐条比对 + 程序哈希核对 + 版本一致。

用法：python scripts/verify-release-zip.py <zip路径>
"""
import hashlib
import json
import os
import sys
import zipfile

SRC = r'D:/WORKBUDDYache/2026-10-26-09-38-44/shima'
VERSION = json.load(open(os.path.join(SRC, 'package.json'), encoding='utf-8'))['version']
EXE = os.path.join(SRC, 'release200', 'Shima-Finance-Workbench-%s-x64.exe' % VERSION)
ROOT = '诗玛财务AI工作台-%s/' % VERSION
SRC_PREFIX = ROOT + '源码/'
EXE_PREFIX = ROOT + '程序/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main(zip_path):
    ok = True
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()

        # 1) 必备条目
        for need in (ROOT + '使用方法.txt', EXE_PREFIX + os.path.basename(EXE)):
            if need not in names:
                print('缺少条目:', need)
                ok = False

        # 2) 版本
        version = json.loads(z.read(SRC_PREFIX + 'package.json').decode('utf-8'))['version']
        manifest = json.loads(z.read(SRC_PREFIX + 'source-files.json').decode('utf-8'))
        tracked = manifest.get('files') or manifest
        print('包内版本:', version, '| 清单版本:', manifest.get('version'))

        # 3) 清单逐条比对（哈希 = 打包时的源码状态）
        missing, bad = [], []
        for rel, expect in tracked.items():
            name = SRC_PREFIX + rel
            if name not in names:
                missing.append(rel)
                continue
            if sha(z.read(name)) != expect:
                bad.append(rel)

        # 4) 源码区杂项漂移：包内文件与本机源码必须一致
        drift = []
        for name in names:
            if not name.startswith(SRC_PREFIX):
                continue
            rel = name[len(SRC_PREFIX):]
            local = os.path.join(SRC, rel)
            if not os.path.exists(local):
                drift.append(rel + '(本机缺失)')
                continue
            if sha(z.read(name)) != sha_file(local):
                drift.append(rel)

        # 5) 程序哈希
        exe_name = EXE_PREFIX + os.path.basename(EXE)
        exe_ok = False
        if exe_name in names:
            exe_in_zip = sha(z.read(exe_name))
            exe_local = sha_file(EXE)
            exe_ok = exe_in_zip == exe_local
            print('程序 sha256:', exe_in_zip[:16], '| 与打包产物一致:', exe_ok)
        else:
            print('程序条目缺失')

        print('源码条目:', sum(1 for n in names if n.startswith(SRC_PREFIX)))
        print('清单条目:', len(tracked), '缺失:', len(missing), '哈希不符:', len(bad), '内容漂移:', len(drift))
        for label, items in (('缺失', missing), ('哈希不符', bad), ('内容漂移', drift)):
            for item in items[:10]:
                print(' ', label, item)

        # 6) 完整性（CRC）
        broken = z.testzip()
        print('CRC 校验:', '全部通过' if broken is None else '损坏 ' + broken)

        ok = ok and version == VERSION and version == manifest.get('version') \
            and not missing and not bad and not drift and exe_ok and broken is None

    print('VERIFY_RELEASE_ZIP', 'OK' if ok else 'FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
