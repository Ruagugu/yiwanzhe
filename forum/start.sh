# 部署脚本 - Linux 服务器一键安装/重启
#!/usr/bin/env bash
# 进入项目目录
cd /www/wwwroot/forum || exit 1

# 拉取最新代码（如用 git 部署）
# git pull origin main

# 启动（生产环境推荐用 pm2）
# pm2 start app.js --name forum
# pm2 save
# pm2 startup

# 直接前台启动
node app.js
