module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Ulb — Urban Local Body: the authority that actually governs and taxes
    // an urban area (Nagar Nigam, Nagar Palika, Nagar Panchayat, Cantonment
    // Board, …).
    //
    //   State → District → ULB → [Zone] → Ward → Locality
    //
    // The ULB — not the city — is the operational parent, because every rule
    // the system depends on is set by the ULB: ward boundaries, zone
    // divisions, tax rates and rebates. One city can contain several ULBs
    // (Lucknow holds both Lucknow Nagar Nigam and Lucknow Cantonment Board,
    // which levy independently), so hanging wards off a City would merge two
    // authorities' data into one bucket.
    //
    // `city_id` is retained but demoted to an optional descriptive link, used
    // for postal addressing and "everything in Lucknow" style reporting.
    // ──────────────────────────────────────────────────────────────
    const Ulb = sequelize.define("Ulb", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Real parent in the hierarchy. Nullable at the DB layer so existing
        // rows survive the move; the API requires it on write.
        district_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Optional geographic grouping — NOT the operational parent.
        city_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        code: DataTypes.STRING(20),

        // Municipal Corporation / Municipal Council / Nagar Panchayat /
        // Cantonment Board / Development Authority.
        ulb_type: DataTypes.STRING,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Ulb;
};
