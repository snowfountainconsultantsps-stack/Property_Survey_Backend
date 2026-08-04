module.exports = (sequelize, DataTypes) => {
    const PropertyOwner = sequelize.define("PropertyOwner", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: {
            type: DataTypes.INTEGER,
        },

        owner_name: DataTypes.STRING,

        father_or_husband_name: DataTypes.STRING,

        occupation: DataTypes.STRING,

        disabled_person: DataTypes.BOOLEAN,

        mobile_number: DataTypes.STRING,

        aadhar_number: DataTypes.STRING,

        bill_photo: DataTypes.STRING,
    });

    return PropertyOwner;
};
