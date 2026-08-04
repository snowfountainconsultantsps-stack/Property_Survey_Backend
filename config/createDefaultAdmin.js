const bcrypt = require("bcryptjs");
const { User } = require("../models");

async function createDefaultAdmin() {
  try {
    const adminExists = await User.findOne({ where: { role: "ADMIN" } });

    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await User.create({
        full_name: "Admin User",
        phone: "9140946956",
        password_hash: hashedPassword,
        role: "ADMIN",
        is_active: true,
      });
      console.log("✓ Default admin created successfully!");
    }
  } catch (error) {
    console.error("Error creating default admin:", error.message);
  }
}

module.exports = createDefaultAdmin;
