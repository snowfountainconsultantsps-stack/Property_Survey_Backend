module.exports = (sequelize, DataTypes) => {
    const FloorUtilities = sequelize.define("FloorUtilities", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        floor_id: DataTypes.INTEGER,

        has_kitchen: DataTypes.BOOLEAN,

        kitchen_count: DataTypes.INTEGER,

        kitchen_area: DataTypes.FLOAT,

        has_toilet: DataTypes.BOOLEAN,

        toilet_count: DataTypes.INTEGER,

        toilet_area: DataTypes.FLOAT,

        parking_type: DataTypes.STRING,

        parking_area: DataTypes.FLOAT,
    });

    return FloorUtilities;
};
