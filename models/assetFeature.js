module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetFeature — a single geometry instance on a layer.
    // e.g. one manhole, one sewer segment, one road centerline.
    //
    // IMPORTANT: the spatial column `geom geometry(Geometry, 4326)` is NOT
    // declared here. It is added by an additive raw migration at startup
    // (see server.js) and is always read/written through raw parameterized
    // SQL (ST_AsGeoJSON / ST_GeomFromGeoJSON). Sequelize therefore never
    // touches the geometry, which keeps CRS handling explicit and avoids
    // shipping raw WKB in ordinary JSON responses. All new geometry is stored
    // in true WGS84 (EPSG:4326, [lng,lat]).
    // ──────────────────────────────────────────────────────────────
    const AssetFeature = sequelize.define("AssetFeature", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        layer_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // Project this feature belongs to (set at import time).
        project_id: DataTypes.INTEGER,

        // Where this feature falls in the location hierarchy. Stamped at import
        // time by a spatial join against the boundaries
        // (services/areaMatch.js) rather than chosen by the uploader, since a
        // bulk file crosses many wards. All three are nullable: a locality is
        // optional by design, and a feature outside every known boundary keeps
        // NULLs rather than being forced into the wrong area.
        zone_id: DataTypes.INTEGER,
        ward_id: DataTypes.INTEGER,
        locality_id: DataTypes.INTEGER,

        // Parcel polygon this feature sits in, when it has been bridged for a
        // property survey.
        polygon_id: DataTypes.INTEGER,

        // Human/asset reference code, e.g. "MH-0142". Not unique globally.
        feature_code: DataTypes.STRING,

        // Free-form attributes keyed by the layer's attribute_schema.
        properties: {
            type: DataTypes.JSONB,
            defaultValue: {},
        },

        // Where this geometry came from.
        source: {
            type: DataTypes.ENUM("IMPORT", "SURVEY", "MANUAL"),
            defaultValue: "IMPORT",
        },

        // Lifecycle:
        //   STAGED     → freshly imported, awaiting admin review on the map
        //   VERIFIED   → admin checked geometry/attributes, not yet live
        //   PUBLISHED  → live; visible to surveyors in the field
        //   FLAGGED    → a surveyor reported a flaw; needs correction
        //   REJECTED   → discarded
        status: {
            type: DataTypes.ENUM("STAGED", "VERIFIED", "PUBLISHED", "FLAGGED", "REJECTED"),
            defaultValue: "STAGED",
        },

        // Cached measurements (geodesic), kept in sync on every geom write.
        length_m: DataTypes.FLOAT, // for line features
        area_sqm: DataTypes.FLOAT, // for polygon features

        // The staging batch this feature was imported in (null for MANUAL/SURVEY).
        upload_id: DataTypes.INTEGER,

        // Provenance / audit (User.id is a UUID).
        created_by: DataTypes.UUID,
        surveyor_id: DataTypes.UUID,
        verified_by: DataTypes.UUID,
        verified_at: DataTypes.DATE,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return AssetFeature;
};
