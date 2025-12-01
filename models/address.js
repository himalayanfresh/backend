import mongoose from 'mongoose';

const AddressSchema = new mongoose.Schema({
  label: { type: String, required: true },
  customerName: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  flatNumber: { type: String, default: '' },
  houseNumber: { type: String, default: '' },
  line1: { type: String, required: true },
  landmark: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pin: { type: String, default: '' },
  isDefault: { type: Boolean, default: false },
  userId: { type: String, default: 'default-user' },
  // Geolocation for live tracking
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
}, { timestamps: true });

// Index for geolocation queries (optional, useful for location-based searches)
AddressSchema.index({ latitude: 1, longitude: 1 });

const Address = mongoose.model('Address', AddressSchema);
export default Address;
