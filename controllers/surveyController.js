const {
    Property,
    Building,
    Floor,
    FloorUtilities,
    FloorOccupancy,
    Unit,
    UnitOwner,
    UnitUtilities,
    UnitPhoto,
    PropertyOwner,
    PropertyUtilities,
    PropertyRoad,
    PropertyPhoto,
    Polygon,
    Survey,
    State,
    District,
    City,
    Zone,
    Ward,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { uploadBuffer } = require("../config/cloudinary");
const enums = require("../models/enums");

// ═══════════════════════════════════════════════════════════════
// POLYGON CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createPolygon = asyncHandler(async (req, res) => {
    const polygon = await Polygon.create(req.body);
    res.status(201).json({ success: true, message: "Polygon created.", data: polygon });
});

const getPolygons = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.ward_id) where.ward_id = req.query.ward_id;
    if (req.query.project_id) where.project_id = req.query.project_id;
    const polygons = await Polygon.findAll({ where, order: [["polygon_code", "ASC"]] });
    res.status(200).json({ success: true, data: polygons });
});

const getPolygonById = asyncHandler(async (req, res) => {
    const polygon = await Polygon.findByPk(req.params.id, {
        include: [{ model: Property }],
    });
    if (!polygon) return res.status(404).json({ success: false, message: "Polygon not found." });
    res.status(200).json({ success: true, data: polygon });
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY OWNER CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createPropertyOwner = asyncHandler(async (req, res) => {
    const owner = await PropertyOwner.create(req.body);
    res.status(201).json({ success: true, message: "Property owner created.", data: owner });
});

const getPropertyOwners = asyncHandler(async (req, res) => {
    const owners = await PropertyOwner.findAll({
        where: { property_id: req.params.propertyId },
    });
    res.status(200).json({ success: true, data: owners });
});

const updatePropertyOwner = asyncHandler(async (req, res) => {
    const owner = await PropertyOwner.findByPk(req.params.id);
    if (!owner) return res.status(404).json({ success: false, message: "Owner not found." });
    const updated = await owner.update(req.body);
    res.status(200).json({ success: true, message: "Owner updated.", data: updated });
});

const deletePropertyOwner = asyncHandler(async (req, res) => {
    const owner = await PropertyOwner.findByPk(req.params.id);
    if (!owner) return res.status(404).json({ success: false, message: "Owner not found." });
    await owner.destroy();
    res.status(200).json({ success: true, message: "Owner deleted." });
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY UTILITIES CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const upsertPropertyUtilities = asyncHandler(async (req, res) => {
    const [utilities, created] = await PropertyUtilities.upsert({
        ...req.body,
        property_id: req.params.propertyId,
    });
    res.status(created ? 201 : 200).json({
        success: true,
        message: created ? "Utilities created." : "Utilities updated.",
        data: utilities,
    });
});

const getPropertyUtilities = asyncHandler(async (req, res) => {
    const utilities = await PropertyUtilities.findOne({
        where: { property_id: req.params.propertyId },
    });
    if (!utilities) return res.status(404).json({ success: false, message: "Utilities not found." });
    res.status(200).json({ success: true, data: utilities });
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY ROAD CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createPropertyRoad = asyncHandler(async (req, res) => {
    const road = await PropertyRoad.create({ ...req.body, property_id: req.params.propertyId });
    res.status(201).json({ success: true, message: "Road created.", data: road });
});

const getPropertyRoads = asyncHandler(async (req, res) => {
    const roads = await PropertyRoad.findAll({
        where: { property_id: req.params.propertyId },
    });
    res.status(200).json({ success: true, data: roads });
});

const updatePropertyRoad = asyncHandler(async (req, res) => {
    const road = await PropertyRoad.findByPk(req.params.id);
    if (!road) return res.status(404).json({ success: false, message: "Road not found." });
    const updated = await road.update(req.body);
    res.status(200).json({ success: true, message: "Road updated.", data: updated });
});

const deletePropertyRoad = asyncHandler(async (req, res) => {
    const road = await PropertyRoad.findByPk(req.params.id);
    if (!road) return res.status(404).json({ success: false, message: "Road not found." });
    await road.destroy();
    res.status(200).json({ success: true, message: "Road deleted." });
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY PHOTO CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createPropertyPhoto = asyncHandler(async (req, res) => {
    const files = req.files || [];

    // Multipart upload: push each image to Cloudinary, store the secure URL.
    if (files.length > 0) {
        const created = [];
        for (const file of files) {
            const result = await uploadBuffer(file.buffer, {
                folder: "property_survey/properties",
            });
            created.push(
                await PropertyPhoto.create({
                    property_id: req.params.propertyId,
                    photo_url:   result.secure_url,
                    photo_type:  req.body.photo_type || "property",
                    caption:     req.body.caption || null,
                })
            );
        }
        return res.status(201).json({
            success: true,
            message: "Photo(s) added.",
            data: created,
            image_urls: created.map((p) => p.photo_url),
        });
    }

    // JSON fallback: an already-hosted photo_url was provided directly.
    if (!req.body.photo_url) {
        return res.status(400).json({
            success: false,
            message: "No image file or photo_url provided.",
        });
    }
    const photo = await PropertyPhoto.create({ ...req.body, property_id: req.params.propertyId });
    res.status(201).json({ success: true, message: "Photo added.", data: photo });
});

const getPropertyPhotos = asyncHandler(async (req, res) => {
    const photos = await PropertyPhoto.findAll({
        where: { property_id: req.params.propertyId },
    });
    res.status(200).json({ success: true, data: photos });
});

const deletePropertyPhoto = asyncHandler(async (req, res) => {
    const photo = await PropertyPhoto.findByPk(req.params.id);
    if (!photo) return res.status(404).json({ success: false, message: "Photo not found." });
    await photo.destroy();
    res.status(200).json({ success: true, message: "Photo deleted." });
});

// ═══════════════════════════════════════════════════════════════
// BUILDING CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createBuilding = asyncHandler(async (req, res) => {
    const building = await Building.create({ ...req.body, property_id: req.params.propertyId });
    res.status(201).json({ success: true, message: "Building created.", data: building });
});

const getBuildingByProperty = asyncHandler(async (req, res) => {
    const building = await Building.findOne({
        where: { property_id: req.params.propertyId },
        include: [
            {
                model: Floor,
                include: [
                    { model: FloorUtilities },
                    { model: FloorOccupancy },
                    {
                        model: Unit,
                        include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
                    },
                ],
            },
        ],
    });
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    res.status(200).json({ success: true, data: building });
});

const updateBuilding = asyncHandler(async (req, res) => {
    const building = await Building.findByPk(req.params.id);
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    const updated = await building.update(req.body);
    res.status(200).json({ success: true, message: "Building updated.", data: updated });
});

const deleteBuilding = asyncHandler(async (req, res) => {
    const building = await Building.findByPk(req.params.id);
    if (!building) return res.status(404).json({ success: false, message: "Building not found." });
    await building.destroy();
    res.status(200).json({ success: true, message: "Building deleted." });
});

// ═══════════════════════════════════════════════════════════════
// FLOOR CONTROLLERS
// ═══════════════════════════════════════════════════════════════

// const createFloor = asyncHandler(async (req, res) => {
//     const floor = await Floor.create({ ...req.body, building_id: req.params.buildingId });
//     res.status(201).json({ success: true, message: "Floor created.", data: floor });
// });
const createFloor = asyncHandler(async (req, res) => {
  console.log("BODY:", req.body);
  console.log("PARAMS:", req.params);

  const buildingId = parseInt(req.params.buildingId);

  if (isNaN(buildingId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid buildingId",
    });
  }

  const floor = await Floor.create({
    ...req.body,
    building_id: buildingId, 
  });

  res.status(201).json({
    success: true,
    message: "Floor created.",
    data: floor,
    floorId: floor.id,
  });
});

const getFloorsByBuilding = asyncHandler(async (req, res) => {
    const floors = await Floor.findAll({
        where: { building_id: req.params.buildingId },
        include: [
            { model: FloorUtilities },
            { model: FloorOccupancy },
            {
                model: Unit,
                include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
            },
        ],
        order: [["floor_number", "ASC"]],
    });
    res.status(200).json({ success: true, data: floors });
});

const getFloorById = asyncHandler(async (req, res) => {
    const floor = await Floor.findByPk(req.params.id, {
        include: [
            { model: FloorUtilities },
            { model: FloorOccupancy },
            {
                model: Unit,
                include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
            },
        ],
    });
    if (!floor) return res.status(404).json({ success: false, message: "Floor not found." });
    res.status(200).json({ success: true, data: floor });
});

const updateFloor = asyncHandler(async (req, res) => {
    const floor = await Floor.findByPk(req.params.id);
    if (!floor) return res.status(404).json({ success: false, message: "Floor not found." });
    const updated = await floor.update(req.body);
    res.status(200).json({ success: true, message: "Floor updated.", data: updated });
});

const deleteFloor = asyncHandler(async (req, res) => {
    const floor = await Floor.findByPk(req.params.id);
    if (!floor) return res.status(404).json({ success: false, message: "Floor not found." });
    await floor.destroy();
    res.status(200).json({ success: true, message: "Floor deleted." });
});

// ═══════════════════════════════════════════════════════════════
// FLOOR UTILITIES CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const upsertFloorUtilities = asyncHandler(async (req, res) => {
    const [utilities, created] = await FloorUtilities.upsert({
        ...req.body,
        floor_id: parseInt(req.params.floorId),
    });
    res.status(created ? 201 : 200).json({
        success: true,
        message: created ? "Floor utilities created." : "Floor utilities updated.",
        data: utilities,
    });
});

const getFloorUtilities = asyncHandler(async (req, res) => {
    const utilities = await FloorUtilities.findOne({
        where: { floor_id: req.params.floorId },
    });
    if (!utilities) return res.status(404).json({ success: false, message: "Floor utilities not found." });
    res.status(200).json({ success: true, data: utilities });
});

// ═══════════════════════════════════════════════════════════════
// FLOOR OCCUPANCY CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createFloorOccupancy = asyncHandler(async (req, res) => {
    let occupancy = await FloorOccupancy.findOne({ where: { floor_id: parseInt(req.params.floorId) } });
    if (occupancy) {
        occupancy = await occupancy.update(req.body);
        return res.status(200).json({ success: true, message: "Floor occupancy updated.", data: occupancy });
    }
    occupancy = await FloorOccupancy.create({ ...req.body, floor_id: parseInt(req.params.floorId) });
    res.status(201).json({ success: true, message: "Occupancy created.", data: occupancy });
});

const getFloorOccupancy = asyncHandler(async (req, res) => {
    const occupancy = await FloorOccupancy.findOne({
        where: { floor_id: parseInt(req.params.floorId) },
    });
    if (!occupancy) return res.status(404).json({ success: false, message: "Occupancy not found." });
    res.status(200).json({ success: true, data: occupancy });
});

const updateFloorOccupancy = asyncHandler(async (req, res) => {
    const occupancy = await FloorOccupancy.findByPk(req.params.id);
    if (!occupancy) return res.status(404).json({ success: false, message: "Occupancy not found." });
    const updated = await occupancy.update(req.body);
    res.status(200).json({ success: true, message: "Occupancy updated.", data: updated });
});

const deleteFloorOccupancy = asyncHandler(async (req, res) => {
    const occupancy = await FloorOccupancy.findByPk(req.params.id);
    if (!occupancy) return res.status(404).json({ success: false, message: "Occupancy not found." });
    await occupancy.destroy();
    res.status(200).json({ success: true, message: "Occupancy deleted." });
});

// ═══════════════════════════════════════════════════════════════
// UNIT CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createUnit = asyncHandler(async (req, res) => {
    const unit = await Unit.create({ ...req.body, floor_id: parseInt(req.params.floorId) });
    res.status(201).json({ success: true, message: "Unit created.", data: unit });
});

const getUnitsByFloor = asyncHandler(async (req, res) => {
    const units = await Unit.findAll({
        where: { floor_id: parseInt(req.params.floorId) },
        include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
    });
    res.status(200).json({ success: true, data: units });
});

const getUnitById = asyncHandler(async (req, res) => {
    const unit = await Unit.findByPk(parseInt(req.params.id), {
        include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
    });
    if (!unit) return res.status(404).json({ success: false, message: "Unit not found." });
    res.status(200).json({ success: true, data: unit });
});

const updateUnit = asyncHandler(async (req, res) => {
    const unit = await Unit.findByPk(parseInt(req.params.id));
    if (!unit) return res.status(404).json({ success: false, message: "Unit not found." });
    const updated = await unit.update(req.body);
    res.status(200).json({ success: true, message: "Unit updated.", data: updated });
});

const deleteUnit = asyncHandler(async (req, res) => {
    const unit = await Unit.findByPk(parseInt(req.params.id));
    if (!unit) return res.status(404).json({ success: false, message: "Unit not found." });
    await unit.destroy();
    res.status(200).json({ success: true, message: "Unit deleted." });
});

// ═══════════════════════════════════════════════════════════════
// UNIT OWNER CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createUnitOwner = asyncHandler(async (req, res) => {
    const owner = await UnitOwner.create({ ...req.body, unit_id: parseInt(req.params.unitId) });
    res.status(201).json({ success: true, message: "Unit owner created.", data: owner });
});

const getUnitOwners = asyncHandler(async (req, res) => {
    const owners = await UnitOwner.findAll({
        where: { unit_id: parseInt(req.params.unitId) },
    });
    res.status(200).json({ success: true, data: owners });
});

const updateUnitOwner = asyncHandler(async (req, res) => {
    const owner = await UnitOwner.findByPk(parseInt(req.params.id));
    if (!owner) return res.status(404).json({ success: false, message: "Unit owner not found." });
    const updated = await owner.update(req.body);
    res.status(200).json({ success: true, message: "Unit owner updated.", data: updated });
});

const deleteUnitOwner = asyncHandler(async (req, res) => {
    const owner = await UnitOwner.findByPk(parseInt(req.params.id));
    if (!owner) return res.status(404).json({ success: false, message: "Unit owner not found." });
    await owner.destroy();
    res.status(200).json({ success: true, message: "Unit owner deleted." });
});

// ═══════════════════════════════════════════════════════════════
// UNIT UTILITIES CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const upsertUnitUtilities = asyncHandler(async (req, res) => {
    const [utilities, created] = await UnitUtilities.upsert({
        ...req.body,
        unit_id: parseInt(req.params.unitId),
    });
    res.status(created ? 201 : 200).json({
        success: true,
        message: created ? "Unit utilities created." : "Unit utilities updated.",
        data: utilities,
    });
});

const getUnitUtilities = asyncHandler(async (req, res) => {
    const utilities = await UnitUtilities.findOne({
        where: { unit_id: parseInt(req.params.unitId) },
    });
    if (!utilities) return res.status(404).json({ success: false, message: "Unit utilities not found." });
    res.status(200).json({ success: true, data: utilities });
});

// ═══════════════════════════════════════════════════════════════
// UNIT PHOTO CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createUnitPhoto = asyncHandler(async (req, res) => {
    const unitId = parseInt(req.params.unitId);
    const files = req.files || [];

    // Multipart upload: push each image to Cloudinary, store the secure URL.
    if (files.length > 0) {
        const created = [];
        for (const file of files) {
            const result = await uploadBuffer(file.buffer, {
                folder: "property_survey/units",
            });
            created.push(
                await UnitPhoto.create({
                    unit_id:    unitId,
                    photo_url:  result.secure_url,
                    photo_type: req.body.photo_type || "unit",
                    caption:    req.body.caption || null,
                })
            );
        }
        return res.status(201).json({
            success: true,
            message: "Unit photo(s) added.",
            data: created,
            image_urls: created.map((p) => p.photo_url),
        });
    }

    // JSON fallback: an already-hosted photo_url was provided directly.
    if (!req.body.photo_url) {
        return res.status(400).json({
            success: false,
            message: "No image file or photo_url provided.",
        });
    }
    const photo = await UnitPhoto.create({ ...req.body, unit_id: unitId });
    res.status(201).json({ success: true, message: "Unit photo added.", data: photo });
});

const getUnitPhotos = asyncHandler(async (req, res) => {
    const photos = await UnitPhoto.findAll({
        where: { unit_id: parseInt(req.params.unitId) },
    });
    res.status(200).json({ success: true, data: photos });
});

const updateUnitPhoto = asyncHandler(async (req, res) => {
    const photo = await UnitPhoto.findByPk(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ success: false, message: "Unit photo not found." });

    const files = req.files || [];
    if (files.length > 0) {
        const result = await uploadBuffer(files[0].buffer, {
            folder: "property_survey/units",
        });
        await photo.update({ photo_url: result.secure_url });
    } else if (req.body.photo_url) {
        await photo.update({ photo_url: req.body.photo_url });
    }
    if (req.body.caption !== undefined) {
        await photo.update({ caption: req.body.caption });
    }

    res.status(200).json({ success: true, message: "Unit photo updated.", data: photo });
});

const deleteUnitPhoto = asyncHandler(async (req, res) => {
    const photo = await UnitPhoto.findByPk(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ success: false, message: "Unit photo not found." });
    await photo.destroy();
    res.status(200).json({ success: true, message: "Unit photo deleted." });
});

// ═══════════════════════════════════════════════════════════════
// LOCATION HIERARCHY CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const getStates = asyncHandler(async (req, res) => {
    const states = await State.findAll({ where: { is_active: true }, order: [["name", "ASC"]] });
    res.status(200).json({ success: true, data: states });
});

const getDistricts = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.state_id) where.state_id = req.query.state_id;
    const districts = await District.findAll({ where, order: [["name", "ASC"]] });
    res.status(200).json({ success: true, data: districts });
});

const getCities = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.district_id) where.district_id = req.query.district_id;
    const cities = await City.findAll({ where, order: [["name", "ASC"]] });
    res.status(200).json({ success: true, data: cities });
});

const getZones = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.city_id) where.city_id = req.query.city_id;
    const zones = await Zone.findAll({ where, order: [["name", "ASC"]] });
    res.status(200).json({ success: true, data: zones });
});

const getWards = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    // zone_id is the precise filter; city_id still works for city-wide lists.
    if (req.query.zone_id) where.zone_id = req.query.zone_id;
    if (req.query.city_id) where.city_id = req.query.city_id;
    const wards = await Ward.findAll({ where, order: [["ward_number", "ASC"]] });
    res.status(200).json({ success: true, data: wards });
});

// ═══════════════════════════════════════════════════════════════
// SURVEY RECORD CONTROLLERS
// ═══════════════════════════════════════════════════════════════

const createSurveyRecord = asyncHandler(async (req, res) => {
    const survey = await Survey.create({ ...req.body, surveyor_id: req.user.id });
    res.status(201).json({ success: true, message: "Survey record created.", data: survey });
});

const getSurveyRecords = asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.surveyor_id) where.surveyor_id = req.query.surveyor_id;
    if (req.query.status) where.status = req.query.status;
    if (req.query.polygon_id) where.polygon_id = req.query.polygon_id;
    if (req.query.project_id) where.project_id = req.query.project_id;
    const surveys = await Survey.findAll({
        where,
        include: [{ model: Property }, { model: Polygon }],
        order: [["survey_date", "DESC"]],
    });
    res.status(200).json({ success: true, data: surveys });
});

const getMySurveys = asyncHandler(async (req, res) => {
    const surveys = await Survey.findAll({
        where: { surveyor_id: req.user.id },
        include: [{ model: Property }, { model: Polygon }],
        order: [["survey_date", "DESC"]],
    });
    res.status(200).json({ success: true, data: surveys });
});

const getSurveyRecordById = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id, {
        include: [{ model: Property }, { model: Polygon }],
    });
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found." });
    res.status(200).json({ success: true, data: survey });
});

const getSurveysByPolygon = asyncHandler(async (req, res) => {
    const surveys = await Survey.findAll({
        where: { polygon_id: req.params.polygonId },
        include: [{ model: Property }, { model: Polygon }],
        order: [["survey_date", "DESC"]],
    });
    res.status(200).json({ success: true, data: surveys });
});

const getSurveysByPolygonCode = asyncHandler(async (req, res) => {
    const polygon = await Polygon.findOne({ where: { polygon_code: req.params.polygonCode, is_active: true } });
    if (!polygon) return res.status(404).json({ success: false, message: "Polygon not found." });

    const surveys = await Survey.findAll({
        where: { polygon_id: polygon.id },
        include: [{ model: Property }, { model: Polygon }],
        order: [["survey_date", "DESC"]],
    });
    res.status(200).json({ success: true, data: surveys });
});

const updateSurveyRecord = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found." });
    const updated = await survey.update(req.body);
    res.status(200).json({ success: true, message: "Survey updated.", data: updated });
});

// ═══════════════════════════════════════════════════════════════
// PROPERTIES BY POLYGON
// ═══════════════════════════════════════════════════════

const getPropertiesByPolygon = asyncHandler(async (req, res) => {
    const properties = await Property.findAll({
        where: { polygon_id: req.params.polygonId },
        include: [
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
                                include: [{ model: UnitOwner }, { model: UnitUtilities }, { model: UnitPhoto }],
                            },
                        ],
                    },
                ],
            },
        ],
        order: [["createdAt", "DESC"]],
    });
    res.status(200).json({ success: true, data: properties });
});

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

const getEnums = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: enums });
});

module.exports = {
    // Polygon
    createPolygon,
    getPolygons,
    getPolygonById,
    // Property Owner
    createPropertyOwner,
    getPropertyOwners,
    updatePropertyOwner,
    deletePropertyOwner,
    // Property Utilities
    upsertPropertyUtilities,
    getPropertyUtilities,
    // Property Road
    createPropertyRoad,
    getPropertyRoads,
    updatePropertyRoad,
    deletePropertyRoad,
    // Property Photo
    createPropertyPhoto,
    getPropertyPhotos,
    deletePropertyPhoto,
    // Building
    createBuilding,
    getBuildingByProperty,
    updateBuilding,
    deleteBuilding,
    // Floor
    createFloor,
    getFloorsByBuilding,
    getFloorById,
    updateFloor,
    deleteFloor,
    // Floor Utilities
    upsertFloorUtilities,
    getFloorUtilities,
    // Floor Occupancy
    createFloorOccupancy,
    getFloorOccupancy,
    updateFloorOccupancy,
    deleteFloorOccupancy,
    // Unit
    createUnit,
    getUnitsByFloor,
    getUnitById,
    updateUnit,
    deleteUnit,
    // Unit Owner
    createUnitOwner,
    getUnitOwners,
    updateUnitOwner,
    deleteUnitOwner,
    // Unit Utilities
    upsertUnitUtilities,
    getUnitUtilities,
    // Unit Photo
    createUnitPhoto,
    getUnitPhotos,
    updateUnitPhoto,
    deleteUnitPhoto,
    // Location Hierarchy
    getStates,
    getDistricts,
    getCities,
    getZones,
    getWards,
    // Survey Records
    createSurveyRecord,
    getSurveyRecords,
    getMySurveys,
    getSurveyRecordById,
    updateSurveyRecord,
    getSurveysByPolygon,
    getSurveysByPolygonCode,
    // Properties by Polygon
    getPropertiesByPolygon,
    // Enums
    getEnums,
};
