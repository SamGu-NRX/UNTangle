import { Router } from 'express';
import db from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/schedules
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM saved_schedules WHERE user_id = ? ORDER BY updated_at DESC`
  ).all(req.user.id);

  res.json(rows.map(r => ({ ...r, sections: JSON.parse(r.sections) })));
});

// POST /api/schedules
router.post('/', (req, res) => {
  const { name = 'My Schedule', sections } = req.body;
  if (!Array.isArray(sections))
    return res.status(400).json({ error: '`sections` must be an array of section IDs' });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO saved_schedules (user_id, name, sections)
    VALUES (?, ?, ?)
  `).run(req.user.id, name, JSON.stringify(sections));

  const saved = db.prepare(`SELECT * FROM saved_schedules WHERE id = ?`).get(lastInsertRowid);
  res.status(201).json({ ...saved, sections: JSON.parse(saved.sections) });
});

// PUT /api/schedules/:id
router.put('/:id', (req, res) => {
  const { name, sections } = req.body;
  const existing = db.prepare(
    `SELECT * FROM saved_schedules WHERE id = ? AND user_id = ?`
  ).get(req.params.id, req.user.id);

  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  db.prepare(`
    UPDATE saved_schedules
    SET name = ?, sections = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? existing.name,
    sections ? JSON.stringify(sections) : existing.sections,
    existing.id
  );

  const updated = db.prepare(`SELECT * FROM saved_schedules WHERE id = ?`).get(existing.id);
  res.json({ ...updated, sections: JSON.parse(updated.sections) });
});

// DELETE /api/schedules/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare(
    `DELETE FROM saved_schedules WHERE id = ? AND user_id = ?`
  ).run(req.params.id, req.user.id);

  if (info.changes === 0) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ ok: true });
});

export default router;