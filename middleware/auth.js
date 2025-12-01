import jwt from 'jsonwebtoken';

export default function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const data = jwt.verify(token, secret);
    // set userId on request
    req.userId = data.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
