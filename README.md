# 遗忘者归乡 (yiwanzhe)

Node.js + better-sqlite3 论坛系统。

## 运行

```bash
npm install
node app.js
# 浏览器访问 http://localhost:3000
```

## 文件结构

- `app.js` / `db.js` — 入口与数据库初始化
- `lib/` — 业务模块（bot 引擎、世界书、库存、通知等）
- `routes/` — Express 路由
- `views/` — EJS 模板
- `public/` — 静态资源（CSS/JS/上传）
- `使用说明书.md` — 用户使用文档
- `启动论坛.bat` — Windows 启动脚本

## 数据

数据库 `forum.db` 首次启动自动建表，**不纳入版本控制**。
运行时上传的图片保存在 `public/uploads/`，也不纳入版本控制。

## Git 工作流

```bash
git push -u origin main    # 首次推送（手动）
# 之后：
git add <files> && git commit -m "<msg>"   # post-commit 钩子自动 push
```
