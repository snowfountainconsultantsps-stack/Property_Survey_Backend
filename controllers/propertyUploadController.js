const { sequelize, Project, Ward } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload, GEOM_FAMILY } = require("../services/shapefileService");
const { insertPolygon } = require("../services/polygonGeo");
const { matchAreas, summarise } = require("../services/areaMatch");

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

    // A ward is no longer asked for: each parcel is stamped with the ward,
    // zone and locality its own geometry falls in (services/areaMatch.js).
    // A parcel file covers a whole ULB, so one ward for the batch mis-filed
    // most of it. Passing ward_id still works as a fallback for parcels that
    // land outside every boundary.
    const fallback_ward_id = req.body.ward_id ? Number(req.body.ward_id) : null;
    let fallbackWard = null;
    if (fallback_ward_id) {
        fallbackWard = await Ward.findByPk(fallback_ward_id);
        if (!fallbackWard) {
            return res.status(400).json({ success: false, message: `Ward ${fallback_ward_id} not found.` });
        }
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

    const matches = await matchAreas(sequelize, polygons.map((f) => f.geometry), project);
    if (fallbackWard) {
        for (const m of matches) {
            if (!m.ward_id) {
                m.ward_id = fallbackWard.id;
                m.zone_id = m.zone_id ?? fallbackWard.zone_id ?? null;
            }
        }
    }
    const areaStats = summarise(matches);

    // The generated polygon_code carries its own ward, so the tag is per parcel
    // rather than per batch. Unmatched parcels get 'NA' instead of borrowing a
    // ward number they don't belong to.
    const wardIds = [...new Set(matches.map((m) => m.ward_id).filter(Boolean))];
    const wardTags = new Map();
    if (wardIds.length) {
        const rows = await Ward.findAll({ where: { id: wardIds } });
        rows.forEach((w) => wardTags.set(w.id, w.ward_number || String(w.id)));
    }

    const created = await sequelize.transaction(async (t) => {
        const rows = [];
        for (let i = 0; i < polygons.length; i += 1) {
            const f = polygons[i];
            const m = matches[i];
            const row = await insertPolygon(
                sequelize,
                {
                    ward_id: m.ward_id,
                    zone_id: m.zone_id,
                    locality_id: m.locality_id,
                    project_id,
                    geometry: f.geometry,
                    polygon_code: pickPolygonCode(f.properties),
                    wardTag: m.ward_id ? wardTags.get(m.ward_id) || String(m.ward_id) : "NA",
                },
                t
            );
            rows.push({ ...row, ward_id: m.ward_id, zone_id: m.zone_id, locality_id: m.locality_id });
        }
        return rows;
    });

    const areaNote = areaStats.matched
        ? ` Matched ${areaStats.matched} to ${areaStats.wards_touched} ward(s).` +
          `${areaStats.unmatched ? ` ${areaStats.unmatched} fell outside every ward boundary.` : ""}`
        : " No parcel fell inside a known ward boundary — import the ward boundaries for this ULB first.";

    res.status(201).json({
        success: true,
        message:
            `Imported ${created.length} parcel(s).` +
            `${skipped ? ` ${skipped} skipped (non-polygon geometry).` : ""}${areaNote}`,
        data: { created: created.length, skipped, polygons: created, bbox: parsed.bbox, areas: areaStats },
    });
});

module.exports = { uploadPropertyShapefile };
