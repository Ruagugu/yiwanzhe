// 世界书系统 · 类酒馆 World Info
// 两种作用域：public（所有 bot 共享）、bot（绑定单个 bot）
// 两种激活：常驻（is_constant=1，无条件注入）、关键词触发（命中 bot 上下文才注入）
const db = require('../db');

function splitKeywords(raw) {
  return (raw || '')
    .split(/[,，;；\n]/)
    .map(k => k.trim())
    .filter(Boolean);
}

function listBooks(opts = {}) {
  const { scope, userId } = opts;
  if (scope === 'bot') {
    return db.prepare(`
      SELECT * FROM world_books WHERE scope = 'bot' AND user_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(userId);
  }
  return db.prepare(`
    SELECT * FROM world_books WHERE scope = 'public'
    ORDER BY sort_order ASC, id ASC
  `).all();
}

function getBook(id) {
  return db.prepare('SELECT * FROM world_books WHERE id = ?').get(id);
}

function addBook(data) {
  const { scope = 'public', user_id = null, title = '', keywords = '',
    content, is_constant = 0, enabled = 1, sort_order = 0 } = data;
  return db.prepare(`
    INSERT INTO world_books (scope, user_id, title, keywords, content, is_constant, enabled, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scope, scope === 'bot' ? user_id : null,
    title, keywords, content,
    is_constant ? 1 : 0, enabled ? 1 : 0, parseInt(sort_order) || 0
  );
}

function updateBook(id, data) {
  const { title = '', keywords = '', content, is_constant = 0, sort_order = 0 } = data;
  return db.prepare(`
    UPDATE world_books SET title = ?, keywords = ?, content = ?, is_constant = ?, sort_order = ?
    WHERE id = ?
  `).run(title, keywords, content, is_constant ? 1 : 0, parseInt(sort_order) || 0, id);
}

function toggleBook(id) {
  return db.prepare('UPDATE world_books SET enabled = NOT enabled WHERE id = ?').run(id);
}

function deleteBook(id) {
  return db.prepare('DELETE FROM world_books WHERE id = ?').run(id);
}

// 激活引擎：返回拼好的提示词片段；无激活条目返回 ''
function getWorldBookForContext(botUserId, scanText) {
  const entries = db.prepare(`
    SELECT * FROM world_books
    WHERE enabled = 1 AND (scope = 'public' OR (scope = 'bot' AND user_id = ?))
    ORDER BY sort_order ASC, id ASC
  `).all(botUserId);
  if (entries.length === 0) return '';

  const hay = (scanText || '').toLowerCase();
  const activated = [];
  for (const e of entries) {
    if (e.is_constant) {
      activated.push(e);
      continue;
    }
    const keys = splitKeywords(e.keywords);
    if (keys.length === 0) continue; // 无关键词又非常驻 → 永不触发
    if (keys.some(k => hay.includes(k.toLowerCase()))) {
      activated.push(e);
    }
  }
  if (activated.length === 0) return '';

  let out = '\n# 世界书（你了解的设定与背景）\n';
  for (const e of activated) {
    const heading = e.title || splitKeywords(e.keywords)[0] || '设定';
    out += `## ${heading}\n${e.content}\n\n`;
  }
  return out;
}

// ============================================================
//  兼容酒馆 World Info JSON 导入 / 导出
//  酒馆条目结构 (ST 1.18.x, newWorldInfoEntryDefinition):
//    key: string[]         → keywords (逗号拼接)
//    keysecondary: string[] → 丢弃（论坛简化版不支持 secondary keys）
//    comment: string       → title
//    content: string       → content
//    constant: boolean     → is_constant
//    selective: boolean    → 丢弃（论坛简化版不支持选择性触发）
//    disable: boolean      → !enabled
//    order: number         → sort_order
//  顶层结构: { entries: { "<uid>": { ... } }, name?: string }
//  我们 export 时保留 name + entries 顶层；import 时忽略 uid 值，自动分配。
// ============================================================

function importFromST(jsonString, opts = {}) {
  const { scope = 'public', userId = null } = opts;
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('JSON 解析失败: ' + e.message);
  }

  // 同时支持 { entries: {...} } 和 { entries: [...] } 两种形式
  let entries;
  if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
    entries = Object.values(data.entries);
  } else if (Array.isArray(data.entries)) {
    entries = data.entries;
  } else {
    throw new Error('未找到 entries 字段——这不是有效的酒馆世界书文件');
  }

  if (entries.length === 0) throw new Error('世界书文件中没有任何条目');

  const stmt = db.prepare(`
    INSERT INTO world_books (scope, user_id, title, keywords, content, is_constant, enabled, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    let count = 0;
    for (const entry of rows) {
      // key 可能是字符串或数组
      const rawKeys = entry.key || entry.keys || [];
      const keywords = Array.isArray(rawKeys) ? rawKeys.join(', ') : String(rawKeys);

      const title = entry.comment || entry.name || '';
      const content = entry.content || entry.text || '';
      if (!content.trim()) continue; // 空内容跳过

      const is_constant = entry.constant ? 1 : 0;
      const enabled = entry.disable ? 0 : 1;
      const sort_order = typeof entry.order === 'number' ? entry.order : (entry.insertion_order ?? 100);

      stmt.run(scope, scope === 'bot' ? userId : null, title, keywords, content, is_constant, enabled, sort_order);
      count++;
    }
    return count;
  });

  return insertMany(entries);
}

function exportToST(opts = {}) {
  const { scope = 'public', userId = null } = opts;
  let rows;
  if (scope === 'bot' && userId) {
    rows = db.prepare(`
      SELECT * FROM world_books WHERE scope = 'bot' AND user_id = ? ORDER BY sort_order ASC, id ASC
    `).all(userId);
  } else {
    rows = db.prepare(`
      SELECT * FROM world_books WHERE scope = 'public' ORDER BY sort_order ASC, id ASC
    `).all();
  }

  const entries = {};
  for (const row of rows) {
    entries[row.id] = {
      uid: row.id,
      key: splitKeywords(row.keywords),
      keysecondary: [],
      comment: row.title || '',
      content: row.content,
      constant: row.is_constant === 1,
      selective: true,       // 简化版始终 true（命中关键词才激活）
      vectorized: false,
      selectiveLogic: 0,     // AND_ANY
      addMemo: false,
      order: row.sort_order || 100,
      position: 0,           // before_char
      disable: row.enabled === 0,
      ignoreBudget: false,
      excludeRecursion: false,
      preventRecursion: false,
      matchPersonaDescription: false,
      matchCharacterDescription: false,
      matchCharacterPersonality: false,
      matchCharacterDepthPrompt: false,
      matchScenario: false,
      matchCreatorNotes: false,
      delayUntilRecursion: 0,
      probability: null,
      useProbability: true,
      depth: null,
      outletName: '',
      group: '',
      groupOverride: false,
      groupWeight: 100,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      useGroupScoring: null,
      automationId: '',
      role: 0,
      sticky: null,
      cooldown: null,
      delay: null,
    };
  }

  return JSON.stringify({ entries }, null, 2);
}

module.exports = {
  splitKeywords, listBooks, getBook, addBook, updateBook, toggleBook, deleteBook,
  getWorldBookForContext,
  importFromST, exportToST,
};
