import mongoose from 'mongoose';

const SubscriptionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  plan: { type: String, enum: ['daily', 'alternate', 'weekly', 'custom'], default: 'daily' },
  status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active' },
  
  // Delivery status for current delivery cycle
  deliveryStatus: { 
    type: String, 
    enum: ['pending', 'packed', 'out_for_delivery', 'nearby', 'delivered'],
    default: 'pending'
  },
  
  // Last successful delivery date
  lastDeliveredDate: { type: Date, default: null },
  
  timeSlot: { type: String, default: '8-10' },
  nextDelivery: { type: Date, default: () => new Date() },
  deliveriesInCycle: { type: Number, default: 0 },
  lastGotFree: { type: Boolean, default: false },
  addressId: { type: String, default: null },
  // cancellation OTP flow: temporary code and expiry when user requests cancellation
  cancelOtp: { type: String },
  cancelOtpExpires: { type: Date },
  // revive OTP flow: user can revive a cancelled subscription
  reviveOtp: { type: String },
  reviveOtpExpires: { type: Date },
  userId: { type: String, default: 'default-user' },
}, { timestamps: true });

const Subscription = mongoose.model('Subscription', SubscriptionSchema);
export default Subscription;
