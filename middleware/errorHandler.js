/**
 * Global error handler middleware.
 * Catches all errors and returns a consistent JSON response.
 */
const errorHandler = (err, req, res, next) => {
    console.error("❌ Error:", err.message);
    console.error(err.stack);

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: err.message || "Internal Server Error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
};

/**
 * Wraps an async route handler to automatically catch errors
 * and forward them to the global error handler.
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
