module.exports = (sequelize, DataTypes) => {
    const Building = sequelize.define("Building", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        floors_above_ground: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        floors_below_ground: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        construction_year: DataTypes.INTEGER,

        total_builtup_area: DataTypes.FLOAT,

        building_occupancy: {
            type: DataTypes.ENUM("Self", "Rented", "Vacant", "SelfRented"),
            comment:
                "Used for single-entry types (SingleStory, Commercial, PetrolPump, Mixed). For MultiStory/CommercialComplex occupancy is tracked at unit level.",
        },
    });

    return Building;
};
