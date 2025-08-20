/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BrowserMultiFormatReader } from '@zxing/library';
import { Camera, CheckCircle, ShoppingCart, Trash2, MapPin, Package, Search, Settings, Mic } from 'lucide-react';
import { isMobile } from 'react-device-detect';
import { Virtuoso } from 'react-virtuoso';
import './index.css';

/** ===== Local Button + simple toast (no external UI libs) ===== */
const Button = ({ className = '', children, ...rest }) => (
  <button {...rest} className={`px-3 py-2 rounded ${className}`}>{children}</button>
);
const toast = ({ title, description }) => {
  alert(description ? `${title}\n${description}` : title);
  try { console.log(`[toast] ${title}${description ? ' - ' + description : ''}`); } catch {}
};

/** ===== Axios base URL from CRA env =====
 *  In Render Static Site, set env var:
 *  Key: REACT_APP_API_HOST   Value: buyfly-server.onrender.com
 */
const host = process.env.REACT_APP_API_HOST;
const API_URL = host ? `https://${host}` : '';
axios.defaults.baseURL = API_URL;

const codeReader = new BrowserMultiFormatReader();

/** ===== App ===== */
function App() {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);

  const [mode, setMode] = useState('whosnear'); // 'whosnear' | 'source' | 'snapstack' | 'dewey' | 'shipping' | 'settings'
  const [searchQuery, setSearchQuery] = useState('');
  const [images, setImages] = useState([]);
  const [barcode, setBarcode] = useState(null);
  const [purchasePrice, setPurchasePrice] = useState('0');
  const [snapStackQueue, setSnapStackQueue] = useState([]);
  const [currentSnapStackItem, setCurrentSnapStackItem] = useState(null);
  const [location, setLocation] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [ebayApiKey, setEbayApiKey] = useState('');
  const [voiceSearch, setVoiceSearch] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [history, setHistory] = useState([]);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState(1);

  // Load settings
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme === 'light' ? 'light' : 'dark');
    const savedEbayApiKey = localStorage.getItem('ebayApiKey') || '';
    setEbayApiKey(savedEbayApiKey);
  }, []);

  // Queries
  const { data: deweyItems, refetch: refetchDewey } = useQuery({
    queryKey: ['dewey', searchQuery],
    queryFn: async () => (await axios.get('/api/dewey')).data,
  });

  const { data: nearbySales, refetch: refetchNearby } = useQuery({
    queryKey: ['whosnear', location, searchQuery],
    queryFn: async () => (await axios.get('/api/whos-near', { params: { lat: location?.lat, lng: location?.lng, radius: 25 } })).data,
    enabled: !!location,
  });

  const { data: shippingItems, refetch: refetchShipping } = useQuery({
    queryKey: ['shipping', searchQuery],
    queryFn: async () => (await axios.get('/api/shipping', { params: { apiKey: ebayApiKey } })).data,
  });

  // Mutations
  const analyzeMutation = useMutation({
    mutationFn: (form) => axios.post('/api/source', form, { headers: { 'X-eBay-Api-Key': ebayApiKey } }),
    onSuccess: ({ data }) => {
      toast({ title: data.recommendation, description: `${data.identifiedProduct} - Profit: $${data.estimatedProfit.toFixed(2)}` });
      setBarcode(null);
      if (data.recommendation === 'GOOD_DEAL') {
        const p = window.prompt('Enter purchase price:');
        setPurchasePrice(p || '0');
        queueToSnapStack.mutate(data);
      } else {
        setHistory((prev) => [...prev, { ...data, historyType: 'fly', timestamp: new Date() }].slice(-200));
      }
    },
    onError: () => toast({ title: 'Error', description: 'Failed to analyze product. Try again?' }),
  });

  const queueToSnapStack = useMutation({
    mutationFn: (analysis) => axios.post('/api/dewey/save', analysis),
    onSuccess: () => { refetchDewey(); toast({ title: 'Queued', description: 'Item added to SnapStack' }); },
  });

  const saveToDewey = useMutation({
    mutationFn: (item) => axios.post('/api/dewey/save', item),
    onSuccess: () => { refetchDewey(); toast({ title: 'Saved to Dewey', description: 'Item ready for Vendoo.' }); },
  });

  const markShipped = useMutation({
    mutationFn: ({ id, platform }) => axios.post('/api/shipping/mark-shipped', { id, platform, apiKey: ebayApiKey }),
    onSuccess: () => refetchShipping(),
  });

  // Location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        try { refetchNearby(); } catch {}
      },
      () => toast({ title: 'Location Error', description: 'Using cached data.' }),
      { enableHighAccuracy: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera (mobile only)
  useEffect(() => {
    const startCamera = async () => {
      if (!isMobile) { toast({ title: 'Camera Unavailable', description: 'Camera is mobile-only' }); return; }
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          setStream(mediaStream);
        }
      } catch {
        toast({ title: 'Camera Error', description: 'Unable to access camera' });
      }
    };
    if (mode === 'source' || mode === 'snapstack') startCamera();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Barcode scanning (no optional-call syntax)
  useEffect(() => {
    if (videoRef.current && mode === 'source' && isMobile) {
      codeReader.decodeFromVideoDevice(undefined, videoRef.current, (result, error) => {
        if (result) {
          setBarcode(result.getText());
          toast({ title: 'Barcode Detected', description: result.getText() });
        }
        const e = error;
        const isNoResult = e && typeof e.isNoResult === 'function' ? e.isNoResult() : false;
        if (e && !isNoResult) {
          console.error('Barcode error:', e);
          toast({ title: 'Barcode Error', description: 'Retry? Or use Google Lens.' });
        }
      });
    }
    return () => { codeReader.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Voice search
  useEffect(() => {
    if (!voiceSearch) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = Ctor ? new Ctor() : null;
    if (!recognition) { setVoiceSearch(false); toast({ title: 'Voice Search', description: 'Not available' }); return; }
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      toast({ title: 'Voice Search', description: transcript });
      setVoiceSearch(false);
    };
    recognition.onend = () => setVoiceSearch(false);
    recognition.start();
  }, [voiceSearch]);

  // Capture image
  const captureImage = async () => {
    if (!videoRef.current || !stream || !isMobile) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    let imageUrl = canvas.toDataURL('image/jpeg', 0.7);

    imageUrl = await autoProcessImage(imageUrl);

    if (mode === 'source') {
      const next = [...images, imageUrl];
      setImages(next);
      if (next.length < (barcode ? 1 : 3)) return;
      if (window.confirm('Approve images?')) {
        const formData = new FormData();
        next.forEach((img, i) => formData.append(`image${i}`, img));
        if (barcode) formData.append('barcode', barcode);
        formData.append('purchasePrice', purchasePrice || '0');
        formData.append('color', color);
        formData.append('size', size);
        formData.append('sku', sku);
        formData.append('quantity', String(quantity));
        analyzeMutation.mutate(formData);
      }
      setImages([]);
    } else if (mode === 'snapstack' && currentSnapStackItem) {
      const updatedPhotos = [...(currentSnapStackItem.photos || []), imageUrl];
      if (updatedPhotos.length <= 25) {
        const updatedItem = { ...currentSnapStackItem, photos: updatedPhotos };
        await axios.post('/api/dewey/save', updatedItem);
        setSnapStackQueue((prev) => prev.map((it) => (it.id === updatedItem.id ? updatedItem : it)));
        toast({ title: 'Photo Added', description: `Added photo to ${updatedItem.identifiedProduct} (${updatedPhotos.length}/25)` });
      } else {
        toast({ title: 'Limit Reached', description: 'Max 25 photos allowed' });
      }
      const idx = snapStackQueue.findIndex((it) => it.id === currentSnapStackItem.id);
      setCurrentSnapStackItem(snapStackQueue[idx + 1] || null);
    }
  };

  // Auto process image
  const autoProcessImage = async (imageUrl) => {
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve) => { img.onload = resolve; });
    const rotated = document.createElement('canvas');
    const rctx = rotated.getContext('2d');
    rotated.width = img.height; rotated.height = img.width;
    rctx.translate(img.height, 0); rctx.rotate(Math.PI / 2); rctx.drawImage(img, 0, 0);

    const size = Math.min(rotated.width, rotated.height);
    const square = document.createElement('canvas');
    square.width = size; square.height = size;
    square.getContext('2d').drawImage(rotated, 0, 0, size, size, 0, 0, size, size);

    const enhance = document.createElement('canvas');
    enhance.width = size; enhance.height = size;
    const ectx = enhance.getContext('2d');
    ectx.drawImage(square, 0, 0);
    ectx.globalCompositeOperation = 'lighter';
    ectx.globalAlpha = 0.1;
    ectx.fillStyle = '#fff';
    ectx.fillRect(0, 0, size, size);

    return enhance.toDataURL('image/jpeg', 0.7);
  };

  const handleBuy = (analysis) => {
    if (analysis.recommendation === 'GOOD_DEAL') {
      queueToSnapStack.mutate(analysis);
      setHistory((prev) => [...prev, { ...analysis, historyType: 'buy', timestamp: new Date() }].slice(-200));
    } else {
      toast({ title: 'Cannot Queue', description: 'Only GOOD_DEAL items can be queued' });
      setHistory((prev) => [...prev, { ...analysis, historyType: 'fly', timestamp: new Date() }].slice(-200));
    }
  };

  const handleNextItem = async () => {
    if (currentSnapStackItem) {
      await saveToDewey.mutate(currentSnapStackItem);
      const idx = snapStackQueue.findIndex((it) => it.id === currentSnapStackItem.id);
      const next = snapStackQueue[idx + 1] || null;
      setCurrentSnapStackItem(next);
      if (!next) toast({ title: 'Complete', description: 'All items sent to Dewey.' });
    }
  };

  const sendAllToDewey = async () => {
    for (const item of snapStackQueue) await saveToDewey.mutate(item);
    setSnapStackQueue([]); setCurrentSnapStackItem(null); setMode('dewey');
    toast({ title: 'Complete', description: 'All items sent to Dewey.' });
  };

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
          <Button onClick={() => setVoiceSearch(true)} className="bg-blue-600 text-white rounded p-2 transition-transform hover:scale-95">
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
            onClick={() => { setMode(m); setCurrentSnapStackItem(null); }}
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
              <select onChange={() => refetchNearby()} className={`touch-friendly border rounded p-2 mb-4 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}>
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
                      <a href={`waze://?ll=${sale.latitude},${sale.longitude}&navigate=yes`} target="_blank" rel="noreferrer" className="text-blue-400 underline flex items-center gap-1">
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
              <button onClick={captureImage} className="capture-button absolute bottom-4 right-4 bg-gradient-to-r from-blue-500 to-purple-600 p-4 rounded-full shadow-lg transition-transform hover:scale-95">
                <Camera className="w-8 h-8 text-white" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input type="text" value={barcode || ''} onChange={(e) => setBarcode(e.target.value)} placeholder="Barcode (auto-detected)" className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
              <input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="Price ($)" className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
            </div>
            <div className="flex gap-2">
              <input type="text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
              <input type="text" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
            </div>
            <div className="flex gap-2">
              <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" className={`touch-friendly border rounded p-2 flex-1 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
              <input type="number" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} placeholder="Quantity" className={`touch-friendly border rounded p-2 w-24 ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setBatchMode(!batchMode)} className={`touch-friendly bg-blue-600 text-white rounded p-2 transition-transform hover:scale-95 ${batchMode ? 'bg-green-600' : ''}`}>
                {batchMode ? 'Batch Mode' : 'Single Mode'}
              </Button>
              <Button onClick={() => analyzeMutation.mutate(new FormData())} className="touch-friendly bg-purple-600 text-white rounded p-2 transition-transform hover:scale-95">
                Get Results
              </Button>
            </div>
          </div>
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
                <Button onClick={() => setCurrentSnapStackItem(snapStackQueue[0])} className="bg-blue-600 text-white rounded transition-transform hover:scale-95">Proceed with Saved</Button>
                <Button
                  onClick={async () => { await axios.post('/api/dewey/clear'); setSnapStackQueue([]); setMode('source'); }}
                  className="bg-red-600 text-white rounded transition-transform hover:scale-95"
                >
                  <Trash2 className="w-5 h-5" /> Clear
                </Button>
                <Button onClick={async () => { for (const it of snapStackQueue) await saveToDewey.mutate(it); setSnapStackQueue([]); setCurrentSnapStackItem(null); setMode('dewey'); toast({ title: 'Complete', description: 'All items sent to Dewey.' }); }} className="bg-purple-600 text-white rounded flex items-center gap-2 transition-transform hover:scale-95">
                  <CheckCircle className="w-5 h-5" /> Send All to Dewey
                </Button>
              </div>
              <Virtuoso
                style={{ height: '50vh' }}
                data={snapStackQueue}
                itemContent={(index, item) => (
                  <div className={`border p-2 rounded mb-2 cursor-pointer ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}`} onClick={() => setCurrentSnapStackItem(item)}>
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
                  <button onClick={captureImage} className="capture-button absolute bottom-4 right-4 bg-gradient-to-r from-blue-500 to-purple-600 p-4 rounded-full shadow-lg transition-transform hover:scale-95">
                    <Camera className="w-8 h-8 text-white" />
                  </button>
                </div>
              ) : (
                <p className="text-center">Camera is mobile-only</p>
              )}
              <div className="mt-4">
                <p>Photos: {(currentSnapStackItem.photos || []).length}/25</p>
                <Button onClick={handleNextItem} className="bg-blue-600 text-white rounded flex items-center gap-2 mt-2 transition-transform hover:scale-95">
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
                  <p className="text-sm">Photos: {(item.photos || []).length}</p>
                </div>
              )}
            />
          ) : (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-700 rounded" />)}
            </div>
          )}
          {Array.isArray(deweyItems) && deweyItems.length > 0 ? (
            <Button onClick={async () => {
              try { await axios.post('/api/vendoo/prepare', { items: deweyItems }); toast({ title: 'Vendoo Prep', description: 'Items sent to Vendoo bot' }); }
              catch { toast({ title: 'Vendoo Error', description: 'Failed to prepare for Vendoo' }); }
            }} className="touch-friendly bg-blue-600 text-white rounded flex items-center gap-2 mt-4 transition-transform hover:scale-95">
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
                  <Button onClick={() => markShipped.mutate({ id: item.id, platform: item.platform })} className="bg-green-600 text-white rounded mt-2 transition-transform hover:scale-95">
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
                onChange={(e) => { const v = e.target.value === 'light' ? 'light' : 'dark'; setTheme(v); localStorage.setItem('theme', v); }}
                className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div>
              <label className="block">Who's Near Radius (miles)</label>
              <input type="number" defaultValue={25} className={`touch-friendly border rounded p-2 w-full ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-900'}`} />
            </div>
            <div>
              <label className="block">eBay API Key</label>
              <input
                type="text"
                value={ebayApiKey}
                onChange={(e) => { setEbayApiKey(e.target.value); localStorage.setItem('ebayApiKey', e.target.value); }}
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
}

export default App;
