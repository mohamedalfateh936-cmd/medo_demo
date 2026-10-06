// ============================================
// طبقات الأمان المتقدمة لـ Medo app
// ============================================
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

// ============ الإعدادات ============
const CONFIG = {
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
  JWT_EXPIRES: '30d',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'medo-super-secret-key-change-in-production-32char',
  BCRYPT_ROUNDS: 12,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000,
  MAX_OTP_ATTEMPTS: 3,
  OTP_EXPIRES: 5 * 60 * 1000,
  MAX_REQUEST_SIZE: '1mb'
};

// ============ 1. تشفير كلمات المرور ============
async function hashPassword(password) {
  return await bcrypt.hash(password, CONFIG.BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// ============ 2. JWT ============
function generateJWT(userId, phone) {
  return jwt.sign(
    { id: userId, phone, iat: Date.now() },
    CONFIG.JWT_SECRET,
    { expiresIn: CONFIG.JWT_EXPIRES, issuer: 'medo-app' }
  );
}

function verifyJWT(token) {
  try {
    return jwt.verify(token, CONFIG.JWT_SECRET, { issuer: 'medo-app' });
  } catch (e) {
    return null;
  }
}

// ============ 3. تشفير AES-256-GCM ============
function encrypt(text) {
  if (!text) return null;
  const key = crypto.scryptSync(CONFIG.ENCRYPTION_KEY, 'medo-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const [ivHex, tagHex, encrypted] = encryptedText.split(':');
    const key = crypto.scryptSync(CONFIG.ENCRYPTION_KEY, 'medo-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

// ============ 4. فحص المدخلات ============
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '')
    .replace(/\$|\{|\}/g, '')
    .replace(/\0/g, '')
    .trim()
    .substring(0, 500);
}

function validatePhone(phone) {
  return /^\+?\d{9,15}$/.test(phone);
}

function validatePassword(password) {
  if (password.length < 8) return { ok: false, msg: 'كلمة المرور 8 أحرف على الأقل' };
  if (!/[A-Za-z]/.test(password)) return { ok: false, msg: 'يجب أن تحتوي على حرف' };
  if (!/[0-9]/.test(password)) return { ok: false, msg: 'يجب أن تحتوي على رقم' };
  return { ok: true };
}

function validateIBAN(iban) {
  return /^SD\d{16}$/.test(iban.replace(/\s/g, ''));
}

// ============ 5. توليد رموز آمنة ============
function generateSecureOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============ 6. Middleware الأمان ============
function securityMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));

  app.use(mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      console.warn(`⚠️  محاولة NoSQL Injection من ${req.ip}: ${key}`);
    }
  }));

  app.use(hpp());

  app.use(require('express').json({ limit: CONFIG.MAX_REQUEST_SIZE }));

  app.use((req, res, next) => {
    res.removeHeader('X-Powered-By');
    next();
  });
}

// ============ 7. Rate Limiters ============
const limiters = {
  general: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'عدد الطلبات كبير، حاول لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false
  }),

  login: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    message: { error: 'تجاوزت محاولات الدخول. انتظر 15 دقيقة' },
    standardHeaders: true
  }),

  register: rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'تجاوزت حد التسجيل. حاول بعد ساعة' }
  }),

  otp: rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { error: 'تجاوزت محاولات OTP. انتظر دقيقة' }
  }),

  transaction: rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: 'تجاوزت حد العمليات. حاول بعد ساعة' }
  })
};

// ============ 8. تسجيل الأحداث الأمنية ============
const securityLog = [];

function logSecurityEvent(type, data) {
  const event = {
    type,
    timestamp: new Date().toISOString(),
    ip: data.ip || 'unknown',
    userId: data.userId || null,
    details: data.details || {}
  };
  securityLog.push(event);
  if (securityLog.length > 1000) securityLog.shift();

  const emoji = {
    'LOGIN_SUCCESS': '✅',
    'LOGIN_FAILED': '❌',
    'REGISTER': '📝',
    'OTP_FAILED': '⚠️',
    'ACCOUNT_LOCKED': '🔒',
    'SUSPICIOUS': '🚨',
    'TRANSACTION': '💰'
  }[type] || '📋';

  console.log(`${emoji} [${event.timestamp}] ${type} | IP: ${event.ip} | User: ${event.userId}`);
}

// ============ 9. فحص محاولات الدخول ============
const loginAttempts = new Map();

function recordFailedAttempt(userId, ip) {
  const now = Date.now();
  const record = loginAttempts.get(userId) || { count: 0, lockedUntil: 0 };

  if (record.lockedUntil > now) {
    return { locked: true, remaining: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  record.count++;
  if (record.count >= CONFIG.MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = now + CONFIG.LOCKOUT_DURATION;
    loginAttempts.set(userId, record);
    logSecurityEvent('ACCOUNT_LOCKED', { userId, ip, details: { attempts: record.count } });
    return { locked: true, remaining: Math.ceil(CONFIG.LOCKOUT_DURATION / 1000) };
  }

  loginAttempts.set(userId, record);
  return { locked: false, remaining: CONFIG.MAX_LOGIN_ATTEMPTS - record.count };
}

function clearLoginAttempts(userId) {
  loginAttempts.delete(userId);
}

function isAccountLocked(userId) {
  const record = loginAttempts.get(userId);
  if (!record) return false;
  if (record.lockedUntil > Date.now()) return true;
  if (record.lockedUntil > 0 && record.lockedUntil <= Date.now()) {
    loginAttempts.delete(userId);
    return false;
  }
  return false;
}

// ============ 10. Middleware المصادقة JWT ============
function jwtAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const payload = verifyJWT(header.substring(7));
  if (!payload) {
    return res.status(401).json({ error: 'انتهت الجلسة' });
  }
  req.jwtPayload = payload;
  next();
}

// ============ 11. حماية Timing Attacks ============
function constantTimeDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  CONFIG,
  hashPassword,
  verifyPassword,
  generateJWT,
  verifyJWT,
  encrypt,
  decrypt,
  sanitizeInput,
  validatePhone,
  validatePassword,
  validateIBAN,
  generateSecureOTP,
  generateSecureToken,
  securityMiddleware,
  limiters,
  logSecurityEvent,
  recordFailedAttempt,
  clearLoginAttempts,
  isAccountLocked,
  jwtAuth,
  constantTimeDelay,
  securityLog
};
