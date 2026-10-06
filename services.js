// ============================================
// Medo app — جميع الخدمات الخارجية
// ============================================
const axios = require('axios');
const crypto = require('crypto');

// ============ EBS — البنوك السودانية ============
class EBSService {
  constructor() {
    this.baseURL = process.env.EBS_BASE_URL || 'https://sandbox.ebs-sudan.com/api';
    this.merchantId = process.env.EBS_MERCHANT_ID || 'MEDO_TEST';
    this.terminalId = process.env.EBS_TERMINAL_ID || 'TERM001';
    this.ipin = process.env.EBS_IPIN || 'TEST_IPIN';
  }

  async receiveViaIBAN(iban, amount, reference) {
    if (process.env.NODE_ENV !== 'production') {
      return { success: true, transactionId: 'EBS_' + Date.now(), mock: true };
    }
    try {
      const res = await axios.post(`${this.baseURL}/consumer/transfer`, {
        merchantId: this.merchantId, terminalId: this.terminalId, ipin: this.ipin,
        toAccount: iban, amount, reference, currency: 'SDG'
      });
      return { success: true, transactionId: res.data.transactionId };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async getBalance(iban) {
    if (process.env.NODE_ENV !== 'production') return { balance: 0, currency: 'SDG', mock: true };
    try {
      const res = await axios.post(`${this.baseURL}/consumer/balance`, {
        merchantId: this.merchantId, terminalId: this.terminalId, ipin: this.ipin, account: iban
      });
      return res.data;
    } catch (e) { return { balance: 0, error: e.message }; }
  }
}

// ============ إيصالي (E15) — الخدمات الحكومية ============
class E15Service {
  constructor() {
    this.baseURL = process.env.E15_BASE_URL || 'https://sandbox.e15.gov.sd/api';
    this.apiKey = process.env.E15_API_KEY || 'TEST_KEY';
  }

  async inquireBill(billNumber) {
    if (process.env.NODE_ENV !== 'production') {
      return { amount: 15000, serviceType: 'كهرباء', dueDate: '2026-11-01', payerName: 'محمد أحمد', mock: true };
    }
    try {
      const res = await axios.post(`${this.baseURL}/v1/inquiry`, { billNumber, apiKey: this.apiKey });
      return res.data;
    } catch (e) { return { error: e.message }; }
  }

  async payBill(billNumber, amount, payerPhone) {
    if (process.env.NODE_ENV !== 'production') {
      return { transactionId: 'E15_' + Date.now(), receiptNumber: 'RC' + Date.now(), status: 'success', mock: true };
    }
    try {
      const res = await axios.post(`${this.baseURL}/v1/payment`, {
        billNumber, amount, payerPhone, apiKey: this.apiKey
      });
      return res.data;
    } catch (e) { return { status: 'failed', error: e.message }; }
  }
}

// ============ Yallapay — الدفع الإلكتروني ============
class YallaPayService {
  constructor() {
    this.baseURL = 'https://gateway.yallapaysudan.com/api/v1/gateway';
    this.token = process.env.YALLAPAY_AUTH_TOKEN || '';
    this.secretKey = process.env.YALLAPAY_SECRET_KEY || '';
  }

  async createPaymentLink(amount, clientRef, description) {
    if (!this.token) {
      return `https://sandbox.yallapaysudan.com/pay?amount=${amount}&ref=${clientRef}`;
    }
    try {
      const res = await axios.post(`${this.baseURL}/generatePaymentLink`, {
        amount, clientReferenceId: clientRef, description,
        paymentSuccessfulRedirectUrl: `${process.env.APP_URL}/payment/success`,
        paymentFailedRedirectUrl: `${process.env.APP_URL}/payment/failed`,
        commissionPaidByCustomer: false
      }, { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } });
      return res.data.paymentUrl;
    } catch (e) { throw new Error('Yallapay: ' + e.message); }
  }

  verifyWebhook(signature, timestamp, rawBody) {
    const expected = crypto.createHmac('sha256', this.secretKey)
      .update(`${timestamp}.${rawBody}`).digest('hex');
    return signature === expected;
  }

  async checkPaymentStatus(clientRef, date) {
    try {
      const res = await axios.post(`${this.baseURL}/getPaymentStatus`,
        { clientReferenceId: clientRef, transactionDate: date },
        { headers: { Authorization: `Bearer ${this.token}` } });
      return res.data;
    } catch (e) { return { status: 'unknown' }; }
  }
}

// ============ Binance Pay — العملات الرقمية ============
class BinancePayService {
  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY || '';
    this.secretKey = process.env.BINANCE_SECRET_KEY || '';
    this.baseURL = 'https://bpay.binanceapi.com';
  }

  sign(payload) {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha512', this.secretKey)
      .update(`${timestamp}\n${nonce}\n${body}\n`).digest('hex').toUpperCase();
    return { timestamp, nonce, signature, body };
  }

  async createOrder(amount, currency, merchantTradeNo) {
    if (!this.apiKey) {
      return { checkoutUrl: `https://pay.binance.com/sandbox?amount=${amount}&currency=${currency}`, mock: true };
    }
    try {
      const payload = {
        env: { terminalType: 'WEB' },
        orderAmount: amount, currency,
        goods: { goodsType: '02', goodsCategory: 'Z000', referenceGoodsId: merchantTradeNo, goodsName: 'Medo top-up' }
      };
      const { timestamp, nonce, signature, body } = this.sign(payload);
      const res = await axios.post(`${this.baseURL}/binancepay/openapi/v3/order`, body, {
        headers: {
          'BinancePay-Timestamp': timestamp, 'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': this.apiKey, 'BinancePay-Signature': signature,
          'Content-Type': 'application/json'
        }
      });
      return res.data;
    } catch (e) { return { error: e.message }; }
  }

  async transferToPayId(payId, amount, currency) {
    if (!this.apiKey) return { success: true, mock: true, txId: 'BIN_' + Date.now() };
    try {
      const payload = {
        recipient: { type: 'PAY_ID', payId }, amount, currency, transferType: 'TO_PAY_ID'
      };
      const { timestamp, nonce, signature, body } = this.sign(payload);
      const res = await axios.post(`${this.baseURL}/binancepay/openapi/wallet/transfer`, body, {
        headers: {
          'BinancePay-Timestamp': timestamp, 'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': this.apiKey, 'BinancePay-Signature': signature,
          'Content-Type': 'application/json'
        }
      });
      return res.data;
    } catch (e) { return { error: e.message }; }
  }
}

// ============ Wallester — بطاقات Visa/Mastercard ============
class WallesterService {
  constructor() {
    this.baseURL = process.env.WALLESTER_BASE_URL || 'https://api.wallester.com/api/v1';
    this.apiKey = process.env.WALLESTER_API_KEY || '';
  }

  async issueCard(userId, scheme = 'visa', currency = 'EUR') {
    if (!this.apiKey) {
      const prefix = scheme === 'mastercard' ? '5321' : '4532';
      const pan = prefix + Math.floor(100000000000 + Math.random() * 900000000000).toString();
      const cvv = Math.floor(100 + Math.random() * 900).toString();
      const month = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
      const year = String(new Date().getFullYear() + 3).slice(-2);
      return { id: Date.now(), pan, cvv, expiry: `${month}/${year}`, scheme: scheme.toUpperCase(), mock: true };
    }
    try {
      const res = await axios.post(`${this.baseURL}/cards`, {
        type: 'virtual', scheme, currency, limit: 5000, user_id: userId
      }, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return res.data;
    } catch (e) { throw new Error('Wallester: ' + e.message); }
  }

  async freezeCard(cardId) {
    if (!this.apiKey) return { status: 'frozen', mock: true };
    try {
      await axios.patch(`${this.baseURL}/cards/${cardId}`, { status: 'frozen' },
        { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return { status: 'frozen' };
    } catch (e) { return { error: e.message }; }
  }

  async getCardDetails(cardId) {
    if (!this.apiKey) return { mock: true };
    try {
      const res = await axios.get(`${this.baseURL}/cards/${cardId}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return res.data;
    } catch (e) { return { error: e.message }; }
  }
}

// ============ Cashy Mobile — التحويل ============
class CashyService {
  constructor() {
    this.baseURL = process.env.CASHY_BASE_URL || 'https://api.cashy.sd/v1';
    this.merchantId = process.env.CASHY_MERCHANT_ID || 'MEDO';
    this.secretKey = process.env.CASHY_SECRET_KEY || 'test';
  }

  sign(payload) {
    return crypto.createHmac('sha256', this.secretKey)
      .update(JSON.stringify(payload)).digest('hex');
  }

  async transfer(phone, amount, reference, type = 'CASHY') {
    if (!process.env.CASHY_MERCHANT_ID) {
      return { success: true, txId: 'CASHY_' + Date.now(), reference, mock: true };
    }
    try {
      const payload = { merchantId: this.merchantId, phone, amount, currency: 'SDG', reference, type };
      const signature = this.sign(payload);
      const res = await axios.post(`${this.baseURL}/transfer`, payload, {
        headers: { 'X-Merchant-Id': this.merchantId, 'X-Signature': signature }
      });
      return res.data;
    } catch (e) { return { success: false, error: e.message }; }
  }

  async transferToMyCashi(phone, amount, reference) {
    return this.transfer(phone, amount, reference, 'MYCASHI');
  }

  async transferToCashyLite(phone, amount, reference) {
    return this.transfer(phone, amount, reference, 'CASHY_LITE');
  }
}

// ============ Paymob — المحافظ المصرية ============
class PaymobService {
  constructor() {
    this.apiKey = process.env.PAYMOB_API_KEY || '';
    this.integrationId = process.env.PAYMOB_WALLET_INTEGRATION_ID || '';
    this.baseURL = 'https://accept.paymob.com/api';
  }

  async getAuthToken() {
    const res = await axios.post(`${this.baseURL}/auth/tokens`, { api_key: this.apiKey });
    return res.data.token;
  }

  async payoutToWallet(walletType, phone, amount, reference) {
    if (!this.apiKey) {
      return { success: true, txId: 'PAYMOB_' + Date.now(), wallet: walletType, mock: true };
    }
    try {
      const authToken = await this.getAuthToken();
      const res = await axios.post(`${this.baseURL}/disburse`, {
        auth_token: authToken, amount_cents: amount * 100, currency: 'EGP',
        wallet_type: walletType, phone_number: phone, merchant_reference: reference
      });
      return res.data;
    } catch (e) { return { success: false, error: e.message }; }
  }
}

// ============ أسعار العملات والذهب والفضة ============
class RatesService {
  constructor() {
    this.cache = {};
    this.cacheDuration = 5 * 60 * 1000;
  }

  async getFiatRates(base = 'USD') {
    const key = 'fiat_' + base;
    if (this.cache[key] && Date.now() - this.cache[key].ts < this.cacheDuration) {
      return this.cache[key].data;
    }
    try {
      const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/${base}`);
      this.cache[key] = { data: res.data.rates, ts: Date.now() };
      return res.data.rates;
    } catch (e) {
      return { SDG: 2400, EGP: 48, SAR: 3.75, AED: 3.67, EUR: 0.92, GBP: 0.79 };
    }
  }

  async getCryptoRates() {
    if (this.cache.crypto && Date.now() - this.cache.crypto.ts < this.cacheDuration) {
      return this.cache.crypto.data;
    }
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin,ethereum,tether,binancecoin,ripple,solana,cardano,dogecoin',
          vs_currencies: 'usd,sdg,egp', include_24hr_change: true
        },
        timeout: 5000
      });
      this.cache.crypto = { data: res.data, ts: Date.now() };
      return res.data;
    } catch (e) {
      return {
        bitcoin: { usd: 67000, sdg: 160800000, usd_24h_change: 1.2 },
        ethereum: { usd: 3200, sdg: 7680000, usd_24h_change: -0.5 },
        tether: { usd: 1.0, sdg: 2400, usd_24h_change: 0.01 },
        binancecoin: { usd: 580, sdg: 1392000, usd_24h_change: 2.1 }
      };
    }
  }

  async getSudanDollarRate() {
    return { buy: 2350, sell: 2420, official: 601, parallel: 2420, updated: new Date().toISOString() };
  }

  async getGoldSilverRates() {
    let goldUSD = 2650, silverUSD = 31;
    try {
      const [g, s] = await Promise.all([
        axios.get('https://api.metals.live/v1/spot/gold', { timeout: 3000 }),
        axios.get('https://api.metals.live/v1/spot/silver', { timeout: 3000 })
      ]);
      goldUSD = g.data[0]?.price || 2650;
      silverUSD = s.data[0]?.price || 31;
    } catch (e) {}
    const rate = 2420;
    return {
      gold: {
        perGram24k: goldUSD * rate / 31.1035,
        perGram21k: (goldUSD * rate / 31.1035) * (21/24),
        perGram18k: (goldUSD * rate / 31.1035) * (18/24),
        perOunce: goldUSD * rate
      },
      silver: {
        perGram: silverUSD * rate / 31.1035,
        perOunce: silverUSD * rate
      },
      updated: new Date().toISOString()
    };
  }

  async getAllRates() {
    const [fiat, crypto, goldSilver, sudanDollar] = await Promise.all([
      this.getFiatRates(), this.getCryptoRates(),
      this.getGoldSilverRates(), this.getSudanDollarRate()
    ]);
    return { fiat, crypto, goldSilver, sudanDollar, timestamp: new Date().toISOString() };
  }
}

// ============ الاشتراكات والبطاقات الرقمية ============
class SubscriptionService {
  async buyGameCard(provider, amount, region = 'US') {
    const providers = {
      playstation: { name: 'PlayStation', currency: 'USD' },
      xbox: { name: 'Xbox', currency: 'USD' },
      steam: { name: 'Steam', currency: 'USD' },
      google: { name: 'Google Play', currency: 'USD' },
      itunes: { name: 'iTunes', currency: 'USD' },
      bigo: { name: 'Bigo Live', currency: 'USD' },
      tiktok: { name: 'TikTok Coins', currency: 'USD' },
      netflix: { name: 'Netflix', currency: 'USD' },
      spotify: { name: 'Spotify', currency: 'USD' }
    };
    const p = providers[provider];
    if (!p) throw new Error('مزود غير مدعوم');
    return {
      code: crypto.randomBytes(8).toString('hex').toUpperCase(),
      provider: p.name, amount, currency: p.currency, region,
      status: 'success', mock: true
    };
  }

  async activateCanva(email, plan = 'pro') {
    return { success: true, email, plan, activatedAt: new Date().toISOString(), mock: true };
  }

  async activateMicrosoft(email, plan = 'personal') {
    return { success: true, email, plan, activatedAt: new Date().toISOString(), mock: true };
  }

  async activateAdobe(email, plan = 'creative-cloud') {
    return { success: true, email, plan, activatedAt: new Date().toISOString(), mock: true };
  }

  async receiveTikTokEarnings(userId) {
    return { earnings: 125.50, currency: 'USD', pending: 45.00, mock: true };
  }

  async receiveFacebookEarnings(accountId) {
    return { earnings: 320.75, currency: 'USD', pending: 120.00, mock: true };
  }
}

// ============ مصدّر الكل ============
module.exports = {
  EBS: new EBSService(),
  E15: new E15Service(),
  YallaPay: new YallaPayService(),
  BinancePay: new BinancePayService(),
  Wallester: new WallesterService(),
  Cashy: new CashyService(),
  Paymob: new PaymobService(),
  Rates: new RatesService(),
  Subscription: new SubscriptionService()
}; 