/**
 * cloudinary.js
 *
 * Central Cloudinary configuration + a small helper for streaming an
 * in-memory file buffer (from multer memoryStorage) up to Cloudinary.
 *
 * Required env vars (.env):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
    // Field photos come straight off a phone camera (several MB each) over
    // mobile data, which was overrunning the default and surfacing as
    // "Request Timeout" 500s on /photos.
    timeout: 120000,
});

/** True only when all three Cloudinary credentials are present. */
const isConfigured = () =>
    Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
            process.env.CLOUDINARY_API_KEY &&
            process.env.CLOUDINARY_API_SECRET
    );

/**
 * Upload a raw image buffer to Cloudinary and resolve with the result
 * (contains `secure_url`, `public_id`, etc.).
 *
 * @param {Buffer} buffer  - the file bytes (req.file.buffer / req.files[i].buffer)
 * @param {Object} [opts]
 * @param {string} [opts.folder]    - Cloudinary folder to store the image in
 * @returns {Promise<import("cloudinary").UploadApiResponse>}
 */
const uploadBuffer = (buffer, { folder = "property_survey" } = {}) =>
    new Promise((resolve, reject) => {
        if (!isConfigured()) {
            return reject(
                new Error(
                    "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
                )
            );
        }
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: "image",
                // Survey photos are evidence, not print assets. Capping the
                // long edge and letting Cloudinary pick the format/quality
                // keeps them legible while cutting storage and the bandwidth
                // every later view costs.
                transformation: [
                    { width: 1600, height: 1600, crop: "limit" },
                    { quality: "auto:good", fetch_format: "auto" },
                ],
            },
            (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(buffer);
    });

module.exports = { cloudinary, uploadBuffer, isConfigured };
