require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { authenticateUser, isAdmin } = require("./middleware/authmiddleware");
const app = express();
app.use(express.json());

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ["https://dev-source-final-frontend-e5e7.vercel.app"];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200, // For legacy browsers
};

app.use(cors(corsOptions));

//cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cloudinary connection test
cloudinary.api.ping((error, result) => {
  if (error) {
    console.error("❌ Cloudinary connection failed:", error.message);
  } else {
    console.log("✅ Cloudinary connected successfully:", result);
  }
});


const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "devsource_profiles",
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const upload = multer({ storage });

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("MongoDB connected"))
.catch((err) => console.error("MongoDB connection error:", err));
// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  profilePicture: {
    type: String,
    default: ""
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  description: {
    type: String,
    default: ""
  },
  address: {
    type: String,
    default: ""
  }
});
const projectSchema = new mongoose.Schema({
  title: String,
  description: String,
  type: {
    type: Number,
    enum: [1, 2, 3],
    required: true
  },
  images: {
    type: [String],
    default: []
  },
  createdAt: Date,
  endDate: Date
});
const blogSchema = new mongoose.Schema({
  title: String,
  description: String,
  createdAt: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },
  image: {
    type: String,
    required: false,
  },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
  dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
});
// Models
const User = mongoose.model("user", userSchema);
const Project = mongoose.model("project", projectSchema);
const Blog = mongoose.model("blog", blogSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || "defaultSecret";

// 🔐 Register - User
app.post("/register/user", async (req, res) => {
  const { name, email, password, profilePicture } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10); // 👈 Hash password

    const user = new User({ name, email, password: hashedPassword, profilePicture, role: "user" });
    await user.save();
    res.status(201).json({ message: "User registered successfully", user });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// 🔐 Register - Admin
app.post("/register/admin", async (req, res) => {
  const { name, email, password, profilePicture } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing && existing.role === "admin") return res.status(400).json({ message: "Admin already exists" });

    const admin = new User({ name, email, password, profilePicture, role: "admin" });
    await admin.save();
    res.status(201).json({ message: "Admin registered successfully", admin });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// 🔑 Login - User
app.post("/login/user", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email, role: "user" });
    if (!user) {
      return res.status(400).json({ message: "Invalid user credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password); // 👈 Compare hashed
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid user credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
    res.status(200).json({ message: "User login successful", token, user });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// 🔑 Login - Admin
app.post("/login/admin", async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await User.findOne({ email, role: "admin" });
    if (!admin || admin.password !== password) {
      return res.status(400).json({ message: "Invalid admin credentials" });
    }

    const token = jwt.sign({ id: admin._id, role: admin.role }, JWT_SECRET, { expiresIn: "24h" });
    res.status(200).json({ message: "Admin login successful", token, admin });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

//serach blogs 
// Search blogs by keyword (title or description)
app.get("/searchBlogs", authenticateUser, async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ message: "Search query is required" });
  }

  try {
    const regex = new RegExp(query, "i"); // i => case-insensitive
    const blogs = await Blog.find({
      $or: [
        { title: { $regex: regex } },
        { description: { $regex: regex } },
      ],
    });
    res.status(200).json(blogs);
  } catch (err) {
    res.status(500).json({ message: "Failed to search blogs", error: err.message });
  }
});

// Endpoint: Upload profile picture
app.post("/upload/profile-picture", authenticateUser, upload.single("profilePicture"), async (req, res) => {
  try {
    console.log("FILE RECEIVED:", req.file);
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const imageUrl = req.file.path;
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { profilePicture: imageUrl },
      { new: true }
    ).select("-password");

    res.status(200).json({ message: "Profile picture updated", user: updatedUser });
  } catch (err) {
    console.error("UPLOAD ERROR:");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
    console.log("REQ.FILE:", req.file);
    console.dir(err, { depth: null }); // <- full error
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});


// Protected: Get all blogs
app.get("/getAllBlogs", authenticateUser, async (req, res) => {
  try {
    const blogs = await Blog.find()
      .populate("createdBy", "name profilePicture")
      .lean();

    const enrichedBlogs = blogs.map((blog) => ({
      ...blog,
      likesCount: blog.likes?.length || 0,
      dislikesCount: blog.dislikes?.length || 0,
      createdByName: blog.createdBy?.name || "Unknown",
      createdByProfile: blog.createdBy?.profilePicture || "",
    }));

    res.status(200).json(enrichedBlogs);
  } catch (err) {
    res.status(500).json({ message: "Failed to get blogs", error: err.message });
  }
});


// likes and dislikes - 

//like 
app.post("/blog/like/:id", authenticateUser, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    const userId = req.user.id;

    // Remove from dislikes if exists
    blog.dislikes = blog.dislikes.filter((id) => id.toString() !== userId);

    // Toggle like
    if (blog.likes.includes(userId)) {
      blog.likes = blog.likes.filter((id) => id.toString() !== userId);
    } else {
      blog.likes.push(userId);
    }

    await blog.save();
    res.status(200).json({
      message: "Like status updated",
      likes: blog.likes.length,
      dislikes: blog.dislikes.length,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to like blog", error: err.message });
  }
});


//dislike 
app.post("/blog/dislike/:id", authenticateUser, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    const userId = req.user.id;

    // Remove from likes if exists
    blog.likes = blog.likes.filter((id) => id.toString() !== userId);

    // Toggle dislike
    if (blog.dislikes.includes(userId)) {
      blog.dislikes = blog.dislikes.filter((id) => id.toString() !== userId);
    } else {
      blog.dislikes.push(userId);
    }

    await blog.save();
    res.status(200).json({
      message: "Dislike status updated",
      likes: blog.likes.length,
      dislikes: blog.dislikes.length,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to dislike blog", error: err.message });
  }
});



// Protected: User deletes own blog
app.delete("/deleteBlog/:id", authenticateUser, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    if (blog.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can't delete this blog" });
    }

    await Blog.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Blog deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete", error: err.message });
  }
});


// Admin: Delete any blog
app.delete("/admin/deleteBlog/:id", authenticateUser, isAdmin, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    await Blog.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Blog deleted by admin" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete blog", error: err.message });
  }
});

// Admin: Delete a user
app.delete("/unauthorize/:userId", authenticateUser, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    await User.findByIdAndDelete(req.params.userId);
    res.status(200).json({ message: "User deleted by admin" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user", error: err.message });
  }
});

// Admin: Get all users
app.get("/getAllUser", authenticateUser, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to get users", error: err.message });
  }
});

// Create blog (authenticated users only)
app.post("/addBlog", authenticateUser, async (req, res) => {
  const { title, description, image } = req.body;

  if (!title || !description) {
    return res.status(400).json({ message: "Title and description are required." });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const newBlog = new Blog({
      title,
      description,
      image: image || "",
      createdBy: user._id,
      createdAt: new Date(),
    });

    await newBlog.save();
    res.status(201).json({ message: "Blog created successfully", blog: newBlog });
  } catch (err) {
    res.status(500).json({ message: "Failed to create blog", error: err.message });
  }
});



// Get all projects (authenticated users)
app.get("/getAllProjects", authenticateUser, async (req, res) => {
  try {
    const projects = await Project.find(); // ✅ Corrected: was Project.findAll()
    res.status(200).json(projects);
  } catch (err) {
    res.status(500).json({ message: "Failed to get projects", error: err.message });
  }
});

// Add a new project (admin only)
app.post("/addProject", authenticateUser, isAdmin, async (req, res) => {
  const { title, description, type, createdAt, endDate, images } = req.body;

  if (!title || !description || !type) {
    return res.status(400).json({ message: "Title, description, and type are required." });
  }

  if (![1, 2, 3].includes(type)) {
    return res.status(400).json({ message: "Invalid project type. Must be 1, 2, or 3." });
  }

  try {
    const newProject = new Project({
      title,
      description,
      type,
      images: images || [],
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
    });

    await newProject.save();
    res.status(201).json({ message: "Project added successfully", project: newProject });
  } catch (err) {
    res.status(500).json({ message: "Failed to add project", error: err.message });
  }
});

// Get user by ID (authenticated users only)
app.get("/user/:id", authenticateUser, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to get user", error: err.message });
  }
});

// Get all blogs created by a specific user
app.get("/user/:id/blogs", authenticateUser, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const blogs = await Blog.find({ createdBy: userId }).lean();

    const enrichedBlogs = blogs.map((blog) => ({
      ...blog,
      likesCount: blog.likes?.length || 0,
      dislikesCount: blog.dislikes?.length || 0,
    }));

    res.status(200).json(enrichedBlogs);
  } catch (err) {
    res.status(500).json({ message: "Failed to get user blogs", error: err.message });
  }
});

// Update user's profile picture
// Update description and address
app.put("/user/profile-info", authenticateUser, async (req, res) => {
  const { description, address } = req.body;

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { description, address },
      { new: true }
    ).select("-password");

    res.status(200).json({ message: "Profile info updated", user: updatedUser });
  } catch (err) {
    res.status(500).json({ message: "Failed to update info", error: err.message });
  }
});
// Home route
app.get("/", (req, res) => {
  res.send("It's working");
});
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));