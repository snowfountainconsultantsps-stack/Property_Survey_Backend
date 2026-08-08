/**
 * polygonGeo.js
 *
 * Raw PostGIS SQL for inserting parcel boundaries into "Polygons".
 *
 * ── The legacy CRS quirk, and why every insert here looks odd ─────────────
 * "Polygons".boundary is DECLARED geometry(MULTIPOLYGON, 4326), but the
 * values actually stored are UTM 44N (EPSG:32644) eastings/northings — i.e.
 * the data is mislabelled at rest. Every read compensates for this:
 *
 *     ST_AsGeoJSON(ST_Transform(ST_SetSRID(boundary, 32644), 4326))
 *                               ^ re-tag to the TRUE crs, then convert
 *
 * (see gisController.js). So to write a row that reads back correctly, new
 * geometry must be transformed to UTM *and then re-tagged 4326* to satisfy
 * the column's declared SRID — matching how the existing rows are stored.
 * Writing honest 4326 lat/lng here would be silently corrupted on read.
 *
 * Contrast: AssetFeatures.geom is true, correctly-tagged WGS84.
 */
const { QueryTypes } = require("sequelize");

// True WGS84 geometry → the mislabelled-UTM form this table stores.
const TO_LEGACY_UTM = (expr) => `ST_SetSRID(ST_Multi(ST_Transform(${expr}, 32644)), 4326)`;

/**
 * Insert one parcel from a WGS84 GeoJSON polygon/multipolygon.
 * If `polygon_code` is not supplied, one is generated from the new row's
 * own id (`PLY/{wardTag}/{000123}`), so it can never collide.
 * @returns {Promise<{id:number, polygon_code:string}>}
 */
async function insertPolygon(sequelize, data, transaction) {
    const {
        ward_id, zone_id = null, locality_id = null,
        project_id = null, geometry, polygon_code = null, wardTag,
    } = data;

    const rows = await sequelize.query(
        `
        WITH src AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326) AS geom4326
        ),
        g AS (
          SELECT
            ${TO_LEGACY_UTM("geom4326")} AS boundary,
            ST_Area(geom4326::geography) AS area_sqmt,
            nextval(pg_get_serial_sequence('"Polygons"', 'id')) AS id
          FROM src
        )
        INSERT INTO "Polygons"
          (id, polygon_code, ward_id, zone_id, locality_id, project_id, boundary, area_sqmt,
           gis_status, is_active, "createdAt", "updatedAt")
        SELECT
          g.id,
          COALESCE(:polygon_code, 'PLY/' || :ward_tag || '/' || lpad(g.id::text, 6, '0')),
          :ward_id, :zone_id, :locality_id, :project_id, g.boundary, g.area_sqmt,
          'RAW', true, NOW(), NOW()
        FROM g
        RETURNING id, polygon_code;
        `,
        {
            replacements: {
                geom: JSON.stringify(geometry),
                polygon_code,
                ward_id,
                zone_id,
                locality_id,
                project_id,
                ward_tag: wardTag,
            },
            type: QueryTypes.SELECT,
            transaction,
        }
    );
    return rows[0];
}

/**
 * Create a Polygon row directly from an AssetFeature's geometry.
 *
 * Property boundaries are uploaded as AssetFeatures (native WGS84), but the
 * whole property-survey chain (Property → Building → Floor → Unit, plus
 * Survey) is keyed on "Polygons".polygon_id. This bridges the two without
 * touching the wizard: the parcel keeps living in AssetFeatures as the thing
 * the surveyor picks on the map, and gets a matching Polygon row so the
 * existing save-flow runs unchanged.
 *
 * @returns {Promise<{id:number, polygon_code:string, area_sqmt:number}>}
 */
async function createPolygonFromFeature(
    sequelize,
    { featureId, ward_id, zone_id = null, locality_id = null, project_id = null, wardTag },
    transaction
) {
    const rows = await sequelize.query(
        `
        WITH f AS (
          SELECT geom FROM "AssetFeatures" WHERE id = :feature_id
        ),
        g AS (
          SELECT
            ${TO_LEGACY_UTM("ST_Force2D(f.geom)")} AS boundary,
            ST_Area(f.geom::geography) AS area_sqmt,
            nextval(pg_get_serial_sequence('"Polygons"', 'id')) AS id
          FROM f
        )
        INSERT INTO "Polygons"
          (id, polygon_code, ward_id, zone_id, locality_id, project_id, boundary, area_sqmt,
           gis_status, is_active, "createdAt", "updatedAt")
        SELECT
          g.id,
          'PLY/' || :ward_tag || '/' || lpad(g.id::text, 6, '0'),
          :ward_id, :zone_id, :locality_id, :project_id, g.boundary, g.area_sqmt,
          'RAW', true, NOW(), NOW()
        FROM g
        RETURNING id, polygon_code, area_sqmt;
        `,
        {
            replacements: {
                feature_id: featureId, ward_id, zone_id, locality_id, project_id, ward_tag: wardTag,
            },
            type: QueryTypes.SELECT,
            transaction,
        }
    );
    return rows[0];
}

module.exports = { insertPolygon, createPolygonFromFeature };
