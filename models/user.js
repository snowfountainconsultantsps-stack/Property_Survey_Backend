module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    full_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    phone: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },

    password_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    role: {
      type: DataTypes.ENUM("ADMIN", "SUPERVISOR", "SURVEYOR", "GIS_EDITOR", "GIS_ADMIN"),
      defaultValue: "SURVEYOR",
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  });

  return User;
};
