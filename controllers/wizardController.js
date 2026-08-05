/**
 * wizardController.js
 *
 * Handles the multi-step survey wizard endpoints:
 *   POST   /api/surveys/draft
 *   PUT    /api/surveys/:id/property-details
 *   PUT    /api/surveys/:id/building
 *   POST   /api/surveys/:id/floors
 *   POST   /api/surveys/:id/units
 *   POST   /api/surveys/:id/photos
 *   POST   /api/surveys/:id/submit
 *   GET    /api/surveys/:id
 *   GET    /api/surveys/surveyor/:surveyorId
 *   GET    /api/surveys/surveyor/:surveyorId/today
 *   GET    /api/surveys/today
 *
 * Also handles property-type catalog endpoints:
 *   GET    /api/types/categories
 *   GET    /api/types/subtypes?category_id=
 *   GET    /api/types/floor-usage
 */

const {
    Property,
    Building,
    Floor,
    Unit,
    UnitOwner,
    UnitUtilities,
    PropertyOwner,
    PropertyUtilities,
    PropertyRoad,
    PropertyPhoto,
    Polygon,
    Survey,
    Ward,
    User,
    PropertyTypeConfig,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { uploadBuffer } = require("../config/cloudinary");

// ═══════════════════════════════════════════════════════════════
// STATIC CATALOG DATA  (driven by DB enums, no separate tables)
// ═══════════════════════════════════════════════════════════════

const CATEGORIES = [
    { id: 1, name: "Residential",    description: "Residential building" },
    { id: 2, name: "NonResidential", description: "Commercial or industrial building" },
    { id: 3, name: "Mixed",          description: "Mixed-use building" },
    { id: 4, name: "Vacant",         description: "Vacant plot or land" },
];

const SUBTYPES = [
    { id: 1, category_id: 1, name: "SingleStory",       description: "Single-storey residential" },
    { id: 2, category_id: 1, name: "MultiStory",         description: "Multi-storey residential" },
    { id: 3, category_id: 2, name: "Commercial",         description: "Shop / office / warehouse" },
    { id: 4, category_id: 2, name: "PetrolPump",         description: "Petrol / CNG station" },
    { id: 5, category_id: 2, name: "CommercialComplex",  description: "Multi-unit commercial complex" },
];

const FLOOR_USAGE_TYPES = [
    { id: 1, name: "Residential", description: "Residential use" },
    { id: 2, name: "Commercial",  description: "Commercial use" },
    { id: 3, name: "Parking",     description: "Parking only" },
    { id: 4, name: "Mixed",       description: "Mixed residential + commercial" },
];

// ── Helpers ────────────────────────────────────────────────────

/** Map frontend UPPERCASE occupancy values to DB PascalCase. */
const mapOccupancy = (status) => {
    const m = { SELF: "Self", RENTED: "Rented", VACANT: "Vacant", SELF_RENTED: "SelfRented" };
    return m[String(status || "").toUpperCase()] || "Self";
};

// Fixed prefix for the unique property code (Lucknow Cantonment).
const PROPERTY_CODE_PREFIX = "LKOCANT";

/**
 * Build the unique property code: LKOCANT/{polygon}/{6-digit padded id}.
 * The trailing id is the (unique) Property primary key, so the code is unique.
 */
const buildPropertyCode = ({ polygonCode, propertyId }) => {
    const polyPart = String(polygonCode ?? "NA").trim() || "NA";
    const seqPart = String(propertyId).padStart(6, "0");
    return `${PROPERTY_CODE_PREFIX}/${polyPart}/${seqPart}`;
};

/** Resolve property_type / property_subtype strings from numeric IDs. */
const resolveTypes = (categoryId, subtypeId) => {
    const cat = CATEGORIES.find((c) => c.id === parseInt(categoryId));
    const sub = SUBTYPES.find((s) => s.id === parseInt(subtypeId));
    return {
        property_type: cat?.name || "Vacant",
        property_subtype: sub?.name || null,
    };
};

// ═══════════════════════════════════════════════════════════════
// CATALOG ENDPOINTS
// ═══════════════════════════════════════════════════════════════

const getCategories = asyncHandler(async (req, res) => {
    res.json({ success: true, data: CATEGORIES });
});

const getSubtypes = asyncHandler(async (req, res) => {
    const { category_id } = req.query;
    const data = category_id
        ? SUBTYPES.filter((s) => s.category_id === parseInt(category_id))
        : SUBTYPES;
    res.json({ success: true, data });
});

// GET /api/types/config[?category_id=&subtype_id=]
// Returns the survey shape + question schema per property type. The app uses
// this to decide which template to render and which extra questions to ask,
// replacing the old `subtypeName.includes("complex")` string matching.
const getTypeConfigs = asyncHandler(async (req, res) => {
    const { category_id, subtype_id } = req.query;

    const where = { is_active: true };
    if (category_id) where.category_id = parseInt(category_id);
    // subtype_id is absent for Mixed/Vacant, so only filter when given.
    if (subtype_id) where.subtype_id = parseInt(subtype_id);

    const configs = await PropertyTypeConfig.findAll({
        where,
        order: [["sort_order", "ASC"]],
    });

    res.json({ success: true, count: configs.length, data: configs });
});

const getFloorUsageTypes = asyncHandler(async (req, res) => {
    res.json({ success: true, data: FLOOR_USAGE_TYPES });
});

// ═══════════════════════════════════════════════════════════════
// STEP 1 — CREATE DRAFT SURVEY
// ═══════════════════════════════════════════════════════════════

const createDraftSurvey = asyncHandler(async (req, res) => {
    const { polygon_code, address, category_id, subtype_id } = req.body;

    if (!polygon_code || !address) {
        return res.status(400).json({
            success: false,
            message: "polygon_code and address are required",
        });
    }

    const polygon = await Polygon.findOne({ where: { polygon_code } });
    if (!polygon) {
        return res.status(404).json({ success: false, message: "Polygon not found" });
    }

    const { property_type, property_subtype } = resolveTypes(category_id, subtype_id);

    const isMultiEntry =
        (property_type === "Residential" && property_subtype === "MultiStory") ||
        (property_type === "NonResidential" && property_subtype === "CommercialComplex");

    // Create the Property record
    const property = await Property.create({
        polygon_id: polygon.id,
        surveyor_id: req.user.id,
        property_type,
        property_subtype,
        address,
        is_multi_entry: isMultiEntry,
        survey_date: new Date().toISOString().split("T")[0],
    });

    // Assign the unique property code now that we have the (unique) property id.
    const property_code = buildPropertyCode({
        polygonCode: polygon.polygon_code,
        propertyId: property.id,
    });
    await property.update({ property_code });

    // Create an empty Building shell for all non-Vacant types
    let building = null;
    if (property_type !== "Vacant") {
        building = await Building.create({ property_id: property.id });
    }

    // Create main Survey record
    const survey = await Survey.create({
        property_id: property.id,
        surveyor_id: req.user.id,
        polygon_id: polygon.id,
        survey_date: new Date().toISOString().split("T")[0],
        status: "in_progress",
        start_time: new Date().toTimeString().split(" ")[0],
    });

    // Back-link property → survey
    await property.update({ survey_id: survey.id });

    res.status(201).json({
        success: true,
        message: "Draft survey created",
        data: {
            survey_id: survey.id,
            property_id: property.id,
            building_id: building?.id ?? null,
            property_code,
        },
    });
});

// ═══════════════════════════════════════════════════════════════
// STEP 2 — ADD PROPERTY DETAILS
// ═══════════════════════════════════════════════════════════════

const addPropertyDetails = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    const property = await Property.findByPk(survey.property_id);
    if (!property) return res.status(404).json({ success: false, message: "Property not found" });

    const {
        owner_name,
        owner_occupation,
        is_disabled_person,
        mobile_number,
        aadhar_number,
        father_husband_name,
        bill_photo_url,
        construction_type,
        plot_area_sqmt,
        utility_connections,
        // Joint ownership: an array of owner objects. The singular fields above
        // remain supported so older app builds keep working.
        owners,
        // Answers to this category's PropertyTypeConfig.attribute_schema.
        type_specific_attributes,
        // Road sides
        road_type_front,  road_width_front,  carriageway_area_front,  footpath_area_front,
        road_type_back,   road_width_back,   carriageway_area_back,   footpath_area_back,
        road_type_left,   road_width_left,   carriageway_area_left,   footpath_area_left,
        road_type_right,  road_width_right,  carriageway_area_right,  footpath_area_right,
    } = req.body;

    // Update core property fields
    await property.update({
        plot_area:        plot_area_sqmt ? parseFloat(plot_area_sqmt) : property.plot_area,
        construction_type: construction_type || property.construction_type,
        type_specific_attributes:
            type_specific_attributes && typeof type_specific_attributes === "object"
                ? type_specific_attributes
                : property.type_specific_attributes,
    });

    // Owners. Joint ownership is common (spouses, brothers), so an `owners`
    // array is accepted; the legacy singular fields map to a one-element list.
    const ownerList = Array.isArray(owners) && owners.length
        ? owners
        : owner_name
            ? [{
                owner_name,
                father_or_husband_name: father_husband_name,
                occupation: owner_occupation,
                disabled_person: is_disabled_person === "YES",
                mobile_number,
                aadhar_number,
                bill_photo: bill_photo_url,
            }]
            : [];

    if (ownerList.length) {
        await PropertyOwner.destroy({ where: { property_id: property.id } });
        for (const o of ownerList) {
            if (!o || !o.owner_name) continue;
            await PropertyOwner.create({
                property_id:            property.id,
                owner_name:             o.owner_name,
                // Accept both the flat wizard names and the DB column names.
                father_or_husband_name: o.father_or_husband_name || o.father_husband_name || null,
                occupation:             o.occupation || o.owner_occupation || null,
                disabled_person:        o.disabled_person === true || o.is_disabled_person === "YES",
                mobile_number:          o.mobile_number || null,
                aadhar_number:          o.aadhar_number || null,
                bill_photo:             o.bill_photo || o.bill_photo_url || null,
            });
        }
    }

    // Utilities
    if (utility_connections) {
        await PropertyUtilities.upsert({
            property_id:        property.id,
            electric_connection:   utility_connections.electricity        || false,
            gas_connection:        utility_connections.gas               || false,
            solar_connection:      utility_connections.solar             || false,
            sewer_connection:      utility_connections.sewerage          || false,
            rainwater_harvesting:  utility_connections.rainwater_harvesting || false,
        });
    }

    // Roads — rebuild from scratch
    await PropertyRoad.destroy({ where: { property_id: property.id } });

    const roadDefs = [
        { side: "Front", type: road_type_front, width: road_width_front, ca: carriageway_area_front, fp: footpath_area_front },
        { side: "Back",  type: road_type_back,  width: road_width_back,  ca: carriageway_area_back,  fp: footpath_area_back  },
        { side: "Left",  type: road_type_left,  width: road_width_left,  ca: carriageway_area_left,  fp: footpath_area_left  },
        { side: "Right", type: road_type_right, width: road_width_right, ca: carriageway_area_right, fp: footpath_area_right },
    ];

    for (const r of roadDefs) {
        // Only create record if the side actually has data
        if (r.type || r.ca != null) {
            await PropertyRoad.create({
                property_id:     property.id,
                road_side:       r.side,
                road_exists:     true,
                road_type:       r.type       || null,
                carriageway_area: r.ca != null ? parseFloat(r.ca) : null,
                footpath_area:   r.fp != null  ? parseFloat(r.fp) : null,
            });
        }
    }

    res.json({ success: true, message: "Property details saved" });
});

// ═══════════════════════════════════════════════════════════════
// STEP 3 — ADD BUILDING INFORMATION
// ═══════════════════════════════════════════════════════════════

const addBuildingInfo = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    let building = await Building.findOne({ where: { property_id: survey.property_id } });

    const { floors_above_ground, floors_below_ground, builtup_area_sqmt, construction_year, building_occupancy } = req.body;

    const occupancyMap = { SELF: "Self", RENTED: "Rented", VACANT: "Vacant", SELF_RENTED: "SelfRented" };

    const data = {
        floors_above_ground: parseInt(floors_above_ground)   || 1,
        floors_below_ground: parseInt(floors_below_ground)   || 0,
        total_builtup_area:  builtup_area_sqmt ? parseFloat(builtup_area_sqmt) : null,
        construction_year:   construction_year ? parseInt(construction_year)   : null,
        ...(building_occupancy && occupancyMap[building_occupancy]
            ? { building_occupancy: occupancyMap[building_occupancy] }
            : {}),
    };

    if (building) {
        await building.update(data);
    } else {
        building = await Building.create({ property_id: survey.property_id, ...data });
    }

    res.json({
        success: true,
        message: "Building info saved",
        data: { building_id: building.id, requires_floor_details: true },
    });
});

// ═══════════════════════════════════════════════════════════════
// STEP 4 — ADD FLOOR
// ═══════════════════════════════════════════════════════════════

const addFloor = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    const building = await Building.findOne({ where: { property_id: survey.property_id } });
    if (!building) return res.status(404).json({ success: false, message: "Building not found" });

    const { floor_number, construction_year } = req.body;

    const floor = await Floor.create({
        building_id:      building.id,
        floor_number:     parseInt(floor_number) || 0,
        construction_year: construction_year ? parseInt(construction_year) : null,
    });

    res.status(201).json({ success: true, message: "Floor added", data: floor });
});

// ═══════════════════════════════════════════════════════════════
// STEP 5 — ADD UNIT
// ═══════════════════════════════════════════════════════════════

const addUnit = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    const building = await Building.findOne({ where: { property_id: survey.property_id } });
    if (!building) return res.status(404).json({ success: false, message: "Building not found" });

    const {
        floor_number,
        carpet_area_sqmt,
        occupancy_status,
        owner_name,
        mobile_number,
        tenant_name,
        tenant_mobile,
        residential_details,
        // Joint ownership of a single unit (flat/shop owned by 2+ people).
        owners,
        unit_number,
    } = req.body;

    // Find or create the floor automatically (for merged/sequential flows)
    let floor = await Floor.findOne({
        where: { building_id: building.id, floor_number: parseInt(floor_number) || 0 },
    });
    if (!floor) {
        floor = await Floor.create({
            building_id:  building.id,
            floor_number: parseInt(floor_number) || 0,
        });
    }

    const attrs = residential_details?.type_specific_attributes || {};

    const unit = await Unit.create({
        floor_id:         floor.id,
        unit_number:      unit_number || null,
        carpet_area:      carpet_area_sqmt ? parseFloat(carpet_area_sqmt) : null,
        occupancy_status: mapOccupancy(occupancy_status),
        occupant_name:    tenant_name  || null,
        occupant_mobile:  tenant_mobile || null,
        type_specific_attributes: attrs,
    });

    // Owners — an `owners` array supports joint ownership; the singular
    // owner_name path is kept for older app builds.
    if (Array.isArray(owners) && owners.length) {
        for (const o of owners) {
            if (!o || !o.owner_name) continue;
            await UnitOwner.create({
                unit_id:                unit.id,
                owner_name:             o.owner_name,
                father_or_husband_name: o.father_or_husband_name || o.father_husband_name || null,
                occupation:             o.occupation || o.owner_occupation || null,
                mobile:                 o.mobile || o.mobile_number || null,
                aadhar:                 o.aadhar || o.aadhar_number || null,
                disabled_person:        o.disabled_person === true || o.is_disabled_person === "YES",
            });
        }
    } else if (owner_name) {
        await UnitOwner.create({
            unit_id:               unit.id,
            owner_name,
            father_or_husband_name: attrs.father_husband_name || null,
            occupation:             attrs.owner_occupation    || null,
            mobile:                 mobile_number             || null,
            aadhar:                 attrs.aadhar_number       || null,
            disabled_person:        attrs.is_disabled_person === "YES",
        });
    }

    // Utilities / amenities
    const rd = residential_details || {};
    await UnitUtilities.create({
        unit_id:           unit.id,
        has_kitchen:       rd.has_kitchen   || false,
        kitchen_count:     rd.kitchen_count  ? parseInt(rd.kitchen_count)  : null,
        kitchen_area:      rd.kitchen_area_sqmt ? parseFloat(rd.kitchen_area_sqmt) : null,
        has_toilet:        rd.has_toilet    || false,
        toilet_count:      rd.toilet_count   ? parseInt(rd.toilet_count)   : null,
        toilet_area:       attrs.toilet_area_sqmt ? parseFloat(attrs.toilet_area_sqmt) : null,
        parking_type:      rd.parking_type   || null,
        parking_area:      rd.parking_area_sqmt ? parseFloat(rd.parking_area_sqmt) : null,
        electric_connection: attrs.utility_connections?.electricity || false,
        gas_connection:      attrs.utility_connections?.gas         || false,
        sewer_connection:    attrs.utility_connections?.sewerage    || false,
    });

    res.status(201).json({ success: true, message: "Unit added", data: unit });
});

// ═══════════════════════════════════════════════════════════════
// STEP 6 — UPLOAD SURVEY PHOTOS
// ═══════════════════════════════════════════════════════════════

const uploadSurveyPhotos = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: "No photo files provided" });
    }

    // Upload each image to Cloudinary first, then persist the returned secure URL.
    const photos = [];
    for (const file of files) {
        const result = await uploadBuffer(file.buffer, {
            folder: "property_survey/surveys",
        });
        const photo = await PropertyPhoto.create({
            property_id: survey.property_id,
            photo_url:   result.secure_url,
            photo_type:  "survey",
        });
        photos.push(photo);
    }

    res.status(201).json({
        success: true,
        message: "Photos uploaded",
        data: photos,
        // The app reads `image_urls` to link uploaded photos back into its state.
        image_urls: photos.map((p) => p.photo_url),
    });
});

// ═══════════════════════════════════════════════════════════════
// STEP 7 — SUBMIT SURVEY
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// WIZARD PROGRESS — remember where to resume
// ═══════════════════════════════════════════════════════════════

// PUT /api/surveys/:id/progress   body: { current_step }
// Server-side resume position, so continuing a survey works on any device and
// doesn't depend on the app's local draft cache surviving.
const updateSurveyProgress = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    const step = Number(req.body.current_step);
    if (!Number.isInteger(step) || step < 1) {
        return res
            .status(400)
            .json({ success: false, message: "current_step must be a positive integer." });
    }

    // Only ever move forward. Requests can land out of order, and going back to
    // edit an earlier step shouldn't throw away the furthest point reached.
    if (step > (survey.current_step || 1)) {
        await survey.update({ current_step: step });
    }

    res.status(200).json({ success: true, data: { current_step: survey.current_step } });
});

const submitSurvey = asyncHandler(async (req, res) => {
    const survey = await Survey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    await survey.update({
        status:   "completed",
        end_time: new Date().toTimeString().split(" ")[0],
    });

    // Ensure the property has a unique code (backfills drafts created before
    // property_code existed).
    let property_code = null;
    const property = await Property.findByPk(survey.property_id);
    if (property) {
        property_code = property.property_code;
        if (!property_code) {
            const polygon = await Polygon.findByPk(property.polygon_id);
            property_code = buildPropertyCode({
                polygonCode: polygon?.polygon_code,
                propertyId: property.id,
            });
            await property.update({ property_code });
        }
    }

    res.json({
        success: true,
        message: "Survey submitted successfully",
        data: { property_code },
    });
});

// ═══════════════════════════════════════════════════════════════
// QUERY ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/** GET /api/surveys/:id — full survey detail */
const getSurveyById = asyncHandler(async (req, res, next) => {
    // `/:id` would otherwise shadow sibling GET routes registered later on
    // /api/surveys (e.g. /enums, /states, /records). Only handle numeric ids
    // here; anything else falls through to the next router.
    if (!/^\d+$/.test(String(req.params.id))) return next();

    const survey = await Survey.findByPk(req.params.id, {
        include: [
            {
                model: Property,
                include: [
                    PropertyOwner,
                    PropertyUtilities,
                    PropertyRoad,
                    PropertyPhoto,
                    {
                        model: Building,
                        include: [{ model: Floor, include: [Unit] }],
                    },
                ],
            },
            { model: Polygon, include: [Ward] },
        ],
    });

    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });

    // Augment to match what the frontend hydrateFromResumeSurvey expects
    const raw = survey.toJSON();
    const adapted = {
        ...raw,
        survey_status: survey.status === "completed" ? "COMPLETED" : "DRAFT",
        property_code: raw.Property?.property_code || null,
        // Frontend reads survey.PropertyDetails for property info
        PropertyDetails: raw.Property || null,
        // Frontend reads survey.SurveyImages
        SurveyImages:    (raw.Property?.PropertyPhotos || []).map((p) => ({
            id:        p.id,
            image_url: p.photo_url,
        })),
        // Frontend reads survey.PropertyUnit.Building.Floors
        PropertyUnit: null,
    };

    if (raw.Property?.Building) {
        adapted.PropertyUnit = {
            Building: {
                ...raw.Property.Building,
                Polygon:       raw.Polygon || null,
                PropertyUnits: (raw.Property.Building.Floors || []).flatMap(
                    (f) => f.Units || []
                ),
            },
        };
    }

    res.json({ success: true, data: adapted });
});

/** GET /api/surveys/surveyor/:surveyorId */
const getSurveyorSurveys = asyncHandler(async (req, res) => {
    const limit  = parseInt(req.query.limit)  || 10;
    const offset = parseInt(req.query.offset) || 0;
    const where  = { surveyor_id: req.params.surveyorId };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Survey.findAndCountAll({
        where,
        include: [
            { model: Property, include: [PropertyOwner] },
            { model: Polygon },
        ],
        limit,
        offset,
        order: [["createdAt", "DESC"]],
    });

    res.json({ success: true, data: rows, total: count });
});

/** GET /api/surveys/surveyor/:surveyorId/today */
const getSurveyorTodaysSurveys = asyncHandler(async (req, res) => {
    const limit  = parseInt(req.query.limit)  || 10;
    const offset = parseInt(req.query.offset) || 0;
    const today  = new Date().toISOString().split("T")[0];
    const where  = { surveyor_id: req.params.surveyorId, survey_date: today };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Survey.findAndCountAll({
        where,
        include: [
            { model: Property, include: [PropertyOwner] },
            { model: Polygon },
        ],
        limit,
        offset,
        order: [["createdAt", "DESC"]],
    });

    res.json({ success: true, data: rows, total: count });
});

/** GET /api/surveys/today — admin view, all surveyors */
const getTodaysSurveys = asyncHandler(async (req, res) => {
    const limit  = parseInt(req.query.limit)  || 10;
    const offset = parseInt(req.query.offset) || 0;
    const today  = new Date().toISOString().split("T")[0];
    const where  = { survey_date: today };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Survey.findAndCountAll({
        where,
        include: [
            { model: Property },
            { model: Polygon, include: [Ward] },
            { model: User, attributes: ["id", "full_name", "phone"] },
        ],
        limit,
        offset,
        order: [["createdAt", "DESC"]],
    });

    res.json({ success: true, data: rows, total: count });
});

// ─── Delete survey image ─────────────────────────────────────
const deleteSurveyImage = asyncHandler(async (req, res) => {
    const photo = await PropertyPhoto.findByPk(req.params.imageId);
    if (!photo) return res.status(404).json({ success: false, message: "Image not found" });
    await photo.destroy();
    res.json({ success: true, message: "Image deleted" });
});

module.exports = {
    // Catalog
    getCategories,
    getSubtypes,
    getFloorUsageTypes,
    getTypeConfigs,
    // Wizard
    createDraftSurvey,
    addPropertyDetails,
    addBuildingInfo,
    addFloor,
    addUnit,
    uploadSurveyPhotos,
    submitSurvey,
    updateSurveyProgress,
    // Queries
    getSurveyById,
    getSurveyorSurveys,
    getSurveyorTodaysSurveys,
    getTodaysSurveys,
    deleteSurveyImage,
};
