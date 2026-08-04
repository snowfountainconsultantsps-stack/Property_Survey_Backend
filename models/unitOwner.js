module.exports = (sequelize, DataTypes) => {
    const UnitOwner = sequelize.define("UnitOwner", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        unit_id: DataTypes.INTEGER,

        owner_name: DataTypes.STRING,

        father_or_husband_name: DataTypes.STRING,

        occupation: DataTypes.STRING,

        mobile: DataTypes.STRING,

        aadhar: DataTypes.STRING,

        disabled_person: DataTypes.BOOLEAN,
    });

    return UnitOwner;
};
