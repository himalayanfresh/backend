import express from 'express';
import fetch from 'node-fetch';
import { decodePolyline, calculateDistance } from '../tools/decode_polyline.js';

const router = express.Router();

// Google Maps API Key (should be in .env)
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCkFcBTJOEdufqsr8EFxT-Qmh40KNK59P8';

/**
 * GET /api/route
 * 
 * Query params:
 * - originLat, originLng: Starting point (store/warehouse)
 * - destLat, destLng: Destination point (customer address)
 * - mode: (optional) 'driving' (default), 'walking', 'bicycling'
 * 
 * Returns:
 * - polyline: Encoded polyline string
 * - points: Decoded array of {lat, lng} coordinates
 * - distance: Total distance in meters
 * - duration: Estimated duration in seconds
 * - eta: Estimated arrival time ISO string
 */
router.get('/', async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng, mode = 'driving' } = req.query;

    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ 
        error: 'Missing required parameters: originLat, originLng, destLat, destLng' 
      });
    }

    const origin = `${originLat},${originLng}`;
    const destination = `${destLat},${destLng}`;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=${mode}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(400).json({ 
        error: `Directions API error: ${data.status}`,
        details: data.error_message || 'No route found'
      });
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    // Decode the polyline
    const encodedPolyline = route.overview_polyline.points;
    const decodedPoints = decodePolyline(encodedPolyline);

    // Calculate ETA
    const now = new Date();
    const eta = new Date(now.getTime() + leg.duration.value * 1000);

    res.json({
      status: 'OK',
      polyline: encodedPolyline,
      points: decodedPoints,
      distance: {
        value: leg.distance.value, // in meters
        text: leg.distance.text,
      },
      duration: {
        value: leg.duration.value, // in seconds
        text: leg.duration.text,
      },
      eta: eta.toISOString(),
      startAddress: leg.start_address,
      endAddress: leg.end_address,
      bounds: route.bounds,
    });
  } catch (error) {
    console.error('Route API error:', error);
    res.status(500).json({ error: 'Failed to fetch route', details: error.message });
  }
});

/**
 * POST /api/route/waypoints
 * 
 * Get route with multiple waypoints (for multi-stop deliveries)
 * 
 * Body:
 * - origin: {lat, lng}
 * - destination: {lat, lng}
 * - waypoints: [{lat, lng}, ...] (optional)
 * - optimize: boolean (optional) - optimize waypoint order
 */
router.post('/waypoints', async (req, res) => {
  try {
    const { origin, destination, waypoints = [], optimize = false, mode = 'driving' } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Missing origin or destination' });
    }

    let waypointsParam = '';
    if (waypoints.length > 0) {
      const waypointStrs = waypoints.map(wp => `${wp.lat},${wp.lng}`);
      waypointsParam = `&waypoints=${optimize ? 'optimize:true|' : ''}${waypointStrs.join('|')}`;
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}${waypointsParam}&mode=${mode}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(400).json({ 
        error: `Directions API error: ${data.status}`,
        details: data.error_message 
      });
    }

    const route = data.routes[0];
    const encodedPolyline = route.overview_polyline.points;
    const decodedPoints = decodePolyline(encodedPolyline);

    // Calculate total distance and duration
    let totalDistance = 0;
    let totalDuration = 0;
    for (const leg of route.legs) {
      totalDistance += leg.distance.value;
      totalDuration += leg.duration.value;
    }

    const now = new Date();
    const eta = new Date(now.getTime() + totalDuration * 1000);

    res.json({
      status: 'OK',
      polyline: encodedPolyline,
      points: decodedPoints,
      legs: route.legs.map(leg => ({
        distance: leg.distance,
        duration: leg.duration,
        startAddress: leg.start_address,
        endAddress: leg.end_address,
      })),
      totalDistance: {
        value: totalDistance,
        text: `${(totalDistance / 1000).toFixed(1)} km`,
      },
      totalDuration: {
        value: totalDuration,
        text: formatDuration(totalDuration),
      },
      eta: eta.toISOString(),
      waypointOrder: data.routes[0].waypoint_order || [],
      bounds: route.bounds,
    });
  } catch (error) {
    console.error('Waypoints route error:', error);
    res.status(500).json({ error: 'Failed to fetch route', details: error.message });
  }
});

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

export default router;
