module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Locality — mohalla / colony / sector inside a Ward.
    //
    //   State → District → ULB → [Zone] → Ward → Locality
    //
    // Unlike every tier above it, a locality is NOT a statutory unit: names
    // overlap, spellings vary and no authority publishes their boundaries.
    // It exists for addressing and for handing surveyors a work area, so it
    // is deliberately optional everywhere — a property is perfectly valid
    // without one.
    //
    // `boundary` (added in server.js as raw PostGIS, like the other levels) is
    // likewise optional: supply a shapefile and properties can be assigned by
    // spatial join; leave it empty and the locality is just a name.
    // ──────────────────────────────────────────────────────────────
    const Locality = sequelize.define("Locality", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        ward_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        code: DataTypes.STRING(20),

        // Colony / Mohalla / Sector / Village / Other — descriptive only.
        locality_type: DataTypes.STRING,

        // Alternate or historical spellings, so surveyor free-text can still
        // be matched back to one record.
        alt_names: DataTypes.STRING,

        pincode: DataTypes.STRING(10),

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Locality;
};
