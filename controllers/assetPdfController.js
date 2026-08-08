const PDFDocument = require("pdfkit");
const { QueryTypes } = require("sequelize");
const { sequelize, Ward } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { writeDesignDoc, writeWardReport } = require("../services/pdfService");
const { areaFilters } = require("../services/areaMatch");

function streamPdf(res, filename, writer) {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    doc.pipe(res);
    writer(doc);
    doc.end();
}

// GET /api/assets/docs/design.pdf
const getDesignDoc = asyncHandler(async (req, res) => {
    streamPdf(res, "digital-asset-system-design.pdf", writeDesignDoc);
});

// Per-layer inventory stats, optionally scoped to a ward and/or project.
// (Shared with getAssetStats and the project summary.)
// `area` is either a ward id (legacy callers) or { zone_id, ward_id,
// locality_id } — the same filter shape the map and feature endpoints take, so
// a filtered map and the totals beside it always agree.
async function loadStats(area, projectId) {
    const repl = {};
    const clauses = [];
    areaFilters(area && typeof area === "object" ? area : { ward_id: area }, clauses, repl);
    const filters = clauses.map((c) => `AND ${c}`);
    if (projectId) {
        filters.push("AND f.project_id = :project_id");
        repl.project_id = projectId;
    }
    const scope = filters.join(" ");
    return sequelize.query(
        `
        SELECT
          l.id AS layer_id, l.code AS layer_code, l.name AS layer_name,
          l.geometry_type AS geometry_type, c.name AS category_name,
          COUNT(f.id) AS feature_count,
          COALESCE(SUM(f.length_m),0) AS total_length_m,
          COALESCE(SUM(f.area_sqm),0) AS total_area_sqm,
          COUNT(f.id) FILTER (WHERE f.status='PUBLISHED') AS published,
          COUNT(f.id) FILTER (WHERE f.status='FLAGGED')   AS flagged
        FROM "AssetLayers" l
        LEFT JOIN "AssetCategories" c ON l.category_id = c.id
        LEFT JOIN "AssetFeatures" f
          ON f.layer_id = l.id AND f.is_active = true ${scope}
        WHERE l.is_active = true
        GROUP BY l.id, l.code, l.name, l.geometry_type, c.name, l.sort_order
        ORDER BY l.sort_order ASC
        `,
        { replacements: repl, type: QueryTypes.SELECT }
    );
}

// Published features (with their layer's style) for plotting the schematic map.
async function loadFeatureLayers(wardId, projectId) {
    const repl = {};
    const filters = [];
    if (wardId) {
        filters.push("AND f.ward_id = :ward_id");
        repl.ward_id = wardId;
    }
    if (projectId) {
        filters.push("AND f.project_id = :project_id");
        repl.project_id = projectId;
    }
    const wardFilter = filters.join(" ");
    const rows = await sequelize.query(
        `
        SELECT l.id AS layer_id, l.name AS layer_name, l.geometry_type, l.style,
               ST_AsGeoJSON(f.geom) AS geojson
        FROM "AssetFeatures" f
        JOIN "AssetLayers" l ON l.id = f.layer_id
        WHERE f.is_active = true AND f.status = 'PUBLISHED' ${wardFilter}
        ORDER BY l.sort_order ASC
        LIMIT 20000
        `,
        { replacements: repl, type: QueryTypes.SELECT }
    );

    const byLayer = new Map();
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const extend = (geom) => {
        if (!geom || !geom.coordinates) return;
        const walk = (c) => {
            if (typeof c[0] === "number") {
                if (c[0] < bbox[0]) bbox[0] = c[0];
                if (c[1] < bbox[1]) bbox[1] = c[1];
                if (c[0] > bbox[2]) bbox[2] = c[0];
                if (c[1] > bbox[3]) bbox[3] = c[1];
                return;
            }
            c.forEach(walk);
        };
        walk(geom.coordinates);
    };

    for (const r of rows) {
        let geometry = null;
        try {
            geometry = JSON.parse(r.geojson);
        } catch {
            continue;
        }
        extend(geometry);
        if (!byLayer.has(r.layer_id)) {
            byLayer.set(r.layer_id, {
                name: r.layer_name,
                style: r.style || {},
                geometry_type: r.geometry_type,
                features: [],
            });
        }
        byLayer.get(r.layer_id).features.push({ type: "Feature", geometry, properties: {} });
    }

    return {
        featureLayers: [...byLayer.values()],
        bbox: bbox[0] === Infinity ? null : bbox,
    };
}

// GET /api/assets/reports/ward/:wardId   (wardId may be "all")
const getWardReport = asyncHandler(async (req, res) => {
    const raw = req.params.wardId;
    const wardId = raw === "all" ? null : Number(raw);

    let ward = null;
    if (wardId) {
        ward = await Ward.findByPk(wardId);
        if (!ward) return res.status(404).json({ success: false, message: "Ward not found." });
    }

    const [stats, plot] = await Promise.all([loadStats(wardId), loadFeatureLayers(wardId)]);

    streamPdf(res, wardId ? `ward-${wardId}-asset-report.pdf` : "area-asset-report.pdf", (doc) =>
        writeWardReport(doc, {
            ward: ward ? { ward_name: ward.ward_name, ward_number: ward.ward_number } : null,
            generatedFor: wardId ? "" : "All wards",
            stats,
            featureLayers: plot.featureLayers,
            bbox: plot.bbox,
        })
    );
});

// GET /api/assets/reports/project/:projectId  → project-scoped asset report
const getProjectReport = asyncHandler(async (req, res) => {
    const { Project } = require("../models");
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });

    const [stats, plot] = await Promise.all([
        loadStats(null, project.id),
        loadFeatureLayers(null, project.id),
    ]);

    streamPdf(res, `project-${project.id}-asset-report.pdf`, (doc) =>
        writeWardReport(doc, {
            ward: null,
            generatedFor: `${project.name}${project.code ? ` (${project.code})` : ""}`,
            stats,
            featureLayers: plot.featureLayers,
            bbox: plot.bbox,
        })
    );
});

module.exports = { getDesignDoc, getWardReport, getProjectReport, loadStats, loadFeatureLayers };
