import { Router } from 'express';
import fetch from 'node-fetch';
import db from '../db/database.js';
import { issueToken, requireAuth } from '../middleware/auth.js';

const router = Router();

const CAS_BASE    = 'https://login.unt.edu/cas';
const SERVICE_URL = encodeURIComponent('http://localhost:5500/cas-callback.html');

// Redirect to UNT CAS login
router.get('/unt/login', (_req, res) => {
  res.redirect(`${CAS_BASE}/login?service=${SERVICE_URL}`);
});

// Validate CAS ticket
router.get('/unt/callback', async (req, res) => {
  const { ticket } = req.query;
  if (!ticket) return res.status(400).json({ error: 'Missing ticket' });

  try {
    const validateUrl = `${CAS_BASE}/serviceValidate?ticket=${ticket}&service=${SERVICE_URL}&format=JSON`;
    const casRes  = await fetch(validateUrl);
    const casData = await casRes.json();

    const auth = casData?.serviceResponse?.authenticationSuccess;
    if (!auth) return res.status(401).json({ error: 'CAS validation failed' });

    const euid = auth.user;
    const name = auth.attributes?.displayName || euid;

    db.prepare(`
      INSERT INTO users (unt_euid, display_name, role)
      VALUES (@euid, @name, 'student')
      ON CONFLICT(unt_euid) DO UPDATE SET display_name = @name
    `).run({ euid, name });

    const user  = db.prepare('SELECT * FROM users WHERE unt_euid = ?').get(euid);
    const token = issueToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ user: { id: user.id, name: user.display_name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'CAS callback failed', detail: err.message });
  }
});

// Guest login
router.post('/guest', (_req, res) => {
  const name = `Guest_${Math.random().toString(36).slice(2, 7)}`;

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (unt_euid, display_name, role) VALUES (NULL, @name, 'guest')
  `).run({ name });

  const user  = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  const token = issueToken(user);

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.json({ user: { id: user.id, name: user.display_name, role: user.role } });
});

// Who am I?
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Logout
router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;
