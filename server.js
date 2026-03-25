/**
 * ══════════════════════════════════════════════════════════
 * IANZYA Hub — Node.js Backend with Midtrans Payment Gateway
 * ══════════════════════════════════════════════════════════
 *
 * Endpoints:
 *   POST /api/create-payment   → Buat Snap transaction token via Midtrans
 *   POST /api/webhook          → Terima notifikasi dari Midtrans
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

// ─── Midtrans Config ──────────────────────────────────────────
// Daftar di https://dashboard.midtrans.com → ambil Server Key & Client Key
// Sandbox  : isProduction = false  → https://app.sandbox.midtrans.com/snap/snap.js
// Production: isProduction = true  → https://app.midtrans.com/snap/snap.js
const MIDTRANS_IS_PRODUCTION = (process.env.MIDTRANS_ENV || "sandbox") === "production";
const MIDTRANS_SERVER_KEY    = process.env.MIDTRANS_SERVER_KEY || "";   // wajib
const MIDTRANS_CLIENT_KEY    = process.env.MIDTRANS_CLIENT_KEY || "";   // dipakai di frontend
const MIDTRANS_BASE_URL      = MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

// ─── Fonnte WA Notification ───────────────────────────────────
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const OWNER_WA     = process.env.OWNER_WA || "";

async function sendWANotif(message) {
  if (!FONNTE_TOKEN || !OWNER_WA) return;
  try {
    await axios.post(
      "https://api.fonnte.com/send",
      { target: OWNER_WA, message },
      { headers: { Authorization: FONNTE_TOKEN } }
    );
    console.log("📲 WA notif terkirim ke", OWNER_WA);
  } catch (err) {
    console.error("WA notif gagal:", err?.response?.data || err.message);
  }
}

// ─── Product Catalog ──────────────────────────────────────────
const PRODUCTS = {
  fnb: {
    name: "Website UMKM F&B",
    description: "Template website premium coffee shop / restoran + free setup & deploy",
    amount: 999000,
    category: "template",
  },
  distributor: {
    name: "Website Distributor",
    description: "Sistem distribusi 3-in-1: Admin, Salesman, Supplier",
    amount: 999000,
    category: "template",
  },
  bundle_template: {
    name: "Bundle 2 Website (F&B + Distributor)",
    description: "Kedua template + free setup, domain gratis 1 tahun, support 60 hari",
    amount: 1499000,
    category: "bundle",
  },
  pos_basic: {
    name: "Kasir POS Offline — Basic",
    description: "Aplikasi kasir offline untuk toko/warung. Transaksi, stok, laporan harian.",
    amount: 499000,
    category: "pos",
  },
  pos_pro: {
    name: "Kasir POS Offline — Pro",
    description: "POS multi-kasir, multi-outlet, loyalty points, laporan laba/rugi + free setup.",
    amount: 999000,
    category: "pos",
  },
  // kasir: harga dinamis Rp 50.000/user — amount dikirim dari frontend
  kasir: {
    name: "Kasir POS Offline",
    description: "Sistem kasir offline. Rp 50.000/user, bayar sekali.",
    pricePerUser: 50000,
    category: "pos",
  },
};

// ─────────────────────────────────────────────────────────────
// HELPER: Verifikasi Midtrans Notification Signature
// SHA512(order_id + status_code + gross_amount + server_key)
// ─────────────────────────────────────────────────────────────
function verifyMidtransSignature({ orderId, statusCode, grossAmount, serverKey }) {
  const raw = orderId + statusCode + grossAmount + serverKey;
  return crypto.createHash("sha512").update(raw).digest("hex");
}


// ─────────────────────────────────────────────────────────────
// GET /api/config — expose public config ke frontend (client key, env)
// ─────────────────────────────────────────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    clientKey: MIDTRANS_CLIENT_KEY,
    isProduction: MIDTRANS_IS_PRODUCTION,
    snapUrl: MIDTRANS_IS_PRODUCTION
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/create-payment
// Body: { product, name, email, phone }
// Response: { success, orderId, snapToken, clientKey, redirectUrl, productName, amount }
// ─────────────────────────────────────────────────────────────
app.post("/api/create-payment", async (req, res) => {
  const { product, name, email, phone } = req.body;

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

  // Kasir: harga dinamis Rp 50.000/user
  let finalAmount = productInfo.amount;
  let finalName   = productInfo.name;
  if (product === "kasir") {
    const users = parseInt(req.body.users) || 1;
    if (users < 1 || users > 100) {
      return res.status(400).json({ success: false, message: "Jumlah user tidak valid (1–100)." });
    }
    finalAmount = productInfo.pricePerUser * users;
    finalName   = `Kasir POS Offline — ${users} User`;
  }

  if (!MIDTRANS_SERVER_KEY) {
    return res.status(500).json({
      success: false,
      message: "Midtrans Server Key belum dikonfigurasi. Set MIDTRANS_SERVER_KEY di environment variables.",
    });
  }

  const orderId = `IZ-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  const snapBody = {
    transaction_details: {
      order_id: orderId,
      gross_amount: finalAmount,
    },
    item_details: [
      {
        id: product,
        price: finalAmount,
        quantity: 1,
        name: finalName,
        category: productInfo.category,
        merchant_name: "IANZYA Hub",
      },
    ],
    customer_details: {
      first_name: name,
      email: email,
      phone: phone || "",
    },
    callbacks: {
      finish:  `${APP_URL}/success.html?order_id=${orderId}`,
      error:   `${APP_URL}/?order_id=${orderId}&status=error`,
      pending: `${APP_URL}/success.html?order_id=${orderId}`,
    },
  };

  const authHeader = "Basic " + Buffer.from(MIDTRANS_SERVER_KEY + ":").toString("base64");

  try {
    const response = await axios.post(MIDTRANS_BASE_URL, snapBody, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader,
      },
    });

    const { token: snapToken, redirect_url } = response.data;

    if (!snapToken) {
      console.error("Midtrans response tidak mengandung snap token:", response.data);
      return res.status(502).json({
        success: false,
        message: "Gagal mendapatkan Snap token dari Midtrans.",
        detail: response.data,
      });
    }

    orders[orderId] = {
      orderId,
      product,
      productName: finalName,
      amount: finalAmount,
      name,
      email,
      phone: phone || "",
      status: "PENDING",
      createdAt: new Date().toISOString(),
      snapToken,
      redirectUrl: redirect_url,
    };

    console.log(`✅ Order created: ${orderId} | ${finalName} | ${name} <${email}>`);

    return res.json({
      success: true,
      orderId,
      snapToken,
      clientKey: MIDTRANS_CLIENT_KEY,
      redirectUrl: redirect_url,
      productName: finalName,
      amount: finalAmount,
    });
  } catch (error) {
    const errData = error?.response?.data;
    console.error("Midtrans API error:", errData || error.message);
    return res.status(502).json({
      success: false,
      message: "Gagal menghubungi Midtrans API.",
      detail: errData || error.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/webhook
// Midtrans akan POST ke sini setelah payment berhasil/gagal/pending
// Wajib set di: Midtrans Dashboard → Settings → Payment → Notification URL
// ─────────────────────────────────────────────────────────────
app.post("/api/webhook", async (req, res) => {
  try {
    const notification = req.body;
    const {
      order_id: invoiceNumber,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
    } = notification;

    console.log(`📩 Webhook received: ${invoiceNumber} → ${transactionStatus} (fraud: ${fraudStatus})`);

    // ── Verifikasi signature Midtrans ──────────────────────
    if (MIDTRANS_SERVER_KEY && signatureKey) {
      const expectedSig = verifyMidtransSignature({
        orderId: invoiceNumber,
        statusCode,
        grossAmount,
        serverKey: MIDTRANS_SERVER_KEY,
      });
      if (expectedSig !== signatureKey) {
        console.warn(`⚠️  Invalid signature for order ${invoiceNumber}. Abaikan.`);
        return res.status(200).json({ status: "INVALID_SIGNATURE" });
      }
    }

    // ── Map status Midtrans → status internal ─────────────
    let internalStatus = "PENDING";
    if (transactionStatus === "capture") {
      internalStatus = fraudStatus === "accept" ? "SUCCESS" : "FAILED";
    } else if (transactionStatus === "settlement") {
      internalStatus = "SUCCESS";
    } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
      internalStatus = "FAILED";
    } else if (transactionStatus === "pending") {
      internalStatus = "PENDING";
    }

    if (invoiceNumber && orders[invoiceNumber]) {
      orders[invoiceNumber].status = internalStatus;
      orders[invoiceNumber].updatedAt = new Date().toISOString();
      orders[invoiceNumber].transactionStatus = transactionStatus;
      orders[invoiceNumber].fraudStatus = fraudStatus || "";
      console.log(`✅ Order ${invoiceNumber} updated to: ${internalStatus} (midtrans: ${transactionStatus})`);

      const order = orders[invoiceNumber];
      const amountFmt = `Rp ${parseInt(order.amount).toLocaleString("id-ID")}`;
      const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

      if (internalStatus === "SUCCESS") {
        const msg =
          `🔔 *ORDER MASUK — IANZYA HUB*\n\n` +
          `✅ *Pembayaran Berhasil!*\n\n` +
          `📦 Produk : ${order.productName}\n` +
          `💰 Total   : ${amountFmt}\n` +
          `👤 Nama    : ${order.name}\n` +
          `📧 Email   : ${order.email}\n` +
          `📱 WA      : ${order.phone || "-"}\n` +
          `🆔 Order ID: ${invoiceNumber}\n` +
          `🕐 Waktu   : ${waktu}\n\n` +
          `Segera proses setup website customer! 🚀`;
        await sendWANotif(msg);
      }

      if (internalStatus === "FAILED") {
        const msg =
          `⚠️ *ORDER GAGAL — IANZYA HUB*\n\n` +
          `Status : ${transactionStatus}\n` +
          `Produk : ${order.productName}\n` +
          `Nama   : ${order.name}\n` +
          `Email  : ${order.email}\n` +
          `Order  : ${invoiceNumber}\n` +
          `Waktu  : ${waktu}`;
        await sendWANotif(msg);
      }
    }

    return res.status(200).json({ status: "OK" });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ status: "OK" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/payment-status?order_id=AZ-xxx
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
  console.log(`\n🚀 IANZYA Hub server running on port ${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Midtrans: ${MIDTRANS_IS_PRODUCTION ? "PRODUCTION" : "SANDBOX"} mode`);
  console.log(`   Webhook: ${APP_URL}/api/webhook\n`);
});

module.exports = app;
