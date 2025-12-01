import mongoose from 'mongoose';

const OrderItemSchema = new mongoose.Schema({
  skuId: String,
  title: String,
  price: Number,
  quantity: Number,
});

const OrderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  items: { type: [OrderItemSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  taxes: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  addressId: { type: String },
  status: { type: String, enum: ['pending', 'confirmed', 'failed'], default: 'pending' },
}, { timestamps: true });

const Order = mongoose.model('Order', OrderSchema);
export default Order;
