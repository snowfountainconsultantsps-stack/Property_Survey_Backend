module.exports = (sequelize, DataTypes) => {
    const Property = sequelize.define("Property", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        polygon_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Project this property belongs to (nullable — legacy data has none).
        project_id: DataTypes.INTEGER,

        // Human-readable unique property identifier: {ward}/{polygon}/{seq}
        // Generated once from the (unique) property id, so it is itself unique.
        property_code: {
            type: DataTypes.STRING,
        },

        surveyor_id: DataTypes.UUID,

        survey_id: DataTypes.INTEGER,

        property_type: {
            type: DataTypes.ENUM("Residential", "NonResidential", "Mixed", "Vacant"),
            allowNull: false,
        },

        property_subtype: {
            type: DataTypes.ENUM(
                "SingleStory",
                "MultiStory",
                "Commercial",
                "PetrolPump",
                "CommercialComplex"
            ),
            comment:
                "SingleStory/MultiStory for Residential. Commercial/PetrolPump/CommercialComplex for NonResidential. Null for Mixed/Vacant.",
        },

        address: {
            type: DataTypes.TEXT,
            allowNull: false,
        },

        plot_area: DataTypes.FLOAT,

        construction_type: DataTypes.STRING,

        survey_date: DataTypes.DATE,

        // Answers to the category-specific questions defined in
        // PropertyTypeConfig.attribute_schema (e.g. a petrol pump's canopy and
        // forecourt areas). Kept as JSONB so adding a question is a data edit.
        type_specific_attributes: {
            type: DataTypes.JSONB,
            defaultValue: {},
        },

        // MultiStory & CommercialComplex can have multiple entries per polygon
        // Others are limited to one entry per polygon
        // This flag helps enforce that rule at application level
        is_multi_entry: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment:
                "true for MultiStory & CommercialComplex (multiple per polygon). false for others (one per polygon).",
        },
    });

    return Property;
};
