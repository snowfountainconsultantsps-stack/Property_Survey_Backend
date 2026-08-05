module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Zone — optional administrative tier between ULB and Ward.
    //
    //   State → District → ULB → [Zone] → Ward → Locality
    //
    // Only large bodies (Municipal Corporations) divide themselves into
    // zones. Nagar Panchayats and Cantonment Boards go straight from ULB to
    // ward, so this tier is skippable — never invent a placeholder zone just
    // to fill the gap.
    // ──────────────────────────────────────────────────────────────
    const Zone = sequelize.define("Zone", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Real parent. Nullable at the DB layer for the transition; required
        // by the API on write.
        ulb_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // Legacy link from when Zone hung off City. Kept so historic rows keep
        // their value; nothing reads it any more.
        city_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        code: DataTypes.STRING(10),

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Zone;
};
