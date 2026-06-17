# ============================================================
# 遗忘者归乡论坛 - 多阶段 Docker 构建
# ============================================================
# 镜像特点：
#   1. 多阶段构建，镜像小（< 200 MB）
#   2. 编译 better-sqlite3 适配 Linux（解决 invalid ELF header）
#   3. 非 root 用户运行
#   4. SQLite 数据库 + 上传文件通过 volume 持久化
# ============================================================

# ---------- 阶段 1: 安装依赖 + 编译原生模块 ----------
FROM node:20-bookworm-slim AS builder

# 编译工具：python3 + make + g++（better-sqlite3 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 单独复制 package 文件，利用 Docker 缓存
COPY package*.json ./

# 编译安装 better-sqlite3 等所有依赖
RUN npm ci --omit=dev && \
    npm cache clean --force

# ---------- 阶段 2: 运行镜像 ----------
FROM node:20-bookworm-slim AS runtime

# 安装运行时最小依赖：wget（healthcheck 用）+ tini（信号处理）
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        tini \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r forum -g 1001 \
    && useradd -r -u 1001 -g forum -m -d /app -s /sbin/nologin forum

WORKDIR /app

# 从 builder 阶段复制 node_modules 和 package.json
COPY --from=builder --chown=forum:forum /app/node_modules ./node_modules
COPY --from=builder --chown=forum:forum /app/package*.json ./

# 复制应用代码
COPY --chown=forum:forum app.js ./
COPY --chown=forum:forum db.js ./
COPY --chown=forum:forum lib ./lib
COPY --chown=forum:forum routes ./routes
COPY --chown=forum:forum views ./views
COPY --chown=forum:forum public ./public

# 数据持久化目录
RUN mkdir -p /app/data /app/public/uploads && \
    chown -R forum:forum /app/data /app/public/uploads

# 切换到非 root 用户
USER forum

# 环境变量
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/forum.db

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# tini 处理 PID 1 信号
ENTRYPOINT ["/usr/bin/tini", "--"]

# 启动应用
CMD ["node", "app.js"]
