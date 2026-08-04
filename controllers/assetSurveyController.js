const { QueryTypes } = require("sequelize");
const {
    sequelize,
    AssetFeature,
    AssetLayer,
    AssetSurvey,
    AssetPhoto,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { updateFeatureGeometry } = require("../services/assetGeo");
const { uploadBuffer } = require("../config/cloudinary");

// ──────────────────────────────────────────────────────────────
// POST /api/assets/features/:id/survey   (surveyor)
// Record a field observation / proposed correction against a feature.
// The proposed geometry/attributes are NOT applied yet — an admin approves.
// Body: { action, proposed_properties?, new_geometry?, condition?, notes?,
//         gps_lat?, gps_lng? }
// ──────────────────────────────────────────────────────────────
/**
 * Cast survey answers to the JSON types their layer declares.
 *
 * Form inputs arrive as strings, so a road width would land in JSONB as "8"
 * rather than 8. That breaks every numeric query later — `width_m < 10` either
 * errors or compares lexicographically ("9" > "10"). Coercing on write keeps
 * the stored data directly filterable and works no matter which client sent it.
 */
// Must match the enum on AssetSurvey.condition.
const CONDITION_VALUES = ["GOOD", "FAIR", "POOR", "DAMAGED", "MISSING"];

/** Accept "Good", "good", "GOOD" → "GOOD". Returns null for blank/invalid. */
function normaliseCondition(value) {
    if (value === null || value === undefined || value === "") return null;
    const upper = String(value).trim().toUpperCase();
    return CONDITION_VALUES.includes(upper) ? upper : null;
}

function coerceToSchema(properties, schema) {
    if (!properties || typeof properties !== "object") return properties;
    const byKey = new Map((schema || []).map((f) => [f.key, f]));
    const out = {};

    for (const [key, raw] of Object.entries(properties)) {
        const field = byKey.get(key);
        // Blank answers are stored as null rather than "" so "unanswered" is
        // distinguishable from "answered with an empty string".
        if (raw === "" || raw === undefined) {
            out[key] = null;
            continue;
        }
        if (!field) {
            out[key] = raw;
            continue;
        }
        if (field.type === "number") {
            const n = Number(raw);
            out[key] = Number.isFinite(n) ? n : null;
        } else if (field.type === "boolean") {
            out[key] =
                typeof raw === "boolean" ? raw : ["true", "1", "yes"].includes(String(raw).toLowerCase());
        } else {
            out[key] = raw;
        }
    }
    return out;
}

const submitSurvey = asyncHandler(async (req, res) => {
    const feature = await AssetFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });

    const {
        action,
        proposed_properties = null,
        new_geometry = null,
        condition = null,
        notes = null,
        gps_lat = null,
        gps_lng = null,
    } = req.body;

    const VALID = ["VERIFY", "CORRECT_GEOMETRY", "CORRECT_ATTRIBUTE", "FLAG"];
    if (!VALID.includes(action)) {
        return res.status(400).json({ success: false, message: `action must be one of ${VALID.join(", ")}.` });
    }

    // One survey per asset. A rejected one is the exception — the asset needs
    // re-surveying, so it must not be locked out forever.
    const existing = await AssetSurvey.findOne({
        where: { feature_id: feature.id, status: ["submitted", "approved"] },
        order: [["createdAt", "DESC"]],
    });
    if (existing) {
        return res.status(409).json({
            success: false,
            message: "This asset has already been surveyed.",
            data: { survey_id: existing.id, status: existing.status },
        });
    }

    // Store answers in the types the layer declares, so they stay queryable.
    const layer = await AssetLayer.findByPk(feature.layer_id);
    const typedProperties = coerceToSchema(proposed_properties, layer?.attribute_schema);

    // `condition` is a Postgres enum in UPPERCASE, but the layer catalogue and
    // the app label these "Good"/"Fair"/… — sending those verbatim aborts the
    // insert. Normalise rather than forcing every caller to match the casing.
    const normalisedCondition = normaliseCondition(condition);
    if (condition && !normalisedCondition) {
        return res.status(400).json({
            success: false,
            message: `condition must be one of ${CONDITION_VALUES.join(", ")} (case-insensitive).`,
        });
    }

    const survey = await sequelize.transaction(async (t) => {
        const s = await AssetSurvey.create(
            {
                feature_id: feature.id,
                surveyor_id: req.user.id,
                action,
                proposed_properties: typedProperties,
                condition: normalisedCondition,
                notes,
                gps_lat,
                gps_lng,
                status: "submitted",
            },
            { transaction: t }
        );

        // Store the surveyor's corrected geometry in the survey's new_geom column.
        if (new_geometry) {
            await sequelize.query(
                `UPDATE "AssetSurveys" SET new_geom = ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)) WHERE id = :id`,
                { replacements: { id: s.id, geom: JSON.stringify(new_geometry) }, transaction: t }
            );
        }

        // A FLAG (or any correction) marks the feature as needing office attention.
        if (action === "FLAG" || action === "CORRECT_GEOMETRY" || action === "CORRECT_ATTRIBUTE") {
            await feature.update({ status: "FLAGGED", surveyor_id: req.user.id }, { transaction: t });
        }
        return s;
    });

    res.status(201).json({ success: true, message: "Field survey recorded.", data: survey });
});

// GET /api/assets/features/:id/surveys  → history for a feature
// Returns the surveys plus who recorded them and the layer's question schema,
// so a reviewer can see labelled answers without extra round trips.
const getFeatureSurveys = asyncHandler(async (req, res) => {
    const surveys = await AssetSurvey.findAll({
        where: { feature_id: req.params.id },
        include: [{ model: AssetPhoto, as: "photos" }],
        order: [["createdAt", "DESC"]],
    });

    // AssetSurvey has no User association, so resolve the names in one query.
    const surveyorIds = [...new Set(surveys.map((s) => s.surveyor_id).filter(Boolean))];
    let nameById = {};
    if (surveyorIds.length) {
        const users = await sequelize.query(
            `SELECT id, full_name, phone FROM "Users" WHERE id IN (:ids)`,
            { replacements: { ids: surveyorIds }, type: QueryTypes.SELECT }
        );
        nameById = Object.fromEntries(users.map((u) => [u.id, u]));
    }

    const feature = await AssetFeature.findByPk(req.params.id);
    const layer = feature ? await AssetLayer.findByPk(feature.layer_id) : null;

    res.status(200).json({
        success: true,
        data: surveys.map((s) => ({
            ...s.toJSON(),
            surveyor: nameById[s.surveyor_id] || null,
        })),
        layer: layer
            ? {
                  id: layer.id,
                  code: layer.code,
                  name: layer.name,
                  attribute_schema: layer.attribute_schema,
              }
            : null,
    });
});

// GET /api/assets/surveys/my  → the logged-in surveyor's submissions
// Includes the feature's layer so the app can group submissions by asset type
// without a second round trip per row.
const getMyAssetSurveys = asyncHandler(async (req, res) => {
    const rows = await sequelize.query(
        `SELECT s.id, s.feature_id, s.action, s.condition, s.notes, s.status,
                s."createdAt", s.review_notes,
                f.feature_code, f.layer_id,
                l.name AS layer_name, l.code AS layer_code, l.geometry_type,
                l.style AS layer_style,
                c.name AS category_name, c.color AS category_color
         FROM "AssetSurveys" s
         JOIN "AssetFeatures" f ON f.id = s.feature_id
         JOIN "AssetLayers" l ON l.id = f.layer_id
         LEFT JOIN "AssetCategories" c ON c.id = l.category_id
         WHERE s.surveyor_id = :uid
         ORDER BY s."createdAt" DESC`,
        { replacements: { uid: req.user.id }, type: QueryTypes.SELECT }
    );
    res.status(200).json({ success: true, data: rows });
});

// GET /api/assets/surveys?status=&feature_id=  (admin/supervisor)
const listSurveys = asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.feature_id) where.feature_id = req.query.feature_id;
    const surveys = await AssetSurvey.findAll({
        where,
        include: [{ model: AssetPhoto, as: "photos" }],
        order: [["createdAt", "DESC"]],
    });
    res.status(200).json({ success: true, data: surveys });
});

// POST /api/assets/surveys/:id/approve  (admin) → apply the correction
const approveSurvey = asyncHandler(async (req, res) => {
    const survey = await AssetSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found." });
    if (survey.status !== "submitted") {
        return res.status(400).json({ success: false, message: `Survey already ${survey.status}.` });
    }
    const feature = await AssetFeature.findByPk(survey.feature_id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });

    await sequelize.transaction(async (t) => {
        // Apply proposed attributes (merge over existing).
        if (survey.proposed_properties) {
            await feature.update(
                { properties: { ...(feature.properties || {}), ...survey.proposed_properties } },
                { transaction: t }
            );
        }

        // Apply corrected geometry, if the survey carried one.
        const geomRows = await sequelize.query(
            `SELECT ST_AsGeoJSON(new_geom) AS geojson FROM "AssetSurveys" WHERE id = :id`,
            { replacements: { id: survey.id }, type: QueryTypes.SELECT, transaction: t }
        );
        if (geomRows[0] && geomRows[0].geojson) {
            await updateFeatureGeometry(sequelize, feature.id, JSON.parse(geomRows[0].geojson), t);
        }

        // Correction accepted → feature is live again.
        await feature.update(
            { status: "PUBLISHED", verified_by: req.user?.id || null, verified_at: new Date() },
            { transaction: t }
        );
        await survey.update(
            {
                status: "approved",
                reviewed_by: req.user?.id || null,
                reviewed_at: new Date(),
                review_notes: req.body.review_notes || null,
            },
            { transaction: t }
        );
    });

    res.status(200).json({ success: true, message: "Survey approved and applied to the feature." });
});

// POST /api/assets/surveys/:id/reject  (admin)
const rejectSurvey = asyncHandler(async (req, res) => {
    const survey = await AssetSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found." });
    if (survey.status !== "submitted") {
        return res.status(400).json({ success: false, message: `Survey already ${survey.status}.` });
    }
    await survey.update({
        status: "rejected",
        reviewed_by: req.user?.id || null,
        reviewed_at: new Date(),
        review_notes: req.body.review_notes || null,
    });
    res.status(200).json({ success: true, message: "Survey rejected." });
});

// ──────────────────────────────────────────────────────────────
// PHOTOS — attach field photos to a feature (optionally a survey visit)
// ──────────────────────────────────────────────────────────────

// POST /api/assets/features/:id/photos   (multipart images)
const addFeaturePhotos = asyncHandler(async (req, res) => {
    const feature = await AssetFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });

    const files = req.files || [];
    if (!files.length && !req.body.photo_url) {
        return res.status(400).json({ success: false, message: "No image file or photo_url provided." });
    }

    const created = [];
    if (files.length) {
        for (const file of files) {
            const result = await uploadBuffer(file.buffer, { folder: "property_survey/assets" });
            created.push(
                await AssetPhoto.create({
                    feature_id: feature.id,
                    asset_survey_id: req.body.asset_survey_id || null,
                    photo_url: result.secure_url,
                    caption: req.body.caption || null,
                    uploaded_by: req.user?.id || null,
                })
            );
        }
    } else {
        created.push(
            await AssetPhoto.create({
                feature_id: feature.id,
                asset_survey_id: req.body.asset_survey_id || null,
                photo_url: req.body.photo_url,
                caption: req.body.caption || null,
                uploaded_by: req.user?.id || null,
            })
        );
    }

    res.status(201).json({
        success: true,
        message: "Photo(s) added.",
        data: created,
        image_urls: created.map((p) => p.photo_url),
    });
});

// GET /api/assets/features/:id/photos
const getFeaturePhotos = asyncHandler(async (req, res) => {
    const photos = await AssetPhoto.findAll({ where: { feature_id: req.params.id } });
    res.status(200).json({ success: true, data: photos });
});

module.exports = {
    submitSurvey,
    getFeatureSurveys,
    getMyAssetSurveys,
    listSurveys,
    approveSurvey,
    rejectSurvey,
    addFeaturePhotos,
    getFeaturePhotos,
};
