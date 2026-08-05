const { sequelize } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { parseUpload } = require("../services/shapefileService");
const {
    setBoundary, findIdByMatch, createRow, getBoundaries, levelConfig,
} = require("../services/locationGeo");

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

// ════════════════════════════════════════════════════════════════
// IMPORT — build the hierarchy FROM a shapefile instead of typing it in.
//
// Two steps on purpose: nothing is written until the admin has seen exactly
// what would be created. `preview` is read-only; `commit` takes the same file
// back with the confirmed field mapping. Re-sending the file keeps the server
// stateless — no staging table to populate, expire and clean up.
// ════════════════════════════════════════════════════════════════

/** Parse the upload and group polygons by the chosen name attribute. */
async function parseAndGroup(file, nameField, codeField) {
    const parsed = await parseUpload(file.buffer, {
        fileName: file.originalname,
        mimeType: file.mimetype,
    });
    const polygons = parsed.features.filter(isPolygon);
    if (!polygons.length) {
        const err = new Error(
            "No polygon geometry found. Boundary files must contain Polygon or MultiPolygon features."
        );
        err.statusCode = 400;
        throw err;
    }

    // Every attribute key present, so the admin can pick which one is the name.
    const fieldSet = new Set();
    polygons.forEach((f) => Object.keys(f.properties || {}).forEach((k) => fieldSet.add(k)));
    const fields = [...fieldSet];

    if (!nameField) return { polygons, fields, groups: null };

    // One admin unit is often split across several polygon rows — group first,
    // then merge the parts into a single MultiPolygon on write.
    const groups = new Map();
    for (const f of polygons) {
        const raw = f.properties?.[nameField];
        if (raw === undefined || raw === null || String(raw).trim() === "") continue;
        const key = String(raw).trim().toLowerCase();
        if (!groups.has(key)) {
            groups.set(key, {
                name: String(raw).trim(),
                code: codeField ? f.properties?.[codeField] ?? null : null,
                geometries: [],
            });
        }
        groups.get(key).geometries.push(f.geometry);
    }
    return { polygons, fields, groups };
}

// POST /api/boundaries/:level/import/preview
// Body: name_field?, code_field?, parent_id?   — read-only, writes nothing.
const previewBoundaryImport = asyncHandler(async (req, res) => {
    const { level } = req.params;
    const { name_field, code_field, parent_id } = req.body;
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }

    let cfg;
    try {
        cfg = levelConfig(level);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (cfg.parentCol && !parent_id) {
        return res.status(400).json({
            success: false,
            message: `A parent must be selected before importing ${cfg.table}.`,
        });
    }

    let out;
    try {
        out = await parseAndGroup(req.file, name_field, code_field);
    } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }

    // Step 1 — no field chosen yet: report what's in the file so the admin can choose.
    if (!out.groups) {
        const sample = out.polygons[0]?.properties || {};
        return res.status(200).json({
            success: true,
            data: {
                stage: "choose_field",
                feature_count: out.polygons.length,
                fields: out.fields,
                sample_values: Object.fromEntries(out.fields.map((f) => [f, sample[f] ?? null])),
            },
        });
    }

    // Step 2 — field chosen: show precisely what would be created vs updated.
    const pid = parent_id ? Number(parent_id) : null;
    const rows = [];
    for (const g of out.groups.values()) {
        const existingId = await findIdByMatch(sequelize, level, cfg.nameCol, g.name, pid);
        rows.push({
            name: g.name,
            code: g.code,
            parts: g.geometries.length,
            existing_id: existingId,
            action: existingId ? "update" : "create",
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({
        success: true,
        data: {
            stage: "confirm",
            feature_count: out.polygons.length,
            fields: out.fields,
            rows,
            summary: {
                total: rows.length,
                create: rows.filter((r) => r.action === "create").length,
                update: rows.filter((r) => r.action === "update").length,
            },
        },
    });
});

// POST /api/boundaries/:level/import/commit
// Body: name_field, code_field?, parent_id?, include? (JSON array of names)
const commitBoundaryImport = asyncHandler(async (req, res) => {
    const { level } = req.params;
    const { name_field, code_field, parent_id, include } = req.body;
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded (field name 'file')." });
    }
    if (!name_field) {
        return res.status(400).json({ success: false, message: "name_field is required." });
    }

    let cfg;
    try {
        cfg = levelConfig(level);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (cfg.parentCol && !parent_id) {
        return res.status(400).json({
            success: false,
            message: `A parent must be selected before importing ${cfg.table}.`,
        });
    }

    let out;
    try {
        out = await parseAndGroup(req.file, name_field, code_field);
    } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }

    // Optional allow-list, so the admin can drop rows they didn't want.
    let allow = null;
    if (include) {
        try {
            const arr = typeof include === "string" ? JSON.parse(include) : include;
            if (Array.isArray(arr)) allow = new Set(arr.map((s) => String(s).trim().toLowerCase()));
        } catch {
            return res.status(400).json({ success: false, message: "include must be a JSON array of names." });
        }
    }

    const pid = parent_id ? Number(parent_id) : null;
    const created = [];
    const updated = [];
    const skipped = [];

    // All-or-nothing: a half-imported hierarchy is worse than none.
    const t = await sequelize.transaction();
    try {
        for (const g of out.groups.values()) {
            if (allow && !allow.has(g.name.toLowerCase())) {
                skipped.push(g.name);
                continue;
            }
            let id = await findIdByMatch(sequelize, level, cfg.nameCol, g.name, pid);
            if (id) {
                await setBoundary(sequelize, level, id, g.geometries, t);
                updated.push({ id, name: g.name });
            } else {
                id = await createRow(
                    sequelize, level,
                    { name: g.name, code: g.code, parentId: pid },
                    t
                );
                await setBoundary(sequelize, level, id, g.geometries, t);
                created.push({ id, name: g.name });
            }
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        return res.status(500).json({
            success: false,
            message: `Import failed and was rolled back: ${err.message}`,
        });
    }

    res.status(200).json({
        success: true,
        message: `Imported ${created.length} new and updated ${updated.length} ${cfg.table}.`,
        data: { created, updated, skipped },
    });
});

module.exports = {
    getLevelBoundaries,
    uploadSingleBoundary,
    bulkUploadBoundaries,
    previewBoundaryImport,
    commitBoundaryImport,
};
