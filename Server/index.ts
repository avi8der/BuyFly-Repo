import express, { Request, Response } from 'express';
     import cors from 'cors';
     import * as cron from 'node-cron';
     import mailparser from 'mailparser';
     import imap from 'imap';
     import { createClient } from '@supabase/supabase-js';
     import * as dotenv from 'dotenv';

     dotenv.config();

     const app = express();
     app.use(cors());
     app.use(express.json());

     const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

     app.get('/api/dewey', (req: Request, res: Response) => {
       res.json({ message: 'Dewey endpoint' });
     });

     app.post('/api/source', (req: Request, res: Response) => {
       res.json({ status: 'Source endpoint' });
     });

     app.get('/api/snapstack', (req: Request, res: Response) => {
       res.json({ status: 'Snapstack endpoint' });
     });

     app.get('/api/nearby', async (req: Request, res: Response) => {
       const { data, error } = await supabase
         .from('nearby_sales')
         .select('*')
         .gte('distance', 0)
         .lte('distance', 25);
       if (error) res.status(500).json({ error: error.message });
       else res.json(data);
     });

     const PORT = process.env.PORT || 10000;
     app.listen(PORT, () => console.log(`Server on port ${PORT}`));

     cron.schedule('* * * * *', () => {
       console.log('Running cron job');
       const imapConfig = {
         user: process.env.EMAIL_USER!,
         password: process.env.EMAIL_PASS!,
         host: 'imap.gmail.com',
         port: 993,
         tls: true,
       };

       const client = new imap(imapConfig);

       client.connect();

       client.on('ready', () => {
         client.openBox('INBOX', true, (err: Error | null, box: any) => {
           if (err) throw err;
           client.search(['UNSEEN'], (err: Error | null, results: any[]) => {
             if (err) throw err;
             const fetch = client.fetch(results, { bodies: '' });
             fetch.on('message', (msg: any, seqno: number) => {
               msg.on('body', (stream: any, info: any) => {
                 const parser = new mailparser.MailParser();
                 parser.on('end', (mail: any) => {
                   console.log('Email parsed:', mail.subject);
                 });
                 stream.pipe(parser);
               });
             });
             fetch.once('error', (err: Error) => {
               console.log('Fetch error:', err);
             });
             fetch.once('end', () => {
               client.end();
             });
           });
         });
       });

       client.on('error', (err: Error) => {
         console.log('IMAP error:', err);
       });

       client.on('end', () => {
         console.log('IMAP connection ended');
       });
     });