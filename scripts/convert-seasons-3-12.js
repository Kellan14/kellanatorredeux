#!/usr/bin/env node

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'MNPhistoryfull.xlsx');
const outputFile = path.join(__dirname, '..', 'MNP-seasons-3-12.csv');

console.log(`Reading Excel file: ${inputFile}\n`);

const workbook = XLSX.readFile(inputFile);

// Seasons to import (3-12, skipping 5 which has bad data, and 2 which is already imported)
const seasonsToImport = ['3', '4', '6', '7', '8', '9', '10', '11', '12'];

let allRows = [];
let totalGames = 0;

console.log('Processing sheets:');
seasonsToImport.forEach(sheetName => {
  if (workbook.SheetNames.includes(sheetName)) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    console.log(`  Season ${sheetName}: ${rows.length} games`);
    allRows = allRows.concat(rows);
    totalGames += rows.length;
  } else {
    console.log(`  Season ${sheetName}: SHEET NOT FOUND`);
  }
});

console.log(`\nTotal games to import: ${totalGames}`);

// Convert to CSV
const headers = Object.keys(allRows[0]);
let csvContent = headers.join(',') + '\n';

allRows.forEach(row => {
  const values = headers.map(header => {
    const value = row[header];
    // Handle values that might contain commas
    if (value === undefined || value === null) return '';
    const strValue = String(value);
    if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
      return '"' + strValue.replace(/"/g, '""') + '"';
    }
    return strValue;
  });
  csvContent += values.join(',') + '\n';
});

fs.writeFileSync(outputFile, csvContent, 'utf8');

console.log(`\nCSV file created: ${outputFile}`);
console.log(`Total lines: ${totalGames + 1} (including header)`);

// Verify seasons in output
const seasons = [...new Set(allRows.map(row => row.season))].sort((a, b) => a - b);
console.log(`Seasons included: ${seasons.join(', ')}`);
