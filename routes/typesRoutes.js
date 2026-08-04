const express = require("express");
const { auth } = require("../middleware/auth");
const { getCategories, getSubtypes, getFloorUsageTypes } = require("../controllers/wizardController");

const router = express.Router();

/** GET /api/types/categories */
router.get("/categories", getCategories);

/** GET /api/types/subtypes?category_id= */
router.get("/subtypes", getSubtypes);

/** GET /api/types/floor-usage */
router.get("/floor-usage", getFloorUsageTypes);

module.exports = router;
