const { QueryTypes } = require("sequelize");
const {
    sequelize,
    AssetCategory,
    AssetLayer,
    AssetFeature,
    Polygon,
    Ward,
} = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { resolveScope, scopeClause, isFeatureInScope } = require("../services/surveyorScope");
const {
    FEATURE_SELECT,
    FEATURE_SURVEY_STATUS,
    insertFeature,
    updateFeatureGeometry,
    toFeatureCollection,
    rowToFeature,
} = require("../services/assetGeo");
const { createPolygonFromFeature } = require("../services/polygonGeo");

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Build a bbox SQL fragment from "minLng,minLat,maxLng,maxLat". */
function bboxClause(bbox, repl) {
    if (!bbox) return null;
    const b = String(bbox).split(",").map(Number);
    if (b.length !== 4 || !b.every(Number.isFinite)) return null;
    repl.minx = b[0];
    repl.miny = b[1];
    repl.maxx = b[2];
    repl.maxy = b[3];
    return "ST_Intersects(f.geom, ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326))";
}

// ══════════════════════════════════════════════════════════════
// CATALOG — categories & layers
// ══════════════════════════════════════════════════════════════

// GET /api/assets/categories  → categories with their active layers
const getCategories = asyncHandler(async (req, res) => {
    const categories = await AssetCategory.findAll({
        where: { is_active: true },
        include: [
            {
                model: AssetLayer,
                as: "layers",
                where: { is_active: true },
                required: false,
            },
        ],
        order: [
            ["sort_order", "ASC"],
            [{ model: AssetLayer, as: "layers" }, "sort_order", "ASC"],
        ],
    });
    res.status(200).json({ success: true, data: categories });
});

// POST /api/assets/categories  (admin)
const createCategory = asyncHandler(async (req, res) => {
    const category = await AssetCategory.create(req.body);
    res.status(201).json({ success: true, message: "Category created.", data: category });
});

// GET /api/assets/layers?category_id=
const getLayers = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.category_id) where.category_id = req.query.category_id;
    const layers = await AssetLayer.findAll({
        where,
        include: [{ model: AssetCategory, as: "category" }],
        order: [["sort_order", "ASC"]],
    });
    res.status(200).json({ success: true, data: layers });
});

// GET /api/assets/layers/:id
const getLayerById = asyncHandler(async (req, res) => {
    const layer = await AssetLayer.findByPk(req.params.id, {
        include: [{ model: AssetCategory, as: "category" }],
    });
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });
    res.status(200).json({ success: true, data: layer });
});

// The survey form is generated from a layer's attribute_schema, and answers are
// stored (and later filtered) using each field's declared type — so a malformed
// schema silently produces an unusable form or unqueryable data. Validate here
// rather than discovering it in the field.
const FIELD_TYPES = ["text", "number", "boolean", "select", "date"];
const KEY_RE = /^[a-z][a-z0-9_]*$/;

function validateAttributeSchema(schema) {
    if (schema === undefined || schema === null) return null;
    if (!Array.isArray(schema)) return "attribute_schema must be an array of fields.";

    const seen = new Set();
    for (const [i, f] of schema.entries()) {
        const at = `Field ${i + 1}`;
        if (!f || typeof f !== "object") return `${at}: must be an object.`;
        if (!f.key || !KEY_RE.test(f.key)) {
            return `${at}: key "${f.key ?? ""}" must be lower_snake_case and start with a letter.`;
        }
        if (seen.has(f.key)) return `${at}: duplicate key "${f.key}".`;
        seen.add(f.key);
        if (!f.label || !String(f.label).trim()) return `${at} (${f.key}): a label is required.`;
        if (!FIELD_TYPES.includes(f.type)) {
            return `${at} (${f.key}): type must be one of ${FIELD_TYPES.join(", ")}.`;
        }
        if (f.type === "select" && (!Array.isArray(f.options) || f.options.length === 0)) {
            return `${at} (${f.key}): a select field needs at least one option.`;
        }
    }
    return null;
}

// POST /api/assets/layers  (admin)
const createLayer = asyncHandler(async (req, res) => {
    const schemaError = validateAttributeSchema(req.body.attribute_schema);
    if (schemaError) return res.status(400).json({ success: false, message: schemaError });

    const layer = await AssetLayer.create(req.body);
    res.status(201).json({ success: true, message: "Layer created.", data: layer });
});

// PUT /api/assets/layers/:id  (admin)
const updateLayer = asyncHandler(async (req, res) => {
    const layer = await AssetLayer.findByPk(req.params.id);
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });

    const schemaError = validateAttributeSchema(req.body.attribute_schema);
    if (schemaError) return res.status(400).json({ success: false, message: schemaError });

    const updated = await layer.update(req.body);
    res.status(200).json({ success: true, message: "Layer updated.", data: updated });
});

// DELETE /api/assets/layers/:id  (admin) — soft delete (hide from map)
const deleteLayer = asyncHandler(async (req, res) => {
    const layer = await AssetLayer.findByPk(req.params.id);
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });
    await layer.update({ is_active: false });
    res.status(200).json({ success: true, message: "Layer archived." });
});

// ══════════════════════════════════════════════════════════════
// FEATURES — read as GeoJSON
// ══════════════════════════════════════════════════════════════

// GET /api/assets/layers/:id/features?status=&ward_id=&bbox=
// Returns a GeoJSON FeatureCollection for one layer.
const getLayerFeatures = asyncHandler(async (req, res) => {
    const { status, ward_id, project_id, bbox } = req.query;
    const where = ["f.is_active = true", "f.layer_id = :layer_id"];
    const repl = { layer_id: req.params.id };

    if (status) {
        where.push("f.status = :status");
        repl.status = status;
    }
    if (ward_id) {
        where.push("f.ward_id = :ward_id");
        repl.ward_id = ward_id;
    }
    if (project_id) {
        where.push("f.project_id = :project_id");
        repl.project_id = project_id;
    }
    const bb = bboxClause(bbox, repl);
    if (bb) where.push(bb);

    // Same allocation guard as the map — this endpoint returns a whole layer.
    const layerScope = await resolveScope(sequelize, req.user);
    const layerScoped = scopeClause(layerScope, "f", repl);
    if (layerScoped) where.push(layerScoped.clause);

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT}, ${FEATURE_SURVEY_STATUS}
         FROM "AssetFeatures" f WHERE ${where.join(" AND ")} ORDER BY f.id`,
        { replacements: repl, type: QueryTypes.SELECT }
    );

    res.status(200).json({
        success: true,
        count: rows.length,
        ...toFeatureCollection(rows),
    });
});

// GET /api/assets/map?ward_id=&bbox=&status=&meta_only=&limit=
// The core "layered map" endpoint: every active layer + its features grouped,
// so the frontend can render toggleable layers from a single request.
// Defaults to PUBLISHED features; pass status=ALL (admin) to include staged/etc.
//
// Two guards matter for large datasets (a city's parcels run to tens of
// thousands, which is megabytes of GeoJSON a phone cannot render):
//   • meta_only=1 → layer list with counts + extent, no geometry at all.
//     Cheap enough to drive a layer picker and to centre a map before any
//     features are fetched.
//   • limit=N     → cap the features returned, with `truncated` in the
//     response so the client can tell the user to zoom in. Pair with bbox.
const getAssetMap = asyncHandler(async (req, res) => {
    const { ward_id, project_id, bbox, status = "PUBLISHED", meta_only, limit } = req.query;

    const layers = await AssetLayer.findAll({
        where: { is_active: true },
        include: [{ model: AssetCategory, as: "category" }],
        order: [["sort_order", "ASC"]],
    });

    const where = ["f.is_active = true"];
    const repl = {};
    if (status && status !== "ALL") {
        where.push("f.status = :status");
        repl.status = status;
    }
    if (ward_id) {
        where.push("f.ward_id = :ward_id");
        repl.ward_id = ward_id;
    }
    if (project_id) {
        where.push("f.project_id = :project_id");
        repl.project_id = project_id;
    }
    const bb = bboxClause(bbox, repl);
    if (bb) where.push(bb);

    // A surveyor only ever sees their allocated area. Admin/supervisor/GIS
    // roles are unrestricted; a surveyor with no assignment sees nothing
    // (the clause resolves to FALSE) rather than the whole city.
    const scope = await resolveScope(sequelize, req.user);
    const scoped = scopeClause(scope, "f", repl);
    if (scoped) where.push(scoped.clause);

    const baseLayer = (l, extra) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        geometry_type: l.geometry_type,
        style: l.style,
        attribute_schema: l.attribute_schema,
        surveyable: l.surveyable,
        category: l.category
            ? { id: l.category.id, code: l.category.code, name: l.category.name, color: l.category.color }
            : null,
        ...extra,
    });

    // ── Metadata only: counts + extent per layer, no geometry ──────────
    if (meta_only) {
        // A property draft (Survey row that isn't completed/reviewed) counts as
        // in-progress, not done — see FEATURE_SURVEY_STATUS in assetGeo.js.
        const DONE_PROPERTY = `EXISTS (SELECT 1 FROM "Properties" p
                                       JOIN "Surveys" s ON s.property_id = p.id
                                       WHERE f.polygon_id IS NOT NULL AND p.polygon_id = f.polygon_id
                                         AND s.status IN ('completed','reviewed'))`;
        const ANY_PROPERTY = `EXISTS (SELECT 1 FROM "Properties" p
                                      JOIN "Surveys" s ON s.property_id = p.id
                                      WHERE f.polygon_id IS NOT NULL AND p.polygon_id = f.polygon_id)`;
        const ANY_ASSET = `EXISTS (SELECT 1 FROM "AssetSurveys" a WHERE a.feature_id = f.id)`;

        const stats = await sequelize.query(
            `SELECT f.layer_id,
                    COUNT(*)::int AS feature_count,
                    COUNT(*) FILTER (WHERE ${ANY_ASSET} OR ${DONE_PROPERTY})::int AS surveyed_count,
                    COUNT(*) FILTER (
                      WHERE NOT (${ANY_ASSET}) AND ${ANY_PROPERTY} AND NOT (${DONE_PROPERTY})
                    )::int AS in_progress_count,
                    ST_XMin(ST_Extent(f.geom)) AS minx, ST_YMin(ST_Extent(f.geom)) AS miny,
                    ST_XMax(ST_Extent(f.geom)) AS maxx, ST_YMax(ST_Extent(f.geom)) AS maxy
             FROM "AssetFeatures" f WHERE ${where.join(" AND ")} GROUP BY f.layer_id`,
            { replacements: repl, type: QueryTypes.SELECT }
        );
        const byId = Object.fromEntries(stats.map((s) => [s.layer_id, s]));

        const data = layers.map((l) => {
            const s = byId[l.id];
            return baseLayer(l, {
                feature_count: s?.feature_count || 0,
                surveyed_count: s?.surveyed_count || 0,
                in_progress_count: s?.in_progress_count || 0,
                extent: s && s.minx !== null ? [s.minx, s.miny, s.maxx, s.maxy] : null,
            });
        });
        return res.status(200).json({
            success: true,
            meta_only: true,
            feature_count: stats.reduce((n, s) => n + s.feature_count, 0),
            layers: data,
        });
    }

    // ── Full geometry ──────────────────────────────────────────────────
    const cap = Math.max(0, Number(limit) || 0);
    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT}, ${FEATURE_SURVEY_STATUS}
         FROM "AssetFeatures" f WHERE ${where.join(" AND ")} ORDER BY f.layer_id, f.id
         ${cap ? "LIMIT :cap" : ""}`,
        { replacements: cap ? { ...repl, cap: cap + 1 } : repl, type: QueryTypes.SELECT }
    );

    // Asked for one extra row purely to detect truncation.
    const truncated = cap > 0 && rows.length > cap;
    if (truncated) rows.length = cap;

    const byLayer = {};
    for (const r of rows) (byLayer[r.layer_id] ||= []).push(r);

    const data = layers.map((l) =>
        baseLayer(l, {
            feature_count: (byLayer[l.id] || []).length,
            geojson: toFeatureCollection(byLayer[l.id] || []),
        })
    );

    res.status(200).json({ success: true, feature_count: rows.length, truncated, layers: data });
});

// GET /api/assets/features/:id  → single feature as GeoJSON Feature
const getFeatureById = asyncHandler(async (req, res) => {
    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT} FROM "AssetFeatures" f WHERE f.id = :id`,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Feature not found." });
    // Ids are guessable, so the list filter alone wouldn't stop a surveyor
    // opening an asset outside their allocated area.
    if (!(await isFeatureInScope(sequelize, req.user, req.params.id))) {
        return res.status(403).json({
            success: false,
            message: "This asset is outside your allocated area.",
        });
    }
    res.status(200).json({ success: true, data: rowToFeature(rows[0]) });
});

// GET /api/assets/features/nearby?lat=&lng=&radius=&layer_id=
// For the surveyor: what published assets are around me?
const getNearbyFeatures = asyncHandler(async (req, res) => {
    const { lat, lng, radius = 100, layer_id, project_id } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ success: false, message: "lat and lng are required." });
    }
    const where = [
        "f.is_active = true",
        "f.status = 'PUBLISHED'",
        `ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)`,
    ];
    const repl = { lat: Number(lat), lng: Number(lng), radius: Number(radius) };
    if (layer_id) {
        where.push("f.layer_id = :layer_id");
        repl.layer_id = layer_id;
    }
    if (project_id) {
        where.push("f.project_id = :project_id");
        repl.project_id = project_id;
    }
    // Proximity must not leak assets outside the surveyor's allocated area.
    const nearScope = await resolveScope(sequelize, req.user);
    const nearScoped = scopeClause(nearScope, "f", repl);
    if (nearScoped) where.push(nearScoped.clause);

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT},
                ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_m
         FROM "AssetFeatures" f
         WHERE ${where.join(" AND ")}
         ORDER BY distance_m ASC
         LIMIT 200`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
    const fc = toFeatureCollection(rows);
    // attach distance to each feature's properties
    fc.features.forEach((feat, i) => (feat.properties.distance_m = rows[i].distance_m));
    res.status(200).json({ success: true, count: rows.length, ...fc });
});

// POST /api/assets/features  → manually add a feature (drawn on the map).
// Body: { layer_id, geometry, properties?, ward_id?, feature_code?, status? }
const createFeature = asyncHandler(async (req, res) => {
    const { layer_id, geometry, properties, project_id, ward_id, polygon_id, feature_code, status } = req.body;
    if (!layer_id || !geometry) {
        return res.status(400).json({ success: false, message: "layer_id and geometry are required." });
    }
    const layer = await AssetLayer.findByPk(layer_id);
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });

    const id = await insertFeature(sequelize, {
        layer_id,
        project_id: project_id || null,
        ward_id: ward_id || null,
        polygon_id: polygon_id || null,
        feature_code: feature_code || null,
        properties: properties || {},
        source: "MANUAL",
        status: status || "PUBLISHED",
        created_by: req.user?.id || null,
        geometry,
    });

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT} FROM "AssetFeatures" f WHERE f.id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT }
    );
    res.status(201).json({ success: true, message: "Feature created.", data: rowToFeature(rows[0]) });
});

// PUT /api/assets/features/:id  → update attributes/status and/or geometry.
const updateFeature = asyncHandler(async (req, res) => {
    const feature = await AssetFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });

    const { geometry, properties, feature_code, status, project_id, ward_id, polygon_id } = req.body;

    // Non-geometry fields via Sequelize.
    const patch = {};
    if (properties !== undefined) patch.properties = properties;
    if (feature_code !== undefined) patch.feature_code = feature_code;
    if (status !== undefined) patch.status = status;
    if (project_id !== undefined) patch.project_id = project_id;
    if (ward_id !== undefined) patch.ward_id = ward_id;
    if (polygon_id !== undefined) patch.polygon_id = polygon_id;
    if (Object.keys(patch).length) await feature.update(patch);

    // Geometry via raw SQL.
    if (geometry) await updateFeatureGeometry(sequelize, feature.id, geometry);

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT} FROM "AssetFeatures" f WHERE f.id = :id`,
        { replacements: { id: feature.id }, type: QueryTypes.SELECT }
    );
    res.status(200).json({ success: true, message: "Feature updated.", data: rowToFeature(rows[0]) });
});

// DELETE /api/assets/features/:id  → soft delete
const deleteFeature = asyncHandler(async (req, res) => {
    const feature = await AssetFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });
    await feature.update({ is_active: false });
    res.status(200).json({ success: true, message: "Feature deleted." });
});

// ══════════════════════════════════════════════════════════════
// PROPERTY BRIDGE — asset feature → Polygon
// ══════════════════════════════════════════════════════════════

// POST /api/assets/features/:id/ensure-polygon   (surveyor)
// Property parcels are uploaded as AssetFeatures, but the property-survey
// wizard saves into Properties/Surveys/Units, all keyed on Polygons.id.
// This returns the Polygon for a parcel feature, creating + linking one from
// the feature's own geometry the first time it's surveyed. The wizard itself
// is untouched — it still just receives a polygon_code.
const ensureFeaturePolygon = asyncHandler(async (req, res) => {
    const feature = await AssetFeature.findByPk(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: "Feature not found." });

    // Survey status for a polygon: any Survey reachable via its Properties.
    // A draft (not completed/reviewed) is resumable, not finished — so it must
    // not report as a completed survey or the app refuses to reopen it.
    const withSurveyStatus = async (polygon) => {
        const rows = await sequelize.query(
            `SELECT MAX(s.id) AS latest_survey_id,
                    COUNT(s.id) AS survey_count,
                    MAX(s.id) FILTER (WHERE s.status IN ('completed','reviewed')) AS completed_survey_id,
                    MAX(s.id) FILTER (WHERE s.status NOT IN ('completed','reviewed')) AS draft_survey_id
             FROM "Properties" p
             LEFT JOIN "Surveys" s ON s.property_id = p.id
             WHERE p.polygon_id = :polygon_id`,
            { replacements: { polygon_id: polygon.id }, type: QueryTypes.SELECT }
        );
        const latest = rows[0]?.completed_survey_id || null;
        const draft = rows[0]?.draft_survey_id || null;
        const w = polygon.ward_id ? await Ward.findByPk(polygon.ward_id) : null;
        return {
            success: true,
            data: {
                polygon_id: polygon.id,
                polygon_code: polygon.polygon_code,
                ward_id: polygon.ward_id,
                ward_name: w?.ward_name || null,
                area_sqmt: polygon.area_sqmt,
                hasCompletedSurvey: Boolean(latest),
                completedSurveyId: latest,
                // Lets the app resume an unfinished wizard instead of
                // starting a second survey for the same parcel.
                draftSurveyId: draft,
            },
        };
    };

    // Already bridged — reuse it so a parcel never gets two Polygon rows.
    if (feature.polygon_id) {
        const existing = await Polygon.findByPk(feature.polygon_id);
        if (existing) return res.status(200).json(await withSurveyStatus(existing));
    }

    // Polygons.ward_id is NOT NULL, so the parcel must carry a ward.
    if (!feature.ward_id) {
        return res.status(400).json({
            success: false,
            message:
                "This parcel has no ward assigned, which a property survey requires. Re-upload the property layer with a ward selected.",
        });
    }
    const ward = await Ward.findByPk(feature.ward_id);
    if (!ward) {
        return res.status(400).json({ success: false, message: `Ward ${feature.ward_id} not found.` });
    }

    const geomRows = await sequelize.query(
        `SELECT GeometryType(geom) AS gtype FROM "AssetFeatures" WHERE id = :id`,
        { replacements: { id: feature.id }, type: QueryTypes.SELECT }
    );
    const gtype = geomRows[0]?.gtype;
    if (!gtype || !String(gtype).toUpperCase().includes("POLYGON")) {
        return res.status(400).json({
            success: false,
            message: `Only polygon parcels can be property-surveyed (this feature is ${gtype || "empty"}).`,
        });
    }

    const created = await sequelize.transaction(async (t) => {
        const poly = await createPolygonFromFeature(
            sequelize,
            {
                featureId: feature.id,
                ward_id: feature.ward_id,
                project_id: feature.project_id || null,
                wardTag: ward.ward_number || String(ward.id),
            },
            t
        );
        await feature.update({ polygon_id: poly.id }, { transaction: t });
        return poly;
    });

    const polygon = await Polygon.findByPk(created.id);
    res.status(201).json(await withSurveyStatus(polygon));
});

// ══════════════════════════════════════════════════════════════
// ATTRIBUTE SEARCH — query features by their survey answers
// ══════════════════════════════════════════════════════════════

// Whitelisted so an operator can never be interpolated into SQL.
const FILTER_OPS = {
    eq: "=",
    ne: "<>",
    lt: "<",
    lte: "<=",
    gt: ">",
    gte: ">=",
};

// POST /api/assets/features/search
// Body: { layer_id, project_id?, ward_id?, status?, filters: [{key, op, value}], limit? }
//
// Effective attributes are the feature's imported `properties` overlaid with the
// latest approved survey answers, so a filter reflects what the surveyor found
// rather than only what the shapefile shipped with.
const searchFeaturesByAttributes = asyncHandler(async (req, res) => {
    const { layer_id, project_id, ward_id, status, filters = [], limit = 500 } = req.body || {};
    if (!layer_id) {
        return res.status(400).json({ success: false, message: "layer_id is required." });
    }

    const layer = await AssetLayer.findByPk(layer_id);
    if (!layer) return res.status(404).json({ success: false, message: "Layer not found." });

    const schemaByKey = new Map((layer.attribute_schema || []).map((f) => [f.key, f]));

    const where = ["f.is_active = true", "f.layer_id = :layer_id"];
    const repl = { layer_id, limit: Math.min(Number(limit) || 500, 5000) };
    if (project_id) {
        where.push("f.project_id = :project_id");
        repl.project_id = project_id;
    }
    if (ward_id) {
        where.push("f.ward_id = :ward_id");
        repl.ward_id = ward_id;
    }
    if (status) {
        where.push("f.status = :status");
        repl.status = status;
    }

    // Latest survey answers per feature, merged over the imported attributes.
    const EFFECTIVE = `(COALESCE(f.properties, '{}'::jsonb) || COALESCE(sv.answers, '{}'::jsonb))`;

    filters.forEach((filter, i) => {
        const field = schemaByKey.get(filter?.key);
        if (!field) {
            const err = new Error(`Unknown field "${filter?.key}" for layer ${layer.code}.`);
            err.statusCode = 400;
            throw err;
        }
        const sqlOp = FILTER_OPS[String(filter.op || "eq").toLowerCase()];
        if (!sqlOp) {
            const err = new Error(
                `Unsupported operator "${filter.op}". Use one of: ${Object.keys(FILTER_OPS).join(", ")}.`
            );
            err.statusCode = 400;
            throw err;
        }

        const keyParam = `fkey${i}`;
        const valParam = `fval${i}`;
        repl[keyParam] = filter.key;

        if (field.type === "number") {
            // ->> yields text; cast so comparisons are numeric ("9" < "10" is
            // false as text). NULLIF guards blanks, and the regex keeps a
            // non-numeric stored value from aborting the whole query.
            where.push(
                `NULLIF(${EFFECTIVE} ->> :${keyParam}, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                 AND (NULLIF(${EFFECTIVE} ->> :${keyParam}, ''))::numeric ${sqlOp} :${valParam}`
            );
            repl[valParam] = Number(filter.value);
        } else if (field.type === "boolean") {
            where.push(`(${EFFECTIVE} ->> :${keyParam})::boolean ${sqlOp} :${valParam}`);
            repl[valParam] = filter.value === true || String(filter.value).toLowerCase() === "true";
        } else {
            where.push(`LOWER(${EFFECTIVE} ->> :${keyParam}) ${sqlOp} LOWER(:${valParam})`);
            repl[valParam] = String(filter.value ?? "");
        }
    });

    const rows = await sequelize.query(
        `SELECT ${FEATURE_SELECT}, ${FEATURE_SURVEY_STATUS},
                ${EFFECTIVE} AS effective_properties
         FROM "AssetFeatures" f
         LEFT JOIN LATERAL (
             SELECT s.proposed_properties AS answers
             FROM "AssetSurveys" s
             WHERE s.feature_id = f.id AND s.proposed_properties IS NOT NULL
             ORDER BY s."createdAt" DESC
             LIMIT 1
         ) sv ON true
         WHERE ${where.join(" AND ")}
         ORDER BY f.id
         LIMIT :limit`,
        { replacements: repl, type: QueryTypes.SELECT }
    );

    const fc = toFeatureCollection(rows);
    // Surface the merged view so the client shows what was actually matched.
    fc.features.forEach((feat, i) => {
        feat.properties = { ...feat.properties, ...(rows[i].effective_properties || {}) };
    });

    res.status(200).json({
        success: true,
        count: rows.length,
        layer: { id: layer.id, code: layer.code, name: layer.name, attribute_schema: layer.attribute_schema },
        ...fc,
    });
});

// ══════════════════════════════════════════════════════════════
// STATS — per-layer inventory (feeds dashboards + PDF report)
// ══════════════════════════════════════════════════════════════

// GET /api/assets/stats?ward_id=
const getAssetStats = asyncHandler(async (req, res) => {
    const { ward_id, project_id } = req.query;
    const repl = {};
    const filters = [];
    if (ward_id) {
        filters.push("AND f.ward_id = :ward_id");
        repl.ward_id = ward_id;
    }
    if (project_id) {
        filters.push("AND f.project_id = :project_id");
        repl.project_id = project_id;
    }
    const wardFilter = filters.join(" ");

    const stats = await sequelize.query(
        `
        SELECT
          l.id            AS layer_id,
          l.code          AS layer_code,
          l.name          AS layer_name,
          l.geometry_type AS geometry_type,
          c.name          AS category_name,
          COUNT(f.id)                                         AS feature_count,
          COALESCE(SUM(f.length_m), 0)                        AS total_length_m,
          COALESCE(SUM(f.area_sqm), 0)                        AS total_area_sqm,
          COUNT(f.id) FILTER (WHERE f.status = 'STAGED')      AS staged,
          COUNT(f.id) FILTER (WHERE f.status = 'VERIFIED')    AS verified,
          COUNT(f.id) FILTER (WHERE f.status = 'PUBLISHED')   AS published,
          COUNT(f.id) FILTER (WHERE f.status = 'FLAGGED')     AS flagged
        FROM "AssetLayers" l
        LEFT JOIN "AssetCategories" c ON l.category_id = c.id
        LEFT JOIN "AssetFeatures" f
          ON f.layer_id = l.id AND f.is_active = true ${wardFilter}
        WHERE l.is_active = true
        GROUP BY l.id, l.code, l.name, l.geometry_type, c.name, l.sort_order
        ORDER BY l.sort_order ASC
        `,
        { replacements: repl, type: QueryTypes.SELECT }
    );

    res.status(200).json({ success: true, data: stats });
});

module.exports = {
    getCategories,
    createCategory,
    getLayers,
    getLayerById,
    createLayer,
    updateLayer,
    deleteLayer,
    getLayerFeatures,
    getAssetMap,
    getFeatureById,
    getNearbyFeatures,
    createFeature,
    updateFeature,
    deleteFeature,
    ensureFeaturePolygon,
    searchFeaturesByAttributes,
    getAssetStats,
};
