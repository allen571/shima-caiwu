#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if [[ ! -x node_modules/.bin/electron ]]; then
  echo '请先安装 Node.js，然后在此目录执行 npm ci。'
  read -r '?按回车关闭'
  exit 1
fi
unset ELECTRON_RUN_AS_NODE
npm start
