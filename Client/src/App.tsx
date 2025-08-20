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
        setHistory((prev) => [...prev, { ...data, historyType: 'fly', timestamp: new Date() }].slice(-200));
      }
    },
    onError: () => toast({ title: 'Error', description: 'Failed to analyze product. Try again?' }),
  });

  // Mutation for SnapStack
  const queueToSnapStack = useMutation({
    mutationFn: (analysis: ProductAnalysis) => db.snapStack.put({ ...analysis, photos: [analysis.imageUrl] }),
    onSuccess: () => {
      db.snapStack.toArray().then(setSnapStackQueue);
      toast({ title: 'Queued', description: 'Item added to SnapStack' });
    },
  });

  // Mutation for Dewey
  const saveToDewey = useMutation({
    mutationFn: (item: ProductAnalysis) => axios.post('/api/dewey/save', item).then((res) => res.data),
    onSuccess: () => {
      refetchDewey();
      toast({ title: 'Saved to Dewey', description: 'Item ready for Vendoo. Open the bot to continue.' });
    },
  });

  // Mutation for marking shipped
  const markShipped = useMutation({
    mutationFn: ({ id, platform }: { id: string; platform: string }) =>
      axios.post('/api/shipping/mark-shipped', { id, platform, apiKey: ebayApiKey }).then((res) => res.data),
    onSuccess: () => refetchShipping(),
  });

  // Get location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        refetchNearby();
      },
      () => toast({ title: 'Location Error', description: 'Unable to get location. Using cached data.' }),
      { enableHighAccuracy: true }
    );
  }, []);

  // Initialize camera (mobile only)
  useEffect(() => {
    const startCamera = async () => {
      if (!isMobile) {
        toast({ title: 'Camera Unavailable', description: 'Camera is mobile-only' });
        return;
      }
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          (videoRef.current as any).srcObject = mediaStream;
          setStream(mediaStream);
        }
      } catch (error) {
        toast({ title: 'Camera Error', description: 'Unable to access camera' });
      }
    };

    if (mode === 'source' || mode === 'snapstack') {
      startCamera();
    }

    db.snapStack.toArray().then(setSnapStackQueue);
    db.history.toArray().then(setHistory);

    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [mode]);

  // Barcode scanning
  useEffect(() => {
    if (videoRef.current && mode === 'source' && isMobile) {
      codeReader.current.decodeFromVideoDevice(undefined, videoRef.current, (result: any, error: any) => {
        if (result) {
          setBarcode(result.getText());
          toast({ title: 'Barcode Detected', description: result.getText() });
        }
        if (error && !error.isNoResult?.()) {
          console.error('Barcode error:', error);
          toast({ title: 'Barcode Error', description: 'Retry or use Google Lens?' });
        }
      });
    }

    return () => {
      codeReader.current.reset();
    };
  }, [mode]);

  // Voice search
  useEffect(() => {
    if (voiceSearch) {
      const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!RecognitionCtor) {
        toast({ title: 'Voice Search', description: 'Not supported in this browser' });
        setVoiceSearch(false);
        return;
      }
      const recognition = new RecognitionCtor();
      (recognition as any).onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setSearchQuery(transcript);
        toast({ title: 'Voice Search', description: transcript });
        setVoiceSearch(false);
      };
      (recognition as any).onend = () => setVoiceSearch(false);
      (recognition as any).start();
    }
  }, [voiceSearch]);

  // Capture image
  const captureImage = async () => {
    if (!videoRef.current || !stream || !isMobile) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    let imageUrl = canvas.toDataURL('image/jpeg', 0.7);

    imageUrl = await autoProcessImage(imageUrl);

    if (mode === 'source') {
      images.push(imageUrl);
      const maxPhotos = barcode ? 1 : (batchMode ? 10 : 3);
      if (images.length < maxPhotos) return;
      if (window.confirm('Approve images?')) {
        const formData = new FormData();
        images.forEach((img, i) => formData.append(`image${i}`, img));
        if (barcode) formData.append('barcode', barcode);
        formData.append('purchasePrice', purchasePrice || '0');
        formData.append('color', color);
        formData.append('size', size);
        formData.append('sku', sku);
        formData.append('quantity', quantity.toString());
        analyzeMutation.mutate(formData);
      }
      setImages([]);
    } else if (mode === 'snapstack' && currentSnapStackItem) {
      const updatedPhotos = [...(currentSnapStackItem.photos || []), imageUrl];
      if (updatedPhotos.length <= 25) {
        const updatedItem = { ...currentSnapStackItem, photos: updatedPhotos };
        await db.snapStack.put(updatedItem);
        setSnapStackQueue((prev) => prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
        toast({ title: 'Photo Added', description: `Added to ${updatedItem.identifiedProduct} (${updatedPhotos.length}/25)` });
        setCurrentSnapStackItem(
          snapStackQueue[snapStackQueue.findIndex((item) => item.id === currentSnapStackItem.id) + 1] || null
        );
      } else {
        toast({ title: 'Limit', description: 'Max 25 photos' });
      }
    }
  };

  // Auto process image
  const autoProcessImage = async (imageUrl: string) => {
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve) => (img.onload = resolve as any));
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d')!;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Rotate 90 degrees
    canvas.width = img.height;
    canvas.height = img.width;
    ctx = canvas.getContext('2d')!;
    ctx.translate(img.height, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);

    // Resize to square
    const size = Math.min(canvas.width, canvas.height);
    const squareCanvas = document.createElement('canvas');
    squareCanvas.width = size;
    squareCanvas.height = size;
    squareCanvas.getContext('2d')?.drawImage(canvas, 0, 0, size, size, 0, 0, size, size);

    // Simple brighten
    const enhanceCanvas = document.createElement('canvas');
    enhanceCanvas.width = size;
    enhanceCanvas.height = size;
    const enhanceCtx = enhanceCanvas.getContext('2d')!;
    enhanceCtx.drawImage(squareCanvas, 0, 0);
    enhanceCtx.globalCompositeOperation = 'lighter';
    enhanceCtx.globalAlpha = 0.1;
    enhanceCtx.fillStyle = '#ffffff';
    enhanceCtx.fillRect(0, 0, size, size);
    enhanceCtx.globalAlpha = 1;

    return enhanceCanvas.toDataURL('image/jpeg', 0.7);
  };

  // Handle Buy
  const handleBuy = (analysis: ProductAnalysis) => {
    if (analysis.recommendation === 'GOOD_DEAL') {
      queueToSnapStack.mutate(analysis);
      setHistory((prev) => [...prev, { ...analysis, historyType: 'buy', timestamp: new Date() }].slice(-200));
    } else {
      toast({ title: 'Cannot Queue', description: 'Only GOOD_DEAL items' });
      setHistory((prev) => [...prev, { ...analysis, historyType: 'fly', timestamp: new Date() }].slice(-200));
    }
  };

  // Handle Next Item
  const handleNextItem = async () => {
    if (currentSnapStackItem) {
      await saveToDewey.mutate(currentSnapStackItem);
      await db.snapStack.delete(currentSnapStackItem.id);
      const newQueue = await db.snapStack.toArray();
      setSnapStackQueue(newQueue);
      setCurrentSnapStackItem(newQueue[0] || null);
      if (newQueue.length === 0) toast({ title: 'Complete', description: 'All sent to Dewey. Open bot.' });
    }
  };

  // Send all to Dewey
  const sendAllToDewey = async () => {
    for (const item of snapStackQueue) {
      await saveToDewey.mutate(item);
      await db.snapStack.delete(item.id);
    }
    setSnapStackQueue([]);
    setCurrentSnapStackItem(null);
    setMode('dewey');
    toast({ title: 'Complete', description: 'All sent to Dewey. Open bot.' });
  };

  // Trigger Vendoo bot
  const triggerVendooBot = async () => {
    try {
      await axios.post('/api/vendoo/prepare', { items: deweyItems });
      toast({ title: 'Vendoo Prep', description: 'Items sent to bot' });
    } catch {
      toast({ title: 'Vendoo Error', description: 'Failed to prepare' });
    }
  };

  // Pull-to-refresh
  const handleRefresh = () => {
    if (mode === 'whosnear') refetchNearby();
    if (mode === 'dewey') refetchDewey();
    if (mode === 'shipping') refetchShipping();
  };

  // Clear history
  const clearHistory = () => {
    setHistory([]);
    db.history.clear();
    toast({ title: 'Cleared', description: 'History reset' });
  };

  return (
    <div className={`mobile-optimized flex flex-col gap-4 p-4 min-h-screen ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      <div className="sticky top-0 z-10 bg-opacity-80 backdrop-blur-sm">
        <div className="flex justify-between items-center p-2">
          <h1 className="text-2xl font-bold gradient-text">BuyFly 🦉</h1>
          <Btn onClick={() => setMode('settings')} className="bg-transparent">
            <Settings className="w-6 h-6" />
          </Btn>
        </div>
        <div className="flex items-center gap-2 p-2">
          <Search className="w-6 h-6 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
          />
          <Btn onClick={() => setVoiceSearch(true)} className="bg-transparent">
            <Mic className="w-6 h-6 text-gray-400" />
          </Btn>
          <Btn onClick={() => setBatchMode(!batchMode)} className="bg-transparent">
            {batchMode ? 'Batch' : 'Single'}
          </Btn>
        </div>
        {mode === 'source' && (
          <Btn onClick={() => analyzeMutation.mutate(new FormData())} className="w-full bg-blue-600 text-white rounded mt-2">
            Get Results
          </Btn>
        )}
      </div>

      <div className="sticky bottom-0 z-10 bg-opacity-80 backdrop-blur-sm flex justify-around p-2 border-t">
        {[
          { mode: 'whosnear', label: 'Near', icon: <MapPin className="w-6 h-6" /> },
          { mode: 'source', label: 'Source', icon: <Camera className="w-6 h-6" /> },
          { mode: 'snapstack', label: 'SnapStack', icon: <ShoppingCart className="w-6 h-6" /> },
          { mode: 'dewey', label: 'Dewey', icon: <CheckCircle className="w-6 h-6" /> },
          { mode: 'shipping', label: 'Shipping', icon: <Package className="w-6 h-6" />, badge: (shippingItems?.length || 0) as number },
        ].map(({ mode: m, label, icon, badge }) => (
          <Btn
            key={m}
            onClick={() => {
              setMode(m as any);
              setCurrentSnapStackItem(null);
            }}
            className={`${mode === (m as any) ? 'bg-blue-600' : 'bg-gray-700'} text-white rounded relative`}
          >
            <div className="flex flex-col items-center gap-1">
              {icon}
              <span className="text-xs">{label}</span>
            </div>
            {badge ? <span className="absolute -top-2 -right-2 bg-red-600 rounded-full px-2 text-xs">{badge}</span> : null}
          </Btn>
        ))}
      </div>

      {mode === 'whosnear' && (
        <div onTouchStart={handleRefresh}>
          <h2 className="text-xl font-semibold">Who's Near 🦉</h2>
          {nearbySales ? (
            <div>
              <select
                onChange={() => refetchNearby()}
                className={`touch-friendly border rounded p-2 mb-4 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              >
                <option value="">All Sales</option>
                <option value="thrift">Thrift Stores</option>
                <option value="estate">Estate Sales</option>
                <option value="garage">Garage Sales</option>
              </select>
              <Virtuoso
                style={{ height: '50vh' }}
                data={[...nearbySales].sort((a, b) => a.distance - b.distance)}
                itemContent={(index, sale) => (
                  <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <p className="font-semibold">
                      {sale.name} ({sale.type})
                    </p>
                    <p>
                      <a
                        href={`waze://?ll=${sale.latitude},${sale.longitude}&navigate=yes`}
                        target="_blank"
                        className="text-blue-400 underline flex items-center gap-1"
                      >
                        <MapPin className="w-4 h-4" /> {sale.address}
                      </a>
                    </p>
                    <p>{sale.phone || 'No phone'}</p>
                    <p>{sale.openHours || 'Hours unavailable'}</p>
                    <p>{sale.distance.toFixed(1)} miles</p>
                  </div>
                )}
              />
            </div>
          ) : (
            <div className="animate-pulse space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}</div>
          )}
        </div>
      )}

      {mode === 'source' && (
        <>
          <div className="camera-container relative">
            {isMobile ? (
              <video ref={videoRef} autoPlay playsInline className="camera-video w-full h-[60vh] rounded-lg" />
            ) : (
              <p className="text-center">Camera is mobile-only</p>
            )}
            {isMobile && (
              <button
                onClick={captureImage}
                className="capture-button absolute bottom-4 right-4 bg-gradient-to-r from-blue-500 to-purple-600 p-4 rounded-full shadow-lg transition-transform hover:scale-95"
              >
                <Camera className="w-8 h-8 text-white" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={barcode || ''}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Barcode (auto-detected)"
              className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
            <input
              type="number"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="Price ($)"
              className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="Color"
              className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="Size"
              className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SKU"
              className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              placeholder="Qty"
              className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
            />
          </div>

          {analyzeMutation.data && (
            <div className={`border p-4 rounded-lg ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <p className="font-semibold">{analyzeMutation.data.identifiedProduct}</p>
              <p>Profit: ${analyzeMutation.data.estimatedProfit.toFixed(2)}</p>
              <p className="text-sm">{analyzeMutation.data.recommendation}</p>
              <div className="flex gap-2 mt-2">
                {analyzeMutation.data.recommendation === 'GOOD_DEAL' && (
                  <Btn onClick={() => handleBuy(analyzeMutation.data)} className="bg-green-600 text-white rounded flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5" /> Buy
                  </Btn>
                )}
                <Btn onClick={() => setImage(null)} className="bg-gray-600 text-white rounded flex items-center gap-2">
                  Fly
                </Btn>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'snapstack' && (
        <>
          {snapStackQueue.length > 0 && !currentSnapStackItem ? (
            <div onTouchStart={handleRefresh}>
              <h2 className="text-xl font-semibold">SnapStack Queue</h2>
              <p>Proceed or start new?</p>
              <div className="flex gap-2 mt-2">
                <Btn onClick={() => setCurrentSnapStackItem(snapStackQueue[0])} className="bg-blue-600 text-white rounded">
                  Proceed
                </Btn>
                <Btn
                  onClick={async () => {
                    await db.snapStack.clear();
                    setSnapStackQueue([]);
                    setMode('source');
                  }}
                  className="bg-red-600 text-white rounded"
                >
                  Start New
                </Btn>
                <Btn onClick={sendAllToDewey} className="bg-purple-600 text-white rounded flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" /> Send All
                </Btn>
              </div>
              <Virtuoso
                style={{ height: '50vh' }}
                data={snapStackQueue}
                itemContent={(index, item) => (
                  <div
                    className={`border p-2 rounded mb-2 cursor-pointer ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}
                    onClick={() => setCurrentSnapStackItem(item)}
                  >
                    <p>
                      {item.identifiedProduct} - ${item.estimatedProfit.toFixed(2)}
                    </p>
                  </div>
                )}
              />
            </div>
          ) : currentSnapStackItem ? (
            <div>
              <h2 className="text-xl font-semibold">{currentSnapStackItem.identifiedProduct}</h2>
              {isMobile ? (
                <div className="camera-container relative">
                  <video ref={videoRef} autoPlay playsInline className="camera-video w-full h-[60vh] rounded-lg" />
                  <button
                    onClick={captureImage}
                    className="capture-button absolute bottom-4 right-4 bg-gradient-to-r from-blue-500 to-purple-600 p-4 rounded-full shadow-lg transition-transform hover:scale-95"
                  >
                    <Camera className="w-8 h-8 text-white" />
                  </button>
                </div>
              ) : (
                <p className="text-center">Camera is mobile-only</p>
              )}
              <div className="mt-4">
                <p>Photos: {currentSnapStackItem.photos?.length || 0}/25</p>
                <Btn onClick={handleNextItem} className="bg-blue-600 text-white rounded flex items-center gap-2 mt-2">
                  Next
                </Btn>
              </div>
            </div>
          ) : (
            <p className="text-gray-400">No items. Go to Source.</p>
          )}
        </>
      )}

      {mode === 'dewey' && (
        <div onTouchStart={handleRefresh}>
          <h2 className="text-xl font-semibold">Dewey</h2>
          {deweyItems ? (
            <Virtuoso
              style={{ height: '50vh' }}
              data={deweyItems}
              itemContent={(index, item) => (
                <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                  <p>
                    {item.identifiedProduct} - ${item.estimatedProfit.toFixed(2)}
                  </p>
                  <p className="text-sm text-gray-400">{item.recommendation}</p>
                  <p className="text-sm">Photos: {item.photos?.length || 0}</p>
                </div>
              )}
            />
          ) : (
            <div className="animate-pulse space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}</div>
          )}
          {!!deweyItems?.length && (
            <Btn onClick={triggerVendooBot} className="bg-blue-600 text-white rounded flex items-center gap-2 mt-4">
              <CheckCircle className="w-5 h-5" /> Send to Bot
            </Btn>
          )}
        </div>
      )}

      {mode === 'shipping' && (
        <div onTouchStart={handleRefresh}>
          <h2 className="text-xl font-semibold">Shipping</h2>
          {shippingItems ? (
            <Virtuoso
              style={{ height: '50vh' }}
              data={shippingItems}
              itemContent={(index, item) => (
                <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                  <p>
                    {item.itemName} - ${item.salePrice.toFixed(2)}
                  </p>
                  <p className="text-sm">{item.platform}</p>
                  <p className="text-sm">{item.buyerAddress}</p>
                  <p className="text-sm">Deadline: {item.shippingDeadline}</p>
                  <Btn onClick={() => markShipped.mutate({ id: item.id, platform: item.platform })} className="bg-green-600 text-white rounded mt-2">
                    Mark Shipped
                  </Btn>
                </div>
              )}
            />
          ) : (
            <div className="animate-pulse space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}</div>
          )}
        </div>
      )}

      {mode === 'settings' && (
        <div>
          <h2 className="text-xl font-semibold">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block">Theme</label>
              <select
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value as 'dark' | 'light');
                  db.settings.put({ key: 'theme', value: e.target.value });
                }}
                className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div>
              <label className="block">Who's Near Radius (miles)</label>
              <input
                type="number"
                defaultValue={25}
                className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
            </div>
            <div>
              <label className="block">eBay API Key</label>
              <input
                type="text"
                value={ebayApiKey}
                onChange={(e) => {
                  setEbayApiKey(e.target.value);
                  db.settings.put({ key: 'ebayApiKey', value: e.target.value });
                }}
                placeholder="Enter eBay API Key"
                className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
            </div>
            <div>
              <label className="block">Notifications</label>
              <Btn className="bg-blue-600 text-white rounded">Enable Sale Alerts</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
