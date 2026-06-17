const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { clearBotsFromQueue } = require('../lib/bot-engine');

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: '权限不足', message: '需要管理员权限' });
  }
  next();
}

router.get('/', requireAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    topics: db.prepare('SELECT COUNT(*) as c FROM topics').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    categories: db.prepare('SELECT COUNT(*) as c FROM categories').get().c,
  };
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.render('admin/dashboard', { stats, categories, saved: req.query.saved });
});

router.get('/settings', requireAdmin, (req, res) => {
  const { DEFAULT_SUMMARY } = require('../lib/world-setting');
  res.render('admin/settings', { saved: req.query.saved, worldPromptDefault: DEFAULT_SUMMARY });
});

router.post('/settings', requireAdmin, (req, res) => {
  const { site_name, site_description, custom_css, posts_per_page, allow_register, footer_text, world_prompt, global_api_key, global_api_base } = req.body;
  const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  stmt.run(site_name, 'site_name');
  stmt.run(site_description, 'site_description');
  stmt.run(custom_css || '', 'custom_css');
  stmt.run(posts_per_page || '20', 'posts_per_page');
  stmt.run(allow_register === 'on' ? 'true' : 'false', 'allow_register');
  stmt.run(footer_text || '', 'footer_text');
  if (typeof world_prompt === 'string' && world_prompt.trim()) {
    stmt.run(world_prompt, 'world_prompt');
  }
  stmt.run(global_api_key || '', 'global_api_key');
  stmt.run(global_api_base || '', 'global_api_base');
  res.redirect('/admin/settings?saved=1');
});

// 分类管理
router.post('/categories/add', requireAdmin, (req, res) => {
  const { name, description, post_role } = req.body;
  if (name) {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get().m || 0;
    const role = post_role === 'admin' ? 'admin' : 'user';
    db.prepare('INSERT INTO categories (name, description, sort_order, post_role) VALUES (?, ?, ?, ?)').run(name, description || '', maxOrder + 1, role);
  }
  res.redirect('/admin');
});

router.post('/categories/:id/delete', requireAdmin, (req, res) => {
  const topicCount = db.prepare('SELECT COUNT(*) as c FROM topics WHERE category_id = ?').get(req.params.id).c;
  if (topicCount > 0) {
    return res.redirect('/admin?error=cat-has-topics');
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

router.post('/categories/:id/edit', requireAdmin, (req, res) => {
  const { name, description, post_role } = req.body;
  const role = post_role === 'admin' ? 'admin' : 'user';
  db.prepare('UPDATE categories SET name = ?, description = ?, post_role = ? WHERE id = ?').run(name, description || '', role, req.params.id);
  res.redirect('/admin');
});

// 用户管理
router.get('/users', requireAdmin, (req, res) => {
  const allUsers = db.prepare('SELECT id, username, nickname, email, role, status, created_at FROM users ORDER BY created_at DESC').all();
  res.render('admin/users', { users: allUsers });
});

// 审核注册申请
router.post('/users/:id/approve', requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/users');
});

router.post('/users/:id/reject', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.redirect('/admin/users');
});

// 审核详情：查看待审核用户的完整注册内容
router.get('/users/:id/review', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.render('error', { title: 'ERROR', message: 'USER NOT FOUND' });
  const items = require('../lib/inventory').list(u.id);
  res.render('admin/user-review', { u, items });
});

// ===== NPC 记忆管理 =====
const { addMemory: addMemoryDb, listMemories, deleteMemory, getMemoriesForContext } = require('../lib/npc-memory');

router.get('/memories', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, nickname, char_name, role FROM users ORDER BY id").all();
  const selectedUserId = parseInt(req.query.user_id) || (users[0] && users[0].id);
  const memories = selectedUserId ? listMemories(selectedUserId, { limit: 200, minWeight: 0 }) : [];
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM npc_memories').get().c;
  res.render('admin/memories', { users, memories, selectedUserId, totalCount });
});

router.post('/memories/add', requireAdmin, (req, res) => {
  const { user_id, content, category, source, weight } = req.body;
  if (user_id && content) {
    addMemoryDb(parseInt(user_id), content.trim(), {
      category: category || 'general',
      source: source || '',
      weight: parseFloat(weight) || 0.5
    });
  }
  res.redirect('/admin/memories?user_id=' + user_id);
});

router.post('/memories/:id/delete', requireAdmin, (req, res) => {
  deleteMemory(parseInt(req.params.id), parseInt(req.query.user_id));
  res.redirect('/admin/memories?user_id=' + req.query.user_id);
});

// ===== 世界书管理 =====
const worldBook = require('../lib/world-book');

router.get('/world-books', requireAdmin, (req, res) => {
  const scope = req.query.scope === 'bot' ? 'bot' : 'public';
  const bots = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.char_name
    FROM bots b JOIN users u ON u.id = b.user_id ORDER BY b.id
  `).all();
  let selectedUserId = parseInt(req.query.user_id) || (bots[0] && bots[0].id) || null;
  const books = scope === 'bot'
    ? (selectedUserId ? worldBook.listBooks({ scope: 'bot', userId: selectedUserId }) : [])
    : worldBook.listBooks({ scope: 'public' });
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM world_books').get().c;
  res.render('admin/world-books', { scope, bots, selectedUserId, books, totalCount, imported: req.query.imported, error: req.query.error });
});

function backToBooks(req) {
  const scope = req.body.scope === 'bot' ? 'bot' : 'public';
  let url = '/admin/world-books?scope=' + scope;
  if (scope === 'bot' && req.body.user_id) url += '&user_id=' + req.body.user_id;
  return url;
}

router.post('/world-books/add', requireAdmin, (req, res) => {
  const { scope, user_id, title, keywords, content, is_constant, sort_order } = req.body;
  if (content && content.trim()) {
    worldBook.addBook({
      scope: scope === 'bot' ? 'bot' : 'public',
      user_id: scope === 'bot' ? parseInt(user_id) : null,
      title: title || '',
      keywords: keywords || '',
      content: content.trim(),
      is_constant: is_constant === 'on' ? 1 : 0,
      sort_order: parseInt(sort_order) || 0,
    });
  }
  res.redirect(backToBooks(req));
});

router.post('/world-books/:id/edit', requireAdmin, (req, res) => {
  const { title, keywords, content, is_constant, sort_order } = req.body;
  if (content && content.trim()) {
    worldBook.updateBook(parseInt(req.params.id), {
      title: title || '',
      keywords: keywords || '',
      content: content.trim(),
      is_constant: is_constant === 'on' ? 1 : 0,
      sort_order: parseInt(sort_order) || 0,
    });
  }
  res.redirect(backToBooks(req));
});

router.post('/world-books/:id/toggle', requireAdmin, (req, res) => {
  worldBook.toggleBook(parseInt(req.params.id));
  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.query.ajax) {
    const book = worldBook.getBook(parseInt(req.params.id));
    return res.json({ ok: true, id: book.id, enabled: book.enabled });
  }
  res.redirect(backToBooks(req));
});

// 批量操作
router.post('/world-books/batch', requireAdmin, (req, res) => {
  const ids = (req.body.ids || []).map(id => parseInt(id)).filter(Boolean);
  const action = req.body.action;
  const scope = req.body.scope === 'bot' ? 'bot' : 'public';
  const userId = scope === 'bot' ? parseInt(req.body.user_id) : null;

  if (ids.length === 0) return res.redirect(backToBooks(req));

  if (action === 'enable') {
    db.prepare('UPDATE world_books SET enabled = 1 WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  } else if (action === 'disable') {
    db.prepare('UPDATE world_books SET enabled = 0 WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  } else if (action === 'delete') {
    db.prepare('DELETE FROM world_books WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  }
  res.redirect(backToBooks(req));
});

router.post('/world-books/:id/delete', requireAdmin, (req, res) => {
  worldBook.deleteBook(parseInt(req.params.id));
  res.redirect(backToBooks(req));
});

// 导出当前作用域的世界书为酒馆 JSON
router.get('/world-books/export', requireAdmin, (req, res) => {
  const scope = req.query.scope === 'bot' ? 'bot' : 'public';
  const userId = scope === 'bot' ? parseInt(req.query.user_id) : null;
  const json = worldBook.exportToST({ scope, userId });
  const filename = 'world-book-' + scope + (userId ? '-' + userId : '') + '.json';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
  res.send(json);
});

// 从酒馆 JSON 导入世界书条目（支持粘贴文本 + 上传文件）
router.post('/world-books/import', requireAdmin, upload.single('file'), (req, res) => {
  const scope = req.body.scope === 'bot' ? 'bot' : 'public';
  const userId = scope === 'bot' ? parseInt(req.body.user_id) : null;
  // 优先取上传文件内容，其次取粘贴文本
  let jsonString = '';
  if (req.file) {
    jsonString = req.file.buffer.toString('utf-8');
  } else {
    jsonString = req.body.json || '';
  }
  if (!jsonString || !jsonString.trim()) {
    return res.redirect(backToBooks(req) + '&error=empty-import');
  }
  try {
    worldBook.importFromST(jsonString, { scope, userId });
  } catch (e) {
    return res.redirect(backToBooks(req) + '&error=' + encodeURIComponent(e.message));
  }
  res.redirect(backToBooks(req) + '&imported=1');
});

router.post('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (['admin', 'moderator', 'user'].includes(role)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) return res.redirect('/admin/users');
  const uid = req.params.id;
  // 清理所有关联数据——遵守外键约束
  db.prepare('DELETE FROM bot_action_logs WHERE bot_id IN (SELECT id FROM bots WHERE user_id = ?)').run(uid);
  db.prepare('DELETE FROM bots WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(uid, uid);
  db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(uid, uid);
  db.prepare('DELETE FROM news WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM posts WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM topics WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  res.redirect('/admin/users');
});

// ===== Bot 管理 =====

// 动态拉取模型列表（从前端传入的 api_base）
router.post('/bots/models', requireAdmin, (req, res) => {
  const { api_base, api_key } = req.body;
  if (!api_base) return res.json({ error: '请先填写 API 代理地址', models: [] });

  const base = api_base.replace(/\/+$/, '');
  fetch(base + '/v1/models', {
    headers: api_key ? { Authorization: 'Bearer ' + api_key } : {},
    signal: AbortSignal.timeout(10000)
  }).then(r => r.json()).then(data => {
    const models = (data.data || []).map(m => ({ id: m.id }));
    res.json({ models, error: null });
  }).catch(err => {
    res.json({ models: [], error: '拉取失败: ' + err.message });
  });
});

router.get('/bots', requireAdmin, (req, res) => {
  const bots = db.prepare(`
    SELECT b.*, u.username, u.char_name, u.legend_name, u.criterion, u.avatar,
      (SELECT COUNT(*) FROM bot_action_logs WHERE bot_id = b.id AND created_at >= datetime('now', '-24 hours')) as actions_today,
      (SELECT created_at FROM bot_action_logs WHERE bot_id = b.id ORDER BY created_at DESC LIMIT 1) as last_action
    FROM bots b JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC
  `).all();
  const activeTab = req.query.tab === 'create' ? 'create' : 'list';
  res.render('admin/bots', { bots, error: null, activeTab });
});

// 批量操作
router.post('/bots/batch', requireAdmin, (req, res) => {
  const ids = (req.body.bot_ids || []).map(id => parseInt(id)).filter(Boolean);
  const action = req.body.action;
  if (ids.length === 0) return res.redirect('/admin/bots');

  if (action === 'enable') {
    db.prepare('UPDATE bots SET is_active = 1 WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
  } else if (action === 'disable') {
    db.prepare('UPDATE bots SET is_active = 0 WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
    clearBotsFromQueue(ids);
  } else if (action === 'delete') {
    // 先找出 user_id，再级联删除
    const placeholders = ids.map(() => '?').join(',');
    const botRows = db.prepare('SELECT id, user_id FROM bots WHERE id IN (' + placeholders + ')').all(...ids);
    clearBotsFromQueue(ids);
    db.prepare('DELETE FROM bot_action_logs WHERE bot_id IN (' + placeholders + ')').run(...ids);
    db.prepare('DELETE FROM bots WHERE id IN (' + placeholders + ')').run(...ids);
    const userIds = botRows.map(r => r.user_id);
    if (userIds.length) {
      const uph = userIds.map(() => '?').join(',');
      db.prepare('DELETE FROM users WHERE id IN (' + uph + ')').run(...userIds);
    }
  }
  res.redirect('/admin/bots');
});

router.post('/bots/new', requireAdmin, (req, res) => {
  const { display_name, system_prompt, model, api_key, api_base, activity_interval,
    char_name, legend_name, criterion, appearance, bio, avatar } = req.body;

  if (!display_name || !system_prompt) {
    const bots = db.prepare(`
      SELECT b.*, u.username, u.char_name, u.legend_name, u.criterion, u.avatar
      FROM bots b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC
    `).all();
    return res.render('admin/bots', { bots, error: '显示名称和系统提示词为必填项' });
  }

  const maxId = db.prepare('SELECT MAX(id) as m FROM users').get().m || 0;
  const username = 'bot_' + (maxId + 1);
  const hash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

  const userResult = db.prepare(`INSERT INTO users (username, password, role, char_name, legend_name, criterion, appearance, bio, avatar)
    VALUES (?, ?, 'bot', ?, ?, ?, ?, ?, ?)`).run(
    username, hash,
    char_name || display_name, legend_name || '', criterion || '', appearance || '', bio || '', avatar || ''
  );

  db.prepare(`INSERT INTO bots (user_id, display_name, system_prompt, model, api_key, api_base, activity_interval)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    userResult.lastInsertRowid, display_name, system_prompt,
    model || 'claude-sonnet-4-6', api_key || '', api_base || '',
    parseInt(activity_interval) || 900
  );

  res.redirect('/admin/bots');
});

router.post('/bots/:id/edit', requireAdmin, (req, res) => {
  const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
  if (!bot) return res.redirect('/admin/bots');

  const { display_name, system_prompt, model, api_key, api_base, activity_interval,
    char_name, legend_name, criterion, appearance, bio, avatar } = req.body;

  db.prepare('UPDATE users SET char_name=?, legend_name=?, criterion=?, appearance=?, bio=?, avatar=? WHERE id=?')
    .run(char_name || '', legend_name || '', criterion || '', appearance || '', bio || '', avatar || '', bot.user_id);

  db.prepare('UPDATE bots SET display_name=?, system_prompt=?, model=?, api_key=?, api_base=?, activity_interval=? WHERE id=?')
    .run(display_name || '', system_prompt, model || 'claude-sonnet-4-6', api_key || '', api_base || '',
      parseInt(activity_interval) || 900, req.params.id);

  res.redirect('/admin/bots');
});

router.post('/bots/:id/toggle', requireAdmin, (req, res) => {
  db.prepare('UPDATE bots SET is_active = NOT is_active WHERE id = ?').run(req.params.id);
  const bot = db.prepare('SELECT is_active FROM bots WHERE id = ?').get(req.params.id);
  if (bot && !bot.is_active) {
    clearBotsFromQueue([parseInt(req.params.id)]);
  }
  res.redirect('/admin/bots');
});

router.post('/bots/:id/trigger', requireAdmin, (req, res) => {
  const bot = db.prepare(`
    SELECT b.*, u.username, u.char_name, u.legend_name, u.criterion
    FROM bots b JOIN users u ON u.id = b.user_id
    WHERE b.id = ?
  `).get(req.params.id);
  if (bot) {
    const { run } = require('../lib/bot-engine');
    run(bot);
  }
  res.redirect('/admin/bots');
});

router.post('/bots/:id/delete', requireAdmin, (req, res) => {
  const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
  if (bot) {
    db.prepare('DELETE FROM bot_action_logs WHERE bot_id = ?').run(bot.id);
    db.prepare('DELETE FROM bots WHERE id = ?').run(bot.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(bot.user_id);
  }
  res.redirect('/admin/bots');
});

// 提示词预览（只读，不调 LLM）
router.get('/bots/:id/preview', requireAdmin, (req, res) => {
  const bot = db.prepare(`
    SELECT b.*, u.username, u.nickname, u.char_name, u.legend_name, u.criterion
    FROM bots b JOIN users u ON u.id = b.user_id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bot) return res.status(404).render('error', { title: 'NOT FOUND', message: 'BOT NOT FOUND' });

  const preview = require('../lib/prompt-preview').buildPrompt(bot);
  res.render('admin/bot-preview', { preview });
});

module.exports = router;
