const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const uploadAssetFile = require("../config/uploadAssetFile");
const imageUpload = require("../config/uploadCloud");

const asset = require("../controllers/assetController");
const uploads = require("../controllers/assetUploadController");
const survey = require("../controllers/assetSurveyController");
const pdf = require("../controllers/assetPdfController");
const propertyUpload = require("../controllers/propertyUploadController");

const router = express.Router();

// Roles that may manage the catalog + review/publish GIS data.
const GIS_ADMIN = authorize("ADMIN", "GIS_ADMIN", "GIS_EDITOR");

// ═════════════════════════════════════════════════════════════
// PDF DOCUMENTS  (place before param routes so paths aren't shadowed)
// ═════════════════════════════════════════════════════════════
router.get("/docs/design.pdf", auth, pdf.getDesignDoc);
router.get("/reports/ward/:wardId", auth, pdf.getWardReport);
router.get("/reports/project/:projectId", auth, pdf.getProjectReport);

// ═════════════════════════════════════════════════════════════
// CATALOG — categories & layers
// ═════════════════════════════════════════════════════════════
router.get("/categories", auth, asset.getCategories);
router.post("/categories", auth, GIS_ADMIN, asset.createCategory);

router.get("/layers", auth, asset.getLayers);
router.post("/layers", auth, GIS_ADMIN, asset.createLayer);
router.get("/layers/:id", auth, asset.getLayerById);
router.put("/layers/:id", auth, GIS_ADMIN, asset.updateLayer);
router.delete("/layers/:id", auth, GIS_ADMIN, asset.deleteLayer);

// Features of a single layer (GeoJSON).
router.get("/layers/:id/features", auth, asset.getLayerFeatures);

// ═════════════════════════════════════════════════════════════
// UPLOAD WORKFLOW — shapefile-zip / GeoJSON → stage → verify → publish
// ═════════════════════════════════════════════════════════════
router.post(
    "/layers/:layerId/uploads",
    auth,
    GIS_ADMIN,
    uploadAssetFile.single("file"),
    uploads.uploadAssetData
);
// Property/parcel boundary shapefile upload → creates Polygon records
// (separate from the AssetFeature layer uploads above).
router.post(
    "/uploads/property",
    auth,
    GIS_ADMIN,
    uploadAssetFile.single("file"),
    propertyUpload.uploadPropertyShapefile
);
router.get("/uploads", auth, GIS_ADMIN, uploads.listUploads);
router.get("/uploads/:id", auth, GIS_ADMIN, uploads.getUpload);
router.get("/uploads/:id/features", auth, GIS_ADMIN, uploads.getUploadFeatures);
router.post("/uploads/:id/verify", auth, GIS_ADMIN, uploads.verifyUpload);
router.post("/uploads/:id/publish", auth, GIS_ADMIN, uploads.publishUpload);
router.post("/uploads/:id/reject", auth, GIS_ADMIN, uploads.rejectUpload);
router.delete("/uploads/:id", auth, GIS_ADMIN, uploads.deleteUpload);

// ═════════════════════════════════════════════════════════════
// LAYERED MAP + STATS
// ═════════════════════════════════════════════════════════════
router.get("/map", auth, asset.getAssetMap);
router.get("/stats", auth, asset.getAssetStats);

// ═════════════════════════════════════════════════════════════
// FEATURES — nearby (surveyor) must precede /features/:id
// ═════════════════════════════════════════════════════════════
router.get("/features/nearby", auth, asset.getNearbyFeatures);
// Parcel feature → Polygon bridge, so a property survey can start from a
// feature the surveyor tapped on the map.
router.post("/features/:id/ensure-polygon", auth, asset.ensureFeaturePolygon);
router.post("/features/search", auth, asset.searchFeaturesByAttributes);
router.post("/features", auth, asset.createFeature);
router.get("/features/:id", auth, asset.getFeatureById);
router.put("/features/:id", auth, GIS_ADMIN, asset.updateFeature);
router.delete("/features/:id", auth, GIS_ADMIN, asset.deleteFeature);

// ═════════════════════════════════════════════════════════════
// SURVEYOR ASSET SURVEY + PHOTOS + REVIEW
// ═════════════════════════════════════════════════════════════
router.post("/features/:id/survey", auth, survey.submitSurvey);
router.get("/features/:id/surveys", auth, survey.getFeatureSurveys);
router.post("/features/:id/photos", auth, imageUpload.any(), survey.addFeaturePhotos);
router.get("/features/:id/photos", auth, survey.getFeaturePhotos);

router.get("/surveys/my", auth, survey.getMyAssetSurveys);
router.get("/surveys", auth, GIS_ADMIN, survey.listSurveys);
router.post("/surveys/:id/approve", auth, GIS_ADMIN, survey.approveSurvey);
router.post("/surveys/:id/reject", auth, GIS_ADMIN, survey.rejectSurvey);

module.exports = router;
