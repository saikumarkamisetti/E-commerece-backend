// 

const express = require ('express');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const cors = require('cors');
const { log, error } = require('console');
const { request } = require('http');
// const { type } = require('os'); // Not used, can be removed
// const { log } = require('console'); // Not used, can be removed

const port = 4000;
const app = express();

app.use(express.json()); // Parses JSON bodies
app.use(cors()); // Enables Cross-Origin Resource Sharing

// --- Database Connection with MongoDB ---
mongoose.connect("mongodb+srv://sk9618620:E-commerce123456@cluster0.fmxs1ei.mongodb.net/E-commerce")
.then(()=>{
    console.log("Database connected successfully");
})
.catch((err) => { // Added error handling for database connection
    console.error("Database connection failed:", err);
    // You might want to exit the process or handle this more gracefully
    // process.exit(1);
});

// --- API Creation ---
app.get("/",(req,res)=>{
    res.send("Express App is running");
});

// --- Image Storage Engine ---
// Ensure 'upload/images' directory exists in your project root
// before running the server, or create it programmatically.
const storage = multer.diskStorage({
    destination:'./upload/images',
    filename:(req,file,cb)=>{
        return cb(null,`${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`)
    }
});
const upload = multer({storage:storage});

// --- Creating Upload Endpoints for Images ---
app.use('/images',express.static('upload/images'));

app.post('/upload', upload.single('product'), (req,res)=>{
    if (!req.file) { // Add check if file was uploaded
        return res.status(400).json({ success: 0, message: "No file uploaded." });
    }
    res.json({
        success:1,
        image_url:`http://localhost:${port}/images/${req.file.filename}`
    });
});

// --- Schema for Creating Products ---
const Product = mongoose.model("product",{
    id:{
        type:Number,
        required:true, // Corrected from require:true
        unique:true // Added unique constraint for custom ID, handle errors if not
    },
    name:{
        type:String,
        required:true
    },
    image:{
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
    available:{ // Corrected from avilable to available
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
            let last_product = products[products.length - 1]; // More direct way to get last element
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
            // 'date' and 'available' will use their defaults
        });
        console.log(product);
        await product.save();
        console.log("Product saved successfully");
        res.json({
            success:true,
            name:req.body.name,
        });
    } catch (error) {
        console.error("Error adding product:", error);
        // Handle potential duplicate ID error if 'id' is unique
        if (error.code === 11000) { // MongoDB duplicate key error code
            return res.status(409).json({
                success:false,
                message:"Product with this ID already exists. Please try again."
            });
        }
        res.status(500).json({
            success:false,
            message:"Failed to add product. " + error.message // Include error message for debugging
        });
    }
});

// --- API to Delete Product ---
app.post('/removeproduct', async (req, res) => {
    try {
        const productIdToDelete = req.body.id;

        if (!productIdToDelete) {
            console.log("Error: Product ID not provided for removal.");
            return res.status(400).json({ success: false, message: "Product ID is required." });
        }

        // Use findOneAndDelete for more flexibility (e.g., if you want to find by custom 'id' field)
        // If req.body.id is MongoDB's _id, findByIdAndDelete is fine.
        // Assuming req.body.id is the custom 'id' (Number) field:
        const deletedProduct = await Product.findByIdAndDelete(productIdToDelete);

        // If req.body.id is MongoDB's _id (ObjectId string):
        // const deletedProduct = await Product.findByIdAndDelete(productIdToDelete);

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

        // Handle CastError specifically: occurs if ID format is invalid for Mongoose's _id
        if (error.name === 'CastError' && error.path === '_id') {
            return res.status(400).json({ success: false, message: "Invalid Product ID format. Please provide a valid MongoDB ObjectId if deleting by _id." });
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
        required:true // Email should probably be required
    },
    password:{
        type:String,
        required:true // Password should be required
    },
    cartData:{ // Corrected from cartDara
        type:Object, // Stores product ID as key, quantity as value
        default:{} // Default to an empty object
    },
    date:{
        type:Date,
        default:Date.now,
    }
});

// --- Creating Endpoint for Registering User (Signup) ---
app.post('/signup',async(req,res)=>{
    try {
        let check = await Users.findOne({email:req.body.email});
        if(check){
            // Corrected 'succes' to 'success'
            return res.status(400).json({success:false,errors:"Existing user found with same Email ID"});
        }

        // Corrected the problematic loop and initialized cart as an empty object
        let cart = {}; // An empty object to store cart items (e.g., { productId: quantity })
        for (let i = 1; i <= 300; i++) {
    cart[i] = 0;
}
        const user = new Users({
            name:req.body.name,
            email:req.body.email,
            password:req.body.password,
            cartData:cart, // Corrected 'cartDara' to 'cartData'
        });

        await user.save();

        const data = {
            user:{
                id:user.id // This is the MongoDB ObjectId for the user
            }
        };

        // For production, the secret should be in an environment variable
        // const token = jwt.sign(data, process.env.JWT_SECRET || 'secret_ecom');
        const token = jwt.sign(data,'secret_ecom'); // Using hardcoded for simplicity in this example

        res.json({success:true,token});

    } catch (error) {
        console.error("Error during user signup:", error);
        // Handle specific errors like duplicate email if unique constraint fails
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

//creating end point for user login
app.post('/login',async (req,res)=>{
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
})

//craeting end point for new collection data
app.get('/newcollection',async (req,res)=>{
    let products = await Product.find({});
    let newcollection = products.slice(1).slice(-8);
    console.log("Newcollection feteched");
    res.send(newcollection);
})

//creatimg end point for popular in women

app.get('/popularinwomen',async (req,res)=>{
    let products = await Product.find({category:"Women"});
    let popular_in_women = products.slice(0,4);
    console.log("popular in women fetched");
    res.send(popular_in_women);
})

//creating middleware to fetch user
const fetchUser = async (req,res,next)=>{
    const token = req.header('auth-token');
    if (!token) {
        res.status(401).send({errors:"please authenticate using valid token"})
    }
    else{
        try{
            const data = jwt.verify(token,'secret_ecom');
            req.user = data.user;
            next();
        }catch{
            res.status(401).send({errors:"please authenticate using a valid token"});
        }
    }
}

//creating end point for cart products
app.post('/addtocart',fetchUser, async (req,res)=>{
    console.log("Added",req.body.itemId);
    let userData = await Users.findOne({_id:req.user.id});
    userData.cartData[req.body.itemId] +=1;
    await Users.findOneAndUpdate({_id:req.user.id},{cartData:userData.cartData})
    res.send("Added")
    
})

//creating end point to remove product from cart data
app.post('/removefromcart',fetchUser,async(req,res)=>{
    console.log("remove",req.body.itemId);
     let userData = await Users.findOne({_id:req.user.id});
     if(userData.cartData[req.body.itemId]>0)
    userData.cartData[req.body.itemId] -=1;
    await Users.findOneAndUpdate({_id:req.user.id},{cartData:userData.cartData})
    res.send("Removed")
})

//creating endpoint to get cart data
app.post('/getcart',fetchUser,async(req,res)=>{
    console.log("GetCart");
    let userData = await Users.findOne({_id:req.user.id});
    res.json(userData.cartData);
})

// --- Start the Server ---
app.listen(port,()=>{
    console.log(`Server running on port ${port}`);
});
