module.exports = (sequelize, DataTypes) => {
    // One approved (or draft) tax assessment per property. The full auditable
    // breakdown is frozen in `breakdown` at approval time so the citizen sees
    // exactly what the admin approved, even if rates change later.
    const PropertyTaxAssessment = sequelize.define("PropertyTaxAssessment", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
        },

        polygon_id: DataTypes.INTEGER,
        project_id: DataTypes.INTEGER,

        assessment_year: DataTypes.STRING,

        // Cached headline numbers (also present inside `breakdown`).
        arv: DataTypes.FLOAT,
        total_amount: DataTypes.FLOAT,

        // The complete computed breakdown (spaces, heads, config, notes).
        breakdown: DataTypes.JSONB,

        status: {
            type: DataTypes.ENUM("DRAFT", "APPROVED"),
            defaultValue: "DRAFT",
        },

        approved_by: DataTypes.UUID,
        approved_at: DataTypes.DATE,
    });

    return PropertyTaxAssessment;
};
