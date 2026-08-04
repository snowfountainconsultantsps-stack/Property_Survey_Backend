module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // AssetPhoto — a photo attached to an asset feature (optionally tied to
    // the survey visit that captured it). Stored on Cloudinary like the
    // existing property/unit photos.
    // ──────────────────────────────────────────────────────────────
    const AssetPhoto = sequelize.define("AssetPhoto", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        feature_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        // Optional link to the AssetSurvey visit that produced this photo.
        asset_survey_id: DataTypes.INTEGER,

        photo_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        caption: DataTypes.STRING,

        uploaded_by: DataTypes.UUID,
    });

    return AssetPhoto;
};
