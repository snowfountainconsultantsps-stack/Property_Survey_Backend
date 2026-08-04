const jwt = require("jsonwebtoken");

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches decoded user payload to req.user.
 */
const auth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Access denied. No token provided.",
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token.",
        });
    }
};

/**
 * Middleware to restrict access to specific roles.
 * Must be used after the auth middleware.
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${req.user.role}' is not authorized.`,
            });
        }
        next();
    };
};

module.exports = { auth, authorize };
