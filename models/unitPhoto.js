module.exports = (sequelize, DataTypes) => {
    const UnitPhoto = sequelize.define("UnitPhoto", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        unit_id: DataTypes.INTEGER,

        photo_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        caption: DataTypes.STRING,

        photo_type: DataTypes.STRING,
    });

    return UnitPhoto;
};
