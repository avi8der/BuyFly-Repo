import { useState, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { BrowserMultiFormatReader } from '@zxing/library';
import { Camera, CheckCircle, ShoppingCart, Trash2, MapPin, Package, Search, Settings, Mic } from 'lucide-react';
import { isMobile } from 'react-device-detect';
import { Virtuoso } from 'react-virtuoso';
import './index.css';

// ==== Local Button + toast (no external libs) ====
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { className?: string; children?: ReactNode };
const Button = ({ className = '', children, ...rest }: BtnProps) => (
  <button {...rest} className={`px-3 py-2 rounded ${className}`}>{children}</button>
);

const toast = ({ title, description }: { title: string; description?: string }) => {
  if (description) alert(`${title}\n${description}`); else alert(title);
  try { console.log(`[toast] ${title}${description ? " - " + description : ""}`); } catch {}
};

// ==== Axios base URL from Render (VITE_API_HOST -> https://host) ====
const __host = import.meta.env.VITE_API_HOST as string | undefined;
const API_URL = __host ? `https://${__host}` : '';
axios.defaults.baseURL = API_URL;

const codeReader = new BrowserMultiFormatReader();

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

  // Load settings
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme as 'dark' | 'light');
    const savedEbayApiKey = localStorage.getItem('ebayApiKey') || '';
    setEbayApiKey(savedEbayApiKey);
  }, []);

  // Query for Dewey items
  const { data: deweyItems, refetch: refetchDewey } = useQuery<ProductAnalysis[]>({
    queryKey: ['dewey', searchQuery],
    queryFn: async () => {
      const { data } = await axios.get('/api/dewey');
      return data;
    },
  });

  // Query for Who's Near
  const { data: nearbySales, refetch: refetchNearby } = useQuery<NearbySale[]>({
    queryKey: ['whosnear', location, searchQuery],
    queryFn: async () => {
      const { data } = await axios.get('/api/whos-near', { params: { lat: location?.lat, lng: location?.lng, radius: 25 } });
      return data;
    },
    enabled: !!location,
  });

  // Query for Shipping items
  const { data: shippingItems, refetch: refetchShipping } = useQuery<ShippingItem[]>({
    queryKey: ['shipping', searchQuery],
    queryFn: async () => {
      const { data } = await axios.get('/api/shipping', { params: { apiKey: ebayApiKey } });
      return data;
    },
  });

  // Mutation for Source analysis
  const analyzeMutation = useMutation({
    mutationFn: (data: FormData) =>
      axios.post<ProductAnalysis>('/api/source', data, { headers: { 'X-eBay-Api-Key': ebayApiKey } }),
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
    mutationFn: (analysis: ProductAnalysis) => axios.post('/api/dewey/save', analysis),
    onSuccess: () => {
      refetchDewey();
      toast({ title: 'Queued', description: 'Item added to SnapStack' });
    },
  });

  // Mutation for Dewey
  const saveToDewey = useMutation({
    mutationFn: (item: ProductAnalysis) => axios.post('/api/dewey/save', item),
    onSuccess: () => {
      refetchDewey();
      toast({ title: 'Saved to Dewey', description: 'Item ready for Vendoo. Open the bot to continue.' });
    },
  });

  // Mutation for marking shipped
  const markShipped = useMutation({
    mutationFn: ({ id, platform }: { id: string; platform: string }) =>
      axios.post('/api/shipping/mark-shipped', { id, platform, apiKey: ebayApiKey }),
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
      } catch {
        toast({ title: 'Camera Error', description: 'Unable to access camera' });
      }
    };

    if (mode === 'source' || mode === 'snapstack') startCamera();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, [mode]);

  // Barcode scanning
  useEffect(() => {
    if (videoRef.current && mode === 'source' && isMobile) {
      codeReader.decodeFromVideoDevice(undefined, videoRef.current, (result, error) => {
        if (result) {
          setBarcode(result.getText());
          toast({ title: 'Barcode Detected', description: result.getText() });
        }
        if (error && !(error as any).isNoResult?.()) {
          console.error('Barcode error:', error);
          toast({ title: 'Barcode Error', description: 'Retry? Or use Google Lens.' });
        }
      });
    }
    return () => { codeReader.reset(); };
  }, [mode]);

  // Voice search
  useEffect(() => {
    if (voiceSearch) {
      const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = Ctor ? new Ctor() : null;
      if (recognition) {
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setSearchQuery(transcript);
          toast({ title: 'Voice Search', description: transcript });
          setVoiceSearch(false);
        };
        recognition.onend = () => setVoiceSearch(false);
        recognition.start();
      } else {
        setVoiceSearch(false);
        toast({ title: 'Voice Search', description: 'SpeechRecognition not available' });
      }
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
      const next = [...images, imageUrl];
      setImages(next);
      if (next.length < (barcode ? 1 : 3)) return;
      setApproveImages(true);
      if (window.confirm('Approve images?')) {
        const formData = new FormData();
        next.forEach((img, i) => formData.append(`image${i}`, img));
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
        await axios.post('/api/dewey/save', updatedItem);
        setSnapStackQueue((prev) => prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
        toast({ title: 'Photo Added', description: `Added photo to ${updatedItem.identifiedProduct} (${updatedPhotos.length}/25)` });
      } else {
        toast({ title: 'Limit Reached', description: 'Max 25 photos allowed' });
      }
      setCurrentSnapStackItem(
        snapStackQueue[snapStackQueue.findIndex(item => item.id === currentSnapStackItem.id) + 1] || null
      );
    }
  };

  // Auto process image
  const autoProcessImage = async (imageUrl: string) => {
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve) => { (img.onload as any) = resolve; });
    const rotated = document.createElement('canvas');
    const rctx = rotated.getContext('2d')!;
    rotated.width = img.height;
    rotated.height = img.width;
    rctx.translate(img.height, 0);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(img, 0, 0);

    const size = Math.min(rotated.width, rotated.height);
    const square = document.createElement('canvas');
    square.width = size; square.height = size;
    square.getContext('2d')!.drawImage(rotated, 0, 0, size, size, 0, 0, size, size);

    const enhance = document.createElement('canvas');
    enhance.width = size; enhance.height = size;
    const ectx = enhance.getContext('2d')!;
    ectx.drawImage(square, 0, 0);
    ectx.globalCompositeOperation = 'lighter';
    ectx.globalAlpha = 0.1;
    ectx.fillStyle = '#fff';
    ectx.fillRect(0, 0, size, size);

    return enhance.toDataURL('image/jpeg', 0.7);
  };

  // Handle Buy
  const handleBuy = (analysis: ProductAnalysis) => {
    if (analysis.recommendation === 'GOOD_DEAL') {
      queueToSnapStack.mutate(analysis);
      setHistory((prev) => [...prev, { ...analysis, historyType: 'buy', timestamp: new Date() }].slice(-200));
    } else {
      toast({ title: 'Cannot Queue', description: 'Only GOOD_DEAL items can be queued' });
      setHistory((prev) => [...prev, { ...analysis, historyType: 'fly', timestamp: new Date() }].slice(-200));
    }
  };

  // Handle Next Item
  const handleNextItem = async () => {
    if (currentSnapStackItem) {
      await saveToDewey.mutate(currentSnapStackItem);
      setCurrentSnapStackItem(snapStackQueue[snapStackQueue.findIndex(item => item.id === currentSnapStackItem.id) + 1] || null);
      if (!snapStackQueue[snapStackQueue.findIndex(item => item.id === currentSnapStackItem.id) + 1]) {
        toast({ title: 'Complete', description: 'All items sent to Dewey. Open the bot to continue.' });
      }
    }
  };

  // Send all to Dewey
  const sendAllToDewey = async () => {
    for (const item of snapStackQueue) await saveToDewey.mutate(item as any);
    setSnapStackQueue([]);
    setCurrentSnapStackItem(null);
    setMode('dewey');
    toast({ title: 'Complete', description: 'All items sent to Dewey. Open the bot to continue.' });
  };

  // Trigger Vendoo bot
  const triggerVendooBot = async () => {
    try {
      await axios.post('/api/vendoo/prepare', { items: deweyItems });
      toast({ title: 'Vendoo Prep', description: 'Items sent to Vendoo bot' });
    } catch {
      toast({ title: 'Vendoo Error', description: 'Failed to prepare for Vendoo' });
    }
  };

  // Pull-to-refresh
  const handleRefresh = () => {
    if (mode === 'whosnear') refetchNearby();
    if (mode === 'dewey') refetchDewey();
    if (mode === 'shipping') refetchShipping();
  };

  return (
    <div className={`mobile-optimized flex flex-col gap-4 p-4 min-h-screen ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      <div className="sticky top-0 z-10 bg-opacity-80 backdrop-blur-sm">
        <div className="flex justify-between items-center p-2">
          <h1 className="text-2xl font-bold gradient-text">BuyFly 🦉</h1>
          <Button onClick={() => setMode('settings')} className="bg-transparent">
            <Settings className="w-6 h-6" />
          </Button>
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
          <Button
            onClick={() => setVoiceSearch(true)}
            className="bg-blue-600 text-white rounded p-2 transition-transform hover:scale-95"
          >
            <Mic className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="sticky bottom-0 z-10 bg-opacity-80 backdrop-blur-sm flex justify-around p-2 border-t">
        {[
          { mode: 'whosnear', label: 'Near', icon: <MapPin className="w-6 h-6" /> },
          { mode: 'source', label: 'Source', icon: <Camera className="w-6 h-6" /> },
          { mode: 'snapstack', label: 'SnapStack', icon: <ShoppingCart className="w-6 h-6" /> },
          { mode: 'dewey', label: 'Dewey', icon: <CheckCircle className="w-6 h-6" /> },
          { mode: 'shipping', label: 'Shipping', icon: <Package className="w-6 h-6" />, badge: shippingItems?.length },
        ].map(({ mode: m, label, icon, badge }) => (
          <Button
            key={m}
            onClick={() => { setMode(m as any); setCurrentSnapStackItem(null); }}
            className={`touch-friendly flex flex-col items-center gap-1 ${mode === m ? 'bg-blue-600' : 'bg-gray-700'} text-white rounded relative transition-transform hover:scale-95`}
          >
            {icon}
            <span className="text-xs">{label}</span>
            {badge ? <span className="absolute -top-2 -right-2 bg-red-600 rounded-full px-2 text-xs">{badge}</span> : null}
          </Button>
        ))}
      </div>

      {/* Who's Near */}
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
                data={[...(nearbySales || [])].sort((a, b) => a.distance - b.distance)}
                itemContent={(index, sale) => (
                  <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <p className="font-semibold">{sale.name} ({sale.type})</p>
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
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}
            </div>
          )}
        </div>
      )}

      {/* Source */}
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
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
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
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Color"
                className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
              <input
                type="text"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="Size"
                className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU"
                className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                placeholder="Quantity"
                className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setBatchMode(!batchMode)}
                className={`touch-friendly bg-blue-600 text-white rounded p-2 transition-transform hover:scale-95 ${batchMode ? 'bg-green-600' : ''}`}
              >
                {batchMode ? 'Batch Mode' : 'Single Mode'}
              </Button>
              <Button
                onClick={() => analyzeMutation.mutate(new FormData())}
                className="touch-friendly bg-purple-600 text-white rounded p-2 transition-transform hover:scale-95"
              >
                Get Results
              </Button>
            </div>
          </div>
          {analyzeMutation.data && (
            <div className={`border p-4 rounded-lg ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <p className="font-semibold">{analyzeMutation.data.identifiedProduct}</p>
              <p>Profit: ${analyzeMutation.data.estimatedProfit.toFixed(2)}</p>
              <p className="text-sm">{analyzeMutation.data.recommendation}</p>
              <div className="flex gap-2 mt-2">
                {analyzeMutation.data.recommendation === 'GOOD_DEAL' && (
                  <Button
                    onClick={() => handleBuy(analyzeMutation.data)}
                    className="bg-green-600 text-white rounded flex items-center gap-2 transition-transform hover:scale-95"
                  >
                    <ShoppingCart className="w-5 h-5" /> Buy
                  </Button>
                )}
                <Button
                  onClick={() => setImage(null)}
                  className="bg-gray-600 text-white rounded flex items-center gap-2 transition-transform hover:scale-95"
                >
                  Fly
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* SnapStack */}
      {mode === 'snapstack' && (
        <>
          {snapStackQueue.length > 0 && !currentSnapStackItem ? (
            <div onTouchStart={handleRefresh}>
              <h2 className="text-xl font-semibold">SnapStack Queue</h2>
              <p>Proceed with saved items or start new?</p>
              <div className="flex gap-2 mt-2">
                <Button
                  onClick={() => setCurrentSnapStackItem(snapStackQueue[0])}
                  className="bg-blue-600 text-white rounded transition-transform hover:scale-95"
                >
                  Proceed with Saved
                </Button>
                <Button
                  onClick={async () => {
                    await axios.post('/api/dewey/clear');
                    setSnapStackQueue([]);
                    setMode('source');
                  }}
                  className="bg-red-600 text-white rounded transition-transform hover:scale-95"
                >
                  <Trash2 className="w-5 h-5" /> Clear
                </Button>
                <Button
                  onClick={sendAllToDewey}
                  className="bg-purple-600 text-white rounded flex items-center gap-2 transition-transform hover:scale-95"
                >
                  <CheckCircle className="w-5 h-5" /> Send All to Dewey
                </Button>
              </div>
              <Virtuoso
                style={{ height: '50vh' }}
                data={snapStackQueue}
                itemContent={(index, item) => (
                  <div
                    className={`border p-2 rounded mb-2 cursor-pointer ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}
                    onClick={() => setCurrentSnapStackItem(item)}
                  >
                    <p>{item.identifiedProduct} - ${item.estimatedProfit.toFixed(2)}</p>
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
                <Button
                  onClick={handleNextItem}
                  className="bg-blue-600 text-white rounded flex items-center gap-2 mt-2 transition-transform hover:scale-95"
                >
                  Next Item
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-gray-400">No items in SnapStack. Go to Source mode.</p>
          )}
        </>
      )}

      {/* Dewey */}
      {mode === 'dewey' && (
        <div onTouchStart={handleRefresh}>
          <h2 className="text-xl font-semibold">Dewey (Saved Items)</h2>
          {deweyItems ? (
            <Virtuoso
              style={{ height: '50vh' }}
              data={deweyItems}
              itemContent={(index, item) => (
                <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                  <p>{item.identifiedProduct} - ${item.estimatedProfit.toFixed(2)}</p>
                  <p className="text-sm text-gray-400">{item.recommendation}</p>
                  <p className="text-sm">Photos: {item.photos?.length || 0}</p>
                </div>
              )}
            />
          ) : (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}
            </div>
          )}
          {deweyItems?.length ? (
            <Button
              onClick={triggerVendooBot}
              className="touch-friendly bg-blue-600 text-white rounded flex items-center gap-2 mt-4 transition-transform hover:scale-95"
            >
              <CheckCircle className="w-5 h-5" /> Send to Vendoo Bot
            </Button>
          ) : null}
        </div>
      )}

      {/* Shipping */}
      {mode === 'shipping' && (
        <div onTouchStart={handleRefresh}>
          <h2 className="text-xl font-semibold">Shipping</h2>
          {shippingItems ? (
            <Virtuoso
              style={{ height: '50vh' }}
              data={shippingItems}
              itemContent={(index, item) => (
                <div className={`border p-2 rounded mb-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`}>
                  <p>{item.itemName} - ${item.salePrice.toFixed(2)}</p>
                  <p className="text-sm">{item.platform}</p>
                  <p className="text-sm">{item.buyerAddress}</p>
                  <p className="text-sm">Deadline: {item.shippingDeadline}</p>
                  <Button
                    onClick={() => markShipped.mutate({ id: item.id, platform: item.platform })}
                    className="bg-green-600 text-white rounded mt-2 transition-transform hover:scale-95"
                  >
                    Mark Shipped
                  </Button>
                </div>
              )}
            />
          ) : (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
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
                  localStorage.setItem('theme', e.target.value);
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
                  localStorage.setItem('ebayApiKey', e.target.value);
                }}
                placeholder="Enter eBay API Key"
                className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              />
            </div>
            <div>
              <label className="block">Notifications</label>
              <Button className="bg-blue-600 text-white rounded">Enable Sale Alerts</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
