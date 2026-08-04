module.exports = (sequelize, DataTypes) => {
    const PropertyUtilities = sequelize.define("PropertyUtilities", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: DataTypes.INTEGER,

        electric_connection: DataTypes.BOOLEAN,

        gas_connection: DataTypes.BOOLEAN,

        solar_connection: DataTypes.BOOLEAN,

        sewer_connection: DataTypes.BOOLEAN,

        rainwater_harvesting: DataTypes.BOOLEAN,
    });

    return PropertyUtilities;
};
