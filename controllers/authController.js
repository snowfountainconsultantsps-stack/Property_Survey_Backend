const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { asyncHandler } = require("../middleware/errorHandler");
const { User } = require("../models");

// ─── Generate JWT Token ──────────────────────────────────────
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, phone: user.phone, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || "7d" }
    );
};

// ─── Register ────────────────────────────────────────────────
// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
    const { full_name, phone, password, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ where: { phone } });

    if (existingUser) {
        return res.status(400).json({
            success: false,
            message: "User with this phone number already exists.",
        });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
        full_name,
        phone,
        password_hash,
        role: role || "SURVEYOR",
    });

    const token = generateToken(newUser);

    res.status(201).json({
        success: true,
        message: "User registered successfully.",
        data: {
            user: {
                id: newUser.id,
                full_name: newUser.full_name,
                phone: newUser.phone,
                role: newUser.role,
                createdAt: newUser.createdAt,
            },
            token,
        },
    });
});

// ─── Login ───────────────────────────────────────────────────
// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({
            success: false,
            message: "Please provide phone and password",
        });
    }

    // Find user by phone
    const user = await User.findOne({ where: { phone } });

    if (!user) {
        return res.status(401).json({
            success: false,
            message: "Invalid phone or password",
        });
    }

    // Check if user is active
    if (!user.is_active) {
        return res.status(403).json({
            success: false,
            message: "Account is deactivated. Please contact admin.",
        });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
        return res.status(401).json({
            success: false,
            message: "Invalid phone or password",
        });
    }

    const token = generateToken(user);

    res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
            user: {
                id: user.id,
                full_name: user.full_name,
                phone: user.phone,
                role: user.role,
                is_active: user.is_active,
            },
            token,
        },
    });
});

// ─── Get Current User ────────────────────────────────────────
// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id, {
        attributes: ["id", "full_name", "phone", "role", "createdAt", "updatedAt"],
    });

    if (!user) {
        return res.status(404).json({
            success: false,
            message: "User not found.",
        });
    }

    res.status(200).json({
        success: true,
        data: user,
    });
});

// ─── Logout ──────────────────────────────────────────────────
// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
    // JWT is stateless; logout is handled client-side by discarding the token.
    res.status(200).json({
        success: true,
        message: "Logged out successfully.",
    });
});

// ─── Get Profile ─────────────────────────────────────────────
// GET /api/auth/profile
const getProfile = asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id, {
        attributes: ["id", "full_name", "phone", "role", "is_active", "createdAt", "updatedAt"],
    });

    if (!user) {
        return res.status(404).json({
            success: false,
            message: "User not found.",
        });
    }

    res.status(200).json({
        success: true,
        data: user,
    });
});

// ─── Update Profile ───────────────────────────────────────────
// PUT /api/auth/updateProfile
const updateProfile = asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id);

    if (!user) {
        return res.status(404).json({
            success: false,
            message: "User not found.",
        });
    }

    const { full_name, phone, password } = req.body;

    if (full_name) user.full_name = full_name;

    if (phone && phone !== user.phone) {
        const taken = await User.findOne({ where: { phone } });
        if (taken) {
            return res.status(400).json({
                success: false,
                message: "Phone number already in use.",
            });
        }
        user.phone = phone;
    }

    if (password) {
        const salt = await bcrypt.genSalt(12);
        user.password_hash = await bcrypt.hash(password, salt);
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: "Profile updated successfully.",
        data: {
            id: user.id,
            full_name: user.full_name,
            phone: user.phone,
            role: user.role,
            updatedAt: user.updatedAt,
        },
    });
});

// ─── Admin: Create User ───────────────────────────────────────
// POST /api/auth/users
const VALID_ROLES = ["ADMIN", "SUPERVISOR", "SURVEYOR", "GIS_EDITOR", "GIS_ADMIN"];

const createUser = asyncHandler(async (req, res) => {
    const { full_name, phone, password, role } = req.body;

    if (!full_name || !phone || !password || !role) {
        return res.status(400).json({
            success: false,
            message: "Please provide full_name, phone, password, and role",
        });
    }

    if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({
            success: false,
            message: "Invalid role. Must be one of: " + VALID_ROLES.join(", "),
        });
    }

    const existing = await User.findOne({ where: { phone } });
    if (existing) {
        return res.status(400).json({
            success: false,
            message: "User already exists with this phone number",
        });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const user = await User.create({ full_name, phone, password_hash, role, is_active: true });

    res.status(201).json({
        success: true,
        message: "User created successfully",
        data: {
            id: user.id,
            full_name: user.full_name,
            phone: user.phone,
            role: user.role,
            is_active: user.is_active,
        },
    });
});

// ─── Admin: Get All Users ─────────────────────────────────────
// GET /api/auth/users
const getAllUsers = asyncHandler(async (req, res) => {
    const users = await User.findAll({
        attributes: ["id", "full_name", "phone", "role", "is_active", "createdAt"],
        order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
        success: true,
        count: users.length,
        data: users,
    });
});

// ─── Admin: Get User Details ──────────────────────────────────
// GET /api/auth/users/:id
const getUserDetails = asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id, {
        attributes: ["id", "full_name", "phone", "role", "is_active", "createdAt", "updatedAt"],
    });

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, data: user });
});

// ─── Admin: Delete User ───────────────────────────────────────
// DELETE /api/auth/users/:id
const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id);

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.id === req.user.id) {
        return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }

    await user.destroy();

    res.status(200).json({ success: true, message: "User deleted successfully" });
});

// ─── Admin: Update User Password ─────────────────────────────
// PUT /api/auth/users/:id/password
const updateUserPassword = asyncHandler(async (req, res) => {
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
        return res.status(400).json({
            success: false,
            message: "new_password must be at least 6 characters",
        });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(new_password, salt);
    await user.save();

    res.status(200).json({ success: true, message: "Password updated successfully" });
});

// ─── Admin: Update User Status ────────────────────────────────
// PUT /api/auth/users/:id/status
const updateUserStatus = asyncHandler(async (req, res) => {
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
        return res.status(400).json({
            success: false,
            message: "is_active must be a boolean",
        });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.id === req.user.id) {
        return res.status(400).json({ success: false, message: "You cannot change your own status" });
    }

    user.is_active = is_active;
    await user.save();

    res.status(200).json({
        success: true,
        message: `User ${is_active ? "activated" : "deactivated"} successfully`,
        data: { id: user.id, is_active: user.is_active },
    });
});

module.exports = { register, login, getMe, logout, getProfile, updateProfile, createUser, getAllUsers, getUserDetails, deleteUser, updateUserPassword, updateUserStatus };
