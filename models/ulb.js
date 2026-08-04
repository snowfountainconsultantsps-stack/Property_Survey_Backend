module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Ulb — Urban Local Body (Municipal Corporation, Municipality, Nagar
    // Panchayat, …). Sits under a City and is what a survey project is run
    // for. Managed alongside the other location levels.
    // ──────────────────────────────────────────────────────────────
    const Ulb = sequelize.define("Ulb", {
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

        code: DataTypes.STRING(20),

        // Corporation / Municipality / Nagar Panchayat / Cantonment etc.
        ulb_type: DataTypes.STRING,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Ulb;
};
