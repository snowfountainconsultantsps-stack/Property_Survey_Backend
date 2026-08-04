const express = require("express");
const { body } = require("express-validator");
const {
    createProperty,
    getProperties,
    getPropertyById,
    updateProperty,
    deleteProperty,
} = require("../controllers/propertyController");
const { auth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

// GET /api/properties
router.get("/", getProperties);

// GET /api/properties/:id
router.get("/:id", getPropertyById);

// POST /api/properties  (auth required)
router.post(
    "/",
    auth,
    [
        body("polygon_id").notEmpty().withMessage("polygon_id is required."),
        body("address").trim().notEmpty().withMessage("Address is required."),
        body("property_type")
            .notEmpty()
            .isIn(["Residential", "NonResidential", "Mixed", "Vacant"])
            .withMessage("property_type must be Residential, NonResidential, Mixed, or Vacant."),
        body("property_subtype")
            .optional()
            .isIn(["SingleStory", "MultiStory", "Commercial", "PetrolPump", "CommercialComplex"])
            .withMessage("Invalid property_subtype."),
        body("plot_area")
            .optional()
            .isFloat({ min: 0 })
            .withMessage("plot_area must be a positive number."),
    ],
    validate,
    createProperty
);

// PUT /api/properties/:id  (auth required)
router.put("/:id", auth, updateProperty);

// DELETE /api/properties/:id  (auth required)
router.delete("/:id", auth, deleteProperty);

module.exports = router;
