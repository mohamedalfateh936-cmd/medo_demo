// ============================================
// Medo app — DEMO SERVER
// port dynamic (works on Render)
// ============================================
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const db = {
  users: {}, sessions: {}, cards: {}, txs: {}, nextId: 1000
};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateId() { return ++db.nextId; }

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const token = header.substring(7);
  const userId = db.sessions[token];
  if (!userId || !db.users[userId]) {
    return res.status(401).json({ error: 'انتهت الجلسة' });
  }
  req.user = db.users[userId];
  req.token = token;
  next();
}

// ============ Demo Login ============
app.post('/api/demo/login', (req, res) => {
  const deviceInfo = req.body.deviceInfo || {};
  const userId = generateId();
  const accountNumber = 'DEMO' + Math.floor(1000 + Math.random() * 9000);
  const token = generateToken();

  const user = {
    id: userId,
    accountNumber,
    full_name: 'حساب تجريبي',
    email: 'demo@medo.app',
    phone: '+2490000' + Math.floor(10000 + Math.random() * 90000),
    wallet_address: '0xDEMO' + crypto.randomBytes(18).toString('hex'),
    iban: 'SD00DEMO' + Math.floor(100000000 + Math.random() * 900000000),
    bban: 'DEMO' + Math.floor(100000000 + Math.random() * 900000000),
    bank_code: '2901',
    profile_picture: null,
    transferCode: 'DEMO-TRIAL-2026',
    is_demo: true,
    deviceInfo,
    preferences: { theme: 'light', language: 'ar', background: 'grad1' },
    created_at: new Date().toISOString(),
    balances: [
      { currency: 'USD', balance: 10000 },
      { currency: 'EUR', balance: 8500 },
      { currency: 'SDG', balance: 5000000 },
      { currency: 'USDT', balance: 5000 },
      { currency: 'EGP', balance: 50000 }
    ]
  };

  db.users[userId] = user;
  db.sessions[token] = userId;
  db.cards[userId] = [];
  db.txs[userId] = [];

  const demoTxs = [
    { type: 'receive', currency: 'USD', amount: 500, status: 'completed', description: '💰 استلام من Upwork', reference: 'DEMO-REF-001', days: 1 },
    { type: 'out', currency: 'SDG', amount: 25000, status: 'completed', description: '🎮 شراء بطاقة PlayStation', reference: 'DEMO-REF-002', days: 2 },
    { type: 'receive', currency: 'USDT', amount: 100, status: 'completed', description: '🪙 استلام USDT من Binance', reference: 'DEMO-REF-003', days: 3 },
    { type: 'out', currency: 'EGP', amount: 500, status: 'completed', description: '📱 تحويل Vodafone Cash', reference: 'DEMO-REF-004', days: 4 },
    { type: 'receive', currency: 'EUR', amount: 200, status: 'completed', description: '🏦 تحويل بنكي دولي', reference: 'DEMO-REF-005', days: 5 }
  ];
  demoTxs.forEach((t, i) => {
    db.txs[userId].push({
      id: Date.now() + i, userId,
      type: t.type, currency: t.currency, amount: t.amount,
      status: t.status, description: t.description, reference: t.reference,
      created_at: new Date(Date.now() - t.days * 86400000).toISOString()
    });
  });

  db.cards[userId].push({
    id: Date.now(), userId,
    pan: '4532111122223333', cvv: '123', expiry: '12/28',
    holder: 'DEMO USER', network: 'VISA', status: 'active', limit: 5000,
    created_at: new Date().toISOString()
  });

  console.log(`\n🎮 Demo account created: ${accountNumber}\n`);

  res.json({
    token,
    user: {
      id: user.id, accountNumber: user.accountNumber, full_name: user.full_name,
      phone: user.phone, email: user.email, wallet_address: user.wallet_address,
      iban: user.iban, bban: user.bban, bank_code: user.bank_code,
      profile_picture: null, preferences: user.preferences,
      transferCode: user.transferCode, is_demo: true
    }
  });
});

// ============ Wallet ============
app.get('/api/wallet/balances', auth, (req, res) => res.json(req.user.balances || []));

app.get('/api/wallet/transactions', auth, (req, res) => {
  res.json((db.txs[req.user.id] || []).sort((a, b) => b.id - a.id));
});

app.get('/api/wallet/sent', auth, (req, res) => {
  res.json((db.txs[req.user.id] || []).filter(t => t.type === 'out').sort((a, b) => b.id - a.id));
});

app.get('/api/wallet/received', auth, (req, res) => {
  res.json((db.txs[req.user.id] || []).filter(t => t.type === 'receive').sort((a, b) => b.id - a.id));
});

// ============ Send ============
app.post('/api/send/by-account', auth, (req, res) => {
  const { toAccountNumber, currency, amount, note } = req.body;
  const amt = parseFloat(amount);
  if (!toAccountNumber || !amt || !currency) return res.status(400).json({ error: 'البيانات ناقصة' });
  if (amt <= 0) return res.status(400).json({ error: 'المبلغ غير صحيح' });

  const bal = (req.user.balances || []).find(b => b.currency === currency);
  if (!bal || bal.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  bal.balance -= amt;

  const ref = 'DEMO' + Date.now().toString().slice(-8);
  const padAcc = String(toAccountNumber).padStart(5, '0');

  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency, amount: amt,
    status: 'completed',
    description: `إرسال إلى مستخدم تجريبي (#${padAcc})`,
    reference: ref, toAccount: padAcc, toName: 'مستخدم تجريبي',
    toPhone: '+249000000000', fromAccount: req.user.accountNumber,
    fromName: req.user.full_name, note: note || '',
    created_at: new Date().toISOString()
  });

  res.json({
    message: 'تم التحويل (تجريبي)', reference: ref,
    recipient: { accountNumber: padAcc, name: 'مستخدم تجريبي', phone: '+249000000000' },
    sender: { accountNumber: req.user.accountNumber, name: req.user.full_name, phone: req.user.phone },
    amount: amt, currency, date: new Date().toISOString()
  });
});

// ============ Refund ============
app.post('/api/refund', auth, (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: 'البيانات ناقصة' });
  const tx = (db.txs[req.user.id] || []).find(t => t.id === parseInt(transactionId));
  if (!tx) return res.status(404).json({ error: 'غير موجودة' });
  if (tx.type !== 'out') return res.status(400).json({ error: 'فقط المرسلة' });
  if (tx.refunded) return res.status(400).json({ error: 'تم استرجاعها' });

  const bal = (req.user.balances || []).find(b => b.currency === tx.currency);
  if (bal) bal.balance += tx.amount;
  tx.refunded = true;

  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'receive',
    currency: tx.currency, amount: tx.amount, status: 'completed',
    description: `استرجاع مبلغ تجريبي — ${tx.reference}`,
    reference: 'REF' + Date.now().toString().slice(-6),
    created_at: new Date().toISOString()
  });

  res.json({ message: 'تم', amount: tx.amount, currency: tx.currency });
});

// ============ Cards ============
app.get('/api/wallester/cards', auth, (req, res) => {
  const cards = db.cards[req.user.id] || [];
  res.json(cards.map(c => ({
    id: c.id, card_number_last4: c.pan.slice(-4), expiry_date: c.expiry,
    card_holder: c.holder, network: c.network, status: c.status, spending_limit: c.limit
  })));
});

app.post('/api/wallester/issue-card', auth, (req, res) => {
  const scheme = (req.body.scheme || 'visa').toLowerCase();
  const prefix = scheme === 'mastercard' ? '5321' : '4532';
  const pan = prefix + Math.floor(100000000000 + Math.random() * 900000000000).toString();
  const cvv = Math.floor(100 + Math.random() * 900).toString();
  const month = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
  const year = String(new Date().getFullYear() + 3).slice(-2);

  const newCard = {
    id: Date.now(), userId: req.user.id, pan, cvv,
    expiry: `${month}/${year}`, holder: req.user.full_name.toUpperCase(),
    network: scheme === 'mastercard' ? 'MASTERCARD' : 'VISA',
    status: 'active', limit: req.body.limit || 5000,
    created_at: new Date().toISOString()
  };
  if (!db.cards[req.user.id]) db.cards[req.user.id] = [];
  db.cards[req.user.id].push(newCard);

  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'receive',
    currency: 'USD', amount: 0, status: 'completed',
    description: `إصدار بطاقة ${scheme}`,
    created_at: new Date().toISOString()
  });

  res.json({ message: 'OK', last4: pan.slice(-4) });
});

app.get('/api/wallester/cards/:id/reveal', auth, (req, res) => {
  const card = (db.cards[req.user.id] || []).find(c => c.id === parseInt(req.params.id));
  if (!card) return res.status(404).json({ error: 'غير موجودة' });
  res.json({ pan: card.pan, cvv: card.cvv, expiry: card.expiry });
});

app.patch('/api/wallester/cards/:id/freeze', auth, (req, res) => {
  const card = (db.cards[req.user.id] || []).find(c => c.id === parseInt(req.params.id));
  if (!card) return res.status(404).json({ error: 'غير موجودة' });
  card.status = card.status === 'frozen' ? 'active' : 'frozen';
  res.json({ message: 'OK', status: card.status });
});

// ============ Rates ============
app.get('/api/rates/all', async (req, res) => {
  try {
    let fiat = {}, crypto = {}, goldSilver = {};
    try {
      const r = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 5000 });
      fiat = r.data.rates || {};
    } catch (e) {
      fiat = { SDG: 2400, EGP: 48, SAR: 3.75, AED: 3.67, EUR: 0.92, GBP: 0.79 };
    }
    try {
      const r = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'bitcoin,ethereum,tether,binancecoin,solana', vs_currencies: 'usd,sdg', include_24hr_change: true },
        timeout: 5000
      });
      crypto = r.data;
    } catch (e) {
      crypto = {
        bitcoin: { usd: 67000, sdg: 160800000, usd_24h_change: 1.2 },
        ethereum: { usd: 3200, sdg: 7680000, usd_24h_change: -0.5 },
        tether: { usd: 1.0, sdg: 2400, usd_24h_change: 0.01 },
        binancecoin: { usd: 580, sdg: 1392000, usd_24h_change: 2.1 }
      };
    }
    const rate = 2420;
    const goldUSD = 2650, silverUSD = 31;
    goldSilver = {
      gold: {
        perGram24k: goldUSD * rate / 31.1035,
        perGram21k: (goldUSD * rate / 31.1035) * (21/24),
        perGram18k: (goldUSD * rate / 31.1035) * (18/24),
        perOunce: goldUSD * rate
      },
      silver: { perGram: silverUSD * rate / 31.1035, perOunce: silverUSD * rate },
      updated: new Date().toISOString()
    };
    res.json({
      fiat, crypto, goldSilver,
      sudanDollar: { buy: 2350, sell: 2420, official: 601, parallel: 2420, updated: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Adhkar ============
const adhkarData = {
  morning: [
    { text: 'اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ... (آية الكرسي)', count: 1 },
    { text: 'قُلْ هُوَ اللَّهُ أَحَدٌ... والمعوذتين', count: 3 },
    { text: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ', count: 1 },
    { text: 'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ', count: 1 },
    { text: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ (سيد الاستغفار)', count: 1 },
    { text: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ', count: 7 },
    { text: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ', count: 3 },
    { text: 'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ نَبِيًّا', count: 3 },
    { text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', count: 100 },
    { text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى سَيِّدِنَا مُحَمَّدٍ', count: 10 }
  ],
  evening: [
    { text: 'اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ... (آية الكرسي)', count: 1 },
    { text: 'قُلْ هُوَ اللَّهُ أَحَدٌ... والمعوذتين', count: 3 },
    { text: 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ', count: 1 },
    { text: 'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ', count: 1 },
    { text: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ', count: 3 },
    { text: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ', count: 7 },
    { text: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ', count: 3 },
    { text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', count: 100 },
    { text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى سَيِّدِنَا مُحَمَّدٍ', count: 10 }
  ],
  sleep: [
    { text: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا', count: 1 },
    { text: 'اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ', count: 3 },
    { text: 'سُبْحَانَ اللَّهِ', count: 33 },
    { text: 'الْحَمْدُ لِلَّهِ', count: 33 },
    { text: 'اللَّهُ أَكْبَرُ', count: 34 }
  ],
  wake: [
    { text: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', count: 1 },
    { text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ', count: 1 }
  ],
  leavingHome: [
    { text: 'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', count: 1 }
  ],
  market: [
    { text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ', count: 1 }
  ],
  enteringHome: [
    { text: 'بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَى رَبِّنَا تَوَكَّلْنَا', count: 1 }
  ],
  tawakkul: [
    { text: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', count: 3 },
    { text: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ الْعَلِيِّ الْعَظِيمِ', count: 7 }
  ],
  provision: [
    { text: 'اللَّهُمَّ اكْفِنِي بِحَلَالِكَ عَنْ حَرَامِكَ، وَأَغْنِنِي بِفَضْلِكَ عَمَّنْ سِوَاكَ', count: 3 }
  ]
};

app.get('/api/adhkar/:category', (req, res) => {
  const items = adhkarData[req.params.category] || adhkarData.morning;
  res.json({ category: req.params.category, items });
});

// ============ Qibla ============
app.post('/api/qibla', (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'الموقع مطلوب' });
  const kaabaLat = 21.4225, kaabaLng = 39.8262;
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat), φ2 = toRad(kaabaLat), Δλ = toRad(kaabaLng - lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  const distance = 6371 * Math.acos(Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ));
  res.json({ bearing: Math.round(bearing), distance: Math.round(distance) });
});

// ============ User ============
app.get('/api/user/profile', auth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, accountNumber: u.accountNumber, full_name: u.full_name,
    email: u.email, phone: u.phone, wallet_address: u.wallet_address,
    iban: u.iban, bban: u.bban, profile_picture: u.profile_picture,
    preferences: u.preferences, transferCode: u.transferCode, is_demo: true
  });
});

app.put('/api/user/profile', auth, (req, res) => {
  const { full_name, email, profile_picture } = req.body;
  if (full_name) req.user.full_name = full_name;
  if (email !== undefined) req.user.email = email;
  if (profile_picture !== undefined) req.user.profile_picture = profile_picture;
  res.json({ message: 'OK' });
});

app.put('/api/user/preferences', auth, (req, res) => {
  req.user.preferences = req.body || {};
  res.json({ message: 'OK', preferences: req.user.preferences });
});

app.post('/api/auth/logout', auth, (req, res) => {
  delete db.sessions[req.token];
  res.json({ message: 'OK' });
});

// ============ Services ============
app.post('/api/interbank/transfer', auth, (req, res) => {
  const { toIBAN, amount } = req.body;
  const amt = parseFloat(amount);
  const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
  if (!sdg || sdg.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  sdg.balance -= amt;
  const ref = 'DEMO-EBS-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'SDG',
    amount: amt, status: 'completed',
    description: `تحويل بنكي تجريبي إلى ${String(toIBAN).substring(0, 10)}...`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', reference: ref });
});

app.post('/api/government/inquire', auth, (req, res) => {
  res.json({ amount: 15000, serviceType: 'كهرباء', dueDate: '2026-11-01', payerName: 'حساب تجريبي' });
});

app.post('/api/government/pay', auth, (req, res) => {
  const { billNumber, serviceType, amount } = req.body;
  const amt = parseFloat(amount);
  const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
  if (!sdg || sdg.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  sdg.balance -= amt;
  const ref = 'DEMO-GOV-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'SDG',
    amount: amt, status: 'completed',
    description: `سداد ${serviceType || 'فاتورة'} تجريبي - ${billNumber}`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', receipt: ref });
});

app.post('/api/topup/mobile', auth, (req, res) => {
  const { network, phone, amount } = req.body;
  const amt = parseFloat(amount);
  const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
  if (!sdg || sdg.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  sdg.balance -= amt;
  const ref = 'DEMO-TOP-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'SDG',
    amount: amt, status: 'completed',
    description: `شحن ${network} تجريبي - ${phone}`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', reference: ref });
});

app.post('/api/cashy/transfer', auth, (req, res) => {
  const { phone, amount, type } = req.body;
  const amt = parseFloat(amount);
  const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
  if (!sdg || sdg.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  sdg.balance -= amt;
  const ref = 'DEMO-CASHY-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'SDG',
    amount: amt, status: 'completed',
    description: `تحويل ${type || 'Cashy'} تجريبي - ${phone}`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', txId: ref });
});

app.post('/api/paymob/payout', auth, (req, res) => {
  const { walletType, phone, amount } = req.body;
  const amt = parseFloat(amount);
  const egp = (req.user.balances || []).find(b => b.currency === 'EGP');
  if (!egp || egp.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  egp.balance -= amt;
  const ref = 'DEMO-PAYMOB-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'EGP',
    amount: amt, status: 'completed',
    description: `${walletType} تجريبي - ${phone}`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', txId: ref });
});

app.post('/api/binance/create-order', auth, (req, res) => {
  res.json({ checkoutUrl: 'https://pay.binance.com/sandbox?amount=' + req.body.amount, mock: true });
});

app.post('/api/binance/transfer', auth, (req, res) => {
  const { payId, amount, currency } = req.body;
  const amt = parseFloat(amount);
  const bal = (req.user.balances || []).find(b => b.currency === currency);
  if (bal && bal.balance >= amt) bal.balance -= amt;
  const ref = 'DEMO-BN-' + Date.now().toString().slice(-8);
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: currency,
    amount: amt, status: 'completed',
    description: `تحويل ${currency} إلى Binance Pay ID: ${payId}`,
    reference: ref, created_at: new Date().toISOString()
  });
  res.json({ success: true, txId: ref });
});

app.post('/api/digital/purchase', auth, (req, res) => {
  const { productName, price } = req.body;
  const amt = parseFloat(price);
  const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
  if (!sdg || sdg.balance < amt) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  sdg.balance -= amt;
  const code = crypto.randomBytes(8).toString('hex').toUpperCase();
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'SDG',
    amount: amt, status: 'completed',
    description: `شراء ${productName} تجريبي`,
    reference: code, created_at: new Date().toISOString()
  });
  res.json({ message: 'تم', code });
});

app.post('/api/subscription/activate', auth, (req, res) => {
  const { service, email, plan } = req.body;
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  db.txs[req.user.id].unshift({
    id: Date.now(), userId: req.user.id, type: 'out', currency: 'USD',
    amount: 0, status: 'completed',
    description: `تفعيل ${service} تجريبي - ${email}`,
    reference: code, created_at: new Date().toISOString()
  });
  res.json({ success: true, email, plan, code, mock: true });
});

app.get('/api/earnings/tiktok', auth, (req, res) => {
  res.json({ earnings: 125.50, currency: 'USD', pending: 45.00 });
});

app.get('/api/earnings/facebook', auth, (req, res) => {
  res.json({ earnings: 320.75, currency: 'USD', pending: 120.00 });
});

// ============ Serve UI ============
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Medo Demo', short_name: 'Medo Demo', start_url: '/', display: 'standalone',
    background_color: '#f59e0b', theme_color: '#f59e0b', orientation: 'portrait'
  });
});

app.get('/', (req, res) => {
  const p = path.join(__dirname, 'index-demo.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.json({ status: '🎮 Demo server running' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Medo DEMO SERVER running on port ${PORT}\n`);
});
