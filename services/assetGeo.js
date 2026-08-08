/**
 * assetGeo.js
 *
 * Small helpers that centralise the raw PostGIS SQL used to read/write the
 * `geom` column on "AssetFeatures". Geometry never goes through Sequelize —
 * everything is parameterized SQL here so CRS handling stays explicit.
 *
 * All geometry is stored in WGS84 (EPSG:4326). Lengths/areas are geodesic
 * (computed via ::geography) and cached on the row.
 */
const { QueryTypes } = require("sequelize");

// Column list used when returning features as GeoJSON. `geom` is emitted as a
// GeoJSON string via ST_AsGeoJSON so it can be reprojection-free on the client.
const FEATURE_SELECT = `
  f.id,
  f.layer_id,
  f.project_id,
  f.zone_id,
  f.ward_id,
  f.locality_id,
  f.polygon_id,
  f.feature_code,
  f.properties,
  f.source,
  f.status,
  f.length_m,
  f.area_sqm,
  f.upload_id,
  ST_AsGeoJSON(f.geom) AS geojson
`;

// Optional add-on columns describing how far a feature's survey has got.
// What counts differs by layer:
//   • ordinary assets  → an AssetSurvey is written in one shot when the
//     surveyor submits, so its mere existence means finished.
//   • property parcels → the wizard creates a draft Survey at step 1 and only
//     marks it 'completed' on submit, so a row alone is NOT finished. Drafts
//     must read as in-progress or a barely-started parcel looks done.
// Appended only where the caller needs it (the field map), so other endpoints
// don't pay for the subqueries.
const SURVEY_DONE_STATUSES = "('completed','reviewed')";

const FEATURE_SURVEY_STATUS = `
  (SELECT COUNT(*) FROM "AssetSurveys" asv WHERE asv.feature_id = f.id) AS asset_survey_count,
  (SELECT MAX(sv.id)
     FROM "Properties" pr
     JOIN "Surveys" sv ON sv.property_id = pr.id
    WHERE f.polygon_id IS NOT NULL AND pr.polygon_id = f.polygon_id) AS property_survey_id,
  (SELECT bool_or(sv.status IN ${SURVEY_DONE_STATUSES})
     FROM "Properties" pr
     JOIN "Surveys" sv ON sv.property_id = pr.id
    WHERE f.polygon_id IS NOT NULL AND pr.polygon_id = f.polygon_id) AS property_survey_done
`;

/**
 * Insert one AssetFeature with geometry.
 * @returns {Promise<number>} the new feature id
 */
async function insertFeature(sequelize, data, transaction) {
    const {
        layer_id,
        project_id = null,
        zone_id = null,
        ward_id = null,
        locality_id = null,
        polygon_id = null,
        feature_code = null,
        properties = {},
        source = "IMPORT",
        status = "STAGED",
        upload_id = null,
        created_by = null,
        surveyor_id = null,
        geometry, // GeoJSON geometry object (WGS84)
    } = data;

    // Use SELECT post-processing so the RETURNING rows come back as a flat
    // array of objects regardless of dialect quirks.
    const rows = await sequelize.query(
        `
        WITH g AS (
          SELECT ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)) AS geom
        )
        INSERT INTO "AssetFeatures"
          (layer_id, project_id, zone_id, ward_id, locality_id, polygon_id, feature_code,
           properties, source, status,
           upload_id, created_by, surveyor_id, geom, length_m, area_sqm,
           is_active, "createdAt", "updatedAt")
        SELECT
          :layer_id, :project_id, :zone_id, :ward_id, :locality_id, :polygon_id, :feature_code,
          CAST(:properties AS JSONB),
          :source, :status, :upload_id, :created_by, :surveyor_id, g.geom,
          CASE WHEN GeometryType(g.geom) LIKE '%LINESTRING%' THEN ST_Length(g.geom::geography) END,
          CASE WHEN GeometryType(g.geom) LIKE '%POLYGON%'    THEN ST_Area(g.geom::geography)   END,
          true, NOW(), NOW()
        FROM g
        RETURNING id;
        `,
        {
            replacements: {
                layer_id,
                project_id,
                zone_id,
                ward_id,
                locality_id,
                polygon_id,
                feature_code,
                properties: JSON.stringify(properties || {}),
                source,
                status,
                upload_id,
                created_by,
                surveyor_id,
                geom: JSON.stringify(geometry),
            },
            type: QueryTypes.SELECT,
            transaction,
        }
    );
    return rows[0].id;
}

/**
 * Insert many AssetFeatures in as few round trips as possible.
 *
 * Importing a shapefile one INSERT at a time is dominated by network latency
 * (a remote Postgres round trip is ~60ms, so a 537-parcel file spent ~30s+
 * just waiting). Batching into multi-row INSERTs cuts that to a handful of
 * round trips. Chunked so a huge file can't exceed the bind-parameter limit.
 *
 * @returns {Promise<number[]>} new feature ids, in input order
 */
async function insertFeaturesBulk(sequelize, features, transaction, chunkSize = 250) {
    const ids = [];

    for (let start = 0; start < features.length; start += chunkSize) {
        const chunk = features.slice(start, start + chunkSize);
        const replacements = {};

        const tuples = chunk.map((d, i) => {
            replacements[`layer_id${i}`] = d.layer_id;
            replacements[`project_id${i}`] = d.project_id ?? null;
            replacements[`zone_id${i}`] = d.zone_id ?? null;
            replacements[`ward_id${i}`] = d.ward_id ?? null;
            replacements[`locality_id${i}`] = d.locality_id ?? null;
            replacements[`polygon_id${i}`] = d.polygon_id ?? null;
            replacements[`feature_code${i}`] = d.feature_code ?? null;
            replacements[`properties${i}`] = JSON.stringify(d.properties || {});
            replacements[`source${i}`] = d.source || "IMPORT";
            replacements[`status${i}`] = d.status || "STAGED";
            replacements[`upload_id${i}`] = d.upload_id ?? null;
            replacements[`created_by${i}`] = d.created_by ?? null;
            replacements[`surveyor_id${i}`] = d.surveyor_id ?? null;
            replacements[`geom${i}`] = JSON.stringify(d.geometry);
            // Explicit casts: Postgres infers VALUES column types from the
            // first row, so untyped NULLs would otherwise break the insert.
            return `(
                :layer_id${i}::integer, :project_id${i}::integer, :zone_id${i}::integer,
                :ward_id${i}::integer, :locality_id${i}::integer,
                :polygon_id${i}::integer, :feature_code${i}::varchar,
                CAST(:properties${i} AS JSONB),
                :source${i}::"enum_AssetFeatures_source",
                :status${i}::"enum_AssetFeatures_status",
                :upload_id${i}::integer, :created_by${i}::uuid, :surveyor_id${i}::uuid,
                ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:geom${i}), 4326)),
                :ordinal${i}::integer
            )`;
        });
        chunk.forEach((_, i) => (replacements[`ordinal${i}`] = i));

        const rows = await sequelize.query(
            `
            WITH v (layer_id, project_id, zone_id, ward_id, locality_id, polygon_id,
                    feature_code, properties,
                    source, status, upload_id, created_by, surveyor_id, geom, ordinal) AS (
              VALUES ${tuples.join(",")}
            )
            INSERT INTO "AssetFeatures"
              (layer_id, project_id, zone_id, ward_id, locality_id, polygon_id, feature_code,
               properties, source, status,
               upload_id, created_by, surveyor_id, geom, length_m, area_sqm,
               is_active, "createdAt", "updatedAt")
            SELECT
              v.layer_id, v.project_id, v.zone_id, v.ward_id, v.locality_id, v.polygon_id,
              v.feature_code, v.properties,
              v.source, v.status, v.upload_id, v.created_by, v.surveyor_id, v.geom,
              CASE WHEN GeometryType(v.geom) LIKE '%LINESTRING%' THEN ST_Length(v.geom::geography) END,
              CASE WHEN GeometryType(v.geom) LIKE '%POLYGON%'    THEN ST_Area(v.geom::geography)   END,
              true, NOW(), NOW()
            FROM (SELECT * FROM v ORDER BY ordinal) v
            RETURNING id;
            `,
            { replacements, type: QueryTypes.SELECT, transaction }
        );

        rows.forEach((r) => ids.push(r.id));
    }

    return ids;
}

/** Replace a feature's geometry (and recompute cached length/area). */
async function updateFeatureGeometry(sequelize, id, geometry, transaction) {
    await sequelize.query(
        `
        WITH g AS (
          SELECT ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)) AS geom
        )
        UPDATE "AssetFeatures" AS f
        SET geom = g.geom,
            length_m = CASE WHEN GeometryType(g.geom) LIKE '%LINESTRING%'
                            THEN ST_Length(g.geom::geography) END,
            area_sqm = CASE WHEN GeometryType(g.geom) LIKE '%POLYGON%'
                            THEN ST_Area(g.geom::geography) END,
            "updatedAt" = NOW()
        FROM g
        WHERE f.id = :id;
        `,
        { replacements: { id, geom: JSON.stringify(geometry) }, transaction }
    );
}

/** Convert a raw DB row (with a `geojson` string column) to a GeoJSON Feature. */
function rowToFeature(row) {
    let geometry = null;
    try {
        geometry = row.geojson ? JSON.parse(row.geojson) : null;
    } catch {
        geometry = null;
    }

    // Only surface survey status when FEATURE_SURVEY_STATUS was actually
    // selected — otherwise the flag would read as a confident "false" on
    // endpoints that never asked for it.
    const hasSurveyCols =
        row.asset_survey_count !== undefined || row.property_survey_id !== undefined;

    let surveyStatus = {};
    if (hasSurveyCols) {
        const assetDone = Number(row.asset_survey_count || 0) > 0;
        const propertyStarted = Boolean(row.property_survey_id);
        const propertyDone = row.property_survey_done === true;

        // DONE → finished. IN_PROGRESS → a draft exists, resume it.
        // null  → never touched.
        const survey_state =
            assetDone || propertyDone ? "DONE" : propertyStarted ? "IN_PROGRESS" : null;

        surveyStatus = {
            survey_state,
            // Retained for callers that only care about "finished or not".
            is_surveyed: survey_state === "DONE",
            survey_id: row.property_survey_id || null,
        };
    }

    return {
        type: "Feature",
        id: row.id,
        geometry,
        properties: {
            // Imported .dbf/GeoJSON attributes go FIRST so the system fields
            // below always win. Shapefiles routinely ship their own `id`,
            // `status`, `Name` columns, and letting those override the real
            // feature id silently breaks anything that round-trips it (the
            // map tap → survey flow, for one).
            ...(row.properties || {}),
            id: row.id,
            layer_id: row.layer_id,
            project_id: row.project_id,
            zone_id: row.zone_id,
            ward_id: row.ward_id,
            locality_id: row.locality_id,
            polygon_id: row.polygon_id,
            feature_code: row.feature_code,
            source: row.source,
            status: row.status,
            length_m: row.length_m,
            area_sqm: row.area_sqm,
            upload_id: row.upload_id,
            ...surveyStatus,
        },
    };
}

/** Wrap rows into a GeoJSON FeatureCollection. */
function toFeatureCollection(rows) {
    return {
        type: "FeatureCollection",
        features: rows.map(rowToFeature),
    };
}

module.exports = {
    FEATURE_SELECT,
    FEATURE_SURVEY_STATUS,
    insertFeature,
    insertFeaturesBulk,
    updateFeatureGeometry,
    rowToFeature,
    toFeatureCollection,
};
