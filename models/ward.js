module.exports = (sequelize, DataTypes) => {
    const Ward = sequelize.define("Ward", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        // Kept alongside zone_id as a denormalised shortcut so city-wide ward
        // queries stay a single lookup. Zone is the real parent.
        city_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // State → District → City → Zone → Ward.
        zone_id: DataTypes.INTEGER,

        ward_name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        ward_number: DataTypes.STRING,

        // Legacy free-text zone name, superseded by zone_id. Retained so old
        // rows keep their original value; nothing reads it any more.
        zone: DataTypes.STRING,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Ward;
};
