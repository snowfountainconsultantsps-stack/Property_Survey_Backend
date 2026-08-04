module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetLayer — the *definition* of a map layer / asset type.
    // e.g. "Sewer Line" (LINESTRING), "Manhole" (POINT),
    //      "Overhead Tank" (POLYGON).
    //
    // A layer defines:
    //   • what geometry kind its features are (drives shapefile validation)
    //   • how it is drawn on the map (`style`)
    //   • what attributes a feature carries (`attribute_schema`) — used to
    //     build survey forms and to map shapefile .dbf columns.
    // Individual geometries live in AssetFeature.
    // ──────────────────────────────────────────────────────────────
    const AssetLayer = sequelize.define("AssetLayer", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        category_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // Machine code, unique. e.g. "SEWER_LINE"
        code: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        description: DataTypes.TEXT,

        // The geometry kind this layer holds. We accept the "Multi" variant
        // transparently during import (a POINT layer also accepts MULTIPOINT).
        geometry_type: {
            type: DataTypes.ENUM("POINT", "LINESTRING", "POLYGON"),
            allowNull: false,
        },

        // Leaflet/GeoJSON draw style. e.g.
        // { color:"#0ea5e9", weight:3, fillColor:"#0ea5e9", fillOpacity:0.3, radius:6 }
        style: {
            type: DataTypes.JSONB,
            defaultValue: {},
        },

        // Attribute form definition. Array of:
        // { key, label, type: "text"|"number"|"boolean"|"select", required, options?, unit? }
        attribute_schema: {
            type: DataTypes.JSONB,
            defaultValue: [],
        },

        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        // Whether surveyors may draw/add new features on this layer in the field.
        surveyable: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return AssetLayer;
};
