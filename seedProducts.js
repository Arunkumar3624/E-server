const axios = require("axios");
const pool = require("./db");

async function seedProducts() {
  try {
    // Electronics categories
    const urls = [
      "https://dummyjson.com/products/category/smartphones",
      "https://dummyjson.com/products/category/laptops",
      "https://dummyjson.com/products/category/mobile-accessories",
      "https://dummyjson.com/products/category/tablets",
    ];

    let allProducts = [];

    // Fetch products from all categories
    for (const url of urls) {
      const res = await axios.get(url);
      allProducts = [...allProducts, ...res.data.products];
    }

    // Insert into DB
    for (const product of allProducts) {
      await pool.query(
        `INSERT INTO products
        (name, description, price, category, stock, image_url)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          product.title,
          product.description,
          product.price,
          product.category,
          product.stock,
          product.thumbnail,
        ],
      );
    }

    console.log("Electronics products imported successfully");
    process.exit();
  } catch (error) {
    console.log("Seed error:", error.response?.data || error.message);
  }
}

seedProducts();
