const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const tax = require("../controllers/taxController");

const router = express.Router();

// Public citizen lookup (no auth) — declared before the auth-guarded routes.
router.get("/public/code/:code", tax.getPublicTaxByCode);

// Admin: view a fresh calculation + any stored assessment.
router.get("/property/:propertyId", auth, tax.getPropertyTax);

// Admin: approve (freeze) the assessment so citizens can see it.
router.post(
    "/property/:propertyId/approve",
    auth,
    authorize("ADMIN", "GIS_ADMIN"),
    tax.approvePropertyTax
);

module.exports = router;
