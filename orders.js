const express = require("express");
const db = require("../db");

const router = express.Router();

const BASE_DELIVERY_FEE = 25;
const EXTRA_STORE_FEE = 10;
const PLATFORM_FEE = 5;

/**
 * Validates the raw checkout payload shape.
 * Returns an array of human-readable error strings (empty array = valid).
 */
function validatePayload(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (
    typeof body.customer_name !== "string" ||
    body.customer_name.trim().length === 0
  ) {
    errors.push("customer_name is required and must be a non-empty string.");
  }

  if (
    typeof body.delivery_address !== "string" ||
    body.delivery_address.trim().length === 0
  ) {
    errors.push("delivery_address is required and must be a non-empty string.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("items must be a non-empty array.");
    return errors; // no point validating items further
  }

  body.items.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      errors.push(`items[${idx}] must be an object.`);
      return;
    }
    if (!Number.isInteger(item.product_id)) {
      errors.push(`items[${idx}].product_id must be an integer.`);
    }
    if (!Number.isInteger(item.store_id)) {
      errors.push(`items[${idx}].store_id must be an integer.`);
    }
    if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity)) {
      errors.push(`items[${idx}].quantity must be a number.`);
    } else if (item.quantity <= 0) {
      errors.push(`items[${idx}].quantity must be greater than 0.`);
    } else if (!Number.isInteger(item.quantity)) {
      errors.push(`items[${idx}].quantity must be a whole number.`);
    }
  });

  return errors;
}

// POST /api/orders
router.post("/", (req, res) => {
  const bodyErrors = validatePayload(req.body);
  if (bodyErrors.length > 0) {
    return res.status(400).json({
      error: "Validation failed",
      details: bodyErrors,
    });
  }

  const { customer_name, delivery_address, items } = req.body;

  // Look up every product referenced in the cart in one go.
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const placeholders = productIds.map(() => "?").join(",");
  const products = db
    .prepare(
      `SELECT id, store_id, name, price, active FROM products WHERE id IN (${placeholders})`
    )
    .all(...productIds);

  const productMap = new Map(products.map((p) => [p.id, p]));

  const businessErrors = [];
  const enrichedItems = [];

  items.forEach((item, idx) => {
    const product = productMap.get(item.product_id);

    if (!product) {
      businessErrors.push(
        `items[${idx}]: product_id ${item.product_id} does not exist.`
      );
      return;
    }
    if (!product.active) {
      businessErrors.push(
        `items[${idx}]: product_id ${item.product_id} is not currently active.`
      );
      return;
    }
    if (product.store_id !== item.store_id) {
      businessErrors.push(
        `items[${idx}]: store_id ${item.store_id} does not match product ${item.product_id} (belongs to store ${product.store_id}).`
      );
      return;
    }

    enrichedItems.push({
      product_id: product.id,
      product_name: product.name,
      store_id: product.store_id,
      unit_price: product.price,
      quantity: item.quantity,
      line_total: Number((product.price * item.quantity).toFixed(2)),
    });
  });

  if (businessErrors.length > 0) {
    return res.status(400).json({
      error: "Validation failed",
      details: businessErrors,
    });
  }

  // ---------- Financial calculation ----------
  const itemTotal = Number(
    enrichedItems.reduce((sum, i) => sum + i.line_total, 0).toFixed(2)
  );

  const uniqueStoreIds = [...new Set(enrichedItems.map((i) => i.store_id))];
  const uniqueStoreCount = uniqueStoreIds.length;

  const deliveryFee =
    BASE_DELIVERY_FEE + EXTRA_STORE_FEE * (uniqueStoreCount - 1);

  const totalPayable = Number(
    (itemTotal + deliveryFee + PLATFORM_FEE).toFixed(2)
  );

  // ---------- Persist: master order + split sub-orders (transaction) ----------
  const insertMasterOrder = db.prepare(
    `INSERT INTO master_orders
      (customer_name, delivery_address, item_total, delivery_fee, platform_fee, total_payable)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertSubOrder = db.prepare(
    `INSERT INTO sub_orders (master_order_id, store_id, subtotal) VALUES (?, ?, ?)`
  );
  const insertSubOrderItem = db.prepare(
    `INSERT INTO sub_order_items
      (sub_order_id, product_id, product_name, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const createOrder = db.transaction(() => {
    const masterResult = insertMasterOrder.run(
      customer_name.trim(),
      delivery_address.trim(),
      itemTotal,
      deliveryFee,
      PLATFORM_FEE,
      totalPayable
    );
    const masterOrderId = masterResult.lastInsertRowid;

    // Group items by store to build sub-orders (vendor orders)
    const subOrders = uniqueStoreIds.map((storeId) => {
      const storeItems = enrichedItems.filter((i) => i.store_id === storeId);
      const subtotal = Number(
        storeItems.reduce((sum, i) => sum + i.line_total, 0).toFixed(2)
      );

      const subOrderResult = insertSubOrder.run(masterOrderId, storeId, subtotal);
      const subOrderId = subOrderResult.lastInsertRowid;

      storeItems.forEach((i) => {
        insertSubOrderItem.run(
          subOrderId,
          i.product_id,
          i.product_name,
          i.quantity,
          i.unit_price,
          i.line_total
        );
      });

      return {
        sub_order_id: subOrderId,
        store_id: storeId,
        subtotal,
        items: storeItems.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          line_total: i.line_total,
        })),
      };
    });

    return { masterOrderId, subOrders };
  });

  const { masterOrderId, subOrders } = createOrder();

  return res.status(201).json({
    master_order_id: masterOrderId,
    customer_name: customer_name.trim(),
    delivery_address: delivery_address.trim(),
    cost_summary: {
      item_total: itemTotal,
      delivery_fee: deliveryFee,
      platform_fee: PLATFORM_FEE,
      total_payable: totalPayable,
      unique_store_count: uniqueStoreCount,
    },
    sub_orders: subOrders,
  });
});

// GET /api/orders/:id - convenience endpoint to inspect a created order
router.get("/:id", (req, res) => {
  const masterOrderId = Number(req.params.id);
  if (!Number.isInteger(masterOrderId)) {
    return res.status(400).json({ error: "Order id must be an integer." });
  }

  const master = db
    .prepare("SELECT * FROM master_orders WHERE id = ?")
    .get(masterOrderId);

  if (!master) {
    return res.status(404).json({ error: "Order not found." });
  }

  const subOrders = db
    .prepare("SELECT * FROM sub_orders WHERE master_order_id = ?")
    .all(masterOrderId)
    .map((so) => ({
      ...so,
      items: db
        .prepare("SELECT * FROM sub_order_items WHERE sub_order_id = ?")
        .all(so.id),
    }));

  res.status(200).json({ ...master, sub_orders: subOrders });
});

module.exports = router;
