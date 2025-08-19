// Server/index.ts
// BuyFly Server — no email/IMAP code. All required routes, safe defaults.

import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';

// -------- Types (match Client) --------
type Recommendation = 'GOOD_DEAL' | 'BAD_DEAL' | 'NEUTRAL';

interface ProductAnalysis {
  id: string;
  imageUrl: string;
  photos?: string[];
  barcode?: string;
  identifiedProduct: string;
  confidence: number;
  recommendation: Recommendation;
  estimatedProfit: number;
  profitMargin: number;
  brand?: string;
  category?: string;
  condition?: string;
  keywords?: string;
  color?: string;
  size?: string;
  sku?: string;
  quantity?: number;
  purchasePrice?: number;
  historyType?: 'buy' | 'fly';
  timestamp?: Date | string;
}

interface NearbySale {
  id: string;
  name: string;
  type: 'thrift' | 'estate' | 'garage';
  address: string;
  phone?: string;
  openHours?: string;
  latitude: number;
  longitude: number;
  distance: number; // miles
}

interface ShippingItem {
  id: string;
  platform: 'ebay' | 'poshmark' | 'mercari' | 'depop';
  itemName: string;
  salePrice: number;
  buyerAddress: string;
  shippingDeadline: string; // ISO string or friendly
}

// -------- App setup --------
const app = express();

// Allow local dev and Render client
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
app.use(
  cors({
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN,
  })
);

// JSON & urlencoded parsers
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

// File upload (for /api/source)
// Using memory storage because we only need the bytes briefly.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 5MB x up to 10 images
});

// -------- In-memory stores (simple dev defaults) --------
const deweyStore: ProductAnalysis[] = [];
const shippingStore: ShippingItem[] = [
  {
    id: 'ship-1',
    platform: 'ebay',
    itemName: 'Nike Air Max 270',
    salePrice: 89.99,
    buyerAddress: '123 Main St, Austin, TX',
    shippingDeadline: new Date(Date.now() + 3 * 86400000).toISOString(),
  },
];

function newId(prefix: string) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

// Haversine for Who’s Near distances
function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// -------- Health --------
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'BuyFly Server',
    emailIntegration: 'disabled', // make it obvious
    time: new Date().toISOString(),
  });
});

// -------- Dewey --------
app.get('/api/dewey', (_req: Request, res: Response) => {
  res.json(deweyStore);
});

app.post('/api/dewey/save', (req: Request, res: Response) => {
  const item = req.body as ProductAnalysis;
  const id = item.id || newId('dewey');
  const saved: ProductAnalysis = {
    ...item,
    id,
    timestamp: item.timestamp || new Date().toISOString(),
  };

  // upsert by id
  const idx = deweyStore.findIndex((i) => i.id === id);
  if (idx >= 0) deweyStore[idx] = saved;
  else deweyStore.push(saved);

  res.json(saved);
});

// -------- Who's Near --------
app.get('/api/whos-near', (req: Request, res: Response) => {
  const lat = Number(req.query.lat ?? 0);
  const lng = Number(req.query.lng ?? 0);
  const radius = Number(req.query.radius ?? 25); // miles

  // Simple sample locations around the provided point
  const seeds: Omit<NearbySale, 'distance'>[] = [
    {
      id: 'sale-1',
      name: 'Thrifty Owl',
      type: 'thrift',
      address: '456 Pine St',
      phone: '(555) 010-1111',
      openHours: '10a–6p',
      latitude: lat + 0.05,
      longitude: lng + 0.05,
    },
    {
      id: 'sale-2',
      name: 'Estate Treasures',
      type: 'estate',
      address: '789 Oak Ave',
      phone: '(555) 010-2222',
      openHours: '9a–3p',
      latitude: lat - 0.07,
      longitude: lng - 0.03,
    },
    {
      id: 'sale-3',
      name: 'Saturday Garage Bonanza',
      type: 'garage',
      address: '101 Maple Ct',
      phone: '',
      openHours: 'Sat 8a–1p',
      latitude: lat + 0.12,
      longitude: lng - 0.08,
    },
  ];

  const results: NearbySale[] = seeds
    .map((s) => ({
      ...s,
      distance: milesBetween(lat, lng, s.latitude, s.longitude),
    }))
    .filter((s) => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);

  res.json(results);
});

// -------- Shipping --------
app.get('/api/shipping', (req: Request, res: Response) => {
  // For now we don’t validate the eBay key here; the Client sends it.
  // You can wire your real integration later.
  const _apiKey = String(req.query.apiKey || '');
  res.json(shippingStore);
});

app.post('/api/shipping/mark-shipped', (req: Request, res: Response) => {
  const { id } = req.body as { id: string; platform: string };
  const idx = shippingStore.findIndex((s) => s.id === id);
  if (idx >= 0) {
    const [removed] = shippingStore.splice(idx, 1);
    return res.json({ ok: true, removed });
  }
  res.status(404).json({ ok: false, error: 'Not found' });
});

// -------- Source (analyze images/barcode) --------
// The Client sends FormData with image0..imageN (data URLs), plus fields.
app.post('/api/source', upload.any(), (req: Request, res: Response) => {
  // Extract fields
  const barcode = (req.body.barcode ?? '').toString() || undefined;
  const purchasePrice = Number(req.body.purchasePrice ?? 0) || 0;
  const color = (req.body.color ?? '').toString() || undefined;
  const size = (req.body.size ?? '').toString() || undefined;
  const sku = (req.body.sku ?? '').toString() || undefined;
  const quantity = Number(req.body.quantity ?? 1) || 1;

  // Build photos array (data URLs or buffers)
  const files = (req.files as Express.Multer.File[]) || [];
  const photos: string[] = [];

  // If the client sent data URLs as fields (image0, image1, ...), capture them too
  Object.keys(req.body)
    .filter((k) => /^image\d+$/i.test(k))
    .forEach((k) => photos.push(req.body[k]));

  // If files uploaded, convert to base64 data URLs for demo purposes
  for (const f of files) {
    const b64 = f.buffer.toString('base64');
    photos.push(`data:${f.mimetype};base64,${b64}`);
  }

  // --- Simple mock analysis (replace with your real model/service) ---
  const identifiedProduct =
    barcode ? `Barcode ${barcode}` : 'Unknown Item (photo analysis)';
  const confidence = barcode ? 0.95 : 0.7;
  // naive price guess
  const comps = barcode ? 35 + Math.random() * 40 : 20 + Math.random() * 60;
  const estimatedProfit = Math.max(0, comps - purchasePrice);
  const profitMargin = comps === 0 ? 0 : estimatedProfit / comps;
  const recommendation: Recommendation =
    estimatedProfit > 15 ? 'GOOD_DEAL' : estimatedProfit > 5 ? 'NEUTRAL' : 'BAD_DEAL';

  const result: ProductAnalysis = {
    id: newId('analysis'),
    imageUrl: photos[0] || '',
    photos: photos.slice(0, 10),
    barcode,
    identifiedProduct,
    confidence,
    recommendation,
    estimatedProfit: Number(estimatedProfit.toFixed(2)),
    profitMargin: Number(profitMargin.toFixed(2)),
    color,
    size,
    sku,
    quantity,
    purchasePrice,
    timestamp: new Date().toISOString(),
    brand: undefined,
    category: undefined,
    condition: undefined,
    keywords: undefined,
  };

  res.json(result);
});

// -------- Vendoo prepare --------
app.post('/api/vendoo/prepare', (req: Request, res: Response) => {
  // In the client we call this with { items: deweyItems }
  // Here we just echo success. Wire to your real bot/service later.
  const items = (req.body.items as ProductAnalysis[]) || [];
  res.json({ ok: true, count: items.length });
});

// -------- Start server --------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BuyFly Server listening on port ${PORT}`);
});
