const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { formatContent } = require('./lib/notify');

const app = express();
const PORT = process.env.PORT || 3000;

// 设置
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
  secret: 'forum-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// 全局模板变量
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  // 完整的 user 对象（包含 nickname 等）从 DB 刷新
  if (req.session.user) {
    const fresh = db.prepare('SELECT id, username, nickname, role, avatar FROM users WHERE id = ?').get(req.session.user.id);
    if (fresh) {
      res.locals.user = fresh;
      req.session.user = fresh; // keep session in sync
    }
  }
  res.locals.settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    res.locals.settings[r.key] = r.value;
  });
  res.locals.currentPath = req.path;
  res.locals.formatContent = formatContent;
  res.locals.formatTime = (raw) => {
    if (!raw) return '';
    // SQLite stores UTC. Append 'Z' so new Date() parses as UTC rather than local.
    const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  };
  res.locals.unreadCount = 0;
  res.locals.notifCount = 0;
  if (req.session.user) {
    res.locals.unreadCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0').get(req.session.user.id).c;
    res.locals.notifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.user.id).c;
  }
  next();
});

// 路由
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/topics', require('./routes/topics'));
app.use('/admin', require('./routes/admin'));
app.use('/user', require('./routes/user'));
app.use('/messages', require('./routes/messages'));
app.use('/news', require('./routes/news'));
app.use('/wiki', require('./routes/wiki'));
app.use('/notifications', require('./routes/notifications'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '页面未找到', message: '你访问的页面不存在' });
});

app.listen(PORT, () => {
  console.log(`论坛已启动: http://localhost:${PORT}`);
  console.log(`默认管理员: admin / admin123`);

  // 启动 Bot 引擎（有 bot 才会活动，无 bot 只占用一个 setInterval）
  const { startBotEngine } = require('./lib/bot-engine');
  startBotEngine();
});
