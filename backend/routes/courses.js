import { Router } from 'express';
import db from '../db/database.js';

const router = Router();

// GET /api/courses?subject=CSCE&term=2025FA&q=systems
router.get('/', (req, res) => {
  const { subject, term, q } = req.query;

  let sql = `
    SELECT
      c.id as course_id, c.subject, c.number, c.title, c.credits,
      s.id as section_id, s.section_code, s.instructor,
      s.days, s.start_time, s.end_time,
      s.location, s.building_code,
      s.max_seats, s.open_seats, s.term
    FROM courses c
    JOIN sections s ON s.course_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (subject) { sql += ` AND c.subject = ?`;                          params.push(subject.toUpperCase()); }
  if (term)    { sql += ` AND s.term = ?`;                              params.push(term); }
  if (q)       { sql += ` AND (c.title LIKE ? OR c.number LIKE ? OR c.subject LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  sql += ` ORDER BY c.subject, c.number, s.section_code`;

  res.json(db.prepare(sql).all(...params));
});

// GET /api/courses/subjects — unique department list
router.get('/subjects', (_req, res) => {
  const subjects = db.prepare(
    `SELECT DISTINCT subject FROM courses ORDER BY subject`
  ).all();
  res.json(subjects.map(r => r.subject));
});

// GET /api/courses/:subject/:number — single course with all sections
router.get('/:subject/:number', (req, res) => {
  const course = db.prepare(
    `SELECT * FROM courses WHERE subject = ? AND number = ?`
  ).get(req.params.subject.toUpperCase(), req.params.number);

  if (!course) return res.status(404).json({ error: 'Course not found' });

  const sections = db.prepare(
    `SELECT * FROM sections WHERE course_id = ? ORDER BY section_code`
  ).all(course.id);

  res.json({ ...course, sections });
});

export default router;