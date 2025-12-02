import express from 'express';
import Order from '../models/order.js';
import Address from '../models/address.js';
import mongoose from 'mongoose';
import auth from '../middleware/auth.js';

const router = express.Router();

// Public endpoint for simulator - get order destination
// GET /api/orders/:id/destination
router.get('/:id/destination', async (req, res) => {
  try {
    const orderId = req.params.id;
    
    // First try to get from Order collection
    const order = await Order.findById(orderId).catch(() => null);
    
    if (order && order.addressId) {
      const address = await Address.findById(order.addressId);
      if (address && address.latitude && address.longitude) {
        return res.json({
          orderId: order._id,
          destination: {
            latitude: address.latitude,
            longitude: address.longitude,
            address: `${address.flatNumber || ''} ${address.houseNumber || ''}, ${address.line1 || ''}, ${address.landmark || ''}, ${address.city || ''} - ${address.pin || ''}`.trim(),
            customerName: address.customerName,
            phoneNumber: address.phoneNumber,
          }
        });
      }
    }
    
    // Fallback: Check if tracking exists with destination
    const Tracking = mongoose.model('Tracking');
    const tracking = await Tracking.findOne({ orderId }).select('destination').lean();
    
    if (tracking && tracking.destination?.latitude && tracking.destination?.longitude) {
      return res.json({
        orderId: orderId,
        destination: {
          latitude: tracking.destination.latitude,
          longitude: tracking.destination.longitude,
          address: tracking.destination.address || 'Customer Location',
          customerName: null,
          phoneNumber: null,
        }
      });
    }
    
    return res.status(404).json({ error: 'No destination found for this order' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(auth);

// GET /api/orders - list orders for authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;
    const list = await Order.find({ userId }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders
// body: { items: [{skuId,title,price,quantity}], addressId }
router.post('/', async (req, res) => {
  try {
    const userId = req.userId;
    const { items = [], addressId = null } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
    // validate address ownership if provided
    if (addressId) {
      const a = await Address.findOne({ _id: addressId, userId });
      if (!a) return res.status(400).json({ error: 'Invalid addressId' });
    }
    // compute subtotal, taxes(5%), delivery (free over 600)
    const subtotal = items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
    const taxes = +(subtotal * 0.05).toFixed(2);
    const deliveryFee = subtotal >= 600 ? 0 : 30;
    const total = +(subtotal + taxes + deliveryFee).toFixed(2);

    const order = new Order({ userId, items, subtotal, taxes, deliveryFee, total, addressId, status: 'pending' });
    await order.save();
    console.log(`Order ${order._id} created for user ${userId} - total ${total}`);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
