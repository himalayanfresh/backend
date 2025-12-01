import express from 'express';
import mongoose from 'mongoose';
import { decodePolyline } from '../tools/decode_polyline.js';
import Subscription from '../models/subscription.js';

const router = express.Router();

// Schema for storing driver tracking data
// Supports both regular orders and subscription deliveries
const TrackingSchema = new mongoose.Schema({
  // Primary identifier - can be orderId or subscriptionDeliveryId
  orderId: { type: String, required: true, index: true },
  
  // Type of delivery being tracked
  deliveryType: { 
    type: String, 
    enum: ['order', 'subscription'],
    default: 'order'
  },
  
  // For subscription deliveries, reference to the subscription
  subscriptionId: { type: String, index: true },
  subscriptionDeliveryId: { type: String, index: true },
  
  driverId: { type: String, default: 'driver-1' },
  driverName: { type: String, default: 'Rajesh Kumar' },
  driverPhone: { type: String, default: '+91-9876543210' },
  driverRating: { type: Number, default: 4.9 },
  status: { 
    type: String, 
    enum: ['assigned', 'picking_up', 'en_route', 'nearby', 'arrived', 'delivered'],
    default: 'assigned'
  },
  currentLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    heading: { type: Number, default: 0 },
    speed: { type: Number, default: 0 }, // in m/s
    accuracy: { type: Number, default: 10 },
  },
  route: {
    polyline: { type: String }, // Encoded polyline
    points: [{ lat: Number, lng: Number }], // Actual route points from driver/simulator
    distance: { type: Number }, // Total distance in meters
    duration: { type: Number }, // Total duration in seconds
    eta: { type: Date },
  },
  origin: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String },
  },
  destination: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String },
  },
  history: [{
    latitude: { type: Number },
    longitude: { type: Number },
    timestamp: { type: Date, default: Date.now },
  }],
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

const Tracking = mongoose.model('Tracking', TrackingSchema);

/**
 * GET /api/tracking/:orderId
 * Get current tracking info for an order
 */
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    let tracking = await Tracking.findOne({ orderId });
    
    if (!tracking) {
      // Create default tracking record if doesn't exist
      tracking = new Tracking({ orderId });
      await tracking.save();
    }
    
    // Convert to plain object
    const trackingObj = tracking.toObject();
    
    // Use stored route points if available, otherwise decode polyline as fallback
    if (trackingObj.route?.points && trackingObj.route.points.length > 0) {
      console.log(`GET: Returning ${trackingObj.route.points.length} stored route points`);
    } else if (trackingObj.route?.polyline) {
      // Fallback: decode polyline if no stored points
      try {
        trackingObj.route.points = decodePolyline(trackingObj.route.polyline);
        console.log(`GET: Decoded ${trackingObj.route.points.length} points from polyline (fallback)`);
      } catch (e) {
        console.error('Failed to decode polyline:', e);
        trackingObj.route.points = [];
      }
    }
    
    res.json(trackingObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tracking/:orderId/start
 * Initialize tracking for an order with route info
 */
router.post('/:orderId/start', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { 
      origin, 
      destination, 
      polyline,
      routePoints, // Array of {lat, lng} - actual driver route points
      distance, 
      duration,
      driverId,
      driverName,
    } = req.body;
    
    let tracking = await Tracking.findOne({ orderId });
    
    if (!tracking) {
      tracking = new Tracking({ orderId });
    }
    
    tracking.origin = origin;
    tracking.destination = destination;
    // Store route with points if provided
    tracking.route = {
      polyline,
      points: routePoints || [], // Store the actual route points from simulator
      distance,
      duration,
      eta: new Date(Date.now() + duration * 1000),
    };
    
    if (routePoints && routePoints.length > 0) {
      console.log(`POST /start: Storing ${routePoints.length} route points in database`);
    }
    tracking.currentLocation = {
      latitude: origin.latitude,
      longitude: origin.longitude,
      heading: 0,
      speed: 0,
    };
    tracking.status = 'picking_up';
    if (driverId) tracking.driverId = driverId;
    if (driverName) tracking.driverName = driverName;
    tracking.lastUpdated = new Date();
    
    await tracking.save();
    
    // Convert to plain object - route points are already stored in the document
    const trackingObj = tracking.toObject();
    
    console.log(`POST /start: Returning tracking with ${trackingObj.route?.points?.length || 0} route points`);
    
    // Emit to subscribers
    const io = req.app.get('io');
    io.to(`order:${orderId}`).emit('trackingStarted', trackingObj);
    
    res.json(trackingObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/tracking/:orderId/location
 * Update driver location (called by driver app or simulator)
 * Uses findOneAndUpdate for better performance (reduces DB load)
 */
router.patch('/:orderId/location', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { latitude, longitude, heading, speed } = req.body;
    
    // First check if tracking exists and get destination for ETA calculation
    const existingTracking = await Tracking.findOne({ orderId }).select('destination').lean();
    if (!existingTracking) {
      return res.status(404).json({ error: 'Tracking not found for this order' });
    }
    
    // Calculate new ETA based on remaining distance
    let newEta = null;
    if (existingTracking.destination?.latitude && existingTracking.destination?.longitude) {
      const remainingDist = calculateDistance(
        latitude, longitude,
        existingTracking.destination.latitude, existingTracking.destination.longitude
      );
      // Assume average speed of 30 km/h in city
      const remainingSeconds = (remainingDist / 1000) / 30 * 3600;
      newEta = new Date(Date.now() + remainingSeconds * 1000);
    }
    
    // Use findOneAndUpdate with $set and $push for atomic update (reduces DB load)
    const tracking = await Tracking.findOneAndUpdate(
      { orderId },
      {
        $set: {
          'currentLocation.latitude': latitude,
          'currentLocation.longitude': longitude,
          'currentLocation.heading': heading || 0,
          'currentLocation.speed': speed || 0,
          'route.eta': newEta,
          lastUpdated: new Date(),
        },
        $push: {
          history: {
            $each: [{ latitude, longitude, timestamp: new Date() }],
            $slice: -100,  // Keep only last 100 points
          },
        },
      },
      { new: true }
    );
    
    // Emit real-time update to subscribers
    const io = req.app.get('io');
    io.to(`order:${orderId}`).emit('driverLocation', {
      orderId,
      latitude,
      longitude,
      heading: tracking.currentLocation.heading,
      speed: tracking.currentLocation.speed,
      eta: tracking.route?.eta?.toISOString(),
      timestamp: tracking.lastUpdated.toISOString(),
    });
    
    res.json({ ok: true, tracking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/tracking/:orderId/status
 * Update delivery status
 */
router.patch('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    const tracking = await Tracking.findOne({ orderId });
    if (!tracking) {
      return res.status(404).json({ error: 'Tracking not found' });
    }
    
    tracking.status = status;
    tracking.lastUpdated = new Date();
    await tracking.save();
    
    // Sync status with subscription if this is a subscription delivery
    if (tracking.deliveryType === 'subscription' || orderId.length === 24) {
      try {
        // Map tracking status to subscription delivery status
        const statusMap = {
          'assigned': 'packed',
          'picking_up': 'packed',
          'en_route': 'out_for_delivery',
          'nearby': 'nearby',
          'arrived': 'nearby',
          'delivered': 'delivered',
        };
        
        const subscriptionStatus = statusMap[status] || 'pending';
        
        // Try to find and update the subscription
        const subscription = await Subscription.findById(orderId);
        if (subscription) {
          subscription.deliveryStatus = subscriptionStatus;
          
          // If delivered, update lastDeliveredDate and calculate next delivery
          if (subscriptionStatus === 'delivered') {
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
          console.log(`📍 Synced subscription ${orderId} status to: ${subscriptionStatus}`);
        }
      } catch (subErr) {
        console.log(`Note: Could not sync subscription status: ${subErr.message}`);
      }
    }
    
    // Emit status update
    const io = req.app.get('io');
    io.to(`order:${orderId}`).emit('statusUpdate', {
      orderId,
      status,
      timestamp: tracking.lastUpdated.toISOString(),
    });
    
    res.json(tracking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default router;
