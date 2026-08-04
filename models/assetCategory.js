module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetCategory — top-level grouping of asset layers.
    // e.g. "Drainage & Sewer", "Water Supply", "Roads & Transport".
    // Purely organisational: used to group layers in the map legend,
    // the admin catalog, and the PDF report.
    // ──────────────────────────────────────────────────────────────
    const AssetCategory = sequelize.define("AssetCategory", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Machine code, unique. e.g. "DRAIN_SEWER"
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

        // Hex colour used as the default legend swatch for the group.
        color: {
            type: DataTypes.STRING,
            defaultValue: "#6b7280",
        },

        icon: DataTypes.STRING,

        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return AssetCategory;
};
