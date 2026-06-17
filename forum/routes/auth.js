const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { COUNTRIES, formatLocation } = require('../lib/locations');

const CRITERIA = ['灯', '杯', '心', '冬', '刃', '启', '铸', '蛾', '蜜', '月', '鳞', '穹'];

router.get('/login', (req, res) => {
  res.render('auth/login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('auth/login', { error: 'INVALID CREDENTIALS' });
  }
  if (user.status === 'pending') {
    return res.render('auth/login', { error: '账号待审核，请等待管理员批准' });
  }
  if (user.status === 'banned') {
    return res.render('auth/login', { error: '账号已被封禁' });
  }
  req.session.user = { id: user.id, username: user.username, nickname: user.nickname, role: user.role, avatar: user.avatar, status: user.status };
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (res.locals.settings.allow_register !== 'true') {
    return res.render('error', { title: 'REGISTRATION CLOSED', message: '管理员已关闭注册' });
  }
  res.render('auth/register', { error: null, criteria: CRITERIA, values: {}, title: 'AWAKEN', COUNTRIES });
});

router.get('/api/locations/:country/:province', (req, res) => {
  // 注册页 JS 动态加载城市列表
  const c = COUNTRIES.find(x => x.code === req.params.country);
  if (!c) return res.json({ cities: [] });
  const p = c.provinces.find(x => x.code === req.params.province);
  res.json({ cities: p ? p.cities : [] });
});

router.post('/register', (req, res) => {
  if (res.locals.settings.allow_register !== 'true') {
    return res.render('error', { title: 'REGISTRATION CLOSED', message: '管理员已关闭注册' });
  }
  const { username, password, password2, nickname, char_name, country_code, province_code, city,
    forum_nick, gender, age,
    legend_name, criterion, appearance, body_attr, sense_attr, spirit_attr, social_attr,
    puzzle, weakness, ability1_name, ability1_effect, ability2_name, ability2_effect, ability3_name, ability3_effect,
    background } = req.body;

  const values = req.body;

  if (!username || !password || !nickname) {
    return res.render('auth/register', { error: '请填写用户ID、昵称和密码', criteria: CRITERIA, values });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.render('auth/register', { error: '用户ID只能包含英文字母、数字和下划线', criteria: CRITERIA, values });
  }
  if (password !== password2) {
    return res.render('auth/register', { error: '两次密码不一致', criteria: CRITERIA, values });
  }
  if (password.length < 6) {
    return res.render('auth/register', { error: '密码至少6位', criteria: CRITERIA, values });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.render('auth/register', { error: '用户ID已被注册', criteria: CRITERIA, values });
  }
  const nickExists = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (nickExists) {
    return res.render('auth/register', { error: '昵称已被使用，请换一个', criteria: CRITERIA, values });
  }

  // Validate attribute points
  const bp = parseInt(body_attr) || 5;
  const sp = parseInt(sense_attr) || 5;
  const mp = parseInt(spirit_attr) || 5;
  const sc = parseInt(social_attr) || 5;
  const total = bp + sp + mp + sc;
  const usedPoints = total - 20;
  if (usedPoints > 8 || bp < 3 || bp > 8 || sp < 3 || sp > 8 || mp < 3 || mp > 8 || sc < 3 || sc > 8) {
    return res.render('auth/register', { error: '属性点数超限: 基础=5, 下限=3, 上限=8, 自由=8, 当前已用=' + usedPoints, criteria: CRITERIA, values, COUNTRIES });
  }

  // 拼接 location
  const location = formatLocation(country_code, province_code, city);

  const hash = bcrypt.hashSync(password, 10);
  // 注意：必须列出所有非默认值字段，列数要与 VALUES 一一对应
  const result = db.prepare(`INSERT INTO users (
    username, password, role, nickname, status,
    char_name, location, country_code, province_code, city, gender, age,
    legend_name, criterion, appearance,
    body_attr, sense_attr, spirit_attr, social_attr,
    puzzle, weakness,
    ability1_name, ability1_effect, ability2_name, ability2_effect, ability3_name, ability3_effect,
    background
  ) VALUES (
    ?,?,?,?,?,
    ?,?,?,?,?,?,?,
    ?,?,?,
    ?,?,?,?,
    ?,?,
    ?,?,?,?,?,?,
    ?
  )`).run(
    username, hash, 'user', nickname || '', 'pending',
    char_name || '', location, country_code || '', province_code || '', city || '', gender || '', parseInt(age) || 0,
    legend_name || '', criterion || '', appearance || '',
    bp, sp, mp, sc,
    puzzle || '', weakness || '',
    ability1_name || '', ability1_effect || '',
    ability2_name || '', ability2_effect || '',
    ability3_name || '', ability3_effect || '',
    background || ''
  );

  res.render('auth/login', { error: 'WAITING REVIEW', message: '注册成功！请等待管理员审核后登录。' });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
