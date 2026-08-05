/**
 * locationGeo.js
 *
 * Raw PostGIS SQL for the location-hierarchy boundary columns
 * (State → District → ULB → [Zone] → Ward → Locality), added additively in
 * server.js. Same convention as services/assetGeo.js: native WGS84
 * (EPSG:4326), all I/O in raw SQL since the `boundary` column isn't declared
 * on the Sequelize models.
 *
 * LOCALITY boundaries are optional — supply a shapefile and properties can be
 * matched to a locality by spatial join; leave it and the locality is a name.
 */
const { QueryTypes } = require("sequelize");

const LEVELS = {
    STATE: { table: "States", nameCol: "name", codeCol: "code", parentCol: null, matchCols: ["name", "code"] },
    DISTRICT: { table: "Districts", nameCol: "name", codeCol: "code", parentCol: "state_id", matchCols: ["name", "code"] },
    CITY: { table: "Cities", nameCol: "name", codeCol: "code", parentCol: "district_id", matchCols: ["name", "code"] },
    ULB: { table: "Ulbs", nameCol: "name", codeCol: "code", parentCol: "district_id", matchCols: ["name", "code"] },
    ZONE: { table: "Zones", nameCol: "name", codeCol: "code", parentCol: "ulb_id", matchCols: ["name", "code"] },
    WARD: { table: "Wards", nameCol: "ward_name", codeCol: "ward_number", parentCol: "ulb_id", matchCols: ["ward_name", "ward_number"] },
    LOCALITY: { table: "Localities", nameCol: "name", codeCol: "code", parentCol: "ward_id", matchCols: ["name", "code", "alt_names"] },
};

const LEVEL_NAMES = Object.keys(LEVELS).join(", ");

function levelConfig(level) {
    const cfg = LEVELS[String(level || "").toUpperCase()];
    if (!cfg) throw new Error(`Unknown level "${level}". Expected one of: ${LEVEL_NAMES}.`);
    return cfg;
}

/**
 * Set (overwrite) one row's boundary. Accepts one WGS84 GeoJSON
 * polygon/multipolygon geometry, or an array of them (merged into a single
 * MultiPolygon) — a shapefile for one admin unit sometimes splits it across
 * several polygon parts.
 */
async function setBoundary(sequelize, level, id, geometryOrGeometries, transaction) {
    const { table } = levelConfig(level);
    const geoms = Array.isArray(geometryOrGeometries) ? geometryOrGeometries : [geometryOrGeometries];
    if (!geoms.length) throw new Error("At least one geometry is required.");

    const repl = { id };
    const exprs = geoms.map((g, i) => {
        repl[`geom${i}`] = JSON.stringify(g);
        return `ST_SetSRID(ST_GeomFromGeoJSON(:geom${i}), 4326)`;
    });
    const collectExpr = exprs.length === 1 ? exprs[0] : `ST_Collect(ARRAY[${exprs.join(", ")}])`;

    await sequelize.query(
        `UPDATE "${table}" SET boundary = ST_Multi(${collectExpr}) WHERE id = :id`,
        { replacements: repl, transaction }
    );
}

/** Find a row's id by matching name/code (case-insensitive), optionally scoped to a parent id. */
async function findIdByMatch(sequelize, level, matchCol, matchValue, parentId) {
    const { table, parentCol, matchCols } = levelConfig(level);
    if (!matchCols.includes(matchCol)) {
        throw new Error(`Invalid match field "${matchCol}" for level. Expected one of: ${matchCols.join(", ")}.`);
    }
    const where = [`LOWER("${matchCol}") = LOWER(:matchValue)`];
    const repl = { matchValue: String(matchValue).trim() };
    if (parentId && parentCol) {
        where.push(`"${parentCol}" = :parentId`);
        repl.parentId = parentId;
    }
    const rows = await sequelize.query(
        `SELECT id FROM "${table}" WHERE ${where.join(" AND ")} LIMIT 1`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
    return rows[0]?.id || null;
}

/**
 * Create one row at a level from imported attributes, returning its id.
 * Used by the shapefile importer, which builds the hierarchy from the file
 * rather than requiring it to be typed in first.
 */
async function createRow(sequelize, level, { name, code, parentId, extra = {} }, transaction) {
    const { table, nameCol, codeCol, parentCol } = levelConfig(level);

    const cols = [`"${nameCol}"`, `"is_active"`, `"createdAt"`, `"updatedAt"`];
    const vals = [":name", "true", "NOW()", "NOW()"];
    const repl = { name: String(name).trim() };

    if (code !== undefined && code !== null && String(code).trim() !== "") {
        cols.push(`"${codeCol}"`);
        vals.push(":code");
        repl.code = String(code).trim();
    }
    if (parentCol && parentId) {
        cols.push(`"${parentCol}"`);
        vals.push(":parentId");
        repl.parentId = parentId;
    }
    // Level-specific extras (e.g. a ULB's ulb_type, a locality's pincode).
    for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null || String(v).trim() === "") continue;
        cols.push(`"${k}"`);
        vals.push(`:x_${k}`);
        repl[`x_${k}`] = v;
    }

    const rows = await sequelize.query(
        `INSERT INTO "${table}" (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING id`,
        { replacements: repl, type: QueryTypes.INSERT, transaction }
    );
    // QueryTypes.INSERT returns [rows, rowCount] for Postgres RETURNING.
    return rows?.[0]?.[0]?.id ?? null;
}

/** All rows at a level (optionally parent-scoped) that have a boundary, as a GeoJSON FeatureCollection. */
async function getBoundaries(sequelize, level, parentId) {
    const { table, nameCol, codeCol, parentCol } = levelConfig(level);
    const where = ["boundary IS NOT NULL"];
    const repl = {};
    if (parentId && parentCol) {
        where.push(`"${parentCol}" = :parentId`);
        repl.parentId = parentId;
    }
    const rows = await sequelize.query(
        `SELECT id, "${nameCol}" AS name, "${codeCol}" AS code, ST_AsGeoJSON(boundary) AS geojson
         FROM "${table}" WHERE ${where.join(" AND ")} ORDER BY "${nameCol}" ASC`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
    return {
        type: "FeatureCollection",
        features: rows.map((r) => ({
            type: "Feature",
            id: r.id,
            geometry: JSON.parse(r.geojson),
            properties: { id: r.id, name: r.name, code: r.code },
        })),
    };
}

module.exports = { LEVELS, levelConfig, setBoundary, findIdByMatch, createRow, getBoundaries };
