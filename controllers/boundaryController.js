const { sequelize } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload } = require("../services/shapefileService");
const { setBoundary, findIdByMatch, getBoundaries } = require("../services/locationGeo");

const isPolygon = (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon";

// GET /api/boundaries?level=WARD&parent_id=5
const getLevelBoundaries = asyncHandler(async (req, res) => {
    const { level, parent_id } = req.query;
    if (!level) return res.status(400).json({ success: false, message: "level is required." });

    let fc;
    try {
        fc = await getBoundaries(sequelize, level, parent_id ? Number(parent_id) : null);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, count: fc.features.length, ...fc });
});

// POST /api/boundaries/:level/:id/upload  (admin / GIS) — set one row's boundary
const uploadSingleBoundary = asyncHandler(async (req, res) => {
    const { level, id } = req.params;
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }

    let parsed;
    try {
        parsed = await parseUpload(req.file.buffer, {
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }

    const polygons = parsed.features.filter(isPolygon);
    if (!polygons.length) {
        return res.status(400).json({
            success: false,
            message: "No polygon geometry found. Boundary files must contain Polygon or MultiPolygon features.",
        });
    }

    try {
        await setBoundary(sequelize, level, id, polygons.map((f) => f.geometry));
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }

    res.status(200).json({
        success: true,
        message: `Boundary saved${polygons.length > 1 ? ` (merged from ${polygons.length} parts)` : ""}.`,
    });
});

// POST /api/boundaries/:level/bulk-upload  (admin / GIS)
// One shapefile with many boundaries → matched to existing rows by name/code.
// Body: match_field (DB column), shapefile_field (attribute key in the file), parent_id? (scope).
const bulkUploadBoundaries = asyncHandler(async (req, res) => {
    const { level } = req.params;
    const { match_field, shapefile_field, parent_id } = req.body;
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }
    if (!match_field || !shapefile_field) {
        return res.status(400).json({ success: false, message: "match_field and shapefile_field are required." });
    }

    let parsed;
    try {
        parsed = await parseUpload(req.file.buffer, {
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }

    const polygons = parsed.features.filter(isPolygon);
    if (!polygons.length) {
        return res.status(400).json({
            success: false,
            message: "No polygon geometry found. Boundary files must contain Polygon or MultiPolygon features.",
        });
    }

    // A single admin unit can be split across several polygon rows in the
    // source file — group by matching value first, then merge geometries.
    const groups = new Map();
    for (const f of polygons) {
        const raw = f.properties?.[shapefile_field];
        if (raw === undefined || raw === null || String(raw).trim() === "") continue;
        const key = String(raw).trim().toLowerCase();
        if (!groups.has(key)) groups.set(key, { rawValue: raw, geometries: [] });
        groups.get(key).geometries.push(f.geometry);
    }

    if (!groups.size) {
        return res.status(400).json({
            success: false,
            message: `No feature had a usable "${shapefile_field}" attribute.`,
        });
    }

    const pid = parent_id ? Number(parent_id) : null;
    const matched = [];
    const unmatched = [];

    for (const { rawValue, geometries } of groups.values()) {
        let matchedId;
        try {
            matchedId = await findIdByMatch(sequelize, level, match_field, rawValue, pid);
        } catch (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        if (!matchedId) {
            unmatched.push(String(rawValue));
            continue;
        }
        await setBoundary(sequelize, level, matchedId, geometries);
        matched.push({ id: matchedId, name: rawValue });
    }

    res.status(200).json({
        success: true,
        message: `Matched ${matched.length} of ${groups.size} boundaries.${
            unmatched.length ? ` ${unmatched.length} unmatched.` : ""
        }`,
        data: { matched, unmatched },
    });
});

module.exports = { getLevelBoundaries, uploadSingleBoundary, bulkUploadBoundaries };
