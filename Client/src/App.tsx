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
  const [barcode, setBarcode] = useState<string | null>(nu
