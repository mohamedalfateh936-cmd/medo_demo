// ============================================
// Medo app — server.js الكامل
// ============================================
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const S = require('./security');
const SV = require('./services');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://medo_admin:SONAmedo@cluster0.tckmcps.mongodb.net/medo_db?appName=Cluster0';

S.securityMiddleware(app);
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));

let db, client;

async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db('medo_db');
    console.log('✅ متصل بـ MongoDB Atlas');
    await db.collection('users').createIndex({ phone: 1 }, { unique: true });
    await db.collection('users').createIndex({ accountNumber: 1 }, { unique: true, sparse: true });
    await db.collection('users').createIndex({ id: 1 }, { unique: true });
  } catch (e) { console.error('❌ فشل:', e.message); process.exit(1); }
}

const Users = () => db.collection('users');
const Sessions = () => db.collection('sessions');
const Txs = () => db.collection('transactions');
const Cards = () => db.collection('cards');

async function getNextUserId() {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: 'userId' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  return r.value ? r.value.seq : (r.seq || 1);
}

async function getNextAccountNumber() {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: 'accountNumber' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  const seq = r.value ? r.value.seq : (r.seq || 1);
  return String(seq).padStart(5, '0');
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

async function getUserLocation(ip) {
  try {
    if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.')) {
      return { country: 'السودان', countryCode: 'SD', city: 'الخرطوم', isp: 'شبكة محلية' };
    }
    const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,query`, { timeout: 4000 });
    if (r.data.status === 'success') {
      return { country: r.data.country, countryCode: r.data.countryCode, city: r.data.city, isp: r.data.isp };
    }
    return { country: 'غير معروف', countryCode: 'XX', city: '—', isp: '—' };
  } catch (e) {
    return { country: 'غير معروف', countryCode: 'XX', city: '—', isp: '—' };
  }
}

function generateTransferCode() {
  // كود نقل الحساب: MEDO-XXXX-XXXX (أرقام وحروف كبيرة)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `MEDO-${part()}-${part()}`;
}

function generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

async function loadUser(req, res, next) {
  try {
    const user = await Users().findOne({ id: req.jwtPayload.id });
    if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
    req.user = user;
    next();
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
}

app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Medo app', short_name: 'Medo', start_url: '/', display: 'standalone',
    background_color: '#6c3bf4', theme_color: '#6c3bf4', orientation: 'portrait',
    icons: [{ src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect x='10' y='10' width='180' height='180' rx='50' fill='%236c3bf4'/><path d='M55 140 L55 75 L75 75 L100 110 L125 75 L145 75 L145 140 L128 140 L128 100 L100 135 L72 100 L72 140 Z' fill='%23fff'/></svg>", sizes: '512x512', type: 'image/svg+xml' }]
  });
});

app.get('/', (req, res) => {
  const p = path.join(__dirname, 'index.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.json({ status: '✅ Medo' });
});

// ============ Countries ============
app.get('/api/auth/countries', S.limiters.general, (req, res) => {
  res.json([
    { code: 'SD', dial: '+249', name: 'السودان', flag: '🇸🇩' },
    { code: 'EG', dial: '+20', name: 'مصر', flag: '🇪🇬' },
    { code: 'SA', dial: '+966', name: 'السعودية', flag: '🇸🇦' },
    { code: 'AE', dial: '+971', name: 'الإمارات', flag: '🇦🇪' },
    { code: 'KW', dial: '+965', name: 'الكويت', flag: '🇰🇼' },
    { code: 'QA', dial: '+974', name: 'قطر', flag: '🇶🇦' },
    { code: 'BH', dial: '+973', name: 'البحرين', flag: '🇧🇭' },
    { code: 'OM', dial: '+968', name: 'عمان', flag: '🇴🇲' },
    { code: 'JO', dial: '+962', name: 'الأردن', flag: '🇯🇴' },
    { code: 'US', dial: '+1', name: 'أمريكا', flag: '🇺🇸' },
    { code: 'GB', dial: '+44', name: 'بريطانيا', flag: '🇬🇧' },
    { code: 'DE', dial: '+49', name: 'ألمانيا', flag: '🇩🇪' },
    { code: 'FR', dial: '+33', name: 'فرنسا', flag: '🇫🇷' },
    { code: 'TR', dial: '+90', name: 'تركيا', flag: '🇹🇷' },
    { code: 'IN', dial: '+91', name: 'الهند', flag: '🇮🇳' },
    { code: 'PK', dial: '+92', name: 'باكستان', flag: '🇵🇰' },
    { code: 'CN', dial: '+86', name: 'الصين', flag: '🇨🇳' },
    { code: 'NG', dial: '+234', name: 'نيجيريا', flag: '🇳🇬' },
    { code: 'KE', dial: '+254', name: 'كينيا', flag: '🇰🇪' },
    { code: 'ET', dial: '+251', name: 'إثيوبيا', flag: '🇪🇹' }
  ]);
});

// ============ Registration ============
app.post('/api/auth/register', S.limiters.register, async (req, res) => {
  const ip = getClientIP(req);
  try {
    let { full_name, email, phone, password, nationalId, deviceInfo } = req.body;
    full_name = S.sanitizeInput(full_name);
    email = email ? S.sanitizeInput(email) : null;
    phone = S.sanitizeInput(phone);
    nationalId = nationalId ? S.sanitizeInput(nationalId) : null;
    if (!full_name || !phone || !password) return res.status(400).json({ error: 'البيانات ناقصة' });
    if (!S.validatePhone(phone)) return res.status(400).json({ error: 'رقم الهاتف غير صحيح' });
    const pwd = S.validatePassword(password);
    if (!pwd.ok) return res.status(400).json({ error: pwd.msg });
    const existing = await Users().findOne({ phone });
    if (existing) return res.status(409).json({ error: 'رقم الهاتف مسجل مسبقاً' });

    const userId = await getNextUserId();
    const accountNumber = await getNextAccountNumber();
    const otp = S.generateSecureOTP();
    const transferCode = generateTransferCode();
    const cd = String(Math.floor(10 + Math.random() * 90));
    const bc = '2901';
    const an = String(Math.floor(100000000000 + Math.random() * 900000000000));
    const iban = `SD${cd}${bc}${an}`;
    const passwordHash = await S.hashPassword(password);
    const location = await getUserLocation(ip);
    const currentDeviceId = deviceInfo?.id || generateDeviceId();

    await Users().insertOne({
      id: userId, accountNumber, full_name, email, phone, nationalId,
      password_hash: passwordHash, is_verified: false,
      wallet_address: '0x' + crypto.randomBytes(20).toString('hex'),
      iban, bban: iban.substring(4), bank_code: bc,
      otp_hash: await S.hashPassword(otp),
      otp_expires: Date.now() + S.CONFIG.OTP_EXPIRES,
      otp_attempts: 0,
      otp_plain: otp, // يُحذف بعد التحقق
      profile_picture: null,
      transferCode,
      devices: [{
        id: currentDeviceId,
        name: deviceInfo?.name || 'الجهاز الحالي',
        os: deviceInfo?.os || '—',
        browser: deviceInfo?.browser || '—',
        ip,
        location,
        registeredAt: new Date(),
        lastSeen: new Date()
      }],
      preferences: { theme: 'light', language: 'ar', background: 'grad1' },
      created_at: new Date(), last_login: null, last_ip: ip,
      balances: [
        { currency: 'USD', balance: 0 }, { currency: 'EUR', balance: 0 },
        { currency: 'SDG', balance: 0 }, { currency: 'USDT', balance: 0 },
        { currency: 'EGP', balance: 0 }
      ]
    });

    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  📱 OTP جديد للتسجيل               ║');
    console.log(`║  الاسم:  ${full_name}`);
    console.log(`║  الهاتف: ${phone}`);
    console.log(`║  ⭐ رقم الحساب: ${accountNumber}`);
    console.log(`║  🔑 الرمز: ${otp}`);
    console.log(`║  🔐 كود نقل الحساب: ${transferCode}`);
    console.log(`║  🌍 الموقع: ${location.city}, ${location.country}`);
    console.log('╚══════════════════════════════════════╝\n');

    res.json({
      message: 'OK',
      userId,
      accountNumber,
      testOtp: otp,
      device: {
        name: deviceInfo?.name || 'الجهاز الحالي',
        os: deviceInfo?.os || '—',
        browser: deviceInfo?.browser || '—',
        ip,
        location,
        time: new Date().toISOString()
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'فشل التسجيل' }); }
});

// ============ OTP Verify ============
app.post('/api/auth/otp/verify', S.limiters.otp, async (req, res) => {
  const ip = getClientIP(req);
  try {
    const userId = parseInt(req.body.userId);
    const code = String(req.body.code || '').substring(0, 6);
    const user = await Users().findOne({ id: userId });
    if (!user) return res.status(400).json({ error: 'غير موجود' });
    if (!user.otp_hash) return res.status(400).json({ error: 'لا يوجد رمز' });
    if (Date.now() > user.otp_expires) return res.status(400).json({ error: 'انتهى' });
    if (user.otp_attempts >= S.CONFIG.MAX_OTP_ATTEMPTS) return res.status(400).json({ error: 'تجاوزت' });
    const valid = await S.verifyPassword(code, user.otp_hash);
    if (!valid) {
      await Users().updateOne({ id: userId }, { $inc: { otp_attempts: 1 } });
      return res.status(400).json({ error: 'رمز خطأ' });
    }

    // توليد كود نقل الحساب الجديد
    const newTransferCode = generateTransferCode();

    await Users().updateOne({ id: userId }, {
      $set: { is_verified: true, last_login: new Date(), last_ip: ip, transferCode: newTransferCode },
      $unset: { otp_hash: '', otp_expires: '', otp_attempts: '', otp_plain: '' }
    });

    const token = S.generateJWT(userId, user.phone);
    await Sessions().insertOne({ token, userId, ip, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });

    res.json({
      token,
      user: {
        id: user.id, accountNumber: user.accountNumber, full_name: user.full_name,
        phone: user.phone, email: user.email, wallet_address: user.wallet_address,
        iban: user.iban, bban: user.bban, bank_code: user.bank_code,
        profile_picture: user.profile_picture, preferences: user.preferences,
        transferCode: newTransferCode
      }
    });
  } catch (err) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/auth/otp/send', S.limiters.otp, async (req, res) => {
  try {
    const userId = parseInt(req.body.userId);
    const user = await Users().findOne({ id: userId });
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    const otp = S.generateSecureOTP();
    await Users().updateOne({ id: userId }, {
      $set: { otp_hash: await S.hashPassword(otp), otp_expires: Date.now() + S.CONFIG.OTP_EXPIRES, otp_attempts: 0, otp_plain: otp }
    });
    console.log(`\n📱 OTP: ${otp}\n`);
    res.json({ message: 'OK', testOtp: otp });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Login with Device Detection ============
app.post('/api/auth/login', S.limiters.login, async (req, res) => {
  const ip = getClientIP(req);
  try {
    let { identifier, phone, password, deviceInfo } = req.body;
    identifier = identifier || phone;
    identifier = S.sanitizeInput(String(identifier || ''));
    if (!identifier || !password) return res.status(400).json({ error: 'البيانات ناقصة' });

    let user;
    if (/^\d{1,5}$/.test(identifier)) {
      user = await Users().findOne({ accountNumber: identifier.padStart(5, '0') });
    }
    if (!user) user = await Users().findOne({ phone: identifier });
    if (!user) user = await Users().findOne({ phone: '+' + identifier.replace(/^0+/, '') });

    if (!user) { await S.constantTimeDelay(500); return res.status(401).json({ error: 'بيانات غير صحيحة' }); }
    if (S.isAccountLocked(user.id)) return res.status(429).json({ error: 'الحساب مقفل' });

    const valid = await S.verifyPassword(password, user.password_hash);
    if (!valid) {
      const result = S.recordFailedAttempt(user.id, ip);
      if (result.locked) return res.status(429).json({ error: 'الحساب مقفل' });
      return res.status(401).json({ error: `بيانات خطأ (${result.remaining} محاولات)` });
    }

    if (!user.is_verified) {
      const otp = S.generateSecureOTP();
      await Users().updateOne({ id: user.id }, {
        $set: { otp_hash: await S.hashPassword(otp), otp_expires: Date.now() + S.CONFIG.OTP_EXPIRES, otp_attempts: 0, otp_plain: otp }
      });
      return res.status(403).json({ error: 'غير مفعل', userId: user.id, requiresOTP: true, testOtp: otp });
    }

    // ⭐ فحص الجهاز
    const currentDeviceId = deviceInfo?.id || generateDeviceId();
    const existingDevice = (user.devices || []).find(d => d.id === currentDeviceId);
    const location = await getUserLocation(ip);

    if (!existingDevice) {
      // جهاز جديد — نطلب كود النقل
      return res.status(403).json({
        error: 'جهاز جديد',
        requiresTransferCode: true,
        userId: user.id,
        accountNumber: user.accountNumber,
        deviceInfo: {
          name: deviceInfo?.name || 'جهاز غير معروف',
          os: deviceInfo?.os || '—',
          browser: deviceInfo?.browser || '—',
          ip,
          location,
          time: new Date().toISOString(),
          deviceId: currentDeviceId
        }
      });
    }

    // تحديث آخر ظهور للجهاز
    await Users().updateOne(
      { id: user.id, 'devices.id': currentDeviceId },
      { $set: { 'devices.$.lastSeen': new Date(), 'devices.$.ip': ip } }
    );

    S.clearLoginAttempts(user.id);
    const token = S.generateJWT(user.id, user.phone);
    await Sessions().insertOne({ token, userId: user.id, ip, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
    await Users().updateOne({ id: user.id }, { $set: { last_login: new Date(), last_ip: ip } });

    res.json({
      token, user: {
        id: user.id, accountNumber: user.accountNumber, full_name: user.full_name,
        phone: user.phone, email: user.email, wallet_address: user.wallet_address,
        iban: user.iban, bban: user.bban, bank_code: user.bank_code,
        profile_picture: user.profile_picture, preferences: user.preferences,
        transferCode: user.transferCode
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'فشل' }); }
});

// ============ Verify Transfer Code (لنقل الحساب) ============
app.post('/api/auth/verify-transfer', S.limiters.login, async (req, res) => {
  const ip = getClientIP(req);
  try {
    const { userId, transferCode, deviceInfo } = req.body;
    if (!userId || !transferCode) return res.status(400).json({ error: 'البيانات ناقصة' });
    const user = await Users().findOne({ id: parseInt(userId) });
    if (!user) return res.status(404).json({ error: 'غير موجود' });

    if ((user.transferCode || '').toUpperCase() !== transferCode.toUpperCase().trim()) {
      return res.status(401).json({ error: 'كود نقل الحساب غير صحيح' });
    }

    // إضافة الجهاز الجديد
    const newDeviceId = deviceInfo?.id || generateDeviceId();
    const location = await getUserLocation(ip);
    const newDevice = {
      id: newDeviceId,
      name: deviceInfo?.name || 'جهاز جديد',
      os: deviceInfo?.os || '—',
      browser: deviceInfo?.browser || '—',
      ip, location,
      registeredAt: new Date(),
      lastSeen: new Date()
    };

    await Users().updateOne({ id: user.id }, {
      $push: { devices: newDevice },
      $set: { last_login: new Date(), last_ip: ip }
    });

    const token = S.generateJWT(user.id, user.phone);
    await Sessions().insertOne({ token, userId: user.id, ip, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });

    res.json({
      message: 'OK',
      token,
      user: {
        id: user.id, accountNumber: user.accountNumber, full_name: user.full_name,
        phone: user.phone, email: user.email, wallet_address: user.wallet_address,
        iban: user.iban, bban: user.bban, bank_code: user.bank_code,
        profile_picture: user.profile_picture, preferences: user.preferences,
        transferCode: user.transferCode
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'فشل' }); }
});

// ============ استعادة كود نقل الحساب (رقم الحساب + كلمة المرور) ============
app.post('/api/auth/recover-transfer-code', S.limiters.otp, async (req, res) => {
  try {
    const { accountNumber, password } = req.body;
    if (!accountNumber || !password) return res.status(400).json({ error: 'البيانات ناقصة' });
    const acc = String(accountNumber).padStart(5, '0');
    const user = await Users().findOne({ accountNumber: acc });
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });
    const valid = await S.verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'كلمة المرور خطأ' });

    let code = user.transferCode;
    if (!code) {
      code = generateTransferCode();
      await Users().updateOne({ id: user.id }, { $set: { transferCode: code } });
    }
    console.log(`\n🔐 كود نقل الحساب (#${acc}): ${code}\n`);
    res.json({ message: 'OK', transferCode: code, accountNumber: acc });
  } catch (err) { res.status(500).json({ error: 'فشل' }); }
});

// ============ الأجهزة المتصلة ============
app.get('/api/user/devices', S.jwtAuth, loadUser, (req, res) => {
  res.json({ devices: req.user.devices || [], transferCode: req.user.transferCode });
});

app.delete('/api/user/devices/:deviceId', S.jwtAuth, loadUser, async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const devices = (req.user.devices || []).filter(d => d.id !== deviceId);
    if (devices.length === 0) return res.status(400).json({ error: 'لا يمكن حذف جميع الأجهزة' });
    await Users().updateOne({ id: req.user.id }, { $set: { devices } });
    res.json({ message: 'OK', devices });
  } catch (err) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Forgot Password ============
app.post('/api/auth/forgot-password', S.limiters.otp, async (req, res) => {
  try {
    const identifier = S.sanitizeInput(String(req.body.identifier || ''));
    if (!identifier) return res.status(400).json({ error: 'أدخل رقم الهاتف أو الحساب' });
    let user = await Users().findOne({ phone: identifier });
    if (!user && /^\d{1,5}$/.test(identifier)) {
      user = await Users().findOne({ accountNumber: identifier.padStart(5, '0') });
    }
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });
    const otp = S.generateSecureOTP();
    await Users().updateOne({ id: user.id }, {
      $set: { reset_otp_hash: await S.hashPassword(otp), reset_otp_expires: Date.now() + 10 * 60 * 1000, reset_otp_attempts: 0, otp_plain: otp }
    });
    console.log(`\n🔐 OTP إعادة التعيين: ${otp}\n`);
    res.json({ message: 'OK', userId: user.id, testOtp: otp });
  } catch (err) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { userId, code, newPassword } = req.body;
    if (!userId || !code || !newPassword) return res.status(400).json({ error: 'البيانات ناقصة' });
    const pwd = S.validatePassword(newPassword);
    if (!pwd.ok) return res.status(400).json({ error: pwd.msg });
    const user = await Users().findOne({ id: parseInt(userId) });
    if (!user || !user.reset_otp_hash) return res.status(400).json({ error: 'لا يوجد طلب' });
    if (Date.now() > user.reset_otp_expires) return res.status(400).json({ error: 'انتهى الرمز' });
    if (user.reset_otp_attempts >= 5) return res.status(400).json({ error: 'تجاوزت' });
    const valid = await S.verifyPassword(code, user.reset_otp_hash);
    if (!valid) {
      await Users().updateOne({ id: user.id }, { $inc: { reset_otp_attempts: 1 } });
      return res.status(400).json({ error: 'رمز خطأ' });
    }
    const hash = await S.hashPassword(newPassword);
    await Users().updateOne({ id: user.id }, { $set: { password_hash: hash }, $unset: { reset_otp_hash: '', reset_otp_expires: '', reset_otp_attempts: '', otp_plain: '' } });
    res.json({ message: 'تم' });
  } catch (err) { res.status(500).json({ error: 'فشل' }); }
});

app.get('/api/auth/me', S.jwtAuth, loadUser, (req, res) => {
  const u = req.user;
  res.json({ user: {
    id: u.id, accountNumber: u.accountNumber, full_name: u.full_name,
    phone: u.phone, email: u.email, wallet_address: u.wallet_address,
    iban: u.iban, bban: u.bban, bank_code: u.bank_code,
    profile_picture: u.profile_picture, preferences: u.preferences || {},
    transferCode: u.transferCode
  }});
});

app.post('/api/auth/logout', S.jwtAuth, async (req, res) => {
  try { await Sessions().deleteOne({ token: req.headers.authorization.substring(7) }); } catch(e){}
  res.json({ message: 'OK' });
});

// ============ Wallet ============
app.get('/api/wallet/balances', S.jwtAuth, loadUser, (req, res) => res.json(req.user.balances || []));

app.get('/api/wallet/transactions', S.jwtAuth, loadUser, async (req, res) => {
  try { const txs = await Txs().find({ userId: req.user.id }).sort({ id: -1 }).limit(200).toArray(); res.json(txs); }
  catch (e) { res.json([]); }
});

app.get('/api/wallet/sent', S.jwtAuth, loadUser, async (req, res) => {
  try { const txs = await Txs().find({ userId: req.user.id, type: 'out' }).sort({ id: -1 }).limit(100).toArray(); res.json(txs); }
  catch (e) { res.json([]); }
});

app.get('/api/wallet/received', S.jwtAuth, loadUser, async (req, res) => {
  try { const txs = await Txs().find({ userId: req.user.id, type: 'receive' }).sort({ id: -1 }).limit(100).toArray(); res.json(txs); }
  catch (e) { res.json([]); }
});

async function updateBalance(userId, currency, delta) {
  const user = await Users().findOne({ id: userId });
  const balances = user.balances || [];
  const idx = balances.findIndex(b => b.currency === currency);
  if (idx >= 0) balances[idx].balance = parseFloat(balances[idx].balance || 0) + delta;
  else balances.push({ currency, balance: delta });
  await Users().updateOne({ id: userId }, { $set: { balances } });
}

async function addTx(userId, data) {
  await Txs().insertOne({ id: Date.now(), userId, created_at: new Date().toISOString(), ...data });
}

// ============ User Profile ============
app.get('/api/user/profile', S.jwtAuth, loadUser, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, accountNumber: u.accountNumber, full_name: u.full_name,
    email: u.email, phone: u.phone, wallet_address: u.wallet_address,
    iban: u.iban, bban: u.bban, profile_picture: u.profile_picture,
    preferences: u.preferences, transferCode: u.transferCode
  });
});

app.put('/api/user/profile', S.limiters.general, S.jwtAuth, loadUser, async (req, res) => {
  let { full_name, email, profile_picture } = req.body;
  const update = {};
  if (full_name) update.full_name = S.sanitizeInput(full_name);
  if (email !== undefined) update.email = S.sanitizeInput(email);
  if (profile_picture !== undefined) update.profile_picture = profile_picture;
  await Users().updateOne({ id: req.user.id }, { $set: update });
  res.json({ message: 'OK' });
});

app.put('/api/user/preferences', S.jwtAuth, loadUser, async (req, res) => {
  const prefs = req.body || {};
  await Users().updateOne({ id: req.user.id }, { $set: { preferences: prefs } });
  res.json({ message: 'OK', preferences: prefs });
});

app.put('/api/user/change-password', S.jwtAuth, loadUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'البيانات ناقصة' });
  const pwd = S.validatePassword(newPassword);
  if (!pwd.ok) return res.status(400).json({ error: pwd.msg });
  const valid = await S.verifyPassword(currentPassword, req.user.password_hash);
  if (!valid) return res.status(400).json({ error: 'كلمة المرور الحالية خطأ' });
  const hash = await S.hashPassword(newPassword);
  await Users().updateOne({ id: req.user.id }, { $set: { password_hash: hash } });
  res.json({ message: 'تم' });
});

// ============ Regenerate Transfer Code ============
app.post('/api/user/regenerate-transfer-code', S.jwtAuth, loadUser, async (req, res) => {
  const newCode = generateTransferCode();
  await Users().updateOne({ id: req.user.id }, { $set: { transferCode: newCode } });
  res.json({ message: 'تم', transferCode: newCode });
});

// ============ Find user by account ============
app.get('/api/user/find/:accountNumber', S.jwtAuth, loadUser, async (req, res) => {
  try {
    const acc = String(req.params.accountNumber).padStart(5, '0');
    const user = await Users().findOne({ accountNumber: acc });
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    res.json({ accountNumber: user.accountNumber, full_name: user.full_name, phone: user.phone.slice(0, 7) + '***' });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Send ============
app.post('/api/send/by-account', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    let { toAccountNumber, currency, amount, note } = req.body;
    amount = parseFloat(amount);
    toAccountNumber = String(toAccountNumber).padStart(5, '0');
    if (!toAccountNumber || !amount || !currency) return res.status(400).json({ error: 'البيانات ناقصة' });
    if (toAccountNumber === req.user.accountNumber) return res.status(400).json({ error: 'لا يمكن الإرسال لنفسك' });
    if (amount <= 0) return res.status(400).json({ error: 'المبلغ غير صحيح' });
    const recipient = await Users().findOne({ accountNumber: toAccountNumber });
    if (!recipient) return res.status(404).json({ error: 'المستقبل غير موجود' });
    const senderBal = (req.user.balances || []).find(b => b.currency === currency);
    if (!senderBal || senderBal.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    const ref = 'MEDO' + Date.now().toString().slice(-8);
    await updateBalance(req.user.id, currency, -amount);
    await updateBalance(recipient.id, currency, amount);
    await addTx(req.user.id, {
      type: 'out', currency, amount, status: 'completed',
      description: `إرسال إلى ${recipient.full_name} (#${recipient.accountNumber})`,
      reference: ref, toAccount: recipient.accountNumber, toName: recipient.full_name,
      toPhone: recipient.phone, fromAccount: req.user.accountNumber,
      fromName: req.user.full_name, fromPhone: req.user.phone, note: note || ''
    });
    await addTx(recipient.id, {
      type: 'receive', currency, amount, status: 'completed',
      description: `استلام من ${req.user.full_name} (#${req.user.accountNumber})`,
      reference: ref, fromAccount: req.user.accountNumber, fromName: req.user.full_name,
      fromPhone: req.user.phone, toAccount: recipient.accountNumber,
      toName: recipient.full_name, toPhone: recipient.phone, note: note || ''
    });
    res.json({
      message: 'تم التحويل', reference: ref,
      recipient: { accountNumber: recipient.accountNumber, name: recipient.full_name, phone: recipient.phone },
      sender: { accountNumber: req.user.accountNumber, name: req.user.full_name, phone: req.user.phone },
      amount, currency, date: new Date().toISOString()
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/refund', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { transactionId, password } = req.body;
    if (!transactionId || !password) return res.status(400).json({ error: 'البيانات ناقصة' });
    const valid = await S.verifyPassword(password, req.user.password_hash);
    if (!valid) return res.status(401).json({ error: 'كلمة المرور خطأ' });
    const tx = await Txs().findOne({ id: parseInt(transactionId), userId: req.user.id });
    if (!tx) return res.status(404).json({ error: 'غير موجودة' });
    if (tx.type !== 'out') return res.status(400).json({ error: 'فقط المرسلة' });
    if (tx.refunded) return res.status(400).json({ error: 'تم استرجاعها' });
    await updateBalance(req.user.id, tx.currency, tx.amount);
    await Txs().updateOne({ id: tx.id }, { $set: { refunded: true } });
    await addTx(req.user.id, { type: 'receive', currency: tx.currency, amount: tx.amount, status: 'completed', description: `استرجاع — ${tx.reference || tx.id}` });
    res.json({ message: 'تم', amount: tx.amount, currency: tx.currency });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Services ============
app.post('/api/interbank/transfer', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    let { toIBAN, amount } = req.body;
    toIBAN = S.sanitizeInput(toIBAN);
    amount = parseFloat(amount);
    if (!toIBAN || !amount) return res.status(400).json({ error: 'البيانات ناقصة' });
    if (!S.validateIBAN(toIBAN)) return res.status(400).json({ error: 'IBAN غير صحيح' });
    const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
    if (!sdg || sdg.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    const result = await SV.EBS.receiveViaIBAN(toIBAN, amount, `MEDO_${req.user.id}_${Date.now()}`);
    if (!result.success) return res.status(400).json({ error: 'فشل' });
    await updateBalance(req.user.id, 'SDG', -amount);
    await addTx(req.user.id, { type: 'out', currency: 'SDG', amount, status: 'completed', description: `تحويل بنكي إلى ${toIBAN.substring(0, 10)}...`, reference: result.transactionId });
    res.json({ message: 'تم', reference: result.transactionId });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/government/inquire', S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { billNumber } = req.body;
    if (!billNumber) return res.status(400).json({ error: 'رقم الفاتورة' });
    res.json(await SV.E15.inquireBill(billNumber));
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/government/pay', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    let { billNumber, serviceType, amount } = req.body;
    amount = parseFloat(amount);
    if (!billNumber || !amount) return res.status(400).json({ error: 'البيانات ناقصة' });
    const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
    if (!sdg || sdg.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    const result = await SV.E15.payBill(billNumber, amount, req.user.phone);
    if (result.status !== 'success') return res.status(400).json({ error: 'فشل' });
    await updateBalance(req.user.id, 'SDG', -amount);
    await addTx(req.user.id, { type: 'out', currency: 'SDG', amount, status: 'completed', description: `سداد ${serviceType || 'فاتورة'} - ${billNumber}`, reference: result.receiptNumber });
    res.json({ message: 'تم', receipt: result.receiptNumber });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/topup/mobile', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    let { network, phone, amount } = req.body;
    phone = S.sanitizeInput(phone);
    amount = parseFloat(amount);
    if (!phone || !amount) return res.status(400).json({ error: 'البيانات ناقصة' });
    if (!/^0(9|1)\d{8}$/.test(phone)) return res.status(400).json({ error: 'رقم خطأ' });
    const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
    if (!sdg || sdg.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    await updateBalance(req.user.id, 'SDG', -amount);
    const ref = 'TOP_' + Date.now().toString().slice(-8);
    await addTx(req.user.id, { type: 'out', currency: 'SDG', amount, status: 'completed', description: `شحن ${network} - ${phone}`, reference: ref });
    res.json({ message: 'تم', reference: ref });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.get('/api/wallester/cards', S.jwtAuth, loadUser, async (req, res) => {
  try {
    const cards = await Cards().find({ userId: req.user.id }).toArray();
    res.json(cards.map(c => ({ id: c.id, card_number_last4: c.pan_last4, expiry_date: c.expiry, card_holder: c.holder, network: c.network, status: c.status, spending_limit: c.limit })));
  } catch (e) { res.json([]); }
});

app.post('/api/wallester/issue-card', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const scheme = (req.body.scheme || 'visa').toLowerCase();
    const card = await SV.Wallester.issueCard(req.user.id, scheme, req.body.currency || 'EUR');
    const newCard = {
      id: card.id, userId: req.user.id,
      pan_encrypted: S.encrypt(card.pan), pan_last4: card.pan.slice(-4),
      cvv_encrypted: S.encrypt(card.cvv), expiry: card.expiry,
      holder: req.user.full_name.toUpperCase(),
      network: scheme === 'mastercard' ? 'MASTERCARD' : 'VISA',
      status: 'active', limit: req.body.limit || 5000, created_at: new Date().toISOString()
    };
    await Cards().insertOne(newCard);
    await addTx(req.user.id, { type: 'receive', currency: 'USD', amount: 0, status: 'completed', description: `إصدار بطاقة ${scheme}` });
    res.json({ message: 'OK', last4: card.pan.slice(-4) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wallester/cards/:id/reveal', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  const card = await Cards().findOne({ id: parseInt(req.params.id), userId: req.user.id });
  if (!card) return res.status(404).json({ error: 'غير موجودة' });
  res.json({ pan: S.decrypt(card.pan_encrypted), cvv: S.decrypt(card.cvv_encrypted), expiry: card.expiry });
});

app.patch('/api/wallester/cards/:id/freeze', S.jwtAuth, loadUser, async (req, res) => {
  const card = await Cards().findOne({ id: parseInt(req.params.id), userId: req.user.id });
  if (!card) return res.status(404).json({ error: 'غير موجودة' });
  const newStatus = card.status === 'frozen' ? 'active' : 'frozen';
  await Cards().updateOne({ id: card.id }, { $set: { status: newStatus } });
  res.json({ message: 'OK', status: newStatus });
});

app.get('/api/rates/all', async (req, res) => {
  try { res.json(await SV.Rates.getAllRates()); }
  catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/cashy/transfer', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { phone, amount, type } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: 'البيانات ناقصة' });
    const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
    if (!sdg || sdg.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    let result;
    const ref = `MEDO_${Date.now()}`;
    if (type === 'MYCASHI') result = await SV.Cashy.transferToMyCashi(phone, parseFloat(amount), ref);
    else if (type === 'CASHY_LITE') result = await SV.Cashy.transferToCashyLite(phone, parseFloat(amount), ref);
    else result = await SV.Cashy.transfer(phone, parseFloat(amount), ref);
    if (!result.success) return res.status(400).json({ error: 'فشل' });
    await updateBalance(req.user.id, 'SDG', -parseFloat(amount));
    await addTx(req.user.id, { type: 'out', currency: 'SDG', amount: parseFloat(amount), status: 'completed', description: `تحويل ${type || 'Cashy'} - ${phone}`, reference: result.txId });
    res.json({ message: 'تم', txId: result.txId });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/paymob/payout', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { walletType, phone, amount } = req.body;
    const egp = (req.user.balances || []).find(b => b.currency === 'EGP');
    if (!egp || egp.balance < amount) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    const result = await SV.Paymob.payoutToWallet(walletType, phone, parseFloat(amount), `MEDO_${Date.now()}`);
    if (!result.success) return res.status(400).json({ error: 'فشل' });
    await updateBalance(req.user.id, 'EGP', -parseFloat(amount));
    await addTx(req.user.id, { type: 'out', currency: 'EGP', amount: parseFloat(amount), status: 'completed', description: `${walletType} - ${phone}`, reference: result.txId });
    res.json({ message: 'تم', txId: result.txId });
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/binance/create-order', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const ref = `MEDO_BN_${req.user.id}_${Date.now()}`;
    res.json(await SV.BinancePay.createOrder(amount, currency, ref));
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/binance/transfer', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { payId, amount, currency } = req.body;
    res.json(await SV.BinancePay.transferToPayId(payId, parseFloat(amount), currency));
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.post('/api/digital/purchase', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { productId, productName, price } = req.body;
    const sdg = (req.user.balances || []).find(b => b.currency === 'SDG');
    if (!sdg || sdg.balance < price) return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    const result = await SV.Subscription.buyGameCard(productId, 1);
    await updateBalance(req.user.id, 'SDG', -parseFloat(price));
    await addTx(req.user.id, { type: 'out', currency: 'SDG', amount: parseFloat(price), status: 'completed', description: `شراء ${productName}` });
    res.json({ message: 'تم', code: result.code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subscription/activate', S.limiters.transaction, S.jwtAuth, loadUser, async (req, res) => {
  try {
    const { service, email, plan } = req.body;
    let result;
    if (service === 'canva') result = await SV.Subscription.activateCanva(email, plan);
    else if (service === 'microsoft') result = await SV.Subscription.activateMicrosoft(email, plan);
    else if (service === 'adobe') result = await SV.Subscription.activateAdobe(email, plan);
    else return res.status(400).json({ error: 'خدمة غير مدعومة' });
    await addTx(req.user.id, { type: 'out', currency: 'USD', amount: 0, status: 'completed', description: `تفعيل ${service}` });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.get('/api/earnings/tiktok', S.jwtAuth, loadUser, async (req, res) => {
  try { res.json(await SV.Subscription.receiveTikTokEarnings(req.user.id)); }
  catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.get('/api/earnings/facebook', S.jwtAuth, loadUser, async (req, res) => {
  try { res.json(await SV.Subscription.receiveFacebookEarnings(req.user.id)); }
  catch (e) { res.status(500).json({ error: 'فشل' }); }
});

// ============ Adhkar ============
const adhkarData = {
  morning: [
    { text: 'اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ... (آية الكرسي)', count: 1 },
    { text: 'قُلْ هُوَ اللَّهُ أَحَدٌ... والمعوذتين', count: 3 },
    { text: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ', count: 1 },
    { text: 'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ', count: 1 },
    { text: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ (سيد الاستغفار)', count: 1 },
    { text: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ، وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ', count: 7 },
    { text: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ', count: 3 },
    { text: 'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ نَبِيًّا', count: 3 },
    { text: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ', count: 1 },
    { text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', count: 100 },
    { text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى سَيِّدِنَا مُحَمَّدٍ', count: 10 }
  ],
  evening: [
    { text: 'اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ... (آية الكرسي)', count: 1 },
    { text: 'قُلْ هُوَ اللَّهُ أَحَدٌ... والمعوذتين', count: 3 },
    { text: 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ', count: 1 },
    { text: 'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ', count: 1 },
    { text: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ (سيد الاستغفار)', count: 1 },
    { text: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ', count: 3 },
    { text: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ', count: 3 },
    { text: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ', count: 7 },
    { text: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ', count: 3 },
    { text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', count: 100 },
    { text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى سَيِّدِنَا مُحَمَّدٍ', count: 10 }
  ],
  sleep: [
    { text: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا', count: 1 },
    { text: 'اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ', count: 3 },
    { text: 'اللَّهُمَّ أَسْلَمْتُ نَفْسِي إِلَيْكَ، وَفَوَّضْتُ أَمْرِي إِلَيْكَ', count: 1 },
    { text: 'سُبْحَانَ اللَّهِ', count: 33 },
    { text: 'الْحَمْدُ لِلَّهِ', count: 33 },
    { text: 'اللَّهُ أَكْبَرُ', count: 34 },
    { text: 'آيَةُ الْكُرْسِيِّ قبل النوم', count: 1 }
  ],
  wake: [
    { text: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', count: 1 },
    { text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ', count: 1 },
    { text: 'الْحَمْدُ لِلَّهِ الَّذِي رَدَّ عَلَيَّ رُوحِي وَعَافَانِي فِي جَسَدِي', count: 1 }
  ],
  leavingHome: [
    { text: 'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', count: 1 },
    { text: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ أَنْ أَضِلَّ أَوْ أُضَلَّ', count: 1 }
  ],
  market: [
    { text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، يُحْيِي وَيُمِيتُ', count: 1 }
  ],
  enteringHome: [
    { text: 'بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَى رَبِّنَا تَوَكَّلْنَا', count: 1 },
    { text: 'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ', count: 1 }
  ],
  tawakkul: [
    { text: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', count: 3 },
    { text: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ الْعَلِيِّ الْعَظِيمِ', count: 7 }
  ],
  provision: [
    { text: 'اللَّهُمَّ اكْفِنِي بِحَلَالِكَ عَنْ حَرَامِكَ، وَأَغْنِنِي بِفَضْلِكَ عَمَّنْ سِوَاكَ', count: 3 },
    { text: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا، وَرِزْقًا طَيِّبًا، وَعَمَلًا مُتَقَبَّلًا', count: 3 }
  ]
};

app.get('/api/adhkar/:category', (req, res) => {
  const items = adhkarData[req.params.category] || adhkarData.morning;
  res.json({ category: req.params.category, items });
});

app.post('/api/qibla', (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.get('/api/geo/ip', async (req, res) => {
  try {
    const ip = getClientIP(req);
    const r = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 5000 });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: 'فشل' }); }
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'خطأ' }); });
app.use((req, res) => res.status(404).json({ error: 'غير موجود' }));

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   🚀 Medo app يعمل بنجاح             ║');
    console.log(`║   🌐 http://localhost:${PORT}          ║`);
    console.log('║   ✅ OTP + معلومات الجهاز            ║');
    console.log('║   ✅ كود نقل الحساب تلقائي           ║');
    console.log('╚══════════════════════════════════════╝\n');
  });
});
