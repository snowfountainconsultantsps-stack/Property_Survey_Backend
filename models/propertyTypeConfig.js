module.exports = (sequelize, DataTypes) => {
    // One row per (property_type, property_subtype) leaf combination.
    //
    // Replaces the string-matching that used to decide the survey shape
    // (`subtypeName.includes("complex")` etc.) with two explicit, data-driven
    // fields:
    //
    //   structural_template — how the wizard is shaped:
    //     FLAT   → land only, no building (Vacant)
    //     SINGLE → building → floors, occupancy captured at floor level
    //     MULTI  → building → floors → units, occupancy at unit level
    //
    //   attribute_schema    — the extra questions this type asks, in the same
    //     {key,label,type,required,options,unit} shape the asset-survey side
    //     already uses (see AssetLayer.attribute_schema and the app's
    //     DynamicAttributeField). Adding a question is a data edit, not code.
    //
    // Answers land in Properties.type_specific_attributes (JSONB), so the tax
    // engine and any future billing can read them without schema changes.
    const PropertyTypeConfig = sequelize.define("PropertyTypeConfig", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Mirrors the Property enums. Subtype is null for Mixed / Vacant,
        // which have no subtype.
        property_type: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        property_subtype: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        // Numeric ids the wizard already speaks (CATEGORIES / SUBTYPES).
        category_id: DataTypes.INTEGER,
        subtype_id: DataTypes.INTEGER,

        label: DataTypes.STRING,
        description: DataTypes.TEXT,

        structural_template: {
            type: DataTypes.ENUM("FLAT", "SINGLE", "MULTI"),
            allowNull: false,
            defaultValue: "SINGLE",
        },

        // Whether several Property rows may share one polygon (a multi-entry
        // complex) — previously hardcoded in createDraftSurvey.
        is_multi_entry: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },

        // Does this type collect photos in the wizard?
        collects_photos: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        // Extra questions asked for this type (array of field definitions).
        attribute_schema: {
            type: DataTypes.JSONB,
            defaultValue: [],
        },

        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return PropertyTypeConfig;
};
