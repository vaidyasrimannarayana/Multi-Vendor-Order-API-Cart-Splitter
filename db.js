const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data.sqlite");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Master order: one per customer checkout
CREATE TABLE IF NOT EXISTS master_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  item_total REAL NOT NULL,
  delivery_fee REAL NOT NULL,
  platform_fee REAL NOT NULL,
  total_payable REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sub-order: one per (master_order, store) pair - what a merchant sees
CREATE TABLE IF NOT EXISTS sub_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_order_id INTEGER NOT NULL REFERENCES master_orders(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_order_id INTEGER NOT NULL REFERENCES sub_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);
`);

// ---------- Seed data (only if empty) ----------
const storeCount = db.prepare("SELECT COUNT(*) AS c FROM stores").get().c;

if (storeCount === 0) {
  const insertStore = db.prepare("INSERT INTO stores (id, name) VALUES (?, ?)");
  const insertProduct = db.prepare(
    "INSERT INTO products (id, store_id, name, price, active) VALUES (?, ?, ?, ?, ?)"
  );

  const seed = db.transaction(() => {
    insertStore.run(1, "Fresh Mart Grocery");
    insertStore.run(2, "TechZone Electronics");
    insertStore.run(3, "Urban Threads Apparel");

    // Store 1: Fresh Mart Grocery
    insertProduct.run(101, 1, "Basmati Rice 5kg", 450, 1);
    insertProduct.run(102, 1, "Toor Dal 1kg", 140, 1);
    insertProduct.run(103, 1, "Sunflower Oil 1L", 160, 1);
    insertProduct.run(104, 1, "Expired Pickle Jar", 90, 0); // inactive - should not appear in catalog

    // Store 2: TechZone Electronics
    insertProduct.run(201, 2, "USB-C Cable 1m", 199, 1);
    insertProduct.run(202, 2, "Wireless Mouse", 599, 1);
    insertProduct.run(203, 2, "Bluetooth Earbuds", 1499, 1);

    // Store 3: Urban Threads Apparel
    insertProduct.run(301, 3, "Cotton T-Shirt", 349, 1);
    insertProduct.run(302, 3, "Denim Jacket", 1899, 1);
  });

  seed();
  console.log("Seeded database with stores and products.");
}

module.exports = db;
