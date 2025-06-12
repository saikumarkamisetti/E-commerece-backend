const express = require('express');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const cors = require('cors');
const dotEnv = require('dotenv');
const bcrypt = require('bcryptjs'); // For password hashing

// Cloudinary imports
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');


dotEnv.config(); // Load environment variables from .env file

const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json()); // Middleware to parse JSON request bodies

// --- CORS Configuration (Allows access from ANY origin/port) ---
// WARNING: Using origin: '*' is DANGEROUS in production.
// For production, change this to your specific frontend URL(s) like:
// origin: 'https://your-frontend-app.com'
app.use(cors({
    origin: '*', // ALLOWS ANY ORIGIN AS REQUESTED - USE WITH CAUTION!
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'auth-token'], // auth-token needed for protected routes
}));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Database connected successfully");
})
.catch((err) => {
    console.error("Database connection failed:", err);
    process.exit(1); // Exit if DB connection fails
});

// API Creation - Root Endpoint
app.get("/", (req, res) => {
    res.send("Express App is running");
});

// --- Cloudinary Configuration ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- Multer Storage for Cloudinary ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'e-commerce-images', // Folder name in Cloudinary
        format: async (req, file) => 'png', // or jpg, jpeg etc.
        public_id: (req, file) => `${file.fieldname}_${Date.now()}`,
    },
});

const upload = multer({ storage: storage });

// Creating Upload Endpoint for Images (Cloudinary)
app.post('/upload', upload.single('product'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: 0, message: "No file uploaded." });
    }
    // req.file.path contains the Cloudinary URL
    res.json({
        success: 1,
        image_url: req.file.path
    });
});

// No need for `app.use('/images', express.static(...))` anymore
// as images are served directly from Cloudinary CDN.

// --- MongoDB Schemas ---

// Schema for Creating Products
const Product = mongoose.model("Product", { // Changed model name to 'Product' (capitalized by convention)
    id: {
        type: Number,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    image: { // This field will now store the Cloudinary URL
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    new_price: {
        type: Number,
        required: true
    },
    old_price: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    available: {
        type: Boolean,
        default: true
    }
});

// Schema for User Model
const Users = mongoose.model('Users', {
    name: {
        type: String,
    },
    email: {
        type: String,
        unique: true,
        required: true
    },
    password: { // Will store hashed password
        type: String,
        required: true
    },
    cartData: {
        type: Object,
        default: {}
    },
    date: {
        type: Date,
        default: Date.now,
    }
});

// --- API Endpoints ---

// API to Add Product
app.post('/addproduct', async (req, res) => {
    try {
        let products = await Product.find({});
        let id;
        if (products.length > 0) {
            let last_product = products[products.length - 1];
            id = last_product.id + 1;
        } else {
            id = 1;
        }

        const product = new Product({
            id: id,
            name: req.body.name,
            image: req.body.image, // This will be the Cloudinary URL passed from frontend
            category: req.body.category,
            new_price: req.body.new_price,
            old_price: req.body.old_price,
        });
        console.log("Attempting to save product:", product);
        await product.save();
        console.log("Product saved successfully");
        res.json({
            success: true,
            name: req.body.name,
        });
    } catch (error) {
        console.error("Error adding product:", error);
        if (error.code === 11000) { // Duplicate key error
            return res.status(409).json({
                success: false,
                message: "Product with this ID already exists or a duplicate field was detected. Please try again."
            });
        }
        res.status(500).json({
            success: false,
            message: "Failed to add product. " + error.message
        });
    }
});

// API to Delete Product
app.post('/removeproduct', async (req, res) => {
    try {
        const productIdToDelete = req.body.id;
        if (!productIdToDelete) {
            console.log("Error: Product ID not provided for removal.");
            return res.status(400).json({ success: false, message: "Product ID is required." });
        }
        const deletedProduct = await Product.findOneAndDelete({ id: productIdToDelete });
        if (!deletedProduct) {
            console.log(`Product with ID ${productIdToDelete} not found.`);
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        console.log("Product removed:", deletedProduct.name);
        res.json({
            success: true,
            name: deletedProduct.name,
            message: "Product removed successfully."
        });
    } catch (error) {
        console.error("Error removing product:", error);
        if (error.name === 'CastError') {
            return res.status(400).json({ success: false, message: "Invalid Product ID format. Please provide a valid numerical product ID." });
        }
        res.status(500).json({ success: false, message: "Server error during product removal: " + error.message });
    }
});

// API for Getting All Products
app.get('/allproducts', async (req, res) => {
    try {
        let products = await Product.find({});
        console.log("All products Fetched");
        res.send(products);
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch products. " + error.message
        });
    }
});

// Creating Endpoint for Registering User (Signup) - WITH PASSWORD HASHING
app.post('/signup', async (req, res) => {
    try {
        if (!req.body.name || !req.body.email || !req.body.password) {
            return res.status(400).json({ success: false, errors: "Missing required fields (name, email, password)." });
        }

        let check = await Users.findOne({ email: req.body.email });
        if (check) {
            return res.status(400).json({ success: false, errors: "Existing user found with same Email ID" });
        }

        let cart = {};
        for (let i = 1; i <= 300; i++) { // Initialize cart
            cart[i] = 0;
        }

        // HASH THE PASSWORD BEFORE SAVING
        const hashedPassword = await bcrypt.hash(req.body.password, 10); // 10 is salt rounds

        const user = new Users({
            name: req.body.name,
            email: req.body.email,
            password: hashedPassword, // Store the hashed password
            cartData: cart,
        });

        await user.save();

        const data = {
            user: {
                id: user.id
            }
        };

        const token = jwt.sign(data, process.env.JWT_SECRET); // Use environment variable for secret

        res.json({ success: true, token });

    } catch (error) {
        console.error("Error during user signup:", error);
        if (error.code === 11000) { // Duplicate key error (e.g., email unique constraint)
            return res.status(409).json({
                success: false,
                message: "Email already registered. Please use a different email."
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error during signup. " + error.message
        });
    }
});

// Creating Endpoint for User Login - WITH PASSWORD HASHING COMPARISON
app.post('/login', async (req, res) => {
    try {
        if (!req.body.email || !req.body.password) {
            return res.status(400).json({ success: false, errors: "Missing email or password." });
        }

        let user = await Users.findOne({ email: req.body.email });
        if (user) {
            // COMPARE HASHED PASSWORD
            const passCompare = await bcrypt.compare(req.body.password, user.password);
            if (passCompare) {
                const data = {
                    user: {
                        id: user.id
                    }
                };
                const token = jwt.sign(data, process.env.JWT_SECRET); // Use environment variable for secret
                res.json({ success: true, token });
            } else {
                res.json({ success: false, errors: "Wrong password" });
            }
        } else {
            res.json({ success: false, errors: "Wrong Email-id" });
        }
    } catch (error) {
        console.error("Error during user login:", error);
        res.status(500).json({ success: false, message: "Server error during login. " + error.message });
    }
});

// Creating Endpoint for New Collection Data
app.get('/newcollection', async (req, res) => {
    try {
        let products = await Product.find({});
        let newcollection = products.slice(-8); // Get last 8 products
        console.log("Newcollection fetched");
        res.send(newcollection);
    } catch (error) {
        console.error("Error fetching new collection:", error);
        res.status(500).json({ success: false, message: "Failed to fetch new collection. " + error.message });
    }
});

// Creating Endpoint for Popular in Women
app.get('/popularinwomen', async (req, res) => {
    try {
        let products = await Product.find({ category: "women" }); // Ensure category matches schema value
        let popular_in_women = products.slice(0, 4); // Get first 4 popular products
        console.log("Popular in women fetched");
        res.send(popular_in_women);
    } catch (error) {
        console.error("Error fetching popular in women products:", error);
        res.status(500).json({ success: false, message: "Failed to fetch popular in women products. " + error.message });
    }
});

// Middleware to fetch user from JWT token
const fetchUser = async (req, res, next) => {
    const token = req.header('auth-token');
    if (!token) {
        return res.status(401).send({ errors: "Please authenticate using a valid token (token not found)" });
    }
    try {
        const data = jwt.verify(token, process.env.JWT_SECRET); // Use environment variable for secret
        req.user = data.user;
        next();
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).send({ errors: "Please authenticate using a valid token (invalid token)" });
    }
};

// Creating Endpoint for Adding Product to Cart
app.post('/addtocart', fetchUser, async (req, res) => {
    try {
        const productId = req.body.itemId;
        if (!productId) {
            return res.status(400).json({ success: false, message: "Product ID (itemId) is required." });
        }
        // Consider a more robust check than 1-300 if IDs are dynamic
        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            // This validation range (1-300) might be too restrictive if product IDs are dynamic.
            // Commenting out the return, but consider if this range is intended.
            // return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300 (or adjust range)." });
        }

        let userData = await Users.findOne({ _id: req.user.id });
        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        if (!userData.cartData || typeof userData.cartData !== 'object') {
            userData.cartData = {};
        }

        userData.cartData[productId] = (userData.cartData[productId] || 0) + 1;
        await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });

        res.json({ success: true, message: "Product added to cart successfully!", cartData: userData.cartData });
    } catch (error) {
        console.error("Error adding product to cart:", error);
        res.status(500).json({ success: false, message: "Server error adding product to cart. " + error.message });
    }
});

// Creating Endpoint for Removing Product from Cart
app.post('/removefromcart', fetchUser, async (req, res) => {
    try {
        const productId = req.body.itemId;
        if (!productId) {
            return res.status(400).json({ success: false, message: "Product ID (itemId) is required." });
        }
        // Consider a more robust check than 1-300 if IDs are dynamic
        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            // This validation range (1-300) might be too restrictive if product IDs are dynamic.
            // Commenting out the return, but consider if this range is intended.
            // return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300 (or adjust range)." });
        }

        let userData = await Users.findOne({ _id: req.user.id });
        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        if (!userData.cartData || typeof userData.cartData !== 'object' || !userData.cartData[productId]) {
            return res.status(400).json({ success: false, message: "Product not found in cart or quantity is already 0." });
        }

        if (userData.cartData[productId] > 1) {
            userData.cartData[productId] -= 1;
        } else {
            delete userData.cartData[productId];
        }

        await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });

        res.json({ success: true, message: "Product removed from cart successfully.", cartData: userData.cartData });
    } catch (error) {
        console.error("Error removing product from cart:", error);
        res.status(500).json({ success: false, message: "Server error removing product from cart. " + error.message });
    }
});

// API to Get Cart Data (Protected)
app.post('/getcart', fetchUser, async (req, res) => {
    try {
        let userData = await Users.findOne({ _id: req.user.id });
        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        console.log("Cart data fetched for user:", req.user.id);
        res.json(userData.cartData);
    } catch (error) {
        console.error("Error fetching cart data:", error);
        res.status(500).json({ success: false, message: "Server error fetching cart data. " + error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
