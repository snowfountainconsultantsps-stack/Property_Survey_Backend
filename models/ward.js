module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Ward — the electoral/administrative division a property belongs to.
    //
    //   State → District → ULB → [Zone] → Ward → Locality
    //
    // The ULB is the parent, because the ULB is what defines and taxes the
    // ward. Zone is an optional grouping in between (large corporations only),
    // so `zone_id` may legitimately be null.
    // ──────────────────────────────────────────────────────────────
    const Ward = sequelize.define("Ward", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Real parent — the taxing authority. Nullable at the DB layer for the
        // transition; required by the API on write.
        ulb_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Optional middle tier; null for ULBs that don't use zones.
        zone_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Legacy link from when Ward hung off City. Retained for historic rows.
        city_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        ward_name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        ward_number: DataTypes.STRING,

        // Legacy free-text zone name, superseded by zone_id.
        zone: DataTypes.STRING,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Ward;
};
