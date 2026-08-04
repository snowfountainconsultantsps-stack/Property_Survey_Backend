const {
    Property, PropertyUtilities, Building, Floor, Unit, FloorOccupancy,
    PropertyTaxAssessment,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { computeTax } = require("../services/taxCalculator");

// Assemble the normalized property tree the calculator needs. Fetched with
// explicit per-table queries (rather than nested includes) so we don't depend
// on Sequelize's default association alias names.
async function buildProperty(propertyId) {
    const property = await Property.findByPk(propertyId);
    if (!property) return null;

    const [util, building] = await Promise.all([
        PropertyUtilities.findOne({ where: { property_id: propertyId } }),
        Building.findOne({ where: { property_id: propertyId } }),
    ]);

    let floors = [];
    if (building) {
        const floorRows = await Floor.findAll({
            where: { building_id: building.id },
            order: [["floor_number", "ASC"]],
        });
        floors = await Promise.all(
            floorRows.map(async (f) => {
                const [units, occ] = await Promise.all([
                    Unit.findAll({ where: { floor_id: f.id } }),
                    FloorOccupancy.findOne({ where: { floor_id: f.id } }),
                ]);
                return {
                    ...f.toJSON(),
                    Units: units.map((u) => u.toJSON()),
                    FloorOccupancy: occ ? occ.toJSON() : null,
                };
            })
        );
    }

    return {
        ...property.toJSON(),
        sewer_connection: !!util?.sewer_connection,
        Building: building ? { ...building.toJSON(), Floors: floors } : null,
    };
}

// GET /api/tax/property/:propertyId  → fresh calculation + stored assessment.
const getPropertyTax = asyncHandler(async (req, res) => {
    const property = await buildProperty(req.params.propertyId);
    if (!property) return res.status(404).json({ success: false, message: "Property not found." });

    const computed = computeTax(property);
    const assessment = await PropertyTaxAssessment.findOne({
        where: { property_id: req.params.propertyId },
    });

    res.status(200).json({ success: true, data: { computed, assessment } });
});

// POST /api/tax/property/:propertyId/approve  → freeze & mark APPROVED (admin).
const approvePropertyTax = asyncHandler(async (req, res) => {
    const property = await buildProperty(req.params.propertyId);
    if (!property) return res.status(404).json({ success: false, message: "Property not found." });

    const breakdown = computeTax(property);
    const payload = {
        polygon_id: property.polygon_id || null,
        project_id: property.project_id || null,
        assessment_year: breakdown.assessment_year,
        arv: breakdown.arv_total,
        total_amount: breakdown.total_annual,
        breakdown,
        status: "APPROVED",
        approved_by: req.user?.id || null,
        approved_at: new Date(),
    };

    let row = await PropertyTaxAssessment.findOne({ where: { property_id: property.id } });
    row = row
        ? await row.update(payload)
        : await PropertyTaxAssessment.create({ property_id: property.id, ...payload });

    res.status(200).json({ success: true, message: "Tax assessment approved.", data: row });
});

// GET /api/tax/public/code/:code  → citizen lookup, APPROVED only (no auth).
const getPublicTaxByCode = asyncHandler(async (req, res) => {
    const property = await Property.findOne({ where: { property_code: req.params.code } });
    if (!property) {
        return res.status(404).json({ success: false, message: "No property found for this House ID." });
    }
    const assessment = await PropertyTaxAssessment.findOne({
        where: { property_id: property.id, status: "APPROVED" },
    });
    if (!assessment) {
        return res.status(404).json({
            success: false,
            message: "Tax for this property has not been approved yet.",
        });
    }
    res.status(200).json({ success: true, data: assessment });
});

module.exports = { getPropertyTax, approvePropertyTax, getPublicTaxByCode };
