const express = require('express');
const router = express.Router();
const db = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: '权限不足', message: '新闻仅限管理员发布' });
  }
  next();
}

// 新闻列表（报纸风格）
router.get('/', (req, res) => {
  const news = db.prepare(`
    SELECT n.*, u.username, u.char_name
    FROM news n JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC
  `).all();
  res.render('news/index', { news });
});

// 新建表单（管理员）
router.get('/new', requireAdmin, (req, res) => {
  res.render('news/edit', { item: null, error: null });
});

router.post('/new', requireAdmin, (req, res) => {
  const { title, content, cover } = req.body;
  if (!title || !content) {
    return res.render('news/edit', { item: null, error: '标题和正文必填' });
  }
  const result = db.prepare('INSERT INTO news (title, content, cover, user_id) VALUES (?, ?, ?, ?)')
    .run(title.trim(), content, (cover || '').trim(), req.session.user.id);
  res.redirect(`/news/${result.lastInsertRowid}`);
});

// 单条新闻详情
router.get('/:id', (req, res) => {
  const item = db.prepare(`
    SELECT n.*, u.username, u.char_name
    FROM news n JOIN users u ON u.id = n.user_id
    WHERE n.id = ?
  `).get(req.params.id);
  if (!item) return res.render('error', { title: 'ERROR', message: 'NEWS NOT FOUND' });
  res.render('news/show', { item });
});

// 编辑表单（管理员）
router.get('/:id/edit', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!item) return res.render('error', { title: 'ERROR', message: 'NEWS NOT FOUND' });
  res.render('news/edit', { item, error: null });
});

router.post('/:id/edit', requireAdmin, (req, res) => {
  const { title, content, cover } = req.body;
  const item = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!item) return res.render('error', { title: 'ERROR', message: 'NEWS NOT FOUND' });
  if (!title || !content) {
    return res.render('news/edit', { item, error: '标题和正文必填' });
  }
  db.prepare('UPDATE news SET title = ?, content = ?, cover = ? WHERE id = ?')
    .run(title.trim(), content, (cover || '').trim(), req.params.id);
  res.redirect(`/news/${req.params.id}`);
});

// 删除（管理员）
router.post('/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.redirect('/news');
});

module.exports = router;
