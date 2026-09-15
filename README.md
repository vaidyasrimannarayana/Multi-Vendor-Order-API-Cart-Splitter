# Multi-Vendor Order API & Cart Splitter

A REST API for a multi-vendor e-commerce platform. Customers browse a shared
product catalog spanning several stores, then check out with a single cart.
The backend calculates the full cost breakdown and internally splits the
order into per-store **sub-orders** so each merchant only sees the items
they need to pack.

## Tech Stack

- **Node.js + Express** — HTTP routing
- **SQLite** (via `better-sqlite3`) — persistent storage, transactional writes
- No external dependencies beyond `express` and `better-sqlite3`

## Data Model

| Table              | Purpose                                                        |
|---------------------|-----------------------------------------------------------------|
| `stores`            | Vendors on the platform                                        |
| `products`          | Catalog items, each tied to one `store_id`                     |
| `master_orders`     | One row per customer checkout — the order the customer sees    |
| `sub_orders`        | One row per `(master_order, store)` pair — the order a merchant sees |
| `sub_order_items`   | Line items belonging to a specific sub-order                   |

A checkout containing items from 3 stores produces **1 master order** and
**3 linked sub-orders**, each with only that store's items.

The database file (`data.sqlite`) is created and seeded automatically the
first time the server starts, with sample products from 3 different stores
(Fresh Mart Grocery, TechZone Electronics, Urban Threads Apparel).

## Setup

```bash
npm install
npm start
```

The server listens on `http://localhost:3000` (override with `PORT` env var).

## Endpoints

### `GET /api/catalog`

Returns all **active** products across every store.

```bash
curl http://localhost:3000/api/catalog
```

```json
{
  "count": 8,
  "products": [
    { "product_id": 101, "product_name": "Basmati Rice 5kg", "price": 450, "store_id": 1, "store_name": "Fresh Mart Grocery" },
    { "product_id": 201, "product_name": "USB-C Cable 1m", "price": 199, "store_id": 2, "store_name": "TechZone Electronics" }
  ]
}
```

### `POST /api/orders`

Accepts a checkout payload, validates it, computes the cost breakdown, and
splits the order by store.

**Request:**

```json
{
  "customer_name": "Vaidya Srimannarayana",
  "delivery_address": "123 Test Street, Hyderabad",
  "items": [
    { "product_id": 101, "store_id": 1, "quantity": 2 },
    { "product_id": 202, "store_id": 2, "quantity": 1 },
    { "product_id": 301, "store_id": 3, "quantity": 3 }
  ]
}
```

**Response — `201 Created`:**

```json
{
  "master_order_id": 1,
  "customer_name": "Vaidya Srimannarayana",
  "delivery_address": "123 Test Street, Hyderabad",
  "cost_summary": {
    "item_total": 2546,
    "delivery_fee": 45,
    "platform_fee": 5,
    "total_payable": 2596,
    "unique_store_count": 3
  },
  "sub_orders": [
    { "sub_order_id": 1, "store_id": 1, "subtotal": 900,  "items": [ ... ] },
    { "sub_order_id": 2, "store_id": 2, "subtotal": 599,  "items": [ ... ] },
    { "sub_order_id": 3, "store_id": 3, "subtotal": 1047, "items": [ ... ] }
  ]
}
```

**Fee logic:**
- Item Total = Σ (price × quantity)
- Delivery Fee = ₹25 base + ₹10 for every unique store beyond the first
  (1 store → ₹25, 2 stores → ₹35, 3 stores → ₹45, ...)
- Platform Fee = flat ₹5
- Total Payable = Item Total + Delivery Fee + Platform Fee

**Validation (all return `400 Bad Request` with an `error` and `details` array):**
- `customer_name` / `delivery_address` missing or empty
- `items` missing, empty, or not an array
- Any `quantity <= 0` or non-integer quantity
- `product_id` that doesn't exist or isn't active
- `store_id` that doesn't match the product's actual store (tamper check)

### `GET /api/orders/:id`

Convenience endpoint to fetch a previously created master order along with
its sub-orders and line items. Returns `404` if the order doesn't exist.

## Error Handling

| Status | When                                                      |
|--------|-----------------------------------------------------------|
| `200`  | Successful `GET`                                          |
| `201`  | Order created successfully                                |
| `400`  | Validation failure (bad payload, bad quantity, bad product/store) |
| `404`  | Unknown route or order not found                          |
| `500`  | Unexpected server error (safety-net handler)               |

## Manual Test Checklist

```bash
# Multi-store order → delivery fee = 45
curl -X POST localhost:3000/api/orders -H "Content-Type: application/json" -d '{
  "customer_name": "Test User", "delivery_address": "Addr",
  "items": [
    {"product_id": 101, "store_id": 1, "quantity": 2},
    {"product_id": 202, "store_id": 2, "quantity": 1},
    {"product_id": 301, "store_id": 3, "quantity": 3}
  ]
}'

# Negative quantity → 400
curl -X POST localhost:3000/api/orders -H "Content-Type: application/json" -d '{
  "customer_name": "Bad", "delivery_address": "Addr",
  "items": [{"product_id": 101, "store_id": 1, "quantity": -5}]
}'
```

All scenarios above (multi-store, single-store, negative/zero quantity,
missing fields, store/product mismatch, unknown product, unknown route)
have been manually verified against a live instance of this server.# Multi-Vendor-Order-API-Cart-Splitter
REST API for multi-vendor checkout (Node.js, Express, SQLite) that computes item totals, tiered delivery fees, and platform fees, then splits one order into per-store sub-orders for merchants — with full request validation and proper HTTP status codes.
