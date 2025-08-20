// Client/src/App.tsx
import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { BrowserMultiFormatReader } from '@zxing/library';
import { Camera, CheckCircle, ShoppingCart, MapPin, Package, Search, Settings, Mic } from 'lucide-react';
import { isMobile } from 'react-device-detect';
import { Virtuoso } from 'react-virtuoso';
import Dexie from 'dexie';
import './index.css';

// ---- minimal types so TS doesn't choke on SpeechRecognition in the browser
type SpeechRecognition = any;
declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

// ---- super-simple toast helper (console + alert)
const toast = ({ title, description }: { title: string; description?: string }) => {
  console.log(`[${title}] ${description || ''}`);
  if (typeof window !== 'undefined') {
    try { alert(`${title}${description ? `: ${description}` : ''}`); } catch {}
  }
};

// Initialize IndexedDB
const db = new Dexie('BuyFlyDB');
db.version(1).stores({
  snapStack: 'id',
  dewey: 'id',
  nearbySales: 'id',
  shipping: 'id',
  settings: 'key',
  history: 'id',
});

interface ProductAnalysis {
  id: string;
  imageUrl: string;
  photos?: string[];
  barcode?: string;
  identifiedProduct: string;
  confidence: number;
  recommendation: 'GOOD_DEAL' | 'BAD_DEAL' | 'NEUTRAL';
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
  timestamp?: Date;
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
  distance: number;
}

interface ShippingItem {
  id: string;
  platform: 'ebay' | 'poshmark' | 'mercari' | 'depop';
  itemName: string;
  salePrice: number;
  buyerAddress: string;
  shippingDeadline: string;
}

// tiny Button wrapper to keep classNames consistent
const Btn = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`touch-friendly rounded px-3 py-2 transition-transform hover:scale-95 ${
      props.className || ''
    }`}
    type={props.type || 'button'}
  />
);

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'whosnear' | 'source' | 'snapstack' | 'dewey' | 'shipping' | 'settings'>('whosnear');
  const [searchQuery, setSearchQuery] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [purchasePrice, setPurchasePrice] = useState<string>('0');
  const [snapStackQueue, setSnapStackQueue] = useState<ProductAnalysis[]>([]);
  const [currentSnapStackItem, setCurrentSnapStackItem] = useState<ProductAnalysis | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [ebayApiKey, setEbayApiKey] = useState<string>('');
  const [voiceSearch, setVoiceSearch] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [history, setHistory] = useState<ProductAnalysis[]>([]);
  const [color, setColor] = useState<string>('');
  const [size, setSize] = useState<string>('');
  const [sku, setSku] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [approveImages, setApproveImages] = useState(false);

  const speechRecognition = useRef<SpeechRecognition | null>(null);
  const codeReader = useRef(new BrowserMultiFormatReader());

  // Load settings
  useEffect(() => {
    db.settings.get('theme').then((setting) => setTheme(setting?.value || 'dark'));
    db.settings.get('ebayApiKey').then((setting) => setEbayApiKey(setting?.value || ''));
  }, []);

  // Query for Dewey items
  const { data: deweyItems, refetch: refetchDewey } = useQuery<ProductAnalysis[]>({
    queryKey: ['dewey', searchQuery],
    queryFn: async () => {
      const data = searchQuery
        ? await db.dewey
            .where('identifiedProduct')
            .startsWithIgnoreCase(searchQuery)
            .or('brand')
            .startsWithIgnoreCase(searchQuery)
            .toArray()
        : await axios.get('/api/dewey').then((res) => res.data);
      await db.dewey.bulkPut(data);
      return data;
    },
  });

  // Query for Who's Near
  const { data: nearbySales, refetch: refetchNearby } = useQuery<NearbySale[]>({
    queryKey: ['whosnear', location, searchQuery],
    queryFn: async () => {
      const data = searchQuery
        ? await db.nearbySales.where('name').startsWithIgnoreCase(searchQuery).toArray()
        : await axios
            .get('/api/whos-near', { params: { lat: location?.lat, lng: location?.lng, radius: 25 } })
            .then((res) => res.data);
      await db.nearbySales.bulkPut(data);
      return data;
    },
    enabled: !!location,
  });

  // Query for Shipping items
  const { data: shippingItems, refetch: refetchShipping } = useQuery<ShippingItem[]>({
    queryKey: ['shipping', searchQuery],
    queryFn: async () => {
      const data = searchQuery
        ? await db.shipping.where('itemName').startsWithIgnoreCase(searchQuery).toArray()
        : await axios.get('/api/shipping', { params: { apiKey: ebayApiKey } }).then((res) => res.data);
      await db.shipping.bulkPut(data);
      return data;
    },
  });

  // Mutation for Source analysis
  const analyzeMutation = useMutation({
    mutationFn: (data: FormData) =>
      axios
        .post<ProductAnalysis>('/api/source', data, { headers: { 'X-eBay-Api-Key': ebayApiKey } })
        .then((res) => res.data),
    onSuccess: (data) => {
      toast({ title: data.recommendation, description: `${data.identifiedProduct} - Profit: $${data.estimatedProfit.toFixed(2)}` });
      setImage(null);
      setBarcode(null);
      if (data.recommendation === 'GOOD_DEAL') {
        const promptVal = window.prompt('Enter purchase price:');
        setPurchasePrice(promptVal || '0');
        queueToSnapStack.mutate(data);
      } else {
        setHistory((prev) => [...prev, { ...data, historyType: 'fly', timestamp: new Date() }].slice(-2
