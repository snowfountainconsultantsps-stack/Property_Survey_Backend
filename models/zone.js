module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Zone — the administrative tier between City and Ward.
    //
    //   State → District → City → Zone → Ward
    //
    // Replaces the free-text `zone` string that used to live on Ward, so
    // zones can be listed, scoped to, and given their own boundary polygon
    // like every other level of the hierarchy.
    // ──────────────────────────────────────────────────────────────
    const Zone = sequelize.define("Zone", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        city_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
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
