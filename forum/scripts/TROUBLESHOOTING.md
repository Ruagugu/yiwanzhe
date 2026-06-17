# 故障排查 (Troubleshooting)

## 1. `invalid ELF header` 错误

```
Error: /www/wwwroot/forum/node_modules/better-sqlite3/build/Release/better_sqlite3.node:
       invalid ELF header
```

**原因**：`node_modules/better-sqlite3/build/Release/better_sqlite3.node` 是 **Windows 编译的原生模块**（PE 格式），上传到 Linux 服务器后无法加载。

**解决**：

```bash
# 在 Linux 服务器上执行
cd /www/wwwroot/forum
rm -rf node_modules          # 必须删！Windows 的 .node 在 Linux 上是垃圾
npm install --omit=dev       # 自动下载 Linux 平台的 prebuilt binary
```

或者用项目提供的安装脚本：

```bash
bash scripts/install.sh
```

**预防**：
- **永远不要** `git add` 提交 `node_modules/`
- **永远不要** 把 Windows 上的 `node_modules/` 上传到 Linux 服务器
- 只传 `package.json` + `package-lock.json`，服务器上 `npm ci` 重新装

## 2. `EACCES: permission denied`

```bash
sudo chown -R $USER:$USER /www/wwwroot/forum
# 或
sudo chmod -R 755 /www/wwwroot/forum
```

## 3. `Error: Cannot find module 'better-sqlite3'`

```bash
cd /www/wwwroot/forum
npm install
```

## 4. `EADDRINUSE :::3000`

3000 端口被占用。改用其他端口：

```bash
PORT=8080 node app.js
```

或在 `app.js` 第 8 行修改默认值。

## 5. `SQLITE_CANTOPEN: unable to open database file`

数据库文件所在目录无写权限：

```bash
mkdir -p /www/wwwroot/forum
chown -R www:www /www/wwwroot/forum   # 或你运行 node 的用户
```

## 6. 文件上传 413 (Payload Too Large)

Nginx 默认 1MB 限制，需要修改：

```nginx
client_max_body_size 20m;
```

然后 `nginx -s reload`。

## 7. better-sqlite3 编译失败（如果 prebuilt 不匹配你的平台）

```bash
# Debian/Ubuntu
sudo apt install -y python3 build-essential

# CentOS/RHEL
sudo yum install -y python3 gcc-c++ make

# 然后重新编译
npm rebuild better-sqlite3 --build-from-source
```

## 8. 服务器架构是 ARM (aarch64) 怎么办？

```bash
node -p "process.arch"
# 输出 arm64 / aarch64 / x64

# better-sqlite3 12.x 支持 ARM64 prebuilt
# 若不支持会自动下载并编译，需要上面的 gcc + python
```

## 9. 数据库迁移到新服务器

```bash
# 旧服务器导出
sqlite3 forum.db ".dump" > forum.sql

# 新服务器导入
sqlite3 forum.db < forum.sql
# 或用 better-sqlite3 读取后写入
```
