const express = require("express");
const { body } = require("express-validator");
const { register, login, getMe, logout, getProfile, updateProfile, createUser, getAllUsers, getUserDetails, deleteUser, updateUserPassword, updateUserStatus } = require("../controllers/authController");
const { auth, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

// POST /api/auth/register
router.post(
    "/register",
    [
        body("full_name").trim().notEmpty().withMessage("Full name is required."),
        body("phone").trim().notEmpty().withMessage("Phone number is required."),
        body("password")
            .isLength({ min: 6 })
            .withMessage("Password must be at least 6 characters."),
        body("role")
            .optional()
            .isIn(["ADMIN", "SUPERVISOR", "SURVEYOR", "GIS_EDITOR", "GIS_ADMIN"])
            .withMessage("Invalid role."),
    ],
    validate,
    register
);

// POST /api/auth/login
router.post(
    "/login",
    [
        body("phone").trim().notEmpty().withMessage("Phone number is required."),
        body("password").notEmpty().withMessage("Password is required."),
    ],
    validate,
    login
);

// GET /api/auth/me
router.get("/me", auth, getMe);

// POST /api/auth/logout
router.post("/logout", auth, logout);

// GET /api/auth/profile
router.get("/profile", auth, getProfile);

// PUT /api/auth/updateProfile
router.put("/updateProfile", auth, updateProfile);

// ── Admin: User Management ─────────────────────────────────────
// GET  /api/auth/users
router.get("/users", auth, authorize("ADMIN"), getAllUsers);

// POST /api/auth/users
router.post("/users", auth, authorize("ADMIN"), [
    body("full_name").trim().notEmpty().withMessage("full_name is required."),
    body("phone").trim().notEmpty().withMessage("phone is required."),
    body("password").isLength({ min: 6 }).withMessage("password must be at least 6 characters."),
    body("role").isIn(["ADMIN", "SUPERVISOR", "SURVEYOR", "GIS_EDITOR", "GIS_ADMIN"]).withMessage("Invalid role."),
], validate, createUser);

// GET  /api/auth/users/:id
router.get("/users/:id", auth, authorize("ADMIN"), getUserDetails);

// DELETE /api/auth/users/:id
router.delete("/users/:id", auth, authorize("ADMIN"), deleteUser);

// PUT /api/auth/users/:id/password
router.put("/users/:id/password", auth, authorize("ADMIN"), updateUserPassword);

// PUT /api/auth/users/:id/status
router.put("/users/:id/status", auth, authorize("ADMIN"), updateUserStatus);

module.exports = router;
