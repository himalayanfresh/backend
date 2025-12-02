import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';

import addressesRouter from './routes/addresses.js';
import subscriptionsRouter from './routes/subscriptions.js';
import subscriptionDeliveriesRouter from './routes/subscriptionDeliveries.js';
import authRouter from './routes/auth.js';
import ordersRouter from './routes/orders.js';
import routeRouter from './routes/route.js';
import trackingRouter from './routes/tracking.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Socket.IO setup with CORS
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Make io accessible to routes
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI not set. Copy .env.example to .env and set MONGO_URI');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('Mongo connection error', err);
    process.exit(1);
  });

app.use('/api/addresses', addressesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/subscription-deliveries', subscriptionDeliveriesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auth', authRouter);
app.use('/api/route', routeRouter);
app.use('/api/tracking', trackingRouter);

app.get('/', (req, res) => res.json({ ok: true, msg: 'Himalayan backend running' }));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Client subscribes to an order's/delivery's updates
  socket.on('subscribe', (deliveryId) => {
    socket.join(`order:${deliveryId}`);
    console.log(`Socket ${socket.id} subscribed to order:${deliveryId}`);
  });

  // Client unsubscribes from an order/delivery
  socket.on('unsubscribe', (deliveryId) => {
    socket.leave(`order:${deliveryId}`);
    console.log(`Socket ${socket.id} unsubscribed from order:${deliveryId}`);
  });

  // Driver sends location update
  socket.on('driverLocation', (data) => {
    // Support both orderId and deliveryId for backward compatibility
    const deliveryId = data.deliveryId || data.orderId;
    const { latitude, longitude, heading, speed, deliveryType, status } = data;
    const update = {
      orderId: deliveryId, // Keep orderId for backward compatibility with Flutter
      deliveryId,
      deliveryType: deliveryType || 'order',
      latitude,
      longitude,
      heading: heading || 0,
      speed: speed || 0,
      status: status || 'en_route',
      timestamp: new Date().toISOString(),
    };
    // Broadcast to all clients subscribed to this order/delivery
    io.to(`order:${deliveryId}`).emit('driverLocation', update);
    console.log(`Driver location update for ${deliveryType || 'order'}:${deliveryId}`, { lat: latitude, lng: longitude, status });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Export io for use in other modules
export { io };

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces for WiFi access
httpServer.listen(PORT, HOST, () => console.log(`Server listening on http://${HOST}:${PORT}`));
