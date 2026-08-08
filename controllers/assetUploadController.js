const { QueryTypes } = require("sequelize");
const { sequelize, AssetLayer, AssetUpload, AssetFeature, Project, Ward } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload, GEOM_FAMILY } = require("../services/shapefileService");
const { FEATURE_SELECT, insertFeaturesBulk, toFeatureCollection } = require("../services/assetGeo");
const { matchAreas, rematchFeatures, summarise, areaFilters } = require("../services/areaMatch");

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

    // 3. Work out where each feature falls in the hierarchy from its own
    //    geometry. A bulk file spans a whole ULB, so one ward for the batch was
    //    wrong for most of it — and a NULL ward makes the feature invisible to
    //    every scoped surveyor (services/surveyorScope.js).
    //    `ward_id` in the body is now only a fallback for features that land
    //    outside every known boundary (or when no boundaries are imported yet).
    const fallback_ward_id = req.body.ward_id ? Number(req.body.ward_id) : null;
    let fallbackWard = null;
    if (fallback_ward_id) {
        fallbackWard = await Ward.findByPk(fallback_ward_id);
        if (!fallbackWard) {
            return res.status(400).json({ success: false, message: `Ward ${fallback_ward_id} not found.` });
        }
    }

    const matches = await matchAreas(sequelize, matching.map((f) => f.geometry), project);
    if (fallbackWard) {
        for (const m of matches) {
            if (!m.ward_id) {
                m.ward_id = fallbackWard.id;
                m.zone_id = m.zone_id ?? fallbackWard.zone_id ?? null;
            }
        }
    }
    const areaStats = summarise(matches);

    // 4. Create the batch + stage features in one transaction.
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
            zone_id: matches[idx].zone_id,
            ward_id: matches[idx].ward_id,
            locality_id: matches[idx].locality_id,
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

    // An unmatched count is worth saying out loud: those features carry no
    // ward, so they won't appear under any ward filter or surveyor allocation
    // until the boundaries that cover them are imported.
    const areaNote = areaStats.matched
        ? ` Matched ${areaStats.matched} to ${areaStats.wards_touched} ward(s)` +
          `${areaStats.zones_touched ? `, ${areaStats.zones_touched} zone(s)` : ""}` +
          `${areaStats.localities_touched ? `, ${areaStats.localities_touched} locality(ies)` : ""}.` +
          `${areaStats.unmatched ? ` ${areaStats.unmatched} fell outside every ward boundary.` : ""}`
        : ` No feature fell inside a known ward boundary — import the ward boundaries for this ULB, then re-match this batch.`;

    res.status(201).json({
        success: true,
        message:
            `Imported ${matching.length} feature(s) into staging.` +
            `${skipped ? ` ${skipped} skipped (geometry mismatch).` : ""}${areaNote}`,
        data: {
            upload_id: result.id,
            layer: { id: layer.id, name: layer.name, geometry_type: layer.geometry_type },
            staged: matching.length,
            skipped,
            bbox: parsed.bbox,
            source_format: parsed.format,
            areas: areaStats,
        },
    });
});

// ──────────────────────────────────────────────────────────────
// POST /api/assets/uploads/:id/match-areas   (admin / GIS)
// Re-run the spatial hierarchy match over a batch already in the table — for
// features imported before this existed, or after the ward/zone/locality
// boundaries were (re)imported. Only fills gaps unless ?overwrite=1, so a
// ward corrected by hand on one feature survives a bulk re-run.
// ──────────────────────────────────────────────────────────────
const matchUploadAreas = asyncHandler(async (req, res) => {
    const upload = await AssetUpload.findByPk(req.params.id);
    if (!upload) return res.status(404).json({ success: false, message: "Upload not found." });

    const project = upload.project_id ? await Project.findByPk(upload.project_id) : null;
    const overwrite = req.query.overwrite === "1" || req.query.overwrite === "true";

    const { updated } = await rematchFeatures(sequelize, {
        uploadId: upload.id,
        project,
        overwrite,
    });

    const [stats] = await sequelize.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(ward_id)::int AS with_ward,
                COUNT(DISTINCT ward_id)::int AS wards,
                COUNT(DISTINCT zone_id)::int AS zones,
                COUNT(DISTINCT locality_id)::int AS localities
         FROM "AssetFeatures" WHERE upload_id = :id AND is_active = true`,
        { replacements: { id: upload.id }, type: QueryTypes.SELECT }
    );

    res.status(200).json({
        success: true,
        message:
            `Re-matched ${updated} feature(s). ` +
            `${stats.with_ward}/${stats.total} now carry a ward across ${stats.wards} ward(s).`,
        data: { updated, ...stats },
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

// GET /api/assets/uploads/:id/features?zone_id=&ward_id=&locality_id=
// Staged features as GeoJSON, for reviewing a batch on the map. The area
// filters let a reviewer check one ward at a time instead of eyeballing a
// whole ULB's import at once.
const getUploadFeatures = asyncHandler(async (req, res) => {
    const where = ["f.upload_id = :id", "f.is_active = true"];
    const repl = { id: req.params.id };
    areaFilters(req.query, where, repl);

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT} FROM "AssetFeatures" f WHERE ${where.join(" AND ")} ORDER BY f.id`,
        { replacements: repl, type: QueryTypes.SELECT }
    );

    // What the batch actually spans, so the reviewer's filter only offers areas
    // that have features in it (and reveals when a batch is stamped nowhere).
    const [spread] = await sequelize.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ward_id IS NULL)::int AS unmatched,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT zone_id), NULL)     AS zone_ids,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT ward_id), NULL)     AS ward_ids,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT locality_id), NULL) AS locality_ids
         FROM "AssetFeatures" WHERE upload_id = :id AND is_active = true`,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );

    res.status(200).json({ success: true, count: rows.length, areas: spread, ...toFeatureCollection(rows) });
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
    matchUploadAreas,
    listUploads,
    getUpload,
    getUploadFeatures,
    verifyUpload,
    publishUpload,
    rejectUpload,
    deleteUpload,
};
