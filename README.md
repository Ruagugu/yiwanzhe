# 遗忘者归乡 (yiwanzhe)

> Node.js + Express + better-sqlite3 论坛系统
>
> 配套部署文档：[`forum/scripts/TROUBLESHOOTING.md`](forum/scripts/TROUBLESHOOTING.md)

## ⚠️ 重要：跨平台部署

**`node_modules/` 不能跨平台拷贝**（Windows / Linux / macOS 的原生模块二进制不兼容）。本项目在仓库中**不包含** `node_modules/`，必须在目标服务器上重新安装。

## 一键启动（本地开发）

### Windows

双击 [`forum/启动论坛.bat`](forum/启动论坛.bat)，首次运行会自动 `npm install`。

### Linux / 服务器

```bash
cd forum
bash scripts/install.sh    # 一次性安装 + 验证
node app.js
```

## 部署到 Linux 服务器（推荐宝塔 / Nginx 反代）

```bash
# 在服务器上
cd /www/wwwroot
git clone https://github.com/Ruagugu/yiwanzhe.git
cd yiwanzhe/forum
bash scripts/install.sh
node app.js    # 或用 pm2 守护: pm2 start app.js --name forum
```

## 🐳 Docker 部署（**推荐**）

```bash
cd forum
docker compose up -d
# 浏览器打开 http://localhost:3000
```

**优势**：镜像内已编译 Linux 版 `better-sqlite3`，**彻底避免 `invalid ELF header` 错误**，跨平台一致。

详见 [`forum/scripts/DOCKER.md`](forum/scripts/DOCKER.md)。

## 常见问题

| 错误 | 原因 | 解决 |
|---|---|---|
| `invalid ELF header` | 上传了 Windows 的 node_modules | 服务器上 `rm -rf node_modules && npm install` |
| `Cannot find module 'better-sqlite3'` | 没装依赖 | `npm install` |
| `EACCES permission denied` | 文件权限 | `chown -R www:www /www/wwwroot/forum` |
| `EADDRINUSE :::3000` | 端口占用 | `PORT=8080 node app.js` |

详细排查见 [`forum/scripts/TROUBLESHOOTING.md`](forum/scripts/TROUBLESHOOTING.md)。

## 文件结构

```
forum/
├── app.js                  入口
├── db.js                   SQLite 初始化
├── lib/                    业务模块（11 个）
├── routes/                 Express 路由（9 个）
├── views/                  EJS 模板（29 个）
├── public/css/             样式表
├── package.json
├── package-lock.json
├── Dockerfile              Docker 镜像构建
├── docker-compose.yml      Docker 一键启动
├── .dockerignore
├── 启动论坛.bat            Windows 启动脚本
├── scripts/
│   ├── install.sh          Linux 一键安装
│   ├── start.sh            Linux 启动
│   ├── DOCKER.md           Docker 部署指南
│   └── TROUBLESHOOTING.md  故障排查
└── 使用说明书.md
```

## 凭据

- 默认管理员: `admin` / `admin123`
- **首次登录后立即修改密码**

## Git 工作流

```bash
git push -u origin main    # 首次
# 之后：post-commit 钩子自动 push
```
