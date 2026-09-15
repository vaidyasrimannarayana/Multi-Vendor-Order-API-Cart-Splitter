const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/catalog - list all active products, across all stores
router.get("/", (req, res) => {
  const products = db
    .prepare(
      `SELECT p.id AS product_id,
              p.name AS product_name,
              p.price,
              p.store_id,
              s.name AS store_name
       FROM products p
       JOIN stores s ON s.id = p.store_id
       WHERE p.active = 1
       ORDER BY p.store_id, p.id`
    )
    .all();

  res.status(200).json({
    count: products.length,
    products,
  });
});

module.exports = router;
