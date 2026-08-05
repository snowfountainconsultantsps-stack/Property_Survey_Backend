module.exports = (sequelize, DataTypes) => {
    const Polygon = sequelize.define("Polygon", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        polygon_code: {
            type: DataTypes.STRING,
            unique: true,
        },

        // Nullable so a parcel can exist while the location hierarchy is being
        // rebuilt (see scripts/resetLocations.js). Uploads still require a
        // ward — that is enforced in the controller, not the column.
        ward_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Project this parcel belongs to (nullable — legacy data has none).
        project_id: DataTypes.INTEGER,

        boundary: {
            type: DataTypes.GEOMETRY("MULTIPOLYGON", 4326),
            allowNull: false,
        },

        area_sqmt: DataTypes.FLOAT,

        map_version: {
            type: DataTypes.INTEGER,
            defaultValue: 1,
        },

        gis_status: {
            type: DataTypes.ENUM("RAW", "SURVEYED", "SPLIT", "FINAL"),
            defaultValue: "RAW",
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Polygon;
};
