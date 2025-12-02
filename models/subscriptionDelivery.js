import mongoose from 'mongoose';

/**
 * SubscriptionDelivery represents a single delivery instance for a subscription.
 * Each time a subscription triggers a delivery (daily, alternate, weekly), 
 * a new SubscriptionDelivery is created.
 */
const SubscriptionDeliverySchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true, index: true },
  userId: { type: String, required: true, index: true },
  
  // Delivery details
  scheduledDate: { type: Date, required: true },
  timeSlot: { type: String, default: '8-10' },
  
  // Address snapshot (in case address changes later)
  addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'Address' },
  deliveryAddress: {
    label: { type: String },
    customerName: { type: String },
    phoneNumber: { type: String },
    flatNumber: { type: String },
    houseNumber: { type: String },
    line1: { type: String },
    landmark: { type: String },
    city: { type: String },
    state: { type: String },
    pin: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
  },
  
  // Items being delivered (snapshot from subscription or custom for this delivery)
  items: [{
    skuId: { type: String },
    title: { type: String },
    price: { type: Number },
    quantity: { type: Number },
  }],
  
  // Status tracking
  status: { 
    type: String, 
    enum: ['scheduled', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'failed'],
    default: 'scheduled',
    index: true
  },
  
  // Driver/delivery partner info
  driverId: { type: String },
  driverName: { type: String },
  driverPhone: { type: String },
  
  // Tracking reference - links to Tracking collection
  trackingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tracking' },
  
  // Timestamps for status changes
  preparedAt: { type: Date },
  dispatchedAt: { type: Date },
  deliveredAt: { type: Date },
  
  // Delivery notes/feedback
  deliveryNotes: { type: String },
  customerFeedback: { type: String },
  rating: { type: Number, min: 1, max: 5 },
  
  // If this delivery earned a free item (every 10th delivery)
  isFreeDelivery: { type: Boolean, default: false },
  
}, { timestamps: true });

// Index for finding deliveries by subscription and date
SubscriptionDeliverySchema.index({ subscriptionId: 1, scheduledDate: -1 });
SubscriptionDeliverySchema.index({ userId: 1, scheduledDate: -1 });
SubscriptionDeliverySchema.index({ status: 1, scheduledDate: 1 });

const SubscriptionDelivery = mongoose.model('SubscriptionDelivery', SubscriptionDeliverySchema);
export default SubscriptionDelivery;
