const db = require('../db');

const ITEM_TYPES = ['weapon', 'armor', 'relic', 'consumable', 'tool', 'misc'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'relic'];

function list(userId) {
  return db.prepare('SELECT * FROM user_inventory WHERE user_id = ? ORDER BY rarity DESC, sort_order, created_at').all(userId);
}

function add(userId, data) {
  const { item_name, item_type = 'misc', quantity = 1, description = '', rarity = 'common' } = data;
  return db.prepare(`
    INSERT INTO user_inventory (user_id, item_name, item_type, quantity, description, rarity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, item_name, item_type, quantity, description, rarity);
}

function update(itemId, userId, data) {
  const { item_name, item_type, quantity, description, rarity } = data;
  return db.prepare(`
    UPDATE user_inventory SET item_name=?, item_type=?, quantity=?, description=?, rarity=?
    WHERE id = ? AND user_id = ?
  `).run(item_name, item_type, quantity, description, rarity, itemId, userId);
}

function remove(itemId, userId) {
  return db.prepare('DELETE FROM user_inventory WHERE id = ? AND user_id = ?').run(itemId, userId);
}

module.exports = { list, add, update, remove, ITEM_TYPES, RARITIES };
