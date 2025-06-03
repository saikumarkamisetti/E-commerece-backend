
const express = require ('express');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const cors = require('cors');
const dotEnv = require('dotenv');
const cloudinary = require('cloudinary').v2; // Import Cloudinary
const { CloudinaryStorage } = require('multer-storage-cloudinary'); // Import Cloudinary storage for Multer
const cors = require('cors');

dotEnv.config();
// Use process.env.PORT provided by Render, or default to 4000 for local development
const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json());

// --- IMPORTANT: Configure CORS for deployment ---
// This assumes your frontend will also be deployed (e.g., on Render, Netlify, Vercel).
// Set the FRONTEND_URL environment variable on your Render backend service.
// Example: FRONTEND_URL=https://your-ecommerce-frontend-xyz.onrender.com
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // Default for local frontend dev

app.use(cors({
  origin: 'http://localhost:5173'
}));

app.use(cors({
  origin: FRONTEND_URL, // Allow requests only from your frontend's URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Specify allowed HTTP methods
  allowedHeaders: ['Content-Type', 'auth-token'], // Specify allowed headers, including your custom auth-token
}));

// --- Configure Cloudinary ---
// These credentials must be set as environment variables on Render.com
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true // Use HTTPS
});



// To this:
mongoose.connect(process.env.MONGO_URI)
.then(()=>{
    console.log("Database connected successfully");
})
.catch((err) => {
    console.error("Database connection failed:", err);
    // process.exit(1); // Consider exiting process if DB connection is critical
});

// --- API Creation ---
app.get("/",(req,res)=>{
    res.send("Express App is running");
});

// --- Image Storage Engine (NOW USING CLOUDINARY) ---
// This replaces the local disk storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'e-commerce-uploads', // Folder name in your Cloudinary account to store images
    format: async (req, file) => 'png', // You can specify desired format (e.g., 'jpg', 'webp')
    public_id: (req, file) => `${file.fieldname}_${Date.now()}`, // Generates a unique public ID for each image
  },
});

const upload = multer({ storage: storage });

// --- Creating Upload Endpoints for Images ---
// This endpoint now uploads directly to Cloudinary and returns the Cloudinary URL
app.post('/upload', upload.single('product'), (req,res)=>{
    if (!req.file) {
        return res.status(400).json({ success: 0, message: "No file uploaded." });
    }
    // req.file.path contains the secure Cloudinary URL of the uploaded image
    res.json({
        success:1,
        image_url:req.file.path // This is the public URL from Cloudinary
    });
});

// --- Schema for Creating Products ---
const Product = mongoose.model("product",{
    id:{
        type:Number,
        required:true,
        unique:true
    },
    name:{
        type:String,
        required:true
    },
    image:{ // This field will now store the Cloudinary image URL
        type:String,
        required:true
    },
    category:{
        type:String,
        required:true
    },
    new_price:{
        type:Number,
        required:true
    },
    old_price:{
        type:Number,
        required:true
    },
    date:{
        type:Date,
        default:Date.now
    },
    available:{
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
            let last_product = products[products.length - 1];
            id = last_product.id + 1;
        } else {
            id = 1;
        }

        const product = new Product({
            id:id,
            name:req.body.name,
            image:req.body.image, // This will be the Cloudinary URL passed from frontend
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
        if (error.code === 11000) {
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
            console.log(`Product with ID ${productIdToDelete} not found.`);
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        // Optional: If you want to delete the image from Cloudinary when product is removed
        // This requires extracting the public ID from the Cloudinary URL
        // Example: https://res.cloudinary.com/dbjjuaqzg/image/upload/v1678888888/e-commerce-uploads/product_1678888888.png
        // Public ID would be 'e-commerce-uploads/product_1678888888'
        /*
        if (deletedProduct.image) {
            const urlParts = deletedProduct.image.split('/');
            const folderName = urlParts[urlParts.length - 2]; // e.g., 'e-commerce-uploads'
            const fileNameWithExtension = urlParts[urlParts.length - 1]; // e.g., 'product_1678888888.png'
            const publicId = `${folderName}/${fileNameWithExtension.split('.')[0]}`; // Combines folder and filename without extension

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
        res.send(products);
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
        required:true
    },
    password:{
        type:String,
        required:true
    },
    cartData:{
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
        if (!req.body.name || !req.body.email || !req.body.password) {
            return res.status(400).json({ success: false, errors: "Missing required fields (name, email, password)." });
        }

        let check = await Users.findOne({email:req.body.email});
        if(check){
            return res.status(400).json({success:false,errors:"Existing user found with same Email ID"});
        }

        let cart = {};
        for (let i = 1; i <= 300; i++) {
            cart[i] = 0;
        }

        const user = new Users({
            name:req.body.name,
            email:req.body.email,
            password:req.body.password,
            cartData:cart,
        });

        await user.save();

        const data = {
            user:{
                id:user.id
            }
        };

        const token = jwt.sign(data,'secret_ecom');

        res.json({success:true,token});

    } catch (error) {
        console.error("Error during user signup:", error);
        if (error.code === 11000) {
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
            const passCompare = req.body.password === user.password;
            if(passCompare){
                const data = {
                    user:{
                        id:user.id
                    }
                }
                const token = jwt.sign(data,'secret_ecom');
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
        const data = jwt.verify(token,'secret_ecom');
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

        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300." });
        }

        let userData = await Users.findOne({_id:req.user.id});

        if (!userData) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (!userData.cartData || typeof userData.cartData !== 'object') {
            userData.cartData = {};
        }

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

        if (typeof productId !== 'number' || productId < 1 || productId > 300) {
            return res.status(400).json({ success: false, message: "Invalid product ID. Must be a number between 1 and 300." });
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
    console.log(`Server running on port ${PORT}`);
});
