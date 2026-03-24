# TemplateKu × DOKU Payment Gateway 🚀

Landing page premium UMKM dengan integrasi **DOKU Payment Gateway** — order langsung bayar via QRIS, GoPay, OVO, VA Bank, ShopeePay, kartu kredit. Siap deploy ke **Vercel** dalam menit.

---

## 📁 Struktur Project

```
templateku/
├── server.js          ← Backend Node.js (Express + DOKU API)
├── package.json
├── vercel.json        ← Konfigurasi deploy Vercel
├── .env.example       ← Template environment variables
├── public/
│   ├── index.html     ← Landing page (modal order → DOKU)
│   └── success.html   ← Halaman setelah bayar
└── README.md
```

---

## ⚡ Quick Start (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Setup environment variables
```bash
cp .env.example .env
# Edit .env dan isi DOKU_CLIENT_ID dan DOKU_SECRET_KEY
```

### 3. Dapatkan DOKU API Credentials
1. Daftar di [dashboard.doku.com](https://dashboard.doku.com)
2. Buat akun merchant
3. Masuk ke **Settings → API Keys**
4. Salin **Client ID** dan **Secret Key**
5. Untuk testing, gunakan akun **Sandbox** terlebih dahulu

### 4. Jalankan server
```bash
npm run dev    # development (auto-restart)
# atau
npm start      # production
```

Buka: http://localhost:3000

---

## 🚀 Deploy ke Vercel

### Cara 1: GitHub → Vercel (Recommended)

```bash
# 1. Push ke GitHub
git init
git add .
git commit -m "feat: DOKU payment gateway integration"
git remote add origin https://github.com/USERNAME/templateku.git
git push -u origin main

# 2. Import di Vercel:
#    vercel.com → New Project → Import dari GitHub
#    Set environment variables di Settings → Environment Variables
```

### Cara 2: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel

# Set env vars di Vercel:
vercel env add DOKU_CLIENT_ID
vercel env add DOKU_SECRET_KEY
vercel env add DOKU_ENV         # "sandbox" atau "production"
vercel env add APP_URL          # https://nama-project.vercel.app
```

### Environment Variables yang Wajib di Vercel:

| Variable | Contoh | Keterangan |
|----------|--------|------------|
| `DOKU_CLIENT_ID` | `BRN-0123-...` | Dari DOKU Dashboard |
| `DOKU_SECRET_KEY` | `SK-...` | Dari DOKU Dashboard |
| `DOKU_ENV` | `sandbox` / `production` | Mode DOKU |
| `APP_URL` | `https://templateku.vercel.app` | URL deployment (tanpa slash) |

---

## 📋 API Endpoints

### `POST /api/create-payment`
Buat payment link DOKU.

**Request body:**
```json
{
  "product": "fnb",         // "fnb" | "distributor" | "bundle"
  "name": "Budi Santoso",
  "email": "budi@email.com",
  "phone": "08123456789"    // opsional
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "TK-1710000000-ABC123",
  "paymentUrl": "https://checkout.doku.com/...",
  "productName": "Website UMKM F&B",
  "amount": 999000
}
```

### `POST /api/webhook`
DOKU memanggil endpoint ini setelah pembayaran berhasil/gagal.  
**⚠️ Wajib daftarkan URL ini di DOKU Dashboard → Settings → Notification URL:**
```
https://nama-project.vercel.app/api/webhook
```

### `GET /api/payment-status?order_id=TK-xxx`
Cek status order.

### `GET /api/orders`
List semua orders (untuk admin — protect dengan auth di production!).

---

## 💳 Produk & Harga

| Product Key | Nama | Harga |
|-------------|------|-------|
| `fnb` | Website UMKM F&B | Rp 999.000 |
| `distributor` | Website Distributor Snack | Rp 999.000 |
| `bundle` | Bundle 2 Website | Rp 1.499.000 |

> Untuk mengubah harga, edit object `PRODUCTS` di `server.js`.

---

## 🔄 Alur Pembayaran

```
User klik "Pesan Sekarang"
        ↓
Modal: isi nama & email
        ↓
POST /api/create-payment
        ↓
Backend call DOKU API (server-side, aman)
        ↓
Redirect ke DOKU Checkout
        ↓
User pilih metode bayar & bayar
        ↓
DOKU POST ke /api/webhook
        ↓
Order status = SUCCESS
        ↓
User redirect ke /success.html
```

---

## 🗄️ Database (Production)

Saat ini orders disimpan di **memory** (hilang saat server restart).

Untuk production, ganti dengan database:

### Opsi 1: Vercel Postgres (mudah)
```bash
vercel postgres create templateku-db
```

### Opsi 2: PlanetScale / Supabase / MongoDB Atlas
Tambahkan `DATABASE_URL` ke environment variables dan update `server.js`.

---

## 🔒 Keamanan

- API Key DOKU **tidak pernah** dikirim ke browser — semua di server-side
- Signature HMAC-SHA256 divalidasi di setiap request ke DOKU
- Untuk production: tambahkan validasi signature webhook dari DOKU
- Lindungi endpoint `/api/orders` dengan authentication

---

## 🧪 Testing di Sandbox

DOKU menyediakan sandbox untuk testing tanpa transaksi nyata.

1. Set `DOKU_ENV=sandbox` di `.env`
2. Gunakan credentials sandbox dari DOKU Dashboard
3. Gunakan kartu test / akun sandbox DOKU

---

## 📞 Troubleshooting

**Error: "DOKU credentials belum dikonfigurasi"**
→ Set `DOKU_CLIENT_ID` dan `DOKU_SECRET_KEY` di `.env` atau Vercel env vars.

**Error: "Gagal mendapatkan payment URL"**  
→ Pastikan Client ID dan Secret Key benar. Cek format di DOKU Dashboard.

**Webhook tidak masuk**  
→ Pastikan URL webhook sudah didaftarkan di DOKU Dashboard dan accessible dari internet (bukan localhost).

**Order status tetap PENDING**  
→ Webhook belum terkonfigurasi. Untuk dev lokal, gunakan [ngrok](https://ngrok.com) untuk expose localhost.

---

Built with ❤️ untuk UMKM Indonesia
