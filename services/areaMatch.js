/**
 * areaMatch.js
 *
 * Works out WHERE an uploaded geometry falls in the location hierarchy
 * (Zone → Ward → Locality) by spatial join, instead of asking the uploader to
 * pick a ward by hand.
 *
 * Why this exists: every downstream feature — filtering the map by ward,
 * allocating a surveyor an area, the property-survey bridge in
 * assetController — keys off AssetFeatures.ward_id. A bulk upload covers a
 * whole ULB and crosses many wards, so one hand-picked ward was either wrong
 * for most features or (the usual case) left NULL, which made the batch
 * invisible to every scoped surveyor (see services/surveyorScope.js: a NULL
 * ward matches no grant).
 *
 * Matching rule, per feature:
 *   1. the ward whose boundary CONTAINS the feature's representative point —
 *      cheap, and robust to edges that don't line up exactly;
 *   2. failing that, the ward it overlaps most (area for polygons, length for
 *      lines), which is what a parcel or pipe straddling a ward line needs.
 * Candidates are restricted to the project's own ULB/city/district, so an
 * identically-shaped ward in another ULB can never win.
 *
 * Zone comes from the matched ward (Wards.zone_id); when the ward has no zone,
 * or no ward matched at all, the zone is matched spatially on its own so zone
 * filtering still works. Locality is matched only inside the matched ward, and
 * only where the locality carries a boundary — they are optional by design
 * (see models/locality.js), so a NULL locality is normal, not a failure.
 *
 * All geometry in/out is WGS84 (EPSG:4326) GeoJSON, matching AssetFeatures.
 */
const { QueryTypes } = require("sequelize");

// Same chunk size as insertFeaturesBulk: keeps the bind-parameter count and
// the per-statement work bounded on a big shapefile.
const CHUNK = 250;

// How much of `a` the feature `b` shares. Area is meaningless for a line and
// length is 0 for a polygon, so take whichever is non-zero — this is only ever
// a tie-break between candidate boundaries.
const OVERLAP = (a, b) =>
    `COALESCE(NULLIF(ST_Area(ST_Intersection(${a}, ${b})), 0), ST_Length(ST_Intersection(${a}, ${b})), 0)`;

/**
 * Restrict candidate wards/zones to the project's administrative area.
 *
 * Falls back to "anywhere with a boundary" for a project that has no scope
 * recorded — matching something correct is better than matching nothing, and
 * the caller reports what was matched either way.
 */
function projectScope(project) {
    const repl = {};
    let ward = "TRUE";
    let zone = "TRUE";
    if (!project) return { ward, zone, repl };

    if (project.ward_id) {
        // A project pinned to a single ward IS that area.
        ward = `w.id = :sc_ward`;
        repl.sc_ward = project.ward_id;
        zone = `z.id IN (SELECT zone_id FROM "Wards" WHERE id = :sc_ward AND zone_id IS NOT NULL)`;
    } else if (project.ulb_id) {
        ward = `w.ulb_id = :sc_ulb`;
        zone = `z.ulb_id = :sc_ulb`;
        repl.sc_ulb = project.ulb_id;
    } else if (project.city_id) {
        // City is a label on the District, so reach the wards through the ULBs
        // it holds; w.city_id covers historic rows that were filed that way.
        ward = `(w.city_id = :sc_city OR w.ulb_id IN (SELECT id FROM "Ulbs" WHERE city_id = :sc_city))`;
        zone = `(z.city_id = :sc_city OR z.ulb_id IN (SELECT id FROM "Ulbs" WHERE city_id = :sc_city))`;
        repl.sc_city = project.city_id;
    } else if (project.district_id) {
        ward = `w.ulb_id IN (SELECT id FROM "Ulbs" WHERE district_id = :sc_dist)`;
        zone = `z.ulb_id IN (SELECT id FROM "Ulbs" WHERE district_id = :sc_dist)`;
        repl.sc_dist = project.district_id;
    }
    return { ward, zone, repl };
}

/** The hierarchy lookup, shared by the pre-insert and re-match paths. */
const matchCte = (scope, geomSource) => `
    src AS (${geomSource}),
    pt AS (SELECT ord, geom, ST_PointOnSurface(geom) AS rep FROM src),
    ward AS (
      SELECT p.ord, p.geom, p.rep, w.id AS ward_id, w.zone_id
      FROM pt p
      LEFT JOIN LATERAL (
        SELECT w.id, w.zone_id
        FROM "Wards" w
        WHERE w.boundary IS NOT NULL AND ${scope.ward}
          AND ST_Intersects(w.boundary, p.geom)
        ORDER BY ST_Contains(w.boundary, p.rep) DESC, ${OVERLAP("w.boundary", "p.geom")} DESC
        LIMIT 1
      ) w ON TRUE
    ),
    zoned AS (
      SELECT wd.ord, wd.geom, wd.rep, wd.ward_id,
             COALESCE(wd.zone_id, z.id) AS zone_id
      FROM ward wd
      LEFT JOIN LATERAL (
        SELECT z.id
        FROM "Zones" z
        WHERE wd.zone_id IS NULL AND z.boundary IS NOT NULL AND ${scope.zone}
          AND ST_Intersects(z.boundary, wd.geom)
        ORDER BY ST_Contains(z.boundary, wd.rep) DESC, ${OVERLAP("z.boundary", "wd.geom")} DESC
        LIMIT 1
      ) z ON TRUE
    ),
    matched AS (
      SELECT zd.ord, zd.ward_id, zd.zone_id, l.id AS locality_id
      FROM zoned zd
      LEFT JOIN LATERAL (
        SELECT l.id
        FROM "Localities" l
        WHERE zd.ward_id IS NOT NULL AND l.ward_id = zd.ward_id
          AND l.boundary IS NOT NULL AND ST_Intersects(l.boundary, zd.geom)
        ORDER BY ST_Contains(l.boundary, zd.rep) DESC, ${OVERLAP("l.boundary", "zd.geom")} DESC
        LIMIT 1
      ) l ON TRUE
    )
`;

/**
 * Resolve zone/ward/locality for a list of WGS84 GeoJSON geometries.
 *
 * @returns {Promise<Array<{ward_id:number|null, zone_id:number|null, locality_id:number|null}>>}
 *          one entry per input geometry, in input order.
 */
async function matchAreas(sequelize, geometries, project, transaction) {
    const out = geometries.map(() => ({ ward_id: null, zone_id: null, locality_id: null }));
    if (!geometries.length) return out;

    const scope = projectScope(project);

    for (let start = 0; start < geometries.length; start += CHUNK) {
        const chunk = geometries.slice(start, start + CHUNK);
        const repl = { ...scope.repl };

        // Explicit casts on every column: Postgres types a VALUES list from its
        // first row, and ST_GeomFromGeoJSON on a NULL would otherwise poison it.
        const tuples = chunk.map((g, i) => {
            repl[`g${i}`] = JSON.stringify(g);
            return `(${i}::int, ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:g${i}), 4326))))`;
        });

        const rows = await sequelize.query(
            `WITH ${matchCte(scope, `SELECT * FROM (VALUES ${tuples.join(",")}) AS v(ord, geom)`)}
             SELECT ord, ward_id, zone_id, locality_id FROM matched ORDER BY ord`,
            { replacements: repl, type: QueryTypes.SELECT, transaction }
        );

        for (const r of rows) {
            out[start + Number(r.ord)] = {
                ward_id: r.ward_id ?? null,
                zone_id: r.zone_id ?? null,
                locality_id: r.locality_id ?? null,
            };
        }
    }

    return out;
}

/**
 * Re-run the match over features already in the table — for batches uploaded
 * before this existed, or after ward boundaries were (re)imported.
 *
 * Set-based: the geometry is already in Postgres, so nothing is shipped over
 * the wire. Only fills gaps unless `overwrite` is set, so a ward corrected by
 * hand on a single feature isn't clobbered by a bulk re-run.
 *
 * @returns {Promise<{updated:number}>}
 */
async function rematchFeatures(
    sequelize,
    { uploadId, projectId, featureId, project, overwrite = false },
    transaction
) {
    const scope = projectScope(project);
    const repl = { ...scope.repl };

    const where = ["f.geom IS NOT NULL", "f.is_active = true"];
    if (uploadId) {
        where.push("f.upload_id = :upload_id");
        repl.upload_id = uploadId;
    }
    if (projectId) {
        where.push("f.project_id = :project_id");
        repl.project_id = projectId;
    }
    if (featureId) {
        where.push("f.id = :feature_id");
        repl.feature_id = featureId;
    }
    if (!overwrite) where.push("f.ward_id IS NULL");

    const [, meta] = await sequelize.query(
        `WITH ${matchCte(scope, `SELECT f.id AS ord, f.geom FROM "AssetFeatures" f WHERE ${where.join(" AND ")}`)}
         UPDATE "AssetFeatures" t
         SET ward_id     = COALESCE(m.ward_id, ${overwrite ? "NULL" : "t.ward_id"}),
             zone_id     = COALESCE(m.zone_id, ${overwrite ? "NULL" : "t.zone_id"}),
             locality_id = COALESCE(m.locality_id, ${overwrite ? "NULL" : "t.locality_id"}),
             "updatedAt" = NOW()
         FROM matched m
         WHERE t.id = m.ord
           AND (m.ward_id IS NOT NULL OR m.zone_id IS NOT NULL OR m.locality_id IS NOT NULL)`,
        { replacements: repl, transaction }
    );

    return { updated: meta?.rowCount ?? 0 };
}

/**
 * Turn per-feature matches into something worth showing the uploader: how many
 * landed in each ward, and how many landed nowhere. An unmatched count is the
 * signal that ward boundaries are missing or the file sits outside the
 * project's ULB — silence there would just produce invisible features.
 */
function summarise(matches) {
    const wards = new Map();
    let unmatched = 0;
    for (const m of matches) {
        if (!m.ward_id) {
            unmatched += 1;
            continue;
        }
        wards.set(m.ward_id, (wards.get(m.ward_id) || 0) + 1);
    }
    return {
        matched: matches.length - unmatched,
        unmatched,
        wards_touched: wards.size,
        zones_touched: new Set(matches.map((m) => m.zone_id).filter(Boolean)).size,
        localities_touched: new Set(matches.map((m) => m.locality_id).filter(Boolean)).size,
        by_ward: [...wards.entries()].map(([ward_id, count]) => ({ ward_id, count })),
    };
}

/**
 * Area filters (zone / ward / locality) for any query over "AssetFeatures",
 * pushed onto a WHERE list. Shared by the map, the layer/staged feature reads
 * and the per-layer stats so "filtered by ward 5" means the same everywhere.
 *
 * Because every feature carries all three ids, a zone filter doesn't have to
 * expand the zone into its wards first — which also means it still works for a
 * feature whose ward boundary is missing.
 *
 * `source` is any object with zone_id / ward_id / locality_id keys (req.query,
 * req.body, or a plain object). Comma-separated ids are accepted so the UI can
 * filter by several areas at once.
 */
function areaFilters(source = {}, where, repl, alias = "f") {
    for (const col of ["zone_id", "ward_id", "locality_id"]) {
        const value = source[col];
        if (value === undefined || value === null || value === "") continue;
        const ids = String(value).split(",").map((v) => Number(v.trim())).filter(Number.isFinite);
        if (!ids.length) continue;
        where.push(`${alias}.${col} IN (:${col})`);
        repl[col] = ids;
    }
    return where;
}

module.exports = { matchAreas, rematchFeatures, summarise, projectScope, areaFilters };
