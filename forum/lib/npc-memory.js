// NPC 记忆系统 · 为每个用户（bot/NPC）存储可被 LLM 检索的长期记忆
const db = require('../db');

function addMemory(userId, content, opts = {}) {
  const { category = 'general', source = '', weight = 0.5 } = opts;
  return db.prepare(`
    INSERT INTO npc_memories (user_id, category, content, source, weight)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, category, content, source, weight);
}

function listMemories(userId, opts = {}) {
  const { limit = 50, minWeight = 0 } = opts;
  return db.prepare(`
    SELECT * FROM npc_memories
    WHERE user_id = ? AND weight >= ?
    ORDER BY weight DESC, created_at DESC
    LIMIT ?
  `).all(userId, minWeight, limit);
}

function deleteMemory(memoryId, userId) {
  return db.prepare('DELETE FROM npc_memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
}

function getMemoriesForContext(userId, opts = {}) {
  const { limit = 20, minWeight = 0.3 } = opts;
  const rows = listMemories(userId, { limit, minWeight });
  if (rows.length === 0) return '';
  let ctx = '\n# 你的长期记忆（你此前积累的认知）\n';
  for (const m of rows) {
    const cat = m.category && m.category !== 'general' ? `[${m.category}] ` : '';
    ctx += `- ${cat}${m.content}（权重 ${m.weight.toFixed(1)}，${m.created_at.split(' ')[0]}）\n`;
  }
  return ctx;
}

module.exports = { addMemory, listMemories, deleteMemory, getMemoriesForContext };
