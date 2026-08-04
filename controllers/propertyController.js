const {
    Property,
    Polygon,
    PropertyOwner,
    PropertyUtilities,
    PropertyRoad,
    PropertyPhoto,
    Building,
    Floor,
    FloorUtilities,
    FloorOccupancy,
    Unit,
    UnitOwner,
    UnitUtilities,
    UnitPhoto,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");

// ─── Create Property ─────────────────────────────────────────
// POST /api/properties
const createProperty = asyncHandler(async (req, res) => {
    const {
        polygon_id,
        project_id,
        property_type,
        property_subtype,
        address,
        plot_area,
        construction_type,
        survey_date,
    } = req.body;

    const property = await Property.create({
        polygon_id,
        project_id,
        property_type,
        property_subtype,
        address,
        plot_area,
        construction_type,
        survey_date,
        surveyor_id: req.user?.id,
    });

    res.status(201).json({
        success: true,
        message: "Property created successfully.",
        data: property,
    });
});

// ─── Get All Properties ──────────────────────────────────────
// GET /api/properties
const getProperties = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, property_type, project_id } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (property_type) where.property_type = property_type;
    if (project_id) where.project_id = project_id;

    const { rows: data, count } = await Property.findAndCountAll({
        where,
        include: [
            { model: Polygon, attributes: ["id", "polygon_code", "ward_id", "gis_status"] },
            { model: PropertyOwner },
            { model: PropertyUtilities },
            { model: PropertyRoad },
            { model: PropertyPhoto },
            {
                model: Building,
                include: [
                    {
                        model: Floor,
                        include: [
                            { model: FloorUtilities },
                            { model: FloorOccupancy },
                            {
                                model: Unit,
                                include: [
                                    { model: UnitOwner },
                                    { model: UnitUtilities },
                                    { model: UnitPhoto },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        order: [["createdAt", "DESC"]],
        limit: Number(limit),
        offset: Number(offset),
        distinct: true,
    });

    res.status(200).json({
        success: true,
        count,
        page: Number(page),
        totalPages: Math.ceil(count / limit),
        data,
    });
});

// ─── Get Property By ID ──────────────────────────────────────
// GET /api/properties/:id
const getPropertyById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const property = await Property.findByPk(id, {
        include: [
            { model: Polygon, attributes: ["id", "polygon_code", "ward_id", "gis_status"] },
            { model: PropertyOwner },
            { model: PropertyUtilities },
            { model: PropertyRoad },
            { model: PropertyPhoto },
            {
                model: Building,
                include: [
                    {
                        model: Floor,
                        include: [
                            { model: FloorUtilities },
                            { model: FloorOccupancy },
                            {
                                model: Unit,
                                include: [
                                    { model: UnitOwner },
                                    { model: UnitUtilities },
                                    { model: UnitPhoto },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    if (!property) {
        return res.status(404).json({
            success: false,
            message: "Property not found.",
        });
    }

    res.status(200).json({
        success: true,
        data: property,
    });
});

// ─── Update Property ─────────────────────────────────────────
// PUT /api/properties/:id
const updateProperty = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const property = await Property.findByPk(id);

    if (!property) {
        return res.status(404).json({
            success: false,
            message: "Property not found.",
        });
    }

    const updatedProperty = await property.update(req.body);

    res.status(200).json({
        success: true,
        message: "Property updated successfully.",
        data: updatedProperty,
    });
});

// ─── Delete Property ─────────────────────────────────────────
// DELETE /api/properties/:id
const deleteProperty = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const property = await Property.findByPk(id);

    if (!property) {
        return res.status(404).json({
            success: false,
            message: "Property not found.",
        });
    }

    await property.destroy();

    res.status(200).json({
        success: true,
        message: "Property deleted successfully.",
    });
});

module.exports = {
    createProperty,
    getProperties,
    getPropertyById,
    updateProperty,
    deleteProperty,
};
