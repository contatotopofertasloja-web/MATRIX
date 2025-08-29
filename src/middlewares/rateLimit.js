// src/middlewares/rateLimit.js
import expressRateLimit from 'express-rate-limit';

const limiter = expressRateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 60,             // 60 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
});

export default function rateLimit(req, res, next) {
  const token = process.env.WEBHOOK_TOKEN;
  // Se tiver token no .env, exige no header Authorization: Bearer <token>
  if (token) {
    const auth = req.headers['authorization'] || '';
    const ok = auth.startsWith('Bearer ') && auth.slice(7) === token;
    if (!ok) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return limiter(req, res, next);
}
