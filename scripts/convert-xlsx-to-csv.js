#!/usr/bin/env node

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Read the Excel file
const inputFile = path.join(__dirname, '..', 'MNPhistoryfull.xlsx');
const outputFile = path.join(__dirname, '..', 'MNPhistoryfull.csv');

console.log(`Reading Excel file: ${inputFile}`);

const workbook = XLSX.readFile(inputFile);
const sheetName = workbook.SheetNames[0]; // Use first sheet
console.log(`Using sheet: ${sheetName}`);

const worksheet = workbook.Sheets[sheetName];

// Convert to CSV
const csv = XLSX.utils.sheet_to_csv(worksheet);

// Write to file
fs.writeFileSync(outputFile, csv, 'utf8');

console.log(`\nCSV file created: ${outputFile}`);
console.log(`Total lines: ${csv.split('\n').length - 1}`);

// Show first few lines as preview
const lines = csv.split('\n').slice(0, 5);
console.log('\nPreview of first 5 lines:');
lines.forEach((line, i) => {
  console.log(`${i + 1}: ${line}`);
});
