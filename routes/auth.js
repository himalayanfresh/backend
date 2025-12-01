import express from 'express';
import User from '../models/user.js';
import jwt from 'jsonwebtoken';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

function _genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/otp { phone }
router.post('/otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    let user = await User.findOne({ phone });
    if (!user) user = new User({ phone });
    const otp = _genOtp();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await user.save();
    // TODO: integrate real SMS provider. For now, log OTP for testing.
    console.log(`OTP for ${phone}: ${otp}`);
    res.json({ ok: true, hint: 'OTP generated (in dev logged to server)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify { phone, otp }
router.post('/verify', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'phone and otp required' });
    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ error: 'invalid phone or otp' });
    if (!user.otp || !user.otpExpires || user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ error: 'invalid or expired otp' });
    }
    // clear OTP
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    // issue JWT
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const token = jwt.sign({}, secret, { subject: user._id.toString(), expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user._id, phone: user.phone, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me - protected
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ id: user._id, phone: user.phone, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/me - update profile (name, role)
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { name, role } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (typeof name === 'string') user.name = name;
    if (role === 'consumer' || role === 'corporate') user.role = role;
    await user.save();
    res.json({ id: user._id, phone: user.phone, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

