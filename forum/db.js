const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'forum.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT DEFAULT '',
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    avatar TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    -- character sheet fields
    char_name TEXT DEFAULT '',
    location TEXT DEFAULT '',
    gender TEXT DEFAULT '',
    age INTEGER DEFAULT 0,
    health_status TEXT DEFAULT '健康',
    energy_level TEXT DEFAULT '接触者',
    legend_name TEXT DEFAULT '',
    criterion TEXT DEFAULT '',
    appearance TEXT DEFAULT '',
    body_attr INTEGER DEFAULT 5,
    sense_attr INTEGER DEFAULT 5,
    spirit_attr INTEGER DEFAULT 5,
    social_attr INTEGER DEFAULT 5,
    free_points INTEGER DEFAULT 8,
    renown INTEGER DEFAULT 0,
    erosion INTEGER DEFAULT 0,
    puzzle TEXT DEFAULT '',
    weakness TEXT DEFAULT '',
    puzzle_depth INTEGER DEFAULT 0,
    ability1_name TEXT DEFAULT '',
    ability1_effect TEXT DEFAULT '',
    ability2_name TEXT DEFAULT '',
    ability2_effect TEXT DEFAULT '',
    ability3_name TEXT DEFAULT '',
    ability3_effect TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    post_role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category_id INTEGER,
    user_id INTEGER NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    topic_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    cover TEXT DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

  // Bot / NPC 账号配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      system_prompt TEXT NOT NULL,
      model TEXT DEFAULT 'claude-sonnet-4-6',
      api_key TEXT NOT NULL DEFAULT '',
      api_base TEXT DEFAULT '',
      activity_interval INTEGER DEFAULT 900,
      is_active INTEGER DEFAULT 1,
      last_action_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bot_action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      params TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      error TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      item_type TEXT DEFAULT 'misc',
      quantity INTEGER DEFAULT 1,
      description TEXT DEFAULT '',
      rarity TEXT DEFAULT 'common',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS npc_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT DEFAULT 'general',
      content TEXT NOT NULL,
      source TEXT DEFAULT '',
      weight REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      from_user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      topic_id INTEGER,
      post_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS world_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'public',
      user_id INTEGER,
      title TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      content TEXT NOT NULL,
      is_constant INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

// 迁移：给已存在的 categories 表补 post_role 字段（user=所有人可发, admin=仅管理员）
const catCols = db.prepare("PRAGMA table_info(categories)").all();
if (!catCols.some(c => c.name === 'post_role')) {
  db.exec("ALTER TABLE categories ADD COLUMN post_role TEXT DEFAULT 'user'");
  // 历史数据：WCSC通告 设为仅管理员
  db.prepare("UPDATE categories SET post_role = 'admin' WHERE name = 'WCSC通告'").run();
}

// 迁移：给 users 表补 api_token 字段
const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some(c => c.name === 'api_token')) {
  db.exec("ALTER TABLE users ADD COLUMN api_token TEXT DEFAULT ''");
}
// 迁移：给 users 表补 nickname 字段（公开显示的昵称，区别于登录用的 username）
if (!userCols.some(c => c.name === 'nickname')) {
  db.exec("ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''");
}
// 迁移：给 users 表补 status 字段（active=已审核, pending=待审核, banned=封禁）
if (!userCols.some(c => c.name === 'status')) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
  // 现有用户全部默认 active
  db.exec("UPDATE users SET status = 'active'");
}
// 迁移：给 users 表补 country / province / city 字段（用于精确地理位置）
if (!userCols.some(c => c.name === 'country_code')) {
  db.exec("ALTER TABLE users ADD COLUMN country_code TEXT DEFAULT ''");
  db.exec("ALTER TABLE users ADD COLUMN province_code TEXT DEFAULT ''");
  db.exec("ALTER TABLE users ADD COLUMN city TEXT DEFAULT ''");
  // 现有 location 字段不重写，保持兼容
}
// 迁移：给 users 表补 background 字段（角色背景故事）
if (!userCols.some(c => c.name === 'background')) {
  db.exec("ALTER TABLE users ADD COLUMN background TEXT DEFAULT ''");
}

// 插入默认数据
function initDefaults() {
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, email, password, role, char_name, location, gender, age, legend_name, criterion, appearance, body_attr, sense_attr, spirit_attr, social_attr, puzzle, weakness)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('admin', '', hash, 'admin',
      'WCSC管理员', '中国|上海|浦东', '保密', 0, '官方权限', '灯', '身着制式黑色风衣的官方人员', 5, 5, 5, 5, '秩序如何维持？', '普通人体质');
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount === 0) {
    const cats = [
      ['情报交换', '异常现象、WCSC内部动态等真假难辨的信息流动', 'user'],
      ['委托发布', '从寻猫到调查具名者失控，酬劳包括现金/遗物/能力协助', 'user'],
      ['知识共享', '【谜题】理解、能力开发心得、准则研究交流', 'user'],
      ['匿名社交', '超越者唯一的自由呼吸空间，无需伪装', 'user'],
      ['日常分享', '普通生活内容 —— 你是普通人，也是传说', 'user'],
      ['WCSC通告', '世界认知稳定理事会官方公告，高危通缉令与重要信息', 'admin'],
    ];
    const stmt = db.prepare('INSERT INTO categories (name, description, sort_order, post_role) VALUES (?, ?, ?, ?)');
    cats.forEach((c, i) => stmt.run(c[0], c[1], i, c[2]));
  }

  const settingsDefaults = {
    site_name: '遗忘者归乡',
    site_description: '超越者的加密匿名社区 —— 传说从未沉默',
    custom_css: '',
    posts_per_page: '20',
    allow_register: 'true',
    footer_text: '遗忘者归乡 · 未知起源 · 无法定位',
    global_api_key: '',
    global_api_base: '',
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settingsDefaults)) {
    stmt.run(k, v);
  }

  // 读取并运行 lib/world-setting.js 的默认 SUMMARY，然后写入 settings.world_prompt
  try {
    const { WORLD_SUMMARY: defaultPrompt } = require('./lib/world-setting');
    if (defaultPrompt) {
      stmt.run('world_prompt', defaultPrompt);
    }
  } catch (e) {
    console.error('Failed to init world_prompt:', e.message);
  }
}

initDefaults();

module.exports = db;
