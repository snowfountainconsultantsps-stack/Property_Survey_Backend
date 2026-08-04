const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const {
    listLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    getLocationTree,
} = require("../controllers/locationController");

const router = express.Router();

// Only admins/GIS staff may reshape the location hierarchy.
const LOCATION_ADMIN = authorize("ADMIN", "GIS_ADMIN", "GIS_EDITOR");

// GET /api/locations/tree  (before /:level so it isn't shadowed)
router.get("/tree", auth, getLocationTree);

// :level = states | districts | cities | zones | wards
router.get("/:level", auth, listLocations);
router.post("/:level", auth, LOCATION_ADMIN, createLocation);
router.put("/:level/:id", auth, LOCATION_ADMIN, updateLocation);
router.delete("/:level/:id", auth, LOCATION_ADMIN, deleteLocation);

module.exports = router;
