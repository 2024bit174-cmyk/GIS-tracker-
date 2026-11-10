# Madrasah Commodities Portal

A Flask web application for managing commodities and reservations, with PIN-protected payments.

## Features

- **Commodity management**: Add, view, and categorize commodities as "Golden Card" or "Premium Card"
- **Image/Video upload**: Secure file uploads for commodity visuals
- **Client reservations**: Clients can reserve commodities by entering a PIN
- **Admin panel**: Password-protected administration panel
- **System settings**: Edit admin phone and bank account details anytime
- **PIN-protected payments**: Clients enter a PIN to confirm reservations

## Architecture

- **Framework**: Flask (Python) - zero cost, easy to deploy
- **Database**: SQLite (file-based, no server required)
- **File uploads**: Secure, validated uploads to `static/uploads/`
- **Deployment**: Ready for VPS/DigitalOcean (UGX 40K-100K/mo) or local development

## Quick Start

```bash
# 1. Install dependencies
pip install flask werkzeug

# 2. Run the application
python app.py

# 3. Open your browser at http://127.0.0.1:5000

# 4. Login as admin
#    Username: admin
#    Password: admin123
```

## Default Login

- **Username**: `admin`
- **Password**: `admin123`

**Change these immediately** by setting environment variables:
```bash
export ADMIN_USERNAME=myadmin
export ADMIN_PASSWORD=mysecret
```

## How It Works

### Admin Panel
1. Login with admin credentials
2. Add commodities (name, description, category: golden/premium, price, optional image/video)
3. View pending reservations
4. Confirm reservations (changes status from `pending` to `confirmed`)
5. Edit admin phone and bank account details - changes take effect immediately

### Client Flow
1. Browse commodities on the home page
2. Click "Reserve Now" on any commodity
3. Enter name, phone, and the PIN (`1234` by default)
4. PIN is verified - reservation created with status `pending`
5. Admin can confirm the reservation, changing status to `confirmed`

### Payment PIN
- Default PIN: `1234`
- Change `PIN_CODE` in `app.py` or set `PIN_CODE` environment variable
- Clients must enter this exact PIN to complete a reservation

## Cost Estimates (to go live)

| Item | Cost (UGX) |
|------|-----------|
| VPS hosting (DigitalOcean/AWS/Raxion/Truehost) | 40,000 - 100,000 / month |
| Domain name (.ug or .com) | 50,000 - 90,000 / year |
| Payment gateway setup (Yo! Payments/PegPay) | 0 - 200,000 (one-time) |
| Transaction fees | 2% - 3% per transaction |
| **Total DIY out-of-pocket** | **100,000 - 400,000** |

**The core system (this code) costs zero to run** until you're ready to integrate a payment gateway.

## Deployment

### Option A: Local Development (free)
```bash
python app.py
# Share http://your-ip:5000 on your LAN
```

### Option B: VPS (recommended)
1. Spin a VPS (Ubuntu 22.04)
2. Install: `pip install flask`
3. `git clone` this repository
4. Set up nginx as reverse proxy on port 80
5. Set up Let's Encrypt SSL (free)
6. Point your domain (.ug/.com) to the VPS IP

### Option C: PaaS (simpler)
- PythonAnywhere (free tier, then paid)
- Render.com (free tier supports Flask)

## Security Notes

- **Never commit real `.env` files** - already listed in `.gitignore`
- Admin credentials are stored in plaintext in the code - change them immediately
- PIN is hardcoded - change `PIN_CODE` in `app.py` for production
- File uploads are validated (extension whitelist) and sanitized (`secure_filename`)
- SQLite database is file-based - secure the file permissions

## Project Structure

```
madrasa/
├── app.py                # Flask application
├── database.db           # SQLite (auto-created)
├── .env                # Secrets (never committed)
├── .gitignore
├── requirements.txt
├── README.md
├── start.bat           # Double-click launcher (Windows)
├── static/
│   └── uploads/          # Commodity images/videos
└── templates/
    ├── layout.html       # Base template (not standalone)
    ├── admin.html        # Admin panel
    ├── client.html       # Client-facing page
    └── login.html        # Admin login