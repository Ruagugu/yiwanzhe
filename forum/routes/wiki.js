const express = require('express');
const router = express.Router();
const db = require('../db');

// 百科首页：按分类分组展示
router.get('/', (req, res) => {
  const entries = db.prepare('SELECT * FROM wiki_entries ORDER BY sort_order, id').all();
  // 分组
  const groups = {};
  entries.forEach(e => {
    const cat = e.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(e);
  });
  res.render('wiki/index', { groups, entries });
});

// 单条目详情
router.get('/:id', (req, res) => {
  const entry = db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.render('error', { title: 'ERROR', message: '条目不存在' });

  const prev = db.prepare('SELECT id, title FROM wiki_entries WHERE id < ? ORDER BY id DESC LIMIT 1').get(req.params.id);
  const next = db.prepare('SELECT id, title FROM wiki_entries WHERE id > ? ORDER BY id ASC LIMIT 1').get(req.params.id);

  res.render('wiki/show', { entry, prev, next });
});

module.exports = router;
