const express = require('express');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path"); // Although not directly used for local storage anymore, it's a common import
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotEnv = require('dotenv');

// Load environment variables from .env file in local development
dotEnv.config();

// Use process.env.PORT provided by Render, or default to 4000 for local development
const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json());

// --- Configure CORS for deployment ---
// FRONTEND_URL must be set as an environment variable on Render for your backend service.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // Default for local frontend dev

app.use(cors({
    origin: FRONTEND_URL, // Corrected to use template literal if needed, but direct variable is fine here
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'auth-token'],
}));

// --- Configure Cloudinary ---
// These credentials must be set as environment variables on Render.com
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true // Use HTTPS
});

// --- Database Connection with MongoDB ---
// MONGO_URI must be set as an environment variable on Render.com
mongoose.connect(process.env.MONGO_URI)
.then(()=>{
    console.log("Database connected successfully");
})
.catch((err) => {
    console.error("Database connection failed:", err);
    // In a production app, you might want to exit the process or handle this more gracefully
    // process.exit(1);
});

// --- API Creation ---
app.get("/",(req,res)=>{
    res.send("Express App is running");
});

// --- Image Storage Engine (USING CLOUDINARY) ---
// This replaces the local disk storage
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'e-commerce-uploads', // Folder name in your Cloudinary account
        format: async (req, file) => 'png', // Specify desired format
        // Corrected: Use backticks for template literal for public_id
        public_id: (req, file) => `${file.fieldname}_${Date.now()}`, // Unique public ID
    },
});

const upload = multer({ storage: storage });

// --- Creating Upload Endpoint for Images ---
// This endpoint now uploads directly to Cloudinary and returns the Cloudinary URL
app.post('/upload', upload.single('product'), (req,res)=>{
    if (!req.file) {
        return res.status(400).json({ success: 0, message: "No file uploaded." });
    }
    res.json({
        success:1,
        image_url:req.file.path // This is the public URL from Cloudinary
    });
});

// --- Schema for Creating Products ---
const Product = mongoose.model("product",{
    id:{
        type:Number,
        required:true, // Corrected from 'require'
        unique:true // Added unique constraint
    },
    name:{
        type:String,
        required:true // Corrected from 'require'
    },
    image:{
        type:String,
        required:true // Corrected from 'require'
    },
    category:{
        type:String,
        required:true
    },
    new_price:{
        type:Number,
        required:true // Corrected from 'require'
    },
    old_price:{
        type:Number,
        required:true // Corrected from 'require'
    },
    date:{
        type:Date,
        default:Date.now
    },
    available:{ // Corrected from 'avilable' to 'available'
        type:Boolean,
        default:true
    }
});

// --- API to Add Product ---
app.post('/addproduct',async (req,res)=>{
    try {
        let products = await Product.find({});
        let id;
        if(products.length > 0){
            let last_product = products[products.length - 1]; // Simplified
            id = last_product.id + 1;
        } else {
            id = 1;
        }

        const product = new Product({
            id:id,
            name:req.body.name,
            image:req.body.image,
            category:req.body.category,
            new_price:req.body.new_price,
            old_price:req.body.old_price,
        });
        console.log("Attempting to save product:", product);
        await product.save();
        console.log("Product saved successfully");
        res.json({
            success:true,
            name:req.body.name,
        });
    } catch (error) {
        console.error("Error adding product:", error);
        if (error.code === 11000) { // MongoDB duplicate key error code
            return res.status(409).json({
                success:false,
                message:"Product with this ID already exists. Please try again."
            });
        }
        res.status(500).json({
            success:false,
            message:"Failed to add product. " + error.message
        });
    }
});

// --- API to Delete Product ---
app.post('/removeproduct', async (req, res) => {
    try {
        const productIdToDelete = req.body.id; // This will be MongoDB's _id string from frontend

        if (!productIdToDelete) {
            console.log("Error: Product ID not provided for removal.");
            return res.status(400).json({ success: false, message: "Product ID is required." });
        }

        const deletedProduct = await Product.findByIdAndDelete(productIdToDelete);

        if (!deletedProduct) {
            // Corrected: Use backticks for template literal
            console.log(`Product with ID ${productIdToDelete} not found.`);
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        // Optional: If you want to delete the image from Cloudinary when product is removed
        /*
        if (deletedProduct.image) {
            const urlParts = deletedProduct.image.split('/');
            const folderName = urlParts[urlParts.length - 2];
            const fileNameWithExtension = urlParts[urlParts.length - 1];
            // Corrected: Use backticks for template literal
            const publicId = `${folderName}/${fileNameWithExtension.split('.')[0]}`;

            try {
                await cloudinary.uploader.destroy(publicId);
                console.log(`Image ${publicId} deleted from Cloudinary.`);
            } catch (cloudinaryError) {
                console.error(`Failed to delete image ${publicId} from Cloudinary:`, cloudinaryError);
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
app.get('/allproducts',async (req,res)=>{
    try {
        let products = await Product.find({});
        console.log("All products Fetched");
        res.send(products); // Consider wrapping in { success: true, products: products }
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).json({
            success:false,
            message:"Failed to fetch products. " + error.message
        });
    }
});

// --- Schema for User Model ---
const Users = mongoose.model('Users',{
    name:{
        type:String,
    },
    email:{
        type:String,
        unique:true,
        required:true // Corrected to required
    },
    password:{
        type:String,
        required:true // Corrected to required
    },
    cartData:{ // Corrected from 'cartDara' to 'cartData'
        type:Object,
        default:{}
    },
    date:{
        type:Date,
        default:Date.now,
    }
});

// --- Creating Endpoint for Registering User (Signup) ---
app.post('/signup',async(req,res)=>{
    try {
        // Basic validation for request body
        if (!req.body.name || !req.body.email || !req.body.password) {
            return res.status(400).json({ success: false, errors: "Missing required fields (name, email, password)." });
        }

        let check = await Users.findOne({email:req.body.email});
        if(check){
            return res.status(400).json({success:false,errors:"Existing user found with same Email ID"});
        }

        // Initialize cartData with 300 product IDs, each with quantity 0
        let cart = {};
        for (let i = 1; i <= 300; i++) {
            cart[i] = 0;
        }

        const user = new Users({
            name:req.body.name,
            email:req.body.email,
            password:req.body.password,
            cartData:cart, // Corrected field name
        });

        await user.save();

        const data = {
            user:{
                id:user.id
            }
        };

        const token = jwt.sign(data, process.env.JWT_SECRET || 'secret_ecom'); // Use env var for JWT secret

        res.json({success:true,token});

    } catch (error) {
        console.error("Error during user signup:", error);
        if (error.code === 11000) { // MongoDB duplicate key error code
            return res.status(409).json({
                success:false,
                message:"Email already registered. Please use a different email."
            });
        }
        res.status(500).json({
            success:false,
            message:"Server error during signup. " + error.message
        });
    }
});

// --- Creating Endpoint for User Login ---
app.post('/login',async (req,res)=>{
    try {
        if (!req.body.email || !req.body.password) {
            return res.status(400).json({ success: false, errors: "Missing email or password." });
        }

        let user = await Users.findOne({email:req.body.email});
        if(user){
            const passCompare = req.body.password === user.password; // IMPORTANT: Hash passwords in production!
            if(passCompare){
                const data = {
                    user:{
                        id:user.id
                    }
                }
                const token = jwt.sign(data, process.env.JWT_SECRET || 'secret_ecom'); // Use env var for JWT secret
                res.json({success:true,token});
            }
            else{
                res.json({success:false,errors:"Wrong password"});
            }
        }
        else{
            res.json({success:false,errors:"Wrong Email-id"});
        }
    } catch (error) {
        console.error("Error during user login:", error);
        res.status(500).json({ success: false, message: "Server error during login. " + error.message });
    }
});

// --- Creating Endpoint for New Collection Data ---
app.get('/newcollection',async (req,res)=>{
    try {
        let products = await Product.find({});
        let newcollection = products.slice(-8);
        console.log("Newcollection fetched");
        res.send(newcollection);
    } catch (error) {
        console.error("Error fetching new collection:", error);
        res.status(500).json({ success: false, message: "Failed to fetch new collection. " + error.message });
    }
});

// --- Creating Endpoint for Popular in Women ---
app.get('/popularinwomen',async (req,res)=>{
    try {
        let products = await Product.find({category:"Women"});
        let popular_in_women = products.slice(0,4);
        console.log("Popular in women fetched");
        res.send(popular_in_women);
    } catch (error) {
        console.error("Error fetching popular in women products:", error);
        res.status(500).json({ success: false, message: "Failed to fetch popular in women products. " + error.message });
    }
});

// --- Middleware to fetch user from JWT token ---
const fetchUser = async (req,res,next)=>{
    const token = req.header('auth-token');
    if (!token) {
        return res.status(401).send({errors:"Please authenticate using a valid token"})
    }
    try{
        // Corrected: Use env var for JWT secret
        const data = jwt.verify(token, process.env.JWT_SECRET || 'secret_ecom');
        req.user = data.user;
        next();
    }catch(error){
        console.error("JWT verification error:", error);
        return res.status(401).send({errors:"Please authenticate using a valid token"});
    }
};

// --- Creating Endpoint for Adding Product to Cart ---
app.post('/addtocart',fetchUser, async (req,res)=>{
    try {
        const productId = req.body.itemId;

        if (!productId) {
            return res.status(400).json({ success: false, message: "Product ID (itemId) is required." });
        }

        // Added more robust type and range validation
        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300." });
        }

        let userData = await Users.findOne({_id:req.user.id});

        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Ensure cartData is an object before attempting to modify
        if (!userData.cartData || typeof userData.cartData !== 'object') {
            userData.cartData = {};
        }

        // Increment quantity or initialize to 1 if not present
        userData.cartData[productId] = (userData.cartData[productId] || 0) + 1;

        await Users.findOneAndUpdate({_id:req.user.id},{cartData:userData.cartData});

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

        // Added more robust type and range validation
        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300." });
        }

        let userData = await Users.findOne({ _id: req.user.id });

        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Check if cartData exists and if the product is in the cart
        if (!userData.cartData || typeof userData.cartData !== 'object' || !userData.cartData[productId]) {
            return res.status(400).json({ success: false, message: "Product not found in cart or quantity is already 0." });
        }

        // Decrement quantity or remove if quantity becomes 0
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


// --- Start the Server ---
app.listen(PORT,()=>{
    // Corrected: Use backticks for template literal
    console.log(`Server running on port ${PORT}`);
});
