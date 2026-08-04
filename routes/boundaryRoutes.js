const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const uploadAssetFile = require("../config/uploadAssetFile");
const {
    getLevelBoundaries,
    uploadSingleBoundary,
    bulkUploadBoundaries,
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

module.exports = router;
