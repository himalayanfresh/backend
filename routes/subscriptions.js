import express from 'express';
import Subscription from '../models/subscription.js';
import Address from '../models/address.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Public endpoint: GET /api/subscriptions/:id (for simulator/internal use)
// This needs to be BEFORE the auth middleware
router.get('/:id', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    
    // Calculate effective delivery status based on dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const nextDelivery = subscription.nextDelivery ? new Date(subscription.nextDelivery) : null;
    if (nextDelivery) nextDelivery.setHours(0, 0, 0, 0);
    
    const lastDelivered = subscription.lastDeliveredDate ? new Date(subscription.lastDeliveredDate) : null;
    if (lastDelivered) lastDelivered.setHours(0, 0, 0, 0);
    
    // Determine effective status
    let effectiveDeliveryStatus = subscription.deliveryStatus || 'pending';
    
    // If status is delivered and we're between lastDelivered and nextDelivery, keep as delivered
    if (effectiveDeliveryStatus === 'delivered' && lastDelivered && nextDelivery) {
      if (today >= lastDelivered && today < nextDelivery) {
        effectiveDeliveryStatus = 'delivered';
      } else if (today >= nextDelivery) {
        // It's a new delivery day - reset to pending (or packed if processed)
        effectiveDeliveryStatus = 'pending';
      }
    }
    
    // If today is nextDelivery and status is pending, it should be packed
    if (nextDelivery && today.getTime() === nextDelivery.getTime() && effectiveDeliveryStatus === 'pending') {
      // Auto-update to packed when it's delivery day
      subscription.deliveryStatus = 'packed';
      await subscription.save();
      effectiveDeliveryStatus = 'packed';
    }
    
    // Return subscription with effective status
    const result = subscription.toObject();
    result.effectiveDeliveryStatus = effectiveDeliveryStatus;
    
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/subscriptions/:id/delivery-status (public - for simulator)
// Update delivery status during tracking
router.patch('/:id/delivery-status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'packed', 'out_for_delivery', 'nearby', 'delivered'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    
    subscription.deliveryStatus = status;
    
    // If delivered, update lastDeliveredDate and calculate next delivery
    if (status === 'delivered') {
      const today = new Date();
      subscription.lastDeliveredDate = today;
      subscription.deliveriesInCycle = (subscription.deliveriesInCycle || 0) + 1;
      
      // Calculate next delivery based on plan
      const nextDate = new Date(today);
      switch (subscription.plan) {
        case 'daily':
          nextDate.setDate(nextDate.getDate() + 1);
          break;
        case 'alternate':
          nextDate.setDate(nextDate.getDate() + 2);
          break;
        case 'weekly':
          nextDate.setDate(nextDate.getDate() + 7);
          break;
        default:
          nextDate.setDate(nextDate.getDate() + 1);
      }
      subscription.nextDelivery = nextDate;
      
      console.log(`📦 Subscription ${subscription._id} delivered. Next delivery: ${nextDate.toDateString()}`);
    }
    
    await subscription.save();
    res.json(subscription);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// ADMIN ENDPOINTS (for warehouse/packing operations)
// =====================================================

/**
 * POST /api/subscriptions/admin/pack-today
 * Admin endpoint: Mark all subscriptions with today as nextDelivery as "packed"
 * This should be called by admin when orders are packed and ready for dispatch
 */
router.post('/admin/pack-today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Find all active subscriptions with nextDelivery = today and status pending
    const subscriptions = await Subscription.find({
      status: 'active',
      nextDelivery: { $gte: today, $lt: tomorrow },
      deliveryStatus: { $in: ['pending', null] },
    });
    
    if (subscriptions.length === 0) {
      return res.json({ 
        message: 'No subscriptions to pack for today',
        count: 0,
        subscriptions: []
      });
    }
    
    // Update all to packed
    const updatedIds = [];
    for (const sub of subscriptions) {
      sub.deliveryStatus = 'packed';
      await sub.save();
      updatedIds.push({
        id: sub._id,
        title: sub.title,
        plan: sub.plan,
        timeSlot: sub.timeSlot,
      });
      console.log(`📦 Subscription ${sub._id} (${sub.title}) marked as packed`);
    }
    
    res.json({
      message: `Successfully packed ${subscriptions.length} subscription(s)`,
      count: subscriptions.length,
      subscriptions: updatedIds,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/subscriptions/admin/:id/pack
 * Admin endpoint: Mark a specific subscription as "packed" (only if today is delivery day)
 * Also calculates nextDeliveryDate according to subscription policy
 */
router.patch('/admin/:id/pack', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    if (subscription.status !== 'active') {
      return res.status(400).json({ error: 'Subscription is not active' });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const nextDelivery = subscription.nextDelivery ? new Date(subscription.nextDelivery) : null;
    if (nextDelivery) nextDelivery.setHours(0, 0, 0, 0);
    
    // Validate that today is the delivery day
    if (!nextDelivery || today.getTime() !== nextDelivery.getTime()) {
      return res.status(400).json({ 
        error: 'Cannot pack - today is not the scheduled delivery day',
        todayDate: today.toDateString(),
        nextDeliveryDate: nextDelivery ? nextDelivery.toDateString() : 'Not set',
      });
    }
    
    // Update status to packed
    subscription.deliveryStatus = 'packed';
    await subscription.save();
    
    console.log(`📦 Admin packed subscription ${subscription._id} (${subscription.title})`);
    
    res.json({
      message: 'Subscription marked as packed',
      subscription: {
        id: subscription._id,
        title: subscription.title,
        plan: subscription.plan,
        deliveryStatus: subscription.deliveryStatus,
        nextDelivery: subscription.nextDelivery,
        timeSlot: subscription.timeSlot,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/subscriptions/admin/today
 * Admin endpoint: Get all subscriptions scheduled for today's delivery
 * Shows status of each (pending, packed, out_for_delivery, delivered)
 */
router.get('/admin/today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Find all active subscriptions with nextDelivery = today
    const subscriptions = await Subscription.find({
      status: 'active',
      nextDelivery: { $gte: today, $lt: tomorrow },
    }).populate('addressId').lean();
    
    // Group by delivery status
    const grouped = {
      pending: [],
      packed: [],
      out_for_delivery: [],
      nearby: [],
      delivered: [],
    };
    
    for (const sub of subscriptions) {
      const status = sub.deliveryStatus || 'pending';
      if (grouped[status]) {
        grouped[status].push({
          id: sub._id,
          title: sub.title,
          plan: sub.plan,
          timeSlot: sub.timeSlot,
          userId: sub.userId,
          deliveryStatus: status,
        });
      }
    }
    
    res.json({
      date: today.toDateString(),
      total: subscriptions.length,
      summary: {
        pending: grouped.pending.length,
        packed: grouped.packed.length,
        out_for_delivery: grouped.out_for_delivery.length,
        nearby: grouped.nearby.length,
        delivered: grouped.delivered.length,
      },
      subscriptions: grouped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(auth);

// GET /api/subscriptions
router.get('/', async (req, res) => {
  const userId = req.userId;
  const list = await Subscription.find({ userId }).sort({ createdAt: -1 });
  res.json(list);
});

// POST /api/subscriptions
router.post('/', async (req, res) => {
  try {
    const { title, plan = 'daily', timeSlot = '8-10', nextDelivery = null, addressId = null } = req.body;
    const userId = req.userId;
    // If addressId provided, ensure it belongs to this user
    if (addressId) {
      const a = await Address.findOne({ _id: addressId, userId });
      if (!a) return res.status(400).json({ error: 'Invalid addressId' });
    }
    const s = new Subscription({ title, plan, timeSlot, nextDelivery: nextDelivery ? new Date(nextDelivery) : undefined, addressId, userId });
    await s.save();
    console.log(`Subscription created for user ${userId}: ${s._id}`);
    res.status(201).json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/subscriptions/:id
router.put('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const updates = (({ title, plan, timeSlot, status, nextDelivery, addressId }) => ({ title, plan, timeSlot, status, nextDelivery, addressId }))(req.body);
    if (updates.nextDelivery) updates.nextDelivery = new Date(updates.nextDelivery);
    // If addressId provided in updates, ensure it belongs to this user
    if (updates.addressId) {
      const a = await Address.findOne({ _id: updates.addressId, userId });
      if (!a) return res.status(400).json({ error: 'Invalid addressId' });
    }
    console.log(`Updating subscription ${req.params.id} for user ${userId} with`, updates);
    const s = await Subscription.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new: true });
    console.log(`Updated subscription result: ${s ? s._id : 'not found'}`);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/subscriptions/:id/cancel-request
// Generates an OTP for cancellation and logs it (dev). Returns ok.
router.post('/:id/cancel-request', async (req, res) => {
  try {
    const userId = req.userId;
    const s = await Subscription.findOne({ _id: req.params.id, userId });
    if (!s) return res.status(404).json({ error: 'Not found' });
    // generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    s.cancelOtp = otp;
    s.cancelOtpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await s.save();
    console.log(`Cancel OTP for subscription ${s._id} (user ${userId}): ${otp}`);
    res.json({ ok: true, hint: 'OTP generated (in dev logged to server)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscriptions/:id/cancel-verify { otp }
// Verify OTP and cancel the subscription (set status to 'cancelled')
router.post('/:id/cancel-verify', async (req, res) => {
  try {
    const userId = req.userId;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp required' });
    const s = await Subscription.findOne({ _id: req.params.id, userId });
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (!s.cancelOtp || !s.cancelOtpExpires || s.cancelOtp !== otp || s.cancelOtpExpires < new Date()) {
      return res.status(400).json({ error: 'invalid or expired otp' });
    }
    s.status = 'cancelled';
    s.cancelOtp = undefined;
    s.cancelOtpExpires = undefined;
    await s.save();
    console.log(`Subscription ${s._id} cancelled by user ${userId}`);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscriptions/:id/revive-request
// Generates an OTP for revival of a cancelled subscription
router.post('/:id/revive-request', async (req, res) => {
  try {
    const userId = req.userId;
    const s = await Subscription.findOne({ _id: req.params.id, userId });
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.status !== 'cancelled') return res.status(400).json({ error: 'Subscription not cancelled' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    s.reviveOtp = otp;
    s.reviveOtpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await s.save();
    console.log(`Revive OTP for subscription ${s._id} (user ${userId}): ${otp}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscriptions/:id/revive-verify { otp }
// Verify revival OTP and set status back to 'active'
router.post('/:id/revive-verify', async (req, res) => {
  try {
    const userId = req.userId;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp required' });
    const s = await Subscription.findOne({ _id: req.params.id, userId });
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.status !== 'cancelled') return res.status(400).json({ error: 'Subscription not cancelled' });
    if (!s.reviveOtp || !s.reviveOtpExpires || s.reviveOtp !== otp || s.reviveOtpExpires < new Date()) {
      return res.status(400).json({ error: 'invalid or expired otp' });
    }
    s.status = 'active';
    s.reviveOtp = undefined;
    s.reviveOtpExpires = undefined;
    await s.save();
    console.log(`Subscription ${s._id} revived by user ${userId}`);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subscriptions/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const s = await Subscription.findOneAndDelete({ _id: req.params.id, userId });
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
