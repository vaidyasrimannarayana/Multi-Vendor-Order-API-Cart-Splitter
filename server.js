const express = require("express");

const catalogRouter = require("./routes/catalog");
const ordersRouter = require("./routes/orders");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Malformed JSON body -> clean 400 instead of a raw 500 stack trace
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  next(err);
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Multi-Vendor Order API is running.",
    endpoints: {
      "GET /api/catalog": "List all active products across stores",
      "POST /api/orders": "Create a checkout order (splits into sub-orders per store)",
      "GET /api/orders/:id": "Fetch a previously created order and its sub-orders",
    },
  });
});

app.use("/api/catalog", catalogRouter);
app.use("/api/orders", ordersRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found.` });
});

// Generic error handler (safety net)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Multi-Vendor Order API listening on http://localhost:${PORT}`);
});
