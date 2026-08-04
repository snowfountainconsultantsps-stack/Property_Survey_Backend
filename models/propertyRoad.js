module.exports = (sequelize, DataTypes) => {
    const PropertyRoad = sequelize.define("PropertyRoad", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: DataTypes.INTEGER,

        road_side: {
            type: DataTypes.ENUM("Front", "Left", "Right", "Back"),
        },

        road_exists: DataTypes.BOOLEAN,

        road_type: DataTypes.STRING,

        road_width: DataTypes.FLOAT,

        carriageway_area: DataTypes.FLOAT,

        footpath_area: DataTypes.FLOAT,
    });

    return PropertyRoad;
};
