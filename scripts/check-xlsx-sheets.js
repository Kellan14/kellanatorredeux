#!/usr/bin/env node

const XLSX = require('xlsx');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'MNPhistoryfull.xlsx');

console.log(`Reading Excel file: ${inputFile}\n`);

const workbook = XLSX.readFile(inputFile);

console.log(`Total sheets: ${workbook.SheetNames.length}\n`);
console.log('Sheet names:');
workbook.SheetNames.forEach((name, i) => {
  const worksheet = workbook.Sheets[name];
  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log(`  ${i + 1}. "${name}" - ${data.length} rows`);

  // Show seasons in this sheet
  if (data.length > 0 && data[0].season) {
    const seasons = [...new Set(data.map(row => row.season))].sort((a, b) => a - b);
    console.log(`     Seasons: ${seasons.join(', ')}`);
  }
});
