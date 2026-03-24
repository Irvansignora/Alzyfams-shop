/**
 * ══════════════════════════════════════════════════════════
 * TEMPLATEKU — Node.js Backend with DOKU Payment Gateway
 * ══════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   POST /api/create-payment   → Buat payment link via DOKU API
 *   POST /api/webhook          → Terima notifikasi dari DOKU
 *   GET  /api/payment-status   → Cek status order
 *   GET  /api/orders           → List semua orders (admin)
 * 
 * Deploy: Vercel (vercel.json sudah dikonfigurasi)
 * Local:  node server.js  atau  npm run dev
 * ══════════════════════════════════════════════════════════
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// ─── In-memory store (ganti dengan database di production) ───
const orders = {};

// ─── DOKU Config ─────────────────────────────────────────────
const DOKU_ENV = process.env.DOKU_ENV || "sandbox";
const DOKU_BASE_URL =
  DOKU_ENV === "production"
    ? "https://api.doku.com"
    : "https://api-sandbox.doku.com";

const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID || "";
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY || "";
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

// ─── Product Catalog ─────────────────────────────────────────
const PRODUCTS = {
  fnb: {
    name: "Website UMKM F&B",
    description: "Template website premium coffee shop / restoran + free setup & deploy",
    amount: 999000, // dalam rupiah (DOKU pakai satuan rupiah)
  },
  distributor: {
    name: "Website Distributor Snack",
    description: "Sistem distribusi 3-in-1: Admin, Salesman, Supplier + free setup",
    amount: 999000,
  },
  bundle: {
    name: "Bundle 2 Website (F&B + Distributor)",
    description: "Kedua template + free setup, domain gratis 1 tahun, support 60 hari",
    amount: 1499000,
  },
};

// ─────────────────────────────────────────────────────────────
// HELPER: Generate DOKU Signature
// Ref: https://developers.doku.com/accept-payment/general-information/signature
// ─────────────────────────────────────────────────────────────
function generateSignature({ clientId, requestId, requestTimestamp, requestTarget, digestValue, secret }) {
  const components = [];
  components.push(`Client-Id:${clientId}`);
  components.push(`Request-Id:${requestId}`);
  components.push(`Request-Timestamp:${requestTimestamp}`);
  components.push(`Request-Target:${requestTarget}`);
  if (digestValue) {
    components.push(`Digest:${digestValue}`);
  }
  const componentString = components.join("\n");
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(componentString);
  const signature = hmac.digest("base64");
  return `HMACSHA256=${signature}`;
}

// ─────────────────────────────────────────────────────────────
// HELPER: Digest for request body
// ─────────────────────────────────────────────────────────────
function generateDigest(body) {
  const hash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("base64");
  return `SHA-256=${hash}`;
}

// ─────────────────────────────────────────────────────────────
// POST /api/create-payment
// Body: { product: "fnb"|"distributor"|"bundle", name, email, phone }
// ─────────────────────────────────────────────────────────────
app.post("/api/create-payment", async (req, res) => {
  const { product, name, email, phone } = req.body;

  // Validation
  if (!product || !name || !email) {
    return res.status(400).json({
      success: false,
      message: "Field product, name, dan email wajib diisi.",
    });
  }

  const productInfo = PRODUCTS[product];
  if (!productInfo) {
    return res.status(400).json({ success: false, message: "Produk tidak valid." });
  }

  if (!DOKU_CLIENT_ID || !DOKU_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "DOKU credentials belum dikonfigurasi. Set DOKU_CLIENT_ID dan DOKU_SECRET_KEY di environment variables.",
    });
  }

  // Generate unique order ID
  const orderId = `TK-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().split(".")[0] + "Z";
  const requestTarget = "/checkout/v1/payment";

  // DOKU Payment request body
  const paymentBody = {
    order: {
      invoice_number: orderId,
      line_items: [
        {
          name: productInfo.name,
          price: productInfo.amount,
          quantity: 1,
        },
      ],
      amount: productInfo.amount,
      currency: "IDR",
      callback_url: `${APP_URL}/success.html?order_id=${orderId}`,
      callback_url_cancel: `${APP_URL}/?order_id=${orderId}&status=cancelled`,
    },
    customer: {
      name: name,
      email: email,
      phone: phone || "",
    },
    payment: {
      payment_due_date: 60, // menit
    },
  };

  // Generate digest & signature
  const digestValue = generateDigest(paymentBody);
  const signature = generateSignature({
    clientId: DOKU_CLIENT_ID,
    requestId,
    requestTimestamp,
    requestTarget,
    digestValue,
    secret: DOKU_SECRET_KEY,
  });

  try {
    const response = await axios.post(
      `${DOKU_BASE_URL}${requestTarget}`,
      paymentBody,
      {
        headers: {
          "Content-Type": "application/json",
          "Client-Id": DOKU_CLIENT_ID,
          "Request-Id": requestId,
          "Request-Timestamp": requestTimestamp,
          Digest: digestValue,
          Signature: signature,
        },
      }
    );

    const dokuData = response.data;
    const paymentUrl = dokuData?.response?.payment?.url || dokuData?.payment?.url;

    if (!paymentUrl) {
      console.error("DOKU response tidak mengandung payment URL:", dokuData);
      return res.status(502).json({
        success: false,
        message: "Gagal mendapatkan payment URL dari DOKU.",
        detail: dokuData,
      });
    }

    // Simpan order ke store
    orders[orderId] = {
      orderId,
      product,
      productName: productInfo.name,
      amount: productInfo.amount,
      name,
      email,
      phone: phone || "",
      status: "PENDING",
      createdAt: new Date().toISOString(),
      paymentUrl,
    };

    console.log(`✅ Order created: ${orderId} | ${productInfo.name} | ${name} <${email}>`);

    return res.json({
      success: true,
      orderId,
      paymentUrl,
      productName: productInfo.name,
      amount: productInfo.amount,
    });
  } catch (error) {
    const errData = error?.response?.data;
    console.error("DOKU API error:", errData || error.message);
    return res.status(502).json({
      success: false,
      message: "Gagal menghubungi DOKU API.",
      detail: errData || error.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/webhook
// DOKU akan POST ke sini setelah payment berhasil/gagal
// Wajib whitelist URL ini di DOKU Dashboard → Settings → Notification URL
// ─────────────────────────────────────────────────────────────
app.post("/api/webhook", (req, res) => {
  try {
    const notification = req.body;
    const invoiceNumber = notification?.order?.invoice_number;
    const transactionStatus = notification?.transaction?.status;

    console.log(`📩 Webhook received: ${invoiceNumber} → ${transactionStatus}`);

    if (invoiceNumber && orders[invoiceNumber]) {
      orders[invoiceNumber].status = transactionStatus;
      orders[invoiceNumber].updatedAt = new Date().toISOString();
      orders[invoiceNumber].transactionId = notification?.transaction?.id || "";
      console.log(`✅ Order ${invoiceNumber} updated to: ${transactionStatus}`);
    }

    // DOKU mengharapkan response 200 dengan body spesifik
    return res.status(200).json({ status: "OK" });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ status: "OK" }); // tetap 200 agar DOKU tidak retry terus
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/payment-status?order_id=TK-xxx
// ─────────────────────────────────────────────────────────────
app.get("/api/payment-status", (req, res) => {
  const { order_id } = req.query;
  if (!order_id || !orders[order_id]) {
    return res.status(404).json({ success: false, message: "Order tidak ditemukan." });
  }
  const order = orders[order_id];
  return res.json({
    success: true,
    orderId: order.orderId,
    status: order.status,
    productName: order.productName,
    amount: order.amount,
    name: order.name,
    email: order.email,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/orders  (simple admin view, protect in production!)
// ─────────────────────────────────────────────────────────────
app.get("/api/orders", (req, res) => {
  const list = Object.values(orders).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ success: true, count: list.length, orders: list });
});

// ─────────────────────────────────────────────────────────────
// Fallback: serve index.html for any unknown route
// ─────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 TemplateKu server running on port ${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   DOKU:    ${DOKU_ENV.toUpperCase()} mode (${DOKU_BASE_URL})`);
  console.log(`   Webhook: ${APP_URL}/api/webhook\n`);
});

module.exports = app;
