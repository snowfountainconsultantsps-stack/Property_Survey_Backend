module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetSurvey — a surveyor's field observation / correction of an
    // asset feature. This is the "surveyor does the survey there, and if
    // there is any flaw corrects it" flow.
    //
    // The proposed geometry/attribute changes are stored here (not applied
    // directly) so an admin/supervisor can approve them. On approval the
    // parent AssetFeature is updated from the accepted values.
    //
    // Like AssetFeature, the two geometry columns
    //   new_geom geometry(Geometry,4326)   -- the surveyor's corrected shape
    // are added by an additive raw migration (server.js) and handled via
    // raw SQL. `new_geom` is null when only attributes changed.
    // ──────────────────────────────────────────────────────────────
    const AssetSurvey = sequelize.define("AssetSurvey", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        feature_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        surveyor_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },

        // What the surveyor did in the field.
        //   VERIFY            → confirmed as-is, condition captured
        //   CORRECT_GEOMETRY  → moved/redrew the shape (new_geom set)
        //   CORRECT_ATTRIBUTE → fixed attributes only (proposed_properties set)
        //   FLAG              → reported a flaw for the office to fix
        action: {
            type: DataTypes.ENUM(
                "VERIFY",
                "CORRECT_GEOMETRY",
                "CORRECT_ATTRIBUTE",
                "FLAG"
            ),
            allowNull: false,
        },

        // Proposed attribute values (merged into feature.properties on approval).
        proposed_properties: {
            type: DataTypes.JSONB,
            defaultValue: null,
        },

        // Simple field condition rating for the asset.
        condition: {
            type: DataTypes.ENUM("GOOD", "FAIR", "POOR", "DAMAGED", "MISSING"),
            defaultValue: null,
        },

        notes: DataTypes.TEXT,

        // Where the surveyor physically was when recording this.
        gps_lat: DataTypes.DOUBLE,
        gps_lng: DataTypes.DOUBLE,

        // Review lifecycle for the proposed change.
        status: {
            type: DataTypes.ENUM("submitted", "approved", "rejected"),
            defaultValue: "submitted",
        },

        reviewed_by: DataTypes.UUID,
        reviewed_at: DataTypes.DATE,
        review_notes: DataTypes.TEXT,
    });

    return AssetSurvey;
};
