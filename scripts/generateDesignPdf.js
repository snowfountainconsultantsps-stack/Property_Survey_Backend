/**
 * Generate the Digital Asset System design document PDF to docs/.
 * Usage:  node scripts/generateDesignPdf.js
 * Requires no database connection.
 */
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { writeDesignDoc } = require("../services/pdfService");

const outDir = path.join(__dirname, "..", "docs");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "Digital_Asset_System_Design.pdf");

const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
doc.pipe(fs.createWriteStream(outPath));
writeDesignDoc(doc);
doc.end();

doc.on("end", () => {}); // stream flush handled by createWriteStream
console.log("Design PDF written to:", outPath);
