import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'untangle_dev_secret';

export function requireAuth(req, res, next) {
  const token = req.cookies.token
    || req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function issueToken(user) {
  return jwt.sign(
    { id: user.id, euid: user.unt_euid, name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}