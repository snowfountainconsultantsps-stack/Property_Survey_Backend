module.exports = (sequelize, DataTypes) => {
    const PropertyPhoto = sequelize.define("PropertyPhoto", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: DataTypes.INTEGER,

        photo_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        caption: DataTypes.STRING,

        photo_type: DataTypes.STRING,
    });

    return PropertyPhoto;
};
