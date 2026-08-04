/**
 * uploadAssetFile.js
 *
 * Multer instance for GIS asset ingestion (NOT images — the existing
 * uploadCloud.js rejects anything that is not image/*). Accepts a single
 * file held in memory as a Buffer:
 *   • a zipped shapefile  (.zip containing .shp/.dbf/.shx/.prj)
 *   • a GeoJSON document  (.geojson / .json)
 *
 * The buffer is handed to shapefileService for parsing + reprojection.
 */
const multer = require("multer");
const path = require("path");

const ALLOWED_EXT = [".zip", ".geojson", ".json"];
const ALLOWED_MIME = [
    "application/zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
    "application/geo+json",
    "application/json",
    "text/json",
    "application/octet-stream", // browsers often send this for .zip / .geojson
];

const uploadAssetFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — shapefiles can be large
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const okExt = ALLOWED_EXT.includes(ext);
        const okMime = ALLOWED_MIME.includes(file.mimetype);
        // Accept when either the extension or the MIME type looks right —
        // browser MIME reporting for .zip/.geojson is unreliable.
        if (okExt || okMime) return cb(null, true);
        cb(
            new Error(
                "Unsupported file. Upload a zipped shapefile (.zip) or a GeoJSON (.geojson/.json)."
            ),
            false
        );
    },
});

module.exports = uploadAssetFile;
