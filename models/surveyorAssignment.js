module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // SurveyorAssignment — which part of the hierarchy a surveyor may work in.
    //
    // A join table rather than a column on User, because the relationship is
    // many-to-many in both directions:
    //   • one surveyor can cover several wards / zones
    //   • one ward can deliberately be shared by several surveyors
    //
    // `level` says which of the three id columns is meaningful. Assigning a
    // ZONE implicitly grants every ward inside it (resolved at query time in
    // services/surveyorScope.js, so adding a ward to a zone extends the
    // assignment automatically instead of going stale).
    // ──────────────────────────────────────────────────────────────
    const SurveyorAssignment = sequelize.define(
        "SurveyorAssignment",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },

            level: {
                type: DataTypes.ENUM("ZONE", "WARD", "LOCALITY"),
                allowNull: false,
            },

            // Exactly one of these is set, matching `level`.
            zone_id: DataTypes.INTEGER,
            ward_id: DataTypes.INTEGER,
            locality_id: DataTypes.INTEGER,

            // The project is allocated first; the area above is a subdivision
            // of it. Required in practice (enforced by the API) so a grant
            // never spans every project that happens to share a ward.
            project_id: DataTypes.INTEGER,

            // Which asset type this surveyor is meant to survey here — e.g.
            // "All Property" or "Sewer Line". NULL means every layer in the
            // project, so existing rows keep working unchanged.
            layer_id: DataTypes.INTEGER,

            assigned_by: DataTypes.UUID,

            notes: DataTypes.TEXT,

            is_active: {
                type: DataTypes.BOOLEAN,
                defaultValue: true,
            },
        },
        {
            indexes: [
                { fields: ["user_id"] },
                { fields: ["ward_id"] },
                { fields: ["zone_id"] },
                { fields: ["locality_id"] },
            ],
        }
    );

    return SurveyorAssignment;
};
