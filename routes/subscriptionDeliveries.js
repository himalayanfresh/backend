import express from 'express';
import mongoose from 'mongoose';
import SubscriptionDelivery from '../models/subscriptionDelivery.js';
import Subscription from '../models/subscription.js';
import Address from '../models/address.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Get Tracking model (defined in tracking.js)
const getTrackingModel = () => mongoose.model('Tracking');

router.use(auth);

/**
 * GET /api/subscription-deliveries
 * List all deliveries for the authenticated user
 * Query params: subscriptionId, status, limit, skip
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;
    const { subscriptionId, status, limit = 20, skip = 0 } = req.query;
    
    const query = { userId };
    if (subscriptionId) query.subscriptionId = subscriptionId;
    if (status) query.status = status;
    
    const deliveries = await SubscriptionDelivery.find(query)
      .sort({ scheduledDate: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));
    
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/subscription-deliveries/today
 * Get today's deliveries for the user
 */
router.get('/today', async (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const deliveries = await SubscriptionDelivery.find({
      userId,
      scheduledDate: { $gte: today, $lt: tomorrow },
      status: { $ne: 'cancelled' }
    }).sort({ scheduledDate: 1 });
    
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/subscription-deliveries/active
 * Get deliveries that are currently being delivered (out_for_delivery status)
 */
router.get('/active', async (req, res) => {
  try {
    const userId = req.userId;
    
    const deliveries = await SubscriptionDelivery.find({
      userId,
      status: 'out_for_delivery'
    }).sort({ dispatchedAt: -1 });
    
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/subscription-deliveries/:id
 * Get a specific delivery
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const delivery = await SubscriptionDelivery.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    res.json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/subscription-deliveries
 * Create a new subscription delivery (usually done by system/scheduler)
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.userId;
    const { subscriptionId, scheduledDate, timeSlot, items } = req.body;
    
    // Verify subscription belongs to user
    const subscription = await Subscription.findOne({ _id: subscriptionId, userId });
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    // Get delivery address
    let deliveryAddress = null;
    if (subscription.addressId) {
      const address = await Address.findById(subscription.addressId);
      if (address) {
        deliveryAddress = {
          label: address.label,
          customerName: address.customerName,
          phoneNumber: address.phoneNumber,
          flatNumber: address.flatNumber,
          houseNumber: address.houseNumber,
          line1: address.line1,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          pin: address.pin,
          latitude: address.latitude,
          longitude: address.longitude,
        };
      }
    }
    
    // Check if this is a free delivery (every 10th)
    const deliveryCount = await SubscriptionDelivery.countDocuments({
      subscriptionId,
      status: 'delivered'
    });
    const isFreeDelivery = (deliveryCount + 1) % 10 === 0;
    
    const delivery = new SubscriptionDelivery({
      subscriptionId,
      userId,
      scheduledDate: new Date(scheduledDate),
      timeSlot: timeSlot || subscription.timeSlot,
      addressId: subscription.addressId,
      deliveryAddress,
      items: items || [],
      isFreeDelivery,
    });
    
    await delivery.save();
    res.status(201).json(delivery);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PATCH /api/subscription-deliveries/:id/status
 * Update delivery status (used by admin/driver)
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = req.userId;
    const { status, driverId, driverName, driverPhone } = req.body;
    
    const delivery = await SubscriptionDelivery.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    // Update status and related timestamps
    delivery.status = status;
    
    if (status === 'preparing') {
      delivery.preparedAt = new Date();
    } else if (status === 'out_for_delivery') {
      delivery.dispatchedAt = new Date();
      if (driverId) delivery.driverId = driverId;
      if (driverName) delivery.driverName = driverName;
      if (driverPhone) delivery.driverPhone = driverPhone;
      
      // Create tracking record
      const Tracking = getTrackingModel();
      const tracking = new Tracking({
        orderId: delivery._id.toString(),
        deliveryType: 'subscription',
        subscriptionId: delivery.subscriptionId.toString(),
        subscriptionDeliveryId: delivery._id.toString(),
        driverId: driverId || 'driver-1',
        driverName: driverName || 'Delivery Partner',
        driverPhone: driverPhone || '+91-9876543210',
        status: 'assigned',
        destination: delivery.deliveryAddress ? {
          latitude: delivery.deliveryAddress.latitude,
          longitude: delivery.deliveryAddress.longitude,
          address: `${delivery.deliveryAddress.flatNumber || ''} ${delivery.deliveryAddress.houseNumber || ''}, ${delivery.deliveryAddress.line1 || ''}`.trim(),
        } : undefined,
      });
      await tracking.save();
      delivery.trackingId = tracking._id;
      
    } else if (status === 'delivered') {
      delivery.deliveredAt = new Date();
    }
    
    await delivery.save();
    res.json(delivery);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscription-deliveries/:id/feedback
 * Add customer feedback for a delivery
 */
router.post('/:id/feedback', async (req, res) => {
  try {
    const userId = req.userId;
    const { rating, feedback } = req.body;
    
    const delivery = await SubscriptionDelivery.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    if (delivery.status !== 'delivered') {
      return res.status(400).json({ error: 'Can only rate delivered orders' });
    }
    
    if (rating) delivery.rating = rating;
    if (feedback) delivery.customerFeedback = feedback;
    
    await delivery.save();
    res.json(delivery);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/subscription-deliveries/:id/tracking
 * Get tracking info for a delivery
 */
router.get('/:id/tracking', async (req, res) => {
  try {
    const userId = req.userId;
    
    const delivery = await SubscriptionDelivery.findOne({
      _id: req.params.id,
      userId
    });
    
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    if (!delivery.trackingId) {
      return res.status(404).json({ error: 'No tracking info available' });
    }
    
    const Tracking = getTrackingModel();
    const tracking = await Tracking.findById(delivery.trackingId);
    
    if (!tracking) {
      return res.status(404).json({ error: 'Tracking not found' });
    }
    
    res.json(tracking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
