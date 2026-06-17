# Docker 部署指南

## 30 秒启动

```bash
cd forum
docker compose up -d
# 等待 30 秒（首次构建 + 编译 better-sqlite3 需要时间）
# 浏览器打开 http://localhost:3000
```

**就这么简单** —— 镜像里已经编译好 Linux 版 `better-sqlite3`，不存在跨平台问题。

## 数据持久化

docker-compose 自动创建两个 volume：

| Volume | 用途 |
|---|---|
| `yiwanzhe-forum-data` | SQLite 数据库 (`forum.db`) |
| `yiwanzhe-forum-uploads` | 用户上传的图片 |

容器删除/重建后数据**不丢失**。

### 备份数据库

```bash
# 备份
docker compose exec forum sh -c "cp /app/data/forum.db /tmp/forum.db.bak"
docker cp yiwanzhe-forum:/tmp/forum.db.bak ./forum-backup-$(date +%Y%m%d).db

# 恢复
docker cp ./forum-backup-20260617.db yiwanzhe-forum:/app/data/forum.db
docker compose restart forum
```

## 常用命令

```bash
# 查看日志
docker compose logs -f forum

# 进入容器调试
docker compose exec forum sh

# 重启
docker compose restart forum

# 停止（保留数据）
docker compose down

# 停止 + 删除数据
docker compose down -v

# 重新构建（代码改动后）
docker compose up -d --build

# 查看资源占用
docker stats yiwanzhe-forum
```

## 生产环境部署

### 方案 A：直接暴露端口（最简单）

```yaml
ports:
  - "3000:3000"   # 已经配置
```

适用：内网、测试、单服务器

### 方案 B：Nginx 反向代理（推荐生产）

`/etc/nginx/conf.d/forum.conf`:

```nginx
server {
    listen 80;
    server_name forum.yourdomain.com;

    client_max_body_size 20m;  # 允许 20MB 上传

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 方案 C：Cloudflare Tunnel（域名在 Cloudflare）

```bash
# 安装 cloudflared
cloudflared tunnel create yiwanzhe
cloudflared tunnel route dns yiwanzhe forum.yourdomain.com

# 配置 config.yml
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json
ingress:
  - hostname: forum.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

cloudflared tunnel run yiwanzhe
```

**注意**：用 Cloudflare Tunnel 暴露本地服务 ≠ 把应用部署到 Cloudflare Workers。**应用本体仍在你自己的服务器/容器里跑**，只是流量经过 Cloudflare 网络。

## 镜像大小

```
REPOSITORY          TAG       SIZE
yiwanzhe-forum      latest    ~180 MB
```

包含：Node.js 20 runtime + 编译好的 better-sqlite3 + 应用代码。

## 从源码定制

修改 `package.json` 后：

```bash
docker compose build --no-cache
docker compose up -d
```

## 故障排查

```bash
# 1. 容器无法启动
docker compose logs forum

# 2. better-sqlite3 报错
docker compose exec forum node -e "require('better-sqlite3')"
# 期望输出空（无错误），如果有 "invalid ELF header" 说明构建缓存问题
docker compose build --no-cache

# 3. 数据库锁错误
# 容器内多个进程同时访问 db，需要确保只有一个 node 进程
docker compose exec forum ps aux
```
