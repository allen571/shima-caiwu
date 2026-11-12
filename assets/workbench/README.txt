财务工作台（FinanceHub）接入说明
================================

v1.2.98 起本目录不再内置任何工作台可执行文件。

历史（v1.2.83~1.2.97）：本目录曾内置 FinanceHub-Workbench.exe（22.9 MB）。
事后确认它实际上是「财务原始数据工作台」的安装向导：主程序里「打开工作台」按钮
在 8765 服务没运行时把它拉起，它就会往 D:\finance-hub 释放旧版文件，把部署目录
的新版程序整个打回旧版——2026-11-11~11-12 的四次「程序回滚 / 同步停摆」均由此产生。
该 exe 已停用（改名 .bak 存档），builder.config.cjs 的 extraResources 条目已移除。

v1.2.98 起的行为：
- 「打开工作台」按钮直接启动正式部署目录（默认 D:\finance-hub）里的
  FinanceHub.exe，参数 server，cwd 为部署目录——config / 数据库 / web 都用
  部署目录自己的同一份，数据不会出现第二个口径。
- 部署目录没有 FinanceHub.exe 时按钮明确报错，引导先运行「启动工作台.bat」，
  绝不再静默执行任何安装程序。

需要从源码重新打包时
--------------------
直接执行：

    npm install
    npm run snapshot
    npx --yes electron-builder@26.15.3 --config builder.config.cjs --win portable --x64 --publish never

本目录残留的 README.txt 与 .bak 存档不参与打包（builder.config.cjs 的 files
白名单不含 assets/workbench，extraResources 也不再引用）。
