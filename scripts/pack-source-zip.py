import os, sys, time, zipfile, hashlib

SRC = r'D:/WORKBUDDYache/2026-10-26-09-38-44/shima'
# 输出路径由命令行参数指定，缺省沿用桌面交付目录；不再写死版本号，避免覆盖旧版源码包
OUT = sys.argv[1] if len(sys.argv) > 1 else \
    r'E:/360MoveData/Users/Administrator/Desktop/财务/诗玛财务AI工作台-源码.zip'
PREFIX = '诗玛财务AI工作台/'

ROOT_FILES = ['.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json',
              'source-files.json', 'builder.config.cjs', '启动财务工作台.cmd', '启动财务工作台.command']
DIRS = ['assets', 'docs', 'electron', 'scripts', 'ui', 'vendor']
SKIP_NAMES = {'.DS_Store', 'Thumbs.db'}
SKIP_SUFFIX = ('.log',)

def entries():
    for f in ROOT_FILES:
        p = os.path.join(SRC, f)
        if os.path.exists(p):
            yield p, f
        else:
            print('缺文件:', f)
    for d in DIRS:
        base = os.path.join(SRC, d)
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '__MACOSX')]
            for name in sorted(files):
                # 下划线开头的是本地一次性调试脚本，不进交付包
                if name in SKIP_NAMES or name.endswith(SKIP_SUFFIX) or name.startswith('_'):
                    continue
                p = os.path.join(root, name)
                rel = os.path.relpath(p, SRC).replace('\\', '/')
                # 内置的第三方工作台程序（22.9 MB 二进制）不算源码，只保留同目录的说明文件
                if rel.startswith('assets/workbench/') and name.lower().endswith('.exe'):
                    continue
                yield p, rel

count = 0
stamp = time.localtime()[:6]
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path, rel in entries():
        info = zipfile.ZipInfo(PREFIX + rel)
        info.date_time = stamp
        exec_bit = rel.endswith(('.command', '.cmd')) or rel.endswith('.sh')
        info.external_attr = (0o755 if exec_bit else 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(path, 'rb') as fh:
            z.writestr(info, fh.read(), compresslevel=9)
        count += 1

size = os.path.getsize(OUT)
print('写入条目', count)
print('输出', OUT)
print('大小 %.2f MB' % (size / 1048576))
