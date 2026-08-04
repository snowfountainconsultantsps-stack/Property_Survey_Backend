const express = require("express");
const { auth } = require("../middleware/auth");
const {
  findPolygonByLocation,
  getAllPolygonsWithSurveyStatus,
} = require("../controllers/gisController");

const router = express.Router();

// GET /api/gis/find-polygon?lat=...&lng=...
router.get("/find-polygon", auth, findPolygonByLocation);

// GET /api/gis/polygons
router.get("/polygons", auth, getAllPolygonsWithSurveyStatus);

module.exports = router;
