const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const uploadAssetFile = require("../config/uploadAssetFile");
const {
    getLevelBoundaries,
    uploadSingleBoundary,
    bulkUploadBoundaries,
    previewBoundaryImport,
    commitBoundaryImport,
} = require("../controllers/boundaryController");

const router = express.Router();

// Roles that may manage location-hierarchy boundaries.
const GIS_ADMIN = authorize("ADMIN", "GIS_ADMIN", "GIS_EDITOR");

// GET /api/boundaries?level=STATE|DISTRICT|CITY|WARD&parent_id=
router.get("/", auth, getLevelBoundaries);

// POST /api/boundaries/:level/:id/upload  — set one row's boundary
router.post("/:level/:id/upload", auth, GIS_ADMIN, uploadAssetFile.single("file"), uploadSingleBoundary);

// POST /api/boundaries/:level/bulk-upload  — match many boundaries by name/code
router.post("/:level/bulk-upload", auth, GIS_ADMIN, uploadAssetFile.single("file"), bulkUploadBoundaries);

// Import the hierarchy FROM a shapefile (creates rows that don't exist yet).
// preview → admin verifies exactly what will be created → commit.
router.post("/:level/import/preview", auth, GIS_ADMIN, uploadAssetFile.single("file"), previewBoundaryImport);
router.post("/:level/import/commit", auth, GIS_ADMIN, uploadAssetFile.single("file"), commitBoundaryImport);

module.exports = router;
