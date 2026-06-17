const express = require('express');
const router = express.Router();
const db = require('../db');
const inventory = require('../lib/inventory');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

router.get('/:username', (req, res) => {
  const profile = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM topics WHERE user_id = u.id) as topic_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count,
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count
    FROM users u WHERE u.username = ?
  `).get(req.params.username);
  if (!profile) return res.render('error', { title: 'ERROR', message: 'USER NOT FOUND' });

  let isFollowing = false;
  if (req.session.user && req.session.user.id !== profile.id) {
    isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(req.session.user.id, profile.id);
  }

  const recentTopics = db.prepare(`
    SELECT t.*, c.name as category_name,
      (SELECT COUNT(*) FROM posts WHERE topic_id = t.id) as reply_count
    FROM topics t JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 5
  `).all(profile.id);

  res.render('user/profile', { profile, recentTopics, isFollowing, saved: req.query.saved });
});

// 关注
router.post('/:username/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (target && target.id !== req.session.user.id) {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)')
      .run(req.session.user.id, target.id);
  }
  res.redirect(`/user/${req.params.username}`);
});

// 取关
router.post('/:username/unfollow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (target) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
      .run(req.session.user.id, target.id);
  }
  res.redirect(`/user/${req.params.username}`);
});

// 粉丝列表（关注 TA 的人）
router.get('/:username/followers', (req, res) => {
  const profile = db.prepare('SELECT id, username, char_name FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.render('error', { title: 'ERROR', message: 'USER NOT FOUND' });
  const users = db.prepare(`
    SELECT u.username, u.char_name, u.avatar, u.role, u.bio
    FROM follows f JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ? ORDER BY f.created_at DESC
  `).all(profile.id);
  res.render('user/follow-list', { profile, users, mode: 'followers' });
});

// 关注列表（TA 关注的人）
router.get('/:username/following', (req, res) => {
  const profile = db.prepare('SELECT id, username, char_name FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.render('error', { title: 'ERROR', message: 'USER NOT FOUND' });
  const users = db.prepare(`
    SELECT u.username, u.char_name, u.avatar, u.role, u.bio
    FROM follows f JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ? ORDER BY f.created_at DESC
  `).all(profile.id);
  res.render('user/follow-list', { profile, users, mode: 'following' });
});

router.get('/:username/edit', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (req.session.user.username !== req.params.username && !isAdmin) {
    return res.redirect(`/user/${req.params.username}`);
  }
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  const items = inventory.list(profile.id);
  res.render('user/edit', { profile, items, error: null, isAdmin, ITEM_TYPES: inventory.ITEM_TYPES, RARITIES: inventory.RARITIES });
});

router.post('/:username/edit', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (req.session.user.username !== req.params.username && !isAdmin) {
    return res.redirect(`/user/${req.params.username}`);
  }

  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);

  if (isAdmin) {
    // 管理员可以编辑所有字段
    const { bio, avatar, char_name, location, gender, age, legend_name, criterion, appearance,
      body_attr, sense_attr, spirit_attr, social_attr, puzzle, weakness,
      ability1_name, ability1_effect, ability2_name, ability2_effect, ability3_name, ability3_effect,
      health_status, energy_level, renown, erosion, puzzle_depth, role, background } = req.body;

    db.prepare(
      'UPDATE users SET bio=?, avatar=?, char_name=?, location=?, gender=?, age=?, legend_name=?, criterion=?, appearance=?, body_attr=?, sense_attr=?, spirit_attr=?, social_attr=?, puzzle=?, weakness=?, ability1_name=?, ability1_effect=?, ability2_name=?, ability2_effect=?, ability3_name=?, ability3_effect=?, health_status=?, energy_level=?, renown=?, erosion=?, puzzle_depth=?, role=?, background=? WHERE username=?'
    ).run(
      bio || null, avatar || null, char_name || null, location || null, gender || null, parseInt(age) || null,
      legend_name || null, criterion || null, appearance || null,
      parseInt(body_attr) || null, parseInt(sense_attr) || null, parseInt(spirit_attr) || null, parseInt(social_attr) || null,
      puzzle || null, weakness || null,
      ability1_name || null, ability1_effect || null,
      ability2_name || null, ability2_effect || null,
      ability3_name || null, ability3_effect || null,
      health_status || null, energy_level || null, parseInt(renown) || null, parseInt(erosion) || null, parseInt(puzzle_depth) || null, role || null,
      background || null,
      req.params.username
    );
  } else {
    // 普通用户只能编辑：角色名 / 头像 / 外貌 / 简介 / 背景
    const { bio, char_name, appearance, avatar, background } = req.body;
    db.prepare('UPDATE users SET bio=?, char_name=?, appearance=?, avatar=?, background=? WHERE username=?').run(
      bio || null, char_name || profile.char_name, appearance || null, avatar || null, background || null,
      req.params.username
    );
  }

  const updated = db.prepare('SELECT id, username, role, avatar FROM users WHERE username = ?').get(req.params.username);
  if (req.session.user.username === req.params.username) {
    req.session.user.avatar = updated.avatar;
  }
  res.redirect(`/user/${req.params.username}?saved=1`);
});

// ===== 背包 =====

// 添加物品
router.post('/:username/inventory/add', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (req.session.user.username !== req.params.username && !isAdmin) {
    return res.redirect(`/user/${req.params.username}`);
  }
  const profile = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.redirect('/');
  const { item_name, item_type, quantity, description, rarity } = req.body;
  if (item_name) {
    inventory.add(profile.id, {
      item_name: item_name.trim(),
      item_type: item_type || 'misc',
      quantity: parseInt(quantity) || 1,
      description: description || '',
      rarity: rarity || 'common'
    });
  }
  res.redirect(`/user/${req.params.username}/edit#inventory`);
});

// 编辑物品
router.post('/:username/inventory/:id/edit', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (req.session.user.username !== req.params.username && !isAdmin) {
    return res.redirect(`/user/${req.params.username}`);
  }
  const profile = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.redirect('/');
  const { item_name, item_type, quantity, description, rarity } = req.body;
  if (item_name) {
    inventory.update(parseInt(req.params.id), profile.id, {
      item_name: item_name.trim(),
      item_type: item_type || 'misc',
      quantity: parseInt(quantity) || 1,
      description: description || '',
      rarity: rarity || 'common'
    });
  }
  res.redirect(`/user/${req.params.username}/edit#inventory`);
});

// 删除物品
router.post('/:username/inventory/:id/delete', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  if (req.session.user.username !== req.params.username && !isAdmin) {
    return res.redirect(`/user/${req.params.username}`);
  }
  const profile = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.redirect('/');
  inventory.remove(parseInt(req.params.id), profile.id);
  res.redirect(`/user/${req.params.username}/edit#inventory`);
});

module.exports = router;
