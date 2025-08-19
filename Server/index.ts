import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import cron from 'node-cron';
import { simpleParser } from 'mailparser';
import Imap from 'imap';
import { nanoid } from 'nanoid';
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const supabase = createClient(process.env.DATABASE_URL!, { auth: { persistSession: false } });
const imap = new Imap({
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASS,
  host: 'imap.ionos.com',
  port: 993,
  tls: true,
});

// Seed data
const seedData = async () => {
  const { data: deweyData, error: deweyError } = await supabase.from('dewey').select('id');
  if (deweyError || !deweyData.length) {
    await supabase.from('dewey').insert([
      { id: nanoid(), name: 'Deal 1', price: 10, recommendation: 'GOOD_DEAL' },
      { id: nanoid(), name: 'Deal 2', price: 15, recommendation: 'GOOD_DEAL' },
    ]);
  }
  const { data: nearbyData, error: nearbyError } = await supabase.from('nearby_sales').select('id');
  if (nearbyError || !nearbyData.length) {
    await supabase.from('nearby_sales').insert([
      { id: nanoid(), name: 'Thrift Store', type: 'thrift', address: '123 Main St', latitude: 40.7128, longitude: -74.0060, distance: 5 },
    ]);
  }
};
seedData();

// APIs
app.get('/api/dewey', async (req, res) => {
  const { data, error } = await supabase.from('dewey').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/dewey/save', async (req, res) => {
  const { id, ...item } = req.body;
  const { data, error } = await supabase.from('dewey').upsert({ id: id || nanoid(), ...item }, { onConflict: 'id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/whos-near', async (req, res) => {
  const { lat, lng, radius = 25 } = req.query;
  const { data, error } = await supabase.from('nearby_sales').select('*').withinDistance('location', [Number(lng), Number(lat)], Number(radius) * 1609.34); // Convert miles to meters
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/source', async (req, res) => {
  const { image, barcode, purchasePrice, color, size, sku, quantity } = req.body;
  // Mock analysis (replace with AI/ML service in production)
  const analysis = {
    id: nanoid(),
    imageUrl: image,
    identifiedProduct: barcode || 'Sample Product',
    confidence: 0.95,
    recommendation: 'GOOD_DEAL',
    estimatedProfit: 20,
    profitMargin: 0.5,
    color,
    size,
    sku,
    quantity: Number(quantity),
    purchasePrice: Number(purchasePrice),
  };
  const { data, error } = await supabase.from('dewey').insert(analysis);
  if (error) return res.status(500).json({ error: error.message });
  res.json(analysis);
});

app.get('/api/shipping', async (req, res) => {
  const { data, error } = await supabase.from('shipping').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/shipping/mark-shipped', async (req, res) => {
  const { id, platform } = req.body;
  const { data, error } = await supabase.from('shipping').update({ status: 'shipped' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/vendoo/prepare', async (req, res) => {
  const { items } = req.body;
  res.json({ success: true });
});

// Email parsing (unchanged)
const checkEmails = () => {
  imap.once('ready', () => {
    imap.openBox('INBOX', true, (err) => {
      if (err) throw err;
      imap.search(['UNSEEN', ['SINCE', new Date(Date.now() - 24 * 60 * 60 * 1000)]], (err, results) => {
        if (err) throw err;
        const fetch = imap.fetch(results, { bodies: '' });
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, async (err, mail) => {
              if (err) throw err;
              const subject = mail.subject?.toLowerCase();
              if (subject?.includes('sold') || subject?.includes('purchase')) {
                const platformMatch = subject.match(/(poshmark|mercari|depop)/i);
                const itemMatch = subject.match(/(\w+\s+\w+)/i);
                if (platformMatch && itemMatch) {
                  const { data, error } = await supabase.from('shipping').insert({
                    id: nanoid(),
                    platform: platformMatch[0].toLowerCase(),
                    itemName: itemMatch[0],
                    salePrice: parseFloat(mail.text?.match(/\$\d+\.\d{2}/)?.[0].replace('$', '')) || 0,
                    buyerAddress: mail.to?.text || 'N/A',
                    shippingDeadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  });
                  if (!error) imap.addFlags(results, ['\\Seen'], () => {});
                }
              }
            });
          });
        });
        fetch.once('end', () => imap.end());
      });
    });
  });
  imap.once('error', (err) => console.error(err));
  imap.once('end', () => console.log('IMAP connection ended'));
};

cron.schedule('*/15 * * * *', checkEmails);
checkEmails();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));