const express = require('express');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path"); // Still useful for general path handling, even with Cloudinary
const cors = require('cors');
const dotEnv = require('dotenv');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs'); // For password hashing

dotEnv.config(); // Load environment variables from .env file

// Use process.env.PORT provided by Render, or default to 4000 for local development
const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json()); // Middleware to parse JSON request bodies

// --- CORS Configuration (Corrected & Efficient) ---
// This handles both local development and deployed frontend URLs.
// IMPORTANT: Set FRONTEND_URL and NODE_ENV environment variables on Render.com
// Example:
// NODE_ENV=production
// FRONTEND_URL=https://your-ecommerce-frontend-xyz.onrender.com
// JWT_SECRET=your_super_secret_jwt_key_here

const ALLOWED_LOCAL_ORIGINS = [
    'http://localhost:5173', // Your current local development frontend
    'http://localhost:3000'  // Another common local frontend port if you use it
];

const getCorsOrigin = (origin, callback) => {
    // For development, allow specific local origins OR the deployed frontend URL
    if (process.env.NODE_ENV === 'development') {
        if (!origin || ALLOWED_LOCAL_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
    } else { // Production environment
        if (origin === process.env.FRONTEND_URL) {
            return callback(null, true);
        }
    }
    // Deny all other origins
    callback(new Error('Not allowed by CORS'));
};

app.use(cors({
    origin: getCorsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Specify allowed HTTP methods
    allowedHeaders: ['Content-Type', 'auth-token'], // Specify allowed headers
    credentials: true // Allow cookies/authorization headers if needed (for JWT)
}));

// --- Cloudinary Configuration ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true // Use HTTPS
});

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Database connected successfully");
    })
    .catch((err) => {
        console.error("Database connection failed:", err);
        // It's often good practice to exit if the DB connection fails on startup
        process.exit(1);
    });

// --- API Creation ---
app.get("/", (req, res) => {
    res.send("Express App is running");
});

// --- Image Storage Engine (Cloudinary) ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'e-commerce-uploads', // Folder name in your Cloudinary account
        format: async (req, file) => 'png', // Can be 'jpg', 'webp', etc.
        public_id: (req, file) => `${file.fieldname}_${Date.now()}_${Math.floor(Math.random() * 1000)}`, // More unique ID
    },
});

const upload = multer({ storage: storage });

// --- Creating Upload Endpoint for Images ---
app.post('/upload', upload.single('product'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: 0, message: "No file uploaded. Please ensure 'product' field is correct and file is valid." });
    }
    res.json({
        success: 1,
        image_url: req.file.path // Cloudinary URL
    });
});

// --- Schema for Products ---
const Product = mongoose.model("Product", { // Changed model name to singular for convention
    id: {
        type: Number,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    image: {
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

// --- API to Add Product ---
app.post('/addproduct', async (req, res) => {
    try {
        // Input validation
        const { name, image, category, new_price, old_price } = req.body;
        if (!name || !image || !category || !new_price || !old_price) {
            return res.status(400).json({ success: false, message: "Missing required product fields." });
        }

        let products = await Product.find({});
        let id;
        if (products.length > 0) {
            let last_product_array = products.slice(-1);
            let last_product = last_product_array[0];
            id = last_product.id + 1;
        } else {
            id = 1;
        }

        const product = new Product({
            id: id,
            name: name,
            image: image,
            category: category,
            new_price: new_price,
            old_price: old_price,
        });

        await product.save();
        console.log("Product saved successfully:", product.name);
        res.status(201).json({ // 201 Created status
            success: true,
            name: product.name,
            message: "Product added successfully!"
        });
    } catch (error) {
        console.error("Error adding product:", error);
        if (error.code === 11000) { // Duplicate key error (e.g., if ID is not unique)
            return res.status(409).json({
                success: false,
                message: "Product with this ID already exists. Please try a different ID or re-check the logic."
            });
        }
        res.status(500).json({
            success: false,
            message: "Failed to add product. " + error.message
        });
    }
});

// --- API to Delete Product ---
app.post('/removeproduct', async (req, res) => {
    try {
        const productIdToDelete = req.body.id; // This should be the Mongoose _id, not your custom `id` field

        if (!productIdToDelete) {
            return res.status(400).json({ success: false, message: "Product ID is required for removal." });
        }

        const deletedProduct = await Product.findByIdAndDelete(productIdToDelete);

        if (!deletedProduct) {
            return res.status(404).json({ success: false, message: "Product not found or already deleted." });
        }

        // Optional: Delete image from Cloudinary
        // This logic can be complex if you have multiple versions or transformations.
        // It's generally better to handle Cloudinary cleanup asynchronously or with webhooks
        // if exact matching of public_id is tricky.
        /*
        if (deletedProduct.image) {
            try {
                // Extract public ID from Cloudinary URL:
                // e.g., 'https://res.cloudinary.com/your_cloud_name/image/upload/v12345/folder/public_id.png'
                const urlParts = deletedProduct.image.split('/');
                const filenameWithExtension = urlParts.pop(); // e.g., 'public_id.png'
                const folderName = urlParts.pop(); // e.g., 'folder'
                const publicId = `${folderName}/${filenameWithExtension.split('.')[0]}`;

                await cloudinary.uploader.destroy(publicId);
                console.log(`Image ${publicId} deleted from Cloudinary.`);
            } catch (cloudinaryError) {
                console.warn(`Failed to delete image from Cloudinary for product ${deletedProduct.name}:`, cloudinaryError.message);
                // Don't fail the product deletion just because image deletion failed
            }
        }
        */

        console.log("Product removed:", deletedProduct.name);
        res.json({
            success: true,
            name: deletedProduct.name,
            message: "Product removed successfully."
        });

    } catch (error) {
        console.error("Error removing product:", error);
        if (error.name === 'CastError' && error.path === '_id') {
            return res.status(400).json({ success: false, message: "Invalid Product ID format. Please provide a valid MongoDB ObjectId." });
        }
        res.status(500).json({ success: false, message: "Server error during product removal: " + error.message });
    }
});

// --- API for Getting All Products ---
app.get('/allproducts', async (req, res) => {
    try {
        const products = await Product.find({});
        if (!products) { // Defensive check
            return res.status(500).json({ success: false, message: "Failed to retrieve product data." });
        }
        console.log("All products fetched.");
        res.json(products); // Send as JSON
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch products. " + error.message
        });
    }
});

// --- Schema for User Model ---
const Users = mongoose.model('Users', {
    name: {
        type: String,
    },
    email: {
        type: String,
        unique: true,
        required: true
    },
    password: {
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

// --- Creating Endpoint for Registering User (Signup) ---
app.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, errors: "Missing required fields (name, email, password)." });
        }

        let check = await Users.findOne({ email: email });
        if (check) {
            return res.status(400).json({ success: false, errors: "Existing user found with this Email ID." });
        }

        let cart = {};
        for (let i = 1; i <= 300; i++) { // Initialize cart for up to 300 product IDs
            cart[i] = 0;
        }

        // Hash password before saving
        const salt = await bcrypt.genSalt(10); // Generate salt
        const hashedPassword = await bcrypt.hash(password, salt); // Hash password

        const user = new Users({
            name: name,
            email: email,
            password: hashedPassword, // Store hashed password
            cartData: cart,
        });

        await user.save();

        const data = {
            user: {
                id: user._id // Use MongoDB's default _id for JWT payload
            }
        };

        const token = jwt.sign(data, process.env.JWT_SECRET); // Use env variable for secret

        res.status(201).json({ success: true, token }); // 201 Created
    } catch (error) {
        console.error("Error during user signup:", error);
        if (error.code === 11000) { // Duplicate key error for email
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

// --- Creating Endpoint for User Login ---
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, errors: "Missing email or password." });
        }

        let user = await Users.findOne({ email: email });
        if (user) {
            // Compare submitted password with hashed password
            const passCompare = await bcrypt.compare(password, user.password);
            if (passCompare) {
                const data = {
                    user: {
                        id: user._id
                    }
                };
                const token = jwt.sign(data, process.env.JWT_SECRET);
                res.json({ success: true, token });
            } else {
                res.status(401).json({ success: false, errors: "Wrong password." }); // 401 Unauthorized
            }
        } else {
            res.status(404).json({ success: false, errors: "User not found with this Email-id." }); // 404 Not Found
        }
    } catch (error) {
        console.error("Error during user login:", error);
        res.status(500).json({ success: false, message: "Server error during login. " + error.message });
    }
});

// --- Middleware to fetch user from JWT token ---
const fetchUser = async (req, res, next) => {
    const token = req.header('auth-token');
    if (!token) {
        return res.status(401).send({ errors: "Please authenticate using a valid token (Token missing)." });
    }
    try {
        const data = jwt.verify(token, process.env.JWT_SECRET); // Use env variable for secret
        req.user = data.user;
        next();
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).send({ errors: "Please authenticate using a valid token (Invalid token)." });
    }
};

// --- Creating Endpoint for Adding Product to Cart ---
app.post('/addtocart', fetchUser, async (req, res) => {
    try {
        const productId = req.body.itemId;

        if (!productId) {
            return res.status(400).json({ success: false, message: "Product ID (itemId) is required." });
        }
        // Assuming your product IDs are numbers
        if (typeof productId !== 'number' || productId < 1) { // Removed upper limit of 300, as it's arbitrary
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a positive number." });
        }

        let userData = await Users.findOne({ _id: req.user.id });

        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Ensure cartData is an object
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

// --- Creating Endpoint for Removing Product from Cart ---
app.post('/removefromcart', fetchUser, async (req, res) => {
    try {
        const productId = req.body.itemId;

        if (!productId) {
            return res.status(400).json({ success: false, message: "Product ID (itemId) is required." });
        }
        if (typeof productId !== 'number' || productId < 1) {
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a positive number." });
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
            // Remove the item from cart if quantity becomes 0
            delete userData.cartData[productId];
        }

        await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });

        res.json({ success: true, message: "Product removed from cart successfully.", cartData: userData.cartData });

    } catch (error) {
        console.error("Error removing product from cart:", error);
        res.status(500).json({ success: false, message: "Server error removing product from cart. " + error.message });
    }
});

// --- API to Get Cart Data (Protected) ---
app.post('/getcart', fetchUser, async (req, res) => {
    try {
        let userData = await Users.findOne({ _id: req.user.id });
        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        console.log("Cart data fetched for user:", req.user.id);
        res.json({ success: true, cartData: userData.cartData });
    } catch (error) {
        console.error("Error fetching cart data:", error);
        res.status(500).json({ success: false, message: "Server error fetching cart data. " + error.message });
    }
});


// --- Creating Endpoint for New Collection Data ---
app.get('/newcollection', async (req, res) => {
    try {
        let products = await Product.find({});
        if (!products) {
            return res.status(500).json({ success: false, message: "Failed to retrieve new collection data." });
        }
        // Ensure there are enough products to slice
        let newcollection = products.slice(Math.max(0, products.length - 8)); // Get last 8 products
        console.log("Newcollection fetched");
        res.json(newcollection);
    } catch (error) {
        console.error("Error fetching new collection:", error);
        res.status(500).json({ success: false, message: "Failed to fetch new collection. " + error.message });
    }
});

// --- Creating Endpoint for Popular in Women ---
app.get('/popularinwomen', async (req, res) => {
    try {
        let products = await Product.find({ category: "women" }); // Use lowercase "women" for consistency
        if (!products) {
            return res.status(500).json({ success: false, message: "Failed to retrieve popular women's products." });
        }
        let popular_in_women = products.slice(0, 4); // Get first 4 products
        console.log("Popular in women fetched");
        res.json(popular_in_women);
    } catch (error) {
        console.error("Error fetching popular in women products:", error);
        res.status(500).json({ success: false, message: "Failed to fetch popular in women products. " + error.message });
    }
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});