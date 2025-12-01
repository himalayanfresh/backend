import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  role: { type: String, enum: ['consumer', 'corporate'], default: 'consumer' },
  name: { type: String, default: '' },
  // OTP fields (temporary)
  otp: { type: String },
  otpExpires: { type: Date },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
export default User;
