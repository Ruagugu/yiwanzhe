const express = require('express');
const router = express.Router();
const db = require('../db');
const { notifyMentions } = require('../lib/notify');

// 需要登录的中间件
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// 分类下的主题列表
router.get('/category/:id', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = parseInt(res.locals.settings.posts_per_page) || 20;
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.render('error', { title: '错误', message: '分类不存在' });

  const total = db.prepare('SELECT COUNT(*) as c FROM topics WHERE category_id = ?').get(req.params.id).c;
  const topics = db.prepare(`
    SELECT t.*, u.username, u.nickname,
      (SELECT COUNT(*) FROM posts WHERE topic_id = t.id) as reply_count,
      (SELECT created_at FROM posts WHERE topic_id = t.id ORDER BY created_at DESC LIMIT 1) as last_reply_at
    FROM topics t JOIN users u ON t.user_id = u.id
    WHERE t.category_id = ?
    ORDER BY t.is_pinned DESC, t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, perPage, (page - 1) * perPage);

  res.render('topics/category', {
    category, topics, page, perPage, total,
    totalPages: Math.ceil(total / perPage)
  });
});

// 需要管理员权限
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/auth/login');
  }
  next();
}

// 新建主题
router.get('/new', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all()
    .filter(c => isAdmin || c.post_role !== 'admin');
  res.render('topics/new', { categories, error: null, categoryId: req.query.cat || '' });
});

router.post('/new', requireAuth, (req, res) => {
  const { title, content, category_id } = req.body;
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  if (!title || !content || !category_id) {
    return res.render('topics/new', { categories, error: 'ALL FIELDS REQUIRED', categoryId: category_id });
  }
  // 板块权限校验
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(category_id);
  if (!cat) {
    return res.render('topics/new', { categories, error: '分类不存在', categoryId: category_id });
  }
  if (cat.post_role === 'admin' && req.session.user.role !== 'admin') {
    return res.render('topics/new', { categories, error: `「${cat.name}」仅限管理员发布`, categoryId: category_id });
  }
  const result = db.prepare('INSERT INTO topics (title, content, category_id, user_id) VALUES (?, ?, ?, ?)').run(title, content, category_id, req.session.user.id);
  notifyMentions(content, result.lastInsertRowid, null, req.session.user.id);
  res.redirect(`/topics/${result.lastInsertRowid}`);
});

// 查看主题（楼中楼支持）
router.get('/:id', (req, res) => {
  const topic = db.prepare(`
    SELECT t.*, u.username, u.nickname, u.id as user_id, u.avatar, u.bio, u.role, u.created_at as user_joined,
      c.name as category_name, c.id as category_id
    FROM topics t
    JOIN users u ON t.user_id = u.id
    JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!topic) return res.render('error', { title: 'ERROR', message: 'TOPIC NOT FOUND' });

  db.prepare('UPDATE topics SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);

  // All top-level posts + their sub-replies
  const topPosts = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar, u.role, u.created_at as user_joined, u.bio
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.topic_id = ? AND p.parent_id IS NULL
    ORDER BY p.created_at ASC
  `).all(req.params.id);

  // 拉取所有非顶层回复，按 parent_id 索引
  const subReplies = db.prepare(`
    SELECT p.*, u.username, u.nickname, u.avatar, u.role, u.created_at as user_joined, u.bio
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.topic_id = ? AND p.parent_id IS NOT NULL
    ORDER BY p.created_at ASC
  `).all(req.params.id);

  // 父级信息（昵称/用户名）按 id 索引，方便子回复定位自己的 parent
  const userById = {};
  db.prepare('SELECT id, username, nickname FROM users').all().forEach(u => { userById[u.id] = u; });

  // 父级 post 信息也建索引，用于楼中楼嵌套时定位 parent_nickname/parent_username
  const postById = {};
  topPosts.forEach(p => { postById[p.id] = p; });
  subReplies.forEach(p => { postById[p.id] = p; });

  // 渲染时用的 parent 视图字段（昵称/用户名）
  function withParent(post) {
    const parent = postById[post.parent_id];
    if (parent) {
      const pu = userById[parent.user_id];
      post.parent_nickname = (pu && pu.nickname) || (pu && pu.username) || '';
      post.parent_username = (pu && pu.username) || '';
    } else {
      post.parent_nickname = '';
      post.parent_username = '';
    }
    return post;
  }
  topPosts.forEach(withParent);
  subReplies.forEach(withParent);

  // Group sub-replies by parent_id（任意层级都可以）
  const children = {};
  subReplies.forEach(r => {
    if (!children[r.parent_id]) children[r.parent_id] = [];
    children[r.parent_id].push(r);
  });

  res.render('topics/show', { topic, posts: topPosts, children, userById });
});

// 回复（支持楼中楼）
router.post('/:id/reply', requireAuth, (req, res) => {
  const { content, parent_id } = req.body;
  if (!content) return res.redirect(`/topics/${req.params.id}`);
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic || topic.is_locked) return res.redirect(`/topics/${req.params.id}`);

  // 校验 parent_id 必须属于当前主题（防止越权指向其他帖子）
  let pid = null;
  if (parent_id) {
    const parent = db.prepare('SELECT id, topic_id FROM posts WHERE id = ?').get(parent_id);
    if (parent && parent.topic_id === topic.id) {
      pid = parent.id;
    }
  }

  const result = db.prepare('INSERT INTO posts (content, topic_id, user_id, parent_id) VALUES (?, ?, ?, ?)').run(content, req.params.id, req.session.user.id, pid);
  notifyMentions(content, parseInt(req.params.id), result.lastInsertRowid, req.session.user.id);
  res.redirect(`/topics/${req.params.id}`);
});

// 删除主题（管理员）
router.post('/:id/delete', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect(`/topics/${req.params.id}`);
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.redirect('/');
  db.prepare('DELETE FROM posts WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.id);
  res.redirect(`/topics/category/${topic.category_id}`);
});

// 置顶/锁定（管理员）
router.post('/:id/toggle-pin', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect('/');
  db.prepare('UPDATE topics SET is_pinned = NOT is_pinned WHERE id = ?').run(req.params.id);
  res.redirect(`/topics/${req.params.id}`);
});

router.post('/:id/toggle-lock', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect('/');
  db.prepare('UPDATE topics SET is_locked = NOT is_locked WHERE id = ?').run(req.params.id);
  res.redirect(`/topics/${req.params.id}`);
});

module.exports = router;
