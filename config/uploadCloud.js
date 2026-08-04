/**
 * uploadCloud.js
 *
 * Multer configured with memoryStorage so uploaded files stay in RAM as a
 * Buffer (req.file.buffer / req.files[i].buffer) and can be streamed straight
 * to Cloudinary — nothing is ever written to local disk.
 *
 * Use `upload.any()` at the route level so we accept image files regardless of
 * the FormData field name the mobile app uses (the app currently sends both
 * "images" and "photos").
 */
const multer = require("multer");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"), false);
        }
    },
});

module.exports = upload;
