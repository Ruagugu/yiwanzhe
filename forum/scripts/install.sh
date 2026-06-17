#!/usr/bin/env bash
# =================================================================
# 遗忘者归乡论坛 - Linux 服务器一键安装脚本
# =================================================================
# 解决：better-sqlite3 .node 原生模块在 Windows/Linux 间不兼容
# 用法：bash install.sh
# =================================================================
set -e

echo "============================================================"
echo " 遗忘者归乡论坛 - Linux 安装"
echo "============================================================"
echo ""

# 1. 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[!] 未检测到 Node.js"
    echo "    请先安装 Node.js 18+ (推荐 20 LTS):"
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "    sudo apt install -y nodejs"
    exit 1
fi

NODE_VER=$(node -v)
NPM_VER=$(npm -v)
ARCH=$(node -p "process.arch")
PLATFORM=$(node -p "process.platform")
echo "[i] Node: $NODE_VER"
echo "[i] npm:  $NPM_VER"
echo "[i] 系统: $PLATFORM-$ARCH"
echo ""

# 2. 检查 Python + 编译工具（备选，以防需要从源码编译）
if ! command -v python3 &> /dev/null; then
    echo "[!] 未检测到 python3，需要时用于编译原生模块"
fi

# 3. 删除旧的 node_modules（如果是 Windows 上传上来的）
if [ -d "node_modules" ]; then
    HAS_WIN=$(file node_modules/better-sqlite3/build/Release/better_sqlite3.node 2>/dev/null | grep -i "MS Windows" || true)
    if [ -n "$HAS_WIN" ]; then
        echo "[!] 检测到 Windows 编译的 .node 模块，必须删除重建"
        rm -rf node_modules
    fi
fi

# 4. 清理可能的旧数据（可选 —— 由用户决定）
if [ -f "forum.db" ]; then
    echo "[i] 发现现有 forum.db，将保留"
fi

# 5. 安装依赖
echo ""
echo "[1/3] 安装 npm 依赖（better-sqlite3 12.x 自带 Linux prebuilt binary）..."
npm install --omit=dev 2>&1 | tail -20

# 6. 验证 better-sqlite3 加载
echo ""
echo "[2/3] 验证 better-sqlite3 能正常加载..."
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('CREATE TABLE t (id INT)'); db.prepare('INSERT INTO t VALUES (?)').run(1); console.log('  ✓ better-sqlite3 OK, version:', require('better-sqlite3/package.json').version);"

# 7. 初始化数据库
echo ""
echo "[3/3] 初始化数据库..."
node -e "require('./db.js'); console.log('  ✓ 数据库已就绪');"

echo ""
echo "============================================================"
echo " ✓ 安装完成"
echo "============================================================"
echo ""
echo " 启动论坛:  node app.js"
echo " 默认账号:  admin / admin123"
echo ""
