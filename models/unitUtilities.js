module.exports = (sequelize, DataTypes) => {
    const UnitUtilities = sequelize.define("UnitUtilities", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        unit_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // Connections
        electric_connection: DataTypes.BOOLEAN,
        water_connection: DataTypes.BOOLEAN,
        gas_connection: DataTypes.BOOLEAN,
        sewer_connection: DataTypes.BOOLEAN,
        internet_connection: DataTypes.BOOLEAN,

        // Kitchen
        has_kitchen: DataTypes.BOOLEAN,
        kitchen_count: DataTypes.INTEGER,
        kitchen_area: DataTypes.FLOAT,

        // Toilet
        has_toilet: DataTypes.BOOLEAN,
        toilet_count: DataTypes.INTEGER,
        toilet_area: DataTypes.FLOAT,

        // Parking
        parking_type: DataTypes.STRING,
        parking_area: DataTypes.FLOAT,
    });

    return UnitUtilities;
};
