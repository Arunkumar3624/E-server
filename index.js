const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");
require("dotenv").config();

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, hashedPassword],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PRODUCTS
app.get("/products", async (req, res) => {
  const result = await pool.query("SELECT * FROM products ORDER BY id");
  res.json(result.rows);
});

// SEARCH PRODUCTS
app.get("/products/search", async (req, res) => {
  const q = req.query.q || "";

  const result = await pool.query(
    `SELECT * FROM products
     WHERE name ILIKE $1 OR category ILIKE $1
     ORDER BY id`,
    [`%${q}%`],
  );

  res.json(result.rows);
});

// PLACE COD ORDER
app.post("/orders", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { items } = req.body;

    await client.query("BEGIN");

    let totalPrice = 0;

    for (const item of items) {
      totalPrice += item.price * item.quantity;
    }

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_price, payment_method, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, totalPrice, "Cash on Delivery", "Pending"],
    );

    const order = orderResult.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_details (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price],
      );
    }

    await client.query("COMMIT");

    res.status(201).json({ message: "Order placed successfully", order });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// GET ALL ORDERS
app.get("/orders", async (req, res) => {
  const result = await pool.query(
    `SELECT 
      orders.id,
      users.username,
      users.email,
      orders.total_price,
      orders.payment_method,
      orders.status,
      orders.created_at
     FROM orders
     JOIN users ON orders.user_id = users.id
     ORDER BY orders.id DESC`,
  );

  res.json(result.rows);
});

// GET SINGLE ORDER DETAILS
app.get("/orders/:id", async (req, res) => {
  const { id } = req.params;

  const orderResult = await pool.query(
    `SELECT 
      orders.id,
      users.username,
      users.email,
      orders.total_price,
      orders.payment_method,
      orders.status,
      orders.created_at
     FROM orders
     JOIN users ON orders.user_id = users.id
     WHERE orders.id = $1`,
    [id],
  );

  const itemsResult = await pool.query(
    `SELECT 
      order_details.id,
      products.name,
      products.image_url,
      order_details.quantity,
      order_details.price
     FROM order_details
     JOIN products ON order_details.product_id = products.id
     WHERE order_details.order_id = $1`,
    [id],
  );

  res.json({
    order: orderResult.rows[0],
    items: itemsResult.rows,
  });
});

// GET MY ORDERS
app.get("/my-orders", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        total_price,
        payment_method,
        status,
        created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY id DESC`,
      [req.user.id],
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY SINGLE ORDER WITH DETAILS
app.get("/my-orders/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const orderResult = await pool.query(
      `SELECT 
        orders.id,
        orders.total_price,
        orders.payment_method,
        orders.status,
        orders.created_at
       FROM orders
       WHERE orders.id = $1 AND orders.user_id = $2`,
      [id, req.user.id],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const itemsResult = await pool.query(
      `SELECT 
        order_details.id,
        products.name,
        products.image_url,
        products.category,
        order_details.quantity,
        order_details.price
       FROM order_details
       JOIN products ON order_details.product_id = products.id
       WHERE order_details.order_id = $1`,
      [id],
    );

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE/CANCEL ORDER
app.delete("/my-orders/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if order belongs to the user
    const orderResult = await client.query(
      `SELECT id FROM orders WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Order not found" });
    }

    // Delete order details first
    await client.query(`DELETE FROM order_details WHERE order_id = $1`, [id]);

    // Delete the order
    await client.query(`DELETE FROM orders WHERE id = $1`, [id]);

    await client.query("COMMIT");

    res.json({ message: "Order cancelled successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
