module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetUpload — one shapefile/GeoJSON import batch.
    // Admin uploads a file → we parse & reproject → create STAGED features
    // linked to this batch → admin reviews them on the map → verify → publish.
    // This row is the unit the admin acts on during that review workflow.
    // ──────────────────────────────────────────────────────────────
    const AssetUpload = sequelize.define("AssetUpload", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        layer_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // Project this import batch was uploaded into.
        project_id: DataTypes.INTEGER,

        file_name: DataTypes.STRING,

        source_format: {
            type: DataTypes.ENUM("SHAPEFILE_ZIP", "GEOJSON"),
            allowNull: false,
        },

        // CRS the source data was in, as detected from the .prj (best effort).
        source_crs: DataTypes.STRING,

        feature_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        // Bounding box of the imported features in WGS84: [minLng,minLat,maxLng,maxLat]
        bbox: {
            type: DataTypes.JSONB,
            defaultValue: null,
        },

        // PENDING_REVIEW → VERIFIED → PUBLISHED, or REJECTED.
        status: {
            type: DataTypes.ENUM("PENDING_REVIEW", "VERIFIED", "PUBLISHED", "REJECTED"),
            defaultValue: "PENDING_REVIEW",
        },

        notes: DataTypes.TEXT,

        uploaded_by: DataTypes.UUID,
        reviewed_by: DataTypes.UUID,
        reviewed_at: DataTypes.DATE,
    });

    return AssetUpload;
};
