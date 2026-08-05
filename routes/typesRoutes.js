const express = require("express");
const { auth } = require("../middleware/auth");
const {
    getCategories,
    getSubtypes,
    getFloorUsageTypes,
    getTypeConfigs,
} = require("../controllers/wizardController");

const router = express.Router();

/** GET /api/types/categories */
router.get("/categories", getCategories);

/** GET /api/types/subtypes?category_id= */
router.get("/subtypes", getSubtypes);

/** GET /api/types/floor-usage */
router.get("/floor-usage", getFloorUsageTypes);

/** GET /api/types/config?category_id=&subtype_id=
 *  Survey shape (FLAT/SINGLE/MULTI) + question schema per property type. */
router.get("/config", getTypeConfigs);

module.exports = router;
