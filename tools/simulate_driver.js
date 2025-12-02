#!/usr/bin/env node
/**
 * Realistic Driver Location Simulator
 * 
 * Simulates a delivery driver moving along a route with realistic behavior:
 * - Speed affects movement speed (not just update frequency)
 * - Includes traffic simulation, stops, speed variations
 * - Automatically detects when driver arrives and updates status
 * 
 * Usage:
 *   node tools/simulate_driver.js [options]
 * 
 * Options:
 *   -o, --order <id>        Order ID to track
 *   -s, --subscription <id> Subscription ID to track
 *   --speed <kmh>           Average speed in km/h (default: 30)
 *   --interval <ms>         Update interval in ms (default: 1000)
 *   --traffic               Enable traffic simulation (random slowdowns)
 * 
 * Examples:
 *   node simulate_driver.js -o order123 --speed 40
 *   node simulate_driver.js -s sub456 --speed 60 --traffic
 */

import { io } from 'socket.io-client';
import fetch from 'node-fetch';

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || 'http://0.0.0.0:8080',
  googleApiKey: process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCkFcBTJOEdufqsr8EFxT-Qmh40KNK59P8',
  
  // Driver starting coordinates (warehouse/store location)
  driverStart: {
    lat: 28.641824,
    lng: 77.341519,
  },
  
  // Default simulation settings
  updateIntervalMs: 3000,      // Send location update every 1 second
  speedKmh: 30,                // Default driving speed (km/h)
  arrivalThresholdMeters: 50,  // Distance to destination to mark as "arrived"
  nearbyThresholdMeters: 200,  // Distance to mark as "near you"
};

// Parse command line arguments
const args = process.argv.slice(2);

let deliveryType = null;
let deliveryId = '';
let speedKmh = CONFIG.speedKmh;
let updateIntervalMs = CONFIG.updateIntervalMs;
let enableTraffic = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '-o' || arg === '--order') {
    deliveryType = 'order';
    if (args[i + 1] && !args[i + 1].startsWith('-')) {
      deliveryId = args[++i];
    }
  } else if (arg === '-s' || arg === '--subscription') {
    deliveryType = 'subscription';
    if (args[i + 1] && !args[i + 1].startsWith('-')) {
      deliveryId = args[++i];
    }
  } else if (arg === '--speed') {
    speedKmh = parseFloat(args[++i]) || CONFIG.speedKmh;
  } else if (arg === '--interval') {
    updateIntervalMs = parseInt(args[++i]) || CONFIG.updateIntervalMs;
  } else if (arg === '--traffic') {
    enableTraffic = true;
  } else if (!deliveryId && !arg.startsWith('-')) {
    // First non-flag argument is the ID (auto-detect type)
    deliveryId = arg;
  }
}

if (!deliveryId) {
  console.log(`
📦 Realistic Driver Simulator
==============================

Usage:
  node simulate_driver.js -o <orderId> [--speed <kmh>] [--traffic]
  node simulate_driver.js -s <subscriptionId> [--speed <kmh>] [--traffic]

Options:
  -o, --order <id>        Regular order ID
  -s, --subscription <id> Subscription ID
  --speed <kmh>           Average speed in km/h (default: 30)
  --interval <ms>         Update interval in ms (default: 1000)
  --traffic               Enable traffic simulation

Examples:
  node simulate_driver.js -o 674abc123 --speed 40
  node simulate_driver.js -s 674def456 --speed 60 --traffic
  `);
  process.exit(1);
}

// Haversine distance calculation (meters)
function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate bearing between two points
function calculateBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Interpolate a point along a line at a given fraction
function interpolatePoint(start, end, fraction) {
  return {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng: start.lng + (end.lng - start.lng) * fraction,
  };
}

// Fetch destination from regular order
async function fetchOrderDestination(orderId) {
  console.log(`\n📦 Fetching destination from order ${orderId}...`);
  
  try {
    const url = `${CONFIG.serverUrl}/api/orders/${orderId}/destination`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (response.ok && data.destination) {
      console.log(`✅ Order destination: ${data.destination.address || 'N/A'}`);
      console.log(`   Coordinates: ${data.destination.latitude}, ${data.destination.longitude}`);
      return {
        lat: data.destination.latitude,
        lng: data.destination.longitude,
        address: data.destination.address,
      };
    }
    console.error(`❌ Failed to fetch order: ${data.error || 'Unknown error'}`);
    return null;
  } catch (error) {
    console.error('❌ Error fetching order:', error.message);
    return null;
  }
}

// Fetch destination from subscription
async function fetchSubscriptionDestination(subscriptionId) {
  console.log(`\n📅 Fetching destination from subscription ${subscriptionId}...`);
  
  try {
    // Fetch subscription to get addressId
    const subUrl = `${CONFIG.serverUrl}/api/subscriptions/${subscriptionId}`;
    const subResponse = await fetch(subUrl);
    
    if (!subResponse.ok) {
      console.error(`❌ Failed to fetch subscription: ${subResponse.status}`);
      return null;
    }
    
    const subscription = await subResponse.json();
    const addressId = subscription.addressId;
    
    if (!addressId) {
      console.error('❌ Subscription has no addressId');
      return null;
    }
    
    // Fetch address
    const addressUrl = `${CONFIG.serverUrl}/api/addresses/${addressId}`;
    const addressResponse = await fetch(addressUrl);
    
    if (!addressResponse.ok) {
      console.error(`❌ Failed to fetch address: ${addressResponse.status}`);
      return null;
    }
    
    const address = await addressResponse.json();
    
    if (!address.latitude || !address.longitude) {
      console.error('❌ Address has no coordinates');
      return null;
    }
    
    const fullAddress = [
      address.flatNumber ? `Flat ${address.flatNumber}` : '',
      address.houseNumber ? `House ${address.houseNumber}` : '',
      address.line1,
      address.city,
    ].filter(Boolean).join(', ');
    
    console.log(`✅ Subscription destination: ${fullAddress}`);
    console.log(`   Coordinates: ${address.latitude}, ${address.longitude}`);
    
    return {
      lat: address.latitude,
      lng: address.longitude,
      address: fullAddress,
    };
  } catch (error) {
    console.error('❌ Error fetching subscription:', error.message);
    return null;
  }
}

// Auto-detect delivery type by trying endpoints
async function autoDetectAndFetchDestination(id) {
  console.log(`\n🔍 Auto-detecting delivery type for: ${id}`);
  
  const orderDest = await fetchOrderDestination(id);
  if (orderDest) {
    deliveryType = 'order';
    return orderDest;
  }
  
  const subDest = await fetchSubscriptionDestination(id);
  if (subDest) {
    deliveryType = 'subscription';
    return subDest;
  }
  
  return null;
}

// Fetch route from Google Directions API
async function fetchRoute(origin, destination) {
  console.log('\n🗺️  Fetching route from Google Directions API...');
  
  try {
    const url = `${CONFIG.serverUrl}/api/route?originLat=${origin.lat}&originLng=${origin.lng}&destLat=${destination.lat}&destLng=${destination.lng}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.points) {
      console.log(`✅ Route found: ${data.distance?.text || 'N/A'}, ${data.duration?.text || 'N/A'}`);
      console.log(`   Raw points from API: ${data.points.length}`);
      return data;
    }
    console.error('❌ Route API error:', data.error || 'No points');
    return null;
  } catch (error) {
    console.error('❌ Failed to fetch route:', error.message);
    return null;
  }
}

// Generate high-resolution route points based on speed
// This is the key function that makes the simulator realistic
function generateHighResolutionRoute(routePoints, speedKmh, updateIntervalMs) {
  if (!routePoints || routePoints.length < 2) return routePoints;
  
  const speedMps = speedKmh * 1000 / 3600; // Convert km/h to m/s
  const distancePerUpdate = speedMps * (updateIntervalMs / 1000); // Distance covered per update
  
  console.log(`\n📊 Calculating route points:`);
  console.log(`   Speed: ${speedKmh} km/h = ${speedMps.toFixed(2)} m/s`);
  console.log(`   Update interval: ${updateIntervalMs}ms`);
  console.log(`   Distance per update: ${distancePerUpdate.toFixed(2)} meters`);
  
  const highResPoints = [];
  let totalDistance = 0;
  
  // Calculate total route distance
  for (let i = 0; i < routePoints.length - 1; i++) {
    const start = routePoints[i];
    const end = routePoints[i + 1];
    totalDistance += calculateDistanceMeters(start.lat, start.lng, end.lat, end.lng);
  }
  
  console.log(`   Total route distance: ${(totalDistance / 1000).toFixed(2)} km`);
  console.log(`   Estimated duration: ${Math.ceil(totalDistance / speedMps / 60)} minutes`);
  
  // Simpler approach: interpolate along total distance
  const numPoints = Math.ceil(totalDistance / distancePerUpdate);
  console.log(`   Generating ${numPoints} points...`);
  
  for (let i = 0; i <= numPoints; i++) {
    const targetDistance = i * distancePerUpdate;
    const point = getPointAtDistance(routePoints, targetDistance);
    if (point) {
      highResPoints.push(point);
    }
  }
  
  // Make sure we include the final destination
  const lastOriginal = routePoints[routePoints.length - 1];
  const lastGenerated = highResPoints[highResPoints.length - 1];
  if (!lastGenerated || 
      calculateDistanceMeters(lastGenerated.lat, lastGenerated.lng, lastOriginal.lat, lastOriginal.lng) > 1) {
    highResPoints.push({ ...lastOriginal });
  }
  
  console.log(`   Generated ${highResPoints.length} high-resolution points`);
  console.log(`   Expected delivery time: ~${Math.round(highResPoints.length * updateIntervalMs / 1000 / 60)} minutes\n`);
  
  return highResPoints;
}

// Get a point at a specific distance along the route
function getPointAtDistance(routePoints, targetDistance) {
  let accumulatedDistance = 0;
  
  for (let i = 0; i < routePoints.length - 1; i++) {
    const start = routePoints[i];
    const end = routePoints[i + 1];
    const segmentDistance = calculateDistanceMeters(start.lat, start.lng, end.lat, end.lng);
    
    if (accumulatedDistance + segmentDistance >= targetDistance) {
      // Target is within this segment
      const distanceIntoSegment = targetDistance - accumulatedDistance;
      const fraction = segmentDistance > 0 ? distanceIntoSegment / segmentDistance : 0;
      return interpolatePoint(start, end, Math.min(fraction, 1));
    }
    
    accumulatedDistance += segmentDistance;
  }
  
  // Return last point if distance exceeds route
  return { ...routePoints[routePoints.length - 1] };
}

// Generate fallback route if API fails
function generateFallbackRoute(origin, destination) {
  const distance = calculateDistanceMeters(origin.lat, origin.lng, destination.lat, destination.lng);
  const numPoints = Math.max(10, Math.ceil(distance / 100)); // Point every ~100m
  
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    // Add slight curve for realism
    const curve = Math.sin(t * Math.PI) * 0.002;
    points.push({
      lat: origin.lat + (destination.lat - origin.lat) * t + curve,
      lng: origin.lng + (destination.lng - origin.lng) * t,
    });
  }
  
  return points;
}

// Main simulation
async function runSimulation() {
  // Fetch destination
  let destination;
  
  if (deliveryType === 'order') {
    destination = await fetchOrderDestination(deliveryId);
  } else if (deliveryType === 'subscription') {
    destination = await fetchSubscriptionDestination(deliveryId);
  } else {
    destination = await autoDetectAndFetchDestination(deliveryId);
  }
  
  if (!destination) {
    console.error('\n❌ Could not fetch destination. Exiting.');
    process.exit(1);
  }
  
  const origin = CONFIG.driverStart;
  
  // Print configuration
  console.log('\n' + '='.repeat(60));
  console.log('🚚 REALISTIC DRIVER SIMULATOR');
  console.log('='.repeat(60));
  console.log(`📋 Type: ${deliveryType === 'subscription' ? 'Subscription' : 'Order'}`);
  console.log(`🆔 ID: ${deliveryId}`);
  console.log(`🏪 Origin: ${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`);
  console.log(`📍 Destination: ${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}`);
  console.log(`🚗 Speed: ${speedKmh} km/h`);
  console.log(`⏱️  Update interval: ${updateIntervalMs}ms`);
  console.log(`🚦 Traffic simulation: ${enableTraffic ? 'ON' : 'OFF'}`);
  console.log('='.repeat(60));
  
  // Fetch actual route from Google Directions API
  const routeData = await fetchRoute(origin, destination);
  
  let routePoints;
  if (routeData && routeData.points && routeData.points.length >= 2) {
    // Generate high-resolution points based on speed
    routePoints = generateHighResolutionRoute(routeData.points, speedKmh, updateIntervalMs);
  } else {
    console.log('⚠️  Using fallback direct route');
    const fallbackPoints = generateFallbackRoute(origin, destination);
    routePoints = generateHighResolutionRoute(fallbackPoints, speedKmh, updateIntervalMs);
  }
  
  // Connect to Socket.IO
  console.log('🔌 Connecting to Socket.IO server...');
  
  const socket = io(CONFIG.serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });
  
  socket.on('connect', () => {
    console.log(`✅ Connected (socket id: ${socket.id})`);
    startDriving(socket, routePoints, destination, routeData);
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Disconnected from server');
  });
}

async function startDriving(socket, routePoints, destination, routeData) {
  console.log('\n🚗 Starting delivery...\n');
  
  let currentIndex = 0;
  const totalPoints = routePoints.length;
  const startTime = Date.now();
  
  let currentStatus = 'en_route';
  let isNearby = false;
  let hasArrived = false;
  
  // Initialize tracking on server
  await initializeTracking(routePoints, routeData);
  
  const interval = setInterval(async () => {
    if (currentIndex >= totalPoints || hasArrived) {
      // Delivery complete
      console.log('\n\n✅ DELIVERY COMPLETED!');
      clearInterval(interval);
      
      // Send final status
      socket.emit('driverLocation', {
        deliveryId,
        deliveryType,
        orderId: deliveryType === 'order' ? deliveryId : undefined,
        subscriptionDeliveryId: deliveryType === 'subscription' ? deliveryId : undefined,
        latitude: destination.lat,
        longitude: destination.lng,
        heading: 0,
        speed: 0,
        status: 'delivered',
      });
      
      // Update status via API
      await updateStatusViaAPI('delivered');
      
      setTimeout(() => {
        console.log('👋 Simulation ended.');
        socket.disconnect();
        process.exit(0);
      }, 2000);
      
      return;
    }
    
    const point = routePoints[currentIndex];
    const nextPoint = routePoints[Math.min(currentIndex + 1, totalPoints - 1)];
    
    // Calculate distance to destination
    const distanceToDestination = calculateDistanceMeters(
      point.lat, point.lng,
      destination.lat, destination.lng
    );
    
    // Calculate current speed with traffic simulation
    let currentSpeed = speedKmh;
    if (enableTraffic) {
      // Random traffic slowdowns
      if (Math.random() < 0.1) {
        currentSpeed = speedKmh * (0.3 + Math.random() * 0.4); // 30-70% speed
      }
    }
    const speedMps = currentSpeed * 1000 / 3600;
    
    // Calculate heading
    const heading = calculateBearing(point.lat, point.lng, nextPoint.lat, nextPoint.lng);
    
    // Add small GPS jitter for realism
    const jitter = 0.00003;
    const latitude = point.lat + (Math.random() - 0.5) * jitter;
    const longitude = point.lng + (Math.random() - 0.5) * jitter;
    
    // Check for status updates
    if (distanceToDestination <= CONFIG.arrivalThresholdMeters && !hasArrived) {
      hasArrived = true;
      currentStatus = 'arrived';
      console.log('\n\n🎉 ARRIVED AT DESTINATION!');
      await updateStatusViaAPI('arrived');
    } else if (distanceToDestination <= CONFIG.nearbyThresholdMeters && !isNearby) {
      isNearby = true;
      currentStatus = 'nearby';
      console.log('\n\n📍 NEAR CUSTOMER LOCATION!');
      await updateStatusViaAPI('nearby');
    }
    
    // Emit location update
    const locationUpdate = {
      deliveryId,
      deliveryType,
      orderId: deliveryType === 'order' ? deliveryId : undefined,
      subscriptionDeliveryId: deliveryType === 'subscription' ? deliveryId : undefined,
      latitude,
      longitude,
      heading: Math.round(heading),
      speed: Math.round(speedMps * 10) / 10,
      status: currentStatus,
      distanceToDestination: Math.round(distanceToDestination),
    };
    
    socket.emit('driverLocation', locationUpdate);
    
    // Update location via REST API for persistence
    await updateLocationViaAPI(latitude, longitude, heading, speedMps);
    
    // Progress display
    const progress = Math.round((currentIndex / totalPoints) * 100);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = totalPoints - currentIndex;
    const etaSeconds = Math.round(remaining * updateIntervalMs / 1000);
    
    // Clear line and print progress
    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
    process.stdout.write(
      `🚚 ${progress}% | ` +
      `Point ${currentIndex + 1}/${totalPoints} | ` +
      `Distance: ${(distanceToDestination / 1000).toFixed(2)}km | ` +
      `Speed: ${currentSpeed.toFixed(0)}km/h | ` +
      `ETA: ${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s | ` +
      `Status: ${currentStatus}`
    );
    
    currentIndex++;
    
  }, updateIntervalMs);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n⚠️  Stopping simulation...');
    clearInterval(interval);
    socket.disconnect();
    process.exit(0);
  });
}

async function initializeTracking(routePoints, routeData) {
  try {
    const origin = routePoints[0];
    const destination = routePoints[routePoints.length - 1];
    
    // Convert route points to the format expected by backend
    // Send the ACTUAL high-resolution route points the driver will follow
    const routePointsForBackend = routePoints.map(p => ({ lat: p.lat, lng: p.lng }));
    
    // Update subscription delivery status to 'out_for_delivery' when simulator starts
    if (deliveryType === 'subscription') {
      try {
        const statusResponse = await fetch(`${CONFIG.serverUrl}/api/subscriptions/${deliveryId}/delivery-status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'out_for_delivery' }),
        });
        if (statusResponse.ok) {
          console.log('📦 Subscription status updated to: out_for_delivery');
        }
      } catch (e) {
        console.log('Note: Could not update subscription status:', e.message);
      }
    }
    
    const response = await fetch(`${CONFIG.serverUrl}/api/tracking/${deliveryId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryType,
        orderId: deliveryType === 'order' ? deliveryId : undefined,
        subscriptionDeliveryId: deliveryType === 'subscription' ? deliveryId : undefined,
        origin: {
          latitude: origin.lat,
          longitude: origin.lng,
          address: 'Store Location',
        },
        destination: {
          latitude: destination.lat,
          longitude: destination.lng,
          address: routeData?.endAddress || 'Customer Location',
        },
        polyline: routeData?.polyline || '',
        // Send the actual route points the driver will follow
        routePoints: routePointsForBackend,
        distance: routeData?.distance?.value || 0,
        duration: routeData?.duration?.value || 0,
        driverName: 'Rajesh Kumar',
        status: 'en_route',
      }),
    });
    
    if (response.ok) {
      console.log('✅ Tracking initialized on server');
      console.log(`   Sent ${routePointsForBackend.length} route points to backend`);
    }
  } catch (error) {
    console.error('Failed to initialize tracking:', error.message);
  }
}

async function updateLocationViaAPI(latitude, longitude, heading, speed) {
  try {
    await fetch(`${CONFIG.serverUrl}/api/tracking/${deliveryId}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude, longitude, heading, speed }),
    });
  } catch (error) {
    // Silently ignore
  }
}

async function updateStatusViaAPI(status) {
  try {
    await fetch(`${CONFIG.serverUrl}/api/tracking/${deliveryId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    console.log(`   Status updated to: ${status}`);
  } catch (error) {
    console.error('Failed to update status:', error.message);
  }
}

// Start simulation
runSimulation().catch((error) => {
  console.error('Simulation error:', error);
  process.exit(1);
});
