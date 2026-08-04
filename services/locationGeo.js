/**
 * locationGeo.js
 *
 * Raw PostGIS SQL for the location-hierarchy boundary columns (State →
 * District → City → Zone → Ward), added additively in server.js. Same
 * convention as services/assetGeo.js: native WGS84 (EPSG:4326), all I/O in
 * raw SQL since the `boundary` column isn't declared on the Sequelize models.
 */
const { QueryTypes } = require("sequelize");

const LEVELS = {
    STATE: { table: "States", nameCol: "name", codeCol: "code", parentCol: null, matchCols: ["name", "code"] },
    DISTRICT: { table: "Districts", nameCol: "name", codeCol: "code", parentCol: "state_id", matchCols: ["name", "code"] },
    CITY: { table: "Cities", nameCol: "name", codeCol: "code", parentCol: "district_id", matchCols: ["name", "code"] },
    ZONE: { table: "Zones", nameCol: "name", codeCol: "code", parentCol: "city_id", matchCols: ["name", "code"] },
    WARD: { table: "Wards", nameCol: "ward_name", codeCol: "ward_number", parentCol: "zone_id", matchCols: ["ward_name", "ward_number"] },
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

module.exports = { LEVELS, levelConfig, setBoundary, findIdByMatch, getBoundaries };
