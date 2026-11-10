import os
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, flash, send_from_directory
from werkzeug.utils import secure_filename

# --- CONFIGURATION ---
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-in-production")

# Admin credentials (edit .env or code)
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# Payment configuration - editable by admin anytime
ADMIN_PHONE = "+256700123456"  # Default; can be changed via admin panel
ADMIN_BANK_ACCOUNT = "Standard Chartered Bank, A/C 1234567890"
PIN_CODE = "1234"  # Simulated PIN for demo reservations

# Upload folder
UPLOAD_FOLDER = os.path.join("static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "mp4", "mov", "avi"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- DATABASE HELPERS ---
def get_db():
    conn = sqlite3.connect("database.db")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with app.app_context():
        db = get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS commodities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT NOT NULL,
                image_url TEXT,
                video_url TEXT,
                price REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                commodity_id INTEGER NOT NULL,
                client_name TEXT NOT NULL,
                client_phone TEXT,
                client_pin INTEGER,
                amount REAL NOT NULL DEFAULT 0,
                status TEXT DEFAULT "pending",
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (commodity_id) REFERENCES commodities(id)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # Insert default settings if not exist
        db.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ("admin_phone", ADMIN_PHONE))
        db.execute("INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)", ("admin_bank_account", ADMIN_BANK_ACCOUNT))
        db.commit()

init_db()

# --- HELPERS ---
def allowed_file(filename):
    return "." in filename and \
           filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# --- ROUTES ---

@app.route("/")
def index():
    """Client-facing page - browse commodities"""
    db = get_db()
    commodities = db.execute(
        "SELECT * FROM commodities WHERE 1"
    ).fetchall()
    db.close()
    return render_template("client.html", commodities=commodities, year=datetime.now().year)

@app.route("/login", methods=["GET", "POST"])
def login():
    """Admin login"""
    if session.get("admin_logged_in"):
        return redirect(url_for("admin"))
    
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session["admin_logged_in"] = True
            flash("Logged in successfully.", "success")
            return redirect(url_for("admin"))
        else:
            flash("Invalid credentials.", "error")
    return render_template("login.html")

@app.route("/admin", methods=["GET", "POST"])
def admin():
    """Admin panel - full control"""
    if not session.get("admin_logged_in"):
        return redirect(url_for("login"))
    
    db = get_db()
    
    if request.method == "POST":
        action = request.form.get("action")
        
        if action == "add_commodity":
            name = request.form["name"]
            description = request.form["description"]
            category = request.form["category"]  # 'golden' or 'premium'
            image = request.files.get("image")
            video = request.files.get("video")
            price = float(request.form["price"]) if request.form.get("price") else 0
            
            image_url = ""
            video_url = ""
            
            if image and allowed_file(image.filename):
                filename = secure_filename(image.filename)
                image.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
                image_url = f"/static/uploads/{filename}"
            
            if video and allowed_file(video.filename):
                filename = secure_filename(video.filename)
                video.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
                video_url = f"/static/uploads/{filename}"
            
            db.execute(
                "INSERT INTO commodities (name, description, category, image_url, video_url, price) VALUES (?, ?, ?, ?, ?, ?)",
                (name, description, category, image_url, video_url, price)
            )
            db.commit()
            flash("Commodity added successfully.", "success")
        
        elif action == "update_settings":
            new_phone = request.form.get("admin_phone", "").strip()
            new_bank = request.form.get("admin_bank_account", "").strip()
            
            db.execute("UPDATE system_settings SET value = ? WHERE key = ?", (new_phone, "admin_phone"))
            db.execute("UPDATE system_settings SET value = ? WHERE key = ?", (new_bank, "admin_bank_account"))
            flash("Settings updated.", "success")
        
        elif action == "confirm_reservation":
            reservation_id = int(request.form.get("reservation_id"))
            db.execute(
                "UPDATE reservations SET status = 'confirmed' WHERE id = ?",
                (reservation_id,)
            )
            flash("Reservation confirmed.", "success")
    
    # Load data
    commodities = db.execute("SELECT * FROM commodities").fetchall()
    
    # Load reservations pending confirmation
    reservations = db.execute(
        "SELECT r.*, c.name as commodity_name FROM reservations r "
        "JOIN commodities c ON r.commodity_id = c.id "
        "WHERE r.status = 'pending'"
    ).fetchall()
    
    # Load system settings
    settings = db.execute("SELECT * FROM system_settings").fetchall()
    settings_dict = {s["key"]: s["value"] for s in settings}
    
    db.close()
    
    return render_template(
        "admin.html",
        commodities=commodities,
        reservations=reservations,
        settings=settings_dict,
        pin_code=PIN_CODE
    )

@app.route("/reserve/<int:commodity_id>", methods=["GET", "POST"])
def reserve(commodity_id):
    """Client-facing reservation"""
    db = get_db()
    commodity = db.execute("SELECT * FROM commodities WHERE id = ?", (commodity_id,)).fetchone()
    
    if request.method == "POST":
        client_name = request.form["client_name"]
        client_phone = request.form["client_phone"]
        entered_pin = int(request.form["pin"])
        
        # PIN verification
        if entered_pin != PIN_CODE:
            flash("Incorrect PIN. Payment aborted.", "error")
            return redirect(url_for("reserve", commodity_id=commodity_id))
        
        # Create reservation
        amount = commodity["price"] if commodity["price"] > 0 else 10000  # fixed demo amount
        db.execute(
            "INSERT INTO reservations (commodity_id, client_name, client_phone, client_pin, amount, status) "
            "VALUES (?, ?, ?, ?, ?, 'pending')",
            (commodity_id, client_name, client_phone, entered_pin, amount)
        )
        db.commit()
        flash(f"Reservation initiated for UGX {amount:,.2f}. PIN confirmed.", "success")
        db.close()
        return redirect(url_for("index"))
    
    db.close()
    return render_template("reserve.html", commodity=commodity, pin_code=PIN_CODE)

@app.route("/static/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

@app.route("/logout")
def logout():
    session.pop("admin_logged_in", None)
    flash("Logged out.", "success")
    return redirect(url_for("login"))

# --- START ---
if __name__ == "__main__":
    init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)