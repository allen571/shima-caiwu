"""打完整交付包：免安装程序 + 完整源码，一个 zip。

结构：
    诗玛财务AI工作台-<版本>/
        使用方法.txt
        程序/Shima-Finance-Workbench-<版本>-x64.exe
        源码/<完整工程>

用法：
    python scripts/pack-release-zip.py [输出zip路径]
"""
import hashlib
import json
import os
import sys
import time
import zipfile

SRC = r'D:/WORKBUDDYache/2026-10-26-09-38-44/shima'
# 版本统一从源码 package.json 读，避免脚本里写死版本号后与真实版本脱节
VERSION = json.load(open(os.path.join(SRC, 'package.json'), encoding='utf-8'))['version']
EXE = os.path.join(SRC, 'release200', 'Shima-Finance-Workbench-%s-x64.exe' % VERSION)
OUT = sys.argv[1] if len(sys.argv) > 1 else \
    r'E:/360MoveData/Users/Administrator/Desktop/财务/诗玛财务AI工作台-%s-完整版.zip' % VERSION

ROOT = '诗玛财务AI工作台-%s/' % VERSION
SRC_PREFIX = ROOT + '源码/'
EXE_PREFIX = ROOT + '程序/'

ROOT_FILES = ['.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json',
              'source-files.json', 'builder.config.cjs', '启动财务工作台.cmd', '启动财务工作台.command']
DIRS = ['assets', 'docs', 'electron', 'scripts', 'ui', 'vendor']
SKIP_NAMES = {'.DS_Store', 'Thumbs.db'}
SKIP_SUFFIX = ('.log',)
SKIP_PREFIX = ('_',)


def source_entries():
    for f in ROOT_FILES:
        p = os.path.join(SRC, f)
        if os.path.exists(p):
            yield p, f
        else:
            print('缺文件:', f)
    for d in DIRS:
        base = os.path.join(SRC, d)
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '__MACOSX', '__pycache__', '.pytest_cache')]
            for name in sorted(files):
                if name in SKIP_NAMES or name.endswith(SKIP_SUFFIX) or name.startswith(SKIP_PREFIX):
                    continue
                p = os.path.join(root, name)
                rel = os.path.relpath(p, SRC).replace('\\', '/')
                yield p, rel


README = """诗玛财务AI工作台 v{version}（Windows 免安装版 + 完整源码）

一、只想用软件
  双击  程序\\Shima-Finance-Workbench-{version}-x64.exe  即可，
  免安装、不写注册表。底部版本号应显示 v{version}。

  数据存放目录（请不要删除）：
      %APPDATA%\\shima-finance-ai-workbench
  里面包含账号配置、抓取结果、每日计划、运行日志：
      promotion-fee.log   推广费抓取轨迹（每店耗时、登录填充、需人工原因）
      fund.log            资金抓取轨迹
      startup.log         启动记录（闪退先看这里）

二、想改代码
  cd 源码
  npm install          # 仅装开发依赖，生产依赖为 0
  npm start            # 本机运行
  npm test             # 全量单元测试
  npm run verify:source # 校验源码没被改乱（对照 source-files.json 哈希）

  改完必须做的事：更新 source-files.json 里对应文件的 sha256，
  否则 npm run check 会拒绝。

三、重新打包 exe
  npx --yes electron-builder@26.15.3 --config builder.config.cjs --win portable --x64 --publish never
  打包期间不要同时改源码（会打进出半截文件）。

四、本包构成
  程序\\   electron-builder 打的 Windows 便携版，可直接分发
  源码\\   electron/ ui/ scripts/ docs/ assets/ vendor/ 及各配置文件

生成时间：{stamp}
"""


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not os.path.exists(EXE):
        print('缺少程序文件:', EXE)
        return 1
    if os.path.exists(OUT):
        print('目标已存在，将覆盖:', OUT)

    stamp = time.localtime()
    count = 0
    with zipfile.ZipFile(OUT, 'w') as z:
        # 使用说明
        info = zipfile.ZipInfo(ROOT + '使用方法.txt')
        info.date_time = stamp[:6]
        info.external_attr = (0o644 << 16)
        info.compress_type = zipfile.ZIP_DEFLATED
        text = README.format(version=VERSION, stamp=time.strftime('%Y-%m-%d %H:%M', stamp))
        z.writestr(info, text.encode('utf-8'), compresslevel=9)
        count += 1

        # 程序：exe 本身已是压缩体，用 STORED 直接存储，打包更快
        info = zipfile.ZipInfo(EXE_PREFIX + os.path.basename(EXE))
        info.date_time = stamp[:6]
        info.external_attr = (0o755 << 16)
        info.compress_type = zipfile.ZIP_STORED
        with open(EXE, 'rb') as fh:
            z.writestr(info, fh.read())
        count += 1

        # 源码
        for path, rel in source_entries():
            info = zipfile.ZipInfo(SRC_PREFIX + rel)
            info.date_time = stamp[:6]
            exec_bit = rel.endswith(('.command', '.cmd', '.sh'))
            info.external_attr = (0o755 if exec_bit else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(path, 'rb') as fh:
                z.writestr(info, fh.read(), compresslevel=9)
            count += 1

    print('版本', VERSION)
    print('写入条目', count)
    print('输出', OUT)
    print('大小 %.2f MB' % (os.path.getsize(OUT) / 1048576))
    print('程序 sha256', sha256(EXE))
    return 0


if __name__ == '__main__':
    sys.exit(main())
