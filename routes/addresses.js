import express from 'express';
import Address from '../models/address.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Public endpoint: GET /api/addresses/:id (for simulator/internal use)
// This needs to be BEFORE the auth middleware
router.get('/:id', async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);
    if (!address) return res.status(404).json({ error: 'Address not found' });
    res.json(address);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// All other endpoints require auth; req.userId is set by middleware
router.use(auth);

// GET /api/addresses
router.get('/', async (req, res) => {
  const userId = req.userId;
  const list = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  res.json(list);
});

// POST /api/addresses
router.post('/', async (req, res) => {
  try {
    const { 
      label, 
      customerName, 
      phoneNumber,
      flatNumber,
      houseNumber,
      line1, 
      landmark,
      city, 
      state,
      pin,
      latitude,
      longitude
    } = req.body;
    const userId = req.userId;
    const a = new Address({ 
      label, 
      customerName, 
      phoneNumber,
      flatNumber,
      houseNumber,
      line1, 
      landmark,
      city, 
      state,
      pin, 
      latitude,
      longitude,
      userId 
    });
    // if first address for user, set default
    const existing = await Address.countDocuments({ userId });
    if (existing == 0) a.isDefault = true;
    await a.save();
    res.status(201).json(a);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/addresses/:id
router.put('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const updates = (({ 
      label, 
      customerName, 
      phoneNumber,
      flatNumber,
      houseNumber,
      line1, 
      landmark,
      city, 
      state,
      pin,
      latitude,
      longitude
    }) => ({ 
      label, 
      customerName, 
      phoneNumber,
      flatNumber,
      houseNumber,
      line1, 
      landmark,
      city, 
      state,
      pin,
      latitude,
      longitude
    }))(req.body);
    
    // Remove undefined fields to avoid overwriting with undefined
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
    
    const a = await Address.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new: true });
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/addresses/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const a = await Address.findOneAndDelete({ _id: req.params.id, userId });
    if (!a) return res.status(404).json({ error: 'Not found' });
    // if deleted was default, pick another as default
    if (a.isDefault) {
      const next = await Address.findOne({ userId: a.userId });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/addresses/:id/default - set default
router.patch('/:id/default', async (req, res) => {
  try {
    const userId = req.userId;
    const a = await Address.findOne({ _id: req.params.id, userId });
    if (!a) return res.status(404).json({ error: 'Not found' });
    await Address.updateMany({ userId: a.userId }, { isDefault: false });
    a.isDefault = true;
    await a.save();
    res.json(a);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
