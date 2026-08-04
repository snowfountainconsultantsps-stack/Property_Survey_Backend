const { sequelize, Project, Ward } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload, GEOM_FAMILY } = require("../services/shapefileService");
const { insertPolygon } = require("../services/polygonGeo");

// Common .dbf/GeoJSON property keys that tend to hold a parcel reference code.
const CODE_KEYS = ["polygon_code", "parcel_code", "code", "survey_no", "khasra_no", "gid", "objectid", "fid"];

function pickPolygonCode(props = {}) {
    const lowerMap = {};
    for (const k of Object.keys(props)) lowerMap[k.toLowerCase()] = props[k];
    for (const key of CODE_KEYS) {
        const v = lowerMap[key];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    }
    return null;
}

// ──────────────────────────────────────────────────────────────
// POST /api/assets/uploads/property   (admin / GIS)
// Bulk-import parcel boundaries (Polygon records) from a zipped shapefile or
// GeoJSON. Each parcel gets a unique polygon_code — taken from the source
// attributes if present, otherwise auto-generated from the new row's id.
// ──────────────────────────────────────────────────────────────
const uploadPropertyShapefile = asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }

    const project_id = req.body.project_id ? Number(req.body.project_id) : null;
    if (!project_id) {
        return res.status(400).json({ success: false, message: "project_id is required — upload into a project." });
    }
    const project = await Project.findByPk(project_id);
    if (!project || !project.is_active) {
        return res.status(404).json({ success: false, message: "Project not found or archived." });
    }

    const ward_id = req.body.ward_id ? Number(req.body.ward_id) : null;
    if (!ward_id) {
        return res.status(400).json({ success: false, message: "ward_id is required for property/parcel uploads." });
    }
    const ward = await Ward.findByPk(ward_id);
    if (!ward) {
        return res.status(400).json({ success: false, message: `Ward ${ward_id} not found.` });
    }

    const parsed = await parseUpload(req.file.buffer, {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
    });
    if (!parsed.features.length) {
        return res.status(400).json({ success: false, message: "No valid geometry found in the file." });
    }

    const polygons = parsed.features.filter((f) => GEOM_FAMILY[f.geometry.type] === "POLYGON");
    const skipped = parsed.features.length - polygons.length;
    if (!polygons.length) {
        return res.status(400).json({
            success: false,
            message: "No polygon geometry found. Property/parcel shapefiles must contain Polygon or MultiPolygon features.",
        });
    }

    const wardTag = ward.ward_number || String(ward.id);

    const created = await sequelize.transaction(async (t) => {
        const rows = [];
        for (const f of polygons) {
            const row = await insertPolygon(
                sequelize,
                {
                    ward_id,
                    project_id,
                    geometry: f.geometry,
                    polygon_code: pickPolygonCode(f.properties),
                    wardTag,
                },
                t
            );
            rows.push(row);
        }
        return rows;
    });

    res.status(201).json({
        success: true,
        message: `Imported ${created.length} parcel(s).${skipped ? ` ${skipped} skipped (non-polygon geometry).` : ""}`,
        data: { created: created.length, skipped, polygons: created, bbox: parsed.bbox },
    });
});

module.exports = { uploadPropertyShapefile };
