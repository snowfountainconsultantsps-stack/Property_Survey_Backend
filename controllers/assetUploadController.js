const { QueryTypes } = require("sequelize");
const { sequelize, AssetLayer, AssetUpload, AssetFeature, Project, Ward } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload, GEOM_FAMILY } = require("../services/shapefileService");
const { FEATURE_SELECT, insertFeaturesBulk, toFeatureCollection } = require("../services/assetGeo");

// Common .dbf/GeoJSON property keys that tend to hold an asset reference code.
const CODE_KEYS = ["feature_code", "code", "asset_code", "ref", "name", "id_no", "gid", "objectid", "fid"];

function pickFeatureCode(props = {}) {
    const lowerMap = {};
    for (const k of Object.keys(props)) lowerMap[k.toLowerCase()] = props[k];
    for (const key of CODE_KEYS) {
        const v = lowerMap[key];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    }
    return null;
}

// ──────────────────────────────────────────────────────────────
// POST /api/assets/layers/:layerId/uploads   (admin / GIS)
// Upload a zipped shapefile or GeoJSON → parse + reproject to WGS84 →
// stage every matching feature (status STAGED) under a new AssetUpload batch.
// ──────────────────────────────────────────────────────────────
const uploadAssetData = asyncHandler(async (req, res) => {
    const layer = await AssetLayer.findByPk(req.params.layerId);
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }

    // Uploads must land inside a project.
    const project_id = req.body.project_id ? Number(req.body.project_id) : null;
    if (!project_id) {
        return res.status(400).json({ success: false, message: "project_id is required — upload into a project." });
    }
    const project = await Project.findByPk(project_id);
    if (!project || !project.is_active) {
        return res.status(404).json({ success: false, message: "Project not found or archived." });
    }

    // 1. Parse + reproject.
    const parsed = await parseUpload(req.file.buffer, {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
    });

    if (!parsed.features.length) {
        return res.status(400).json({ success: false, message: "No valid geometry found in the file." });
    }

    // 2. Keep only features whose geometry family matches the layer.
    const matching = parsed.features.filter(
        (f) => GEOM_FAMILY[f.geometry.type] === layer.geometry_type
    );
    const skipped = parsed.features.length - matching.length;

    if (!matching.length) {
        return res.status(400).json({
            success: false,
            message: `Geometry mismatch. Layer "${layer.name}" expects ${layer.geometry_type}, but the file contains ${parsed.geometryFamilies.join(", ")}.`,
        });
    }

    // 3. Create the batch + stage features in one transaction.
    const ward_id = req.body.ward_id ? Number(req.body.ward_id) : null;
    if (ward_id) {
        const ward = await Ward.findByPk(ward_id);
        if (!ward) {
            return res.status(400).json({ success: false, message: `Ward ${ward_id} not found.` });
        }
    }
    const result = await sequelize.transaction(async (t) => {
        const upload = await AssetUpload.create(
            {
                layer_id: layer.id,
                project_id,
                file_name: req.file.originalname,
                source_format: parsed.format,
                source_crs: req.body.source_crs || null,
                feature_count: matching.length,
                bbox: parsed.bbox,
                status: "PENDING_REVIEW",
                uploaded_by: req.user?.id || null,
                notes: req.body.notes || null,
            },
            { transaction: t }
        );

        // Batched rather than one INSERT per feature: a remote Postgres round
        // trip is ~60ms, so a few hundred features would otherwise spend
        // 30s+ purely waiting on the network.
        const rows = matching.map((f, idx) => ({
            layer_id: layer.id,
            project_id,
            ward_id,
            // Fall back to a batch-scoped unique code (layer + upload + sequence)
            // when the source file has no usable code attribute — guaranteed
            // unique since upload.id is a fresh PK and the index is per-batch.
            feature_code:
                pickFeatureCode(f.properties) ||
                `${layer.code}-${upload.id}-${String(idx + 1).padStart(4, "0")}`,
            properties: f.properties,
            source: "IMPORT",
            status: "STAGED",
            upload_id: upload.id,
            created_by: req.user?.id || null,
            geometry: f.geometry,
        }));

        await insertFeaturesBulk(sequelize, rows, t);
        return upload;
    });

    res.status(201).json({
        success: true,
        message: `Imported ${matching.length} feature(s) into staging.${skipped ? ` ${skipped} skipped (geometry mismatch).` : ""}`,
        data: {
            upload_id: result.id,
            layer: { id: layer.id, name: layer.name, geometry_type: layer.geometry_type },
            staged: matching.length,
            skipped,
            bbox: parsed.bbox,
            source_format: parsed.format,
        },
    });
});

// GET /api/assets/uploads?layer_id=&status=
const listUploads = asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.layer_id) where.layer_id = req.query.layer_id;
    if (req.query.project_id) where.project_id = req.query.project_id;
    if (req.query.status) where.status = req.query.status;
    const uploads = await AssetUpload.findAll({
        where,
        include: [{ model: AssetLayer, as: "layer", attributes: ["id", "name", "code", "geometry_type"] }],
        order: [["createdAt", "DESC"]],
    });
    res.status(200).json({ success: true, data: uploads });
});

// GET /api/assets/uploads/:id
const getUpload = asyncHandler(async (req, res) => {
    const upload = await AssetUpload.findByPk(req.params.id, {
        include: [{ model: AssetLayer, as: "layer" }],
    });
    if (!upload) return res.status(404).json({ success: false, message: "Upload not found." });
    res.status(200).json({ success: true, data: upload });
});

// GET /api/assets/uploads/:id/features  → staged features as GeoJSON (for map review)
const getUploadFeatures = asyncHandler(async (req, res) => {
    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT} FROM "AssetFeatures" f WHERE f.upload_id = :id AND f.is_active = true ORDER BY f.id`,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    res.status(200).json({ success: true, count: rows.length, ...toFeatureCollection(rows) });
});

// Shared status-transition helper for a batch's features + the batch row.
async function transitionUpload(req, res, { featureStatus, uploadStatus, allowedFrom, message, setVerifier }) {
    const upload = await AssetUpload.findByPk(req.params.id);
    if (!upload) return res.status(404).json({ success: false, message: "Upload not found." });
    if (allowedFrom && !allowedFrom.includes(upload.status)) {
        return res.status(400).json({
            success: false,
            message: `Cannot ${uploadStatus} an upload that is '${upload.status}'.`,
        });
    }

    await sequelize.transaction(async (t) => {
        // Only move features that are still active and not already rejected/published.
        await AssetFeature.update(
            {
                status: featureStatus,
                ...(setVerifier
                    ? { verified_by: req.user?.id || null, verified_at: new Date() }
                    : {}),
            },
            {
                where: { upload_id: upload.id, is_active: true },
                transaction: t,
            }
        );
        await upload.update(
            { status: uploadStatus, reviewed_by: req.user?.id || null, reviewed_at: new Date() },
            { transaction: t }
        );
    });

    res.status(200).json({ success: true, message });
}

// POST /api/assets/uploads/:id/verify   → STAGED features become VERIFIED
const verifyUpload = (req, res) =>
    transitionUpload(req, res, {
        featureStatus: "VERIFIED",
        uploadStatus: "VERIFIED",
        allowedFrom: ["PENDING_REVIEW"],
        message: "Upload verified. Features are ready to publish.",
    });

// POST /api/assets/uploads/:id/publish  → features go live (PUBLISHED)
const publishUpload = (req, res) =>
    transitionUpload(req, res, {
        featureStatus: "PUBLISHED",
        uploadStatus: "PUBLISHED",
        allowedFrom: ["PENDING_REVIEW", "VERIFIED"],
        setVerifier: true,
        message: "Upload published. Features are now live for surveyors.",
    });

// POST /api/assets/uploads/:id/reject   → features become REJECTED
const rejectUpload = (req, res) =>
    transitionUpload(req, res, {
        featureStatus: "REJECTED",
        uploadStatus: "REJECTED",
        allowedFrom: ["PENDING_REVIEW", "VERIFIED"],
        message: "Upload rejected. Features hidden.",
    });

// DELETE /api/assets/uploads/:id  → hard-discard a batch (only if not published)
const deleteUpload = asyncHandler(async (req, res) => {
    const upload = await AssetUpload.findByPk(req.params.id);
    if (!upload) return res.status(404).json({ success: false, message: "Upload not found." });
    if (upload.status === "PUBLISHED") {
        return res.status(400).json({
            success: false,
            message: "Cannot delete a published upload. Reject it first if needed.",
        });
    }
    await sequelize.transaction(async (t) => {
        await AssetFeature.destroy({ where: { upload_id: upload.id }, transaction: t });
        await upload.destroy({ transaction: t });
    });
    res.status(200).json({ success: true, message: "Upload and its staged features deleted." });
});

module.exports = {
    uploadAssetData,
    listUploads,
    getUpload,
    getUploadFeatures,
    verifyUpload,
    publishUpload,
    rejectUpload,
    deleteUpload,
};
