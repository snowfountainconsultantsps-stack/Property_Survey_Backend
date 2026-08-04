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

        ward_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
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
