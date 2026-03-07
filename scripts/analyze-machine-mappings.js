#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse TypeScript file to extract mappings
const tsContent = fs.readFileSync(path.join(__dirname, '../lib/machine-mappings.ts'), 'utf-8');
const mappingsMatch = tsContent.match(/export const machineMappings[^{]*(\{[\s\S]*?\n\};?)/);
let machineMappings = {};
if (mappingsMatch) {
  try {
    // Clean up the TS syntax to make it valid JSON-ish
    let mappingsStr = mappingsMatch[1]
      .replace(/\/\/.*$/gm, '') // Remove comments
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .replace(/'/g, '"'); // Single to double quotes
    machineMappings = eval('(' + mappingsStr + ')');
  } catch (e) {
    console.error('Error parsing mappings:', e.message);
  }
}

function getMachineVariations(machineName) {
  const variations = new Set([machineName, machineName.toLowerCase()]);
  const lowerName = machineName.toLowerCase();

  for (const [key, value] of Object.entries(machineMappings)) {
    if (value.toLowerCase() === lowerName || key.toLowerCase() === lowerName) {
      variations.add(key);
      variations.add(value);
    }
  }

  if (machineMappings[lowerName]) {
    variations.add(machineMappings[lowerName]);
  }
  if (machineMappings[machineName]) {
    variations.add(machineMappings[machineName]);
  }

  return Array.from(variations);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyze() {
  console.log('Fetching all games from database...\n');

  // Fetch all games with pagination
  let allGames = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('games')
      .select('machine, season')
      .not('machine', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }

    if (!data || data.length === 0) break;
    allGames = allGames.concat(data);
    offset += pageSize;

    if (data.length < pageSize) break;
  }

  // Count games per machine
  const machineCountsInDB = {};
  const machineSeasons = {};

  allGames.forEach(g => {
    const m = g.machine;
    machineCountsInDB[m] = (machineCountsInDB[m] || 0) + 1;
    if (!machineSeasons[m]) machineSeasons[m] = new Set();
    machineSeasons[m].add(g.season);
  });

  const uniqueMachines = Object.keys(machineCountsInDB);
  console.log('Total games:', allGames.length);
  console.log('Unique machines in DB:', uniqueMachines.length);

  // Analyze each machine
  const problems = [];

  for (const dbMachine of uniqueMachines) {
    const dbCount = machineCountsInDB[dbMachine];
    const seasons = [...machineSeasons[dbMachine]].sort((a,b) => a-b);

    // Get variations that would be searched
    const variations = getMachineVariations(dbMachine);

    // Check if variations include the actual DB value
    const variationsLower = variations.map(v => v.toLowerCase());
    const dbMachineLower = dbMachine.toLowerCase();

    // Check if searching for this machine would find itself
    const wouldFindSelf = variationsLower.includes(dbMachineLower) ||
                          variations.includes(dbMachine);

    // Check for similar machines that might be separate
    const similarMachines = uniqueMachines.filter(m =>
      m !== dbMachine &&
      m.toLowerCase().replace(/[^a-z0-9]/g, '') === dbMachineLower.replace(/[^a-z0-9]/g, '')
    );

    if (similarMachines.length > 0) {
      problems.push({
        type: 'similar',
        machine: dbMachine,
        dbCount,
        seasons,
        similar: similarMachines,
        similarCounts: similarMachines.map(m => machineCountsInDB[m])
      });
    }

    // Check if mapping points to non-existent value
    const mappedTo = machineMappings[dbMachineLower];
    if (mappedTo && !machineCountsInDB[mappedTo] && mappedTo !== dbMachine) {
      // Check if any variation exists
      const mappedVariations = getMachineVariations(mappedTo);
      const anyExists = mappedVariations.some(v => machineCountsInDB[v]);

      if (!anyExists) {
        problems.push({
          type: 'maps_to_nonexistent',
          machine: dbMachine,
          dbCount,
          seasons,
          mapsTo: mappedTo
        });
      }
    }
  }

  // Group similar machines
  const similarGroups = {};
  problems.filter(p => p.type === 'similar').forEach(p => {
    const key = [p.machine, ...p.similar].sort().join('|');
    if (!similarGroups[key]) {
      similarGroups[key] = {
        machines: [p.machine, ...p.similar],
        totalCount: p.dbCount + p.similarCounts.reduce((a,b) => a+b, 0)
      };
    }
  });

  console.log('\n=== MACHINES WITH SIMILAR VARIANTS (need mapping) ===\n');

  Object.values(similarGroups)
    .sort((a, b) => b.totalCount - a.totalCount)
    .forEach(group => {
      console.log(`Total ${group.totalCount} games split across:`);
      group.machines.forEach(m => {
        const seasons = [...machineSeasons[m]].sort((a,b) => a-b).join(',');
        console.log(`  "${m}" - ${machineCountsInDB[m]} games (seasons: ${seasons})`);
      });
      console.log('');
    });

  console.log('\n=== MAPPINGS POINTING TO NON-EXISTENT VALUES ===\n');

  problems.filter(p => p.type === 'maps_to_nonexistent').forEach(p => {
    console.log(`"${p.machine}" (${p.dbCount} games) maps to "${p.mapsTo}" which doesn't exist in DB`);
  });

  // Check for display name issues
  console.log('\n=== CHECKING API BEHAVIOR ===\n');

  // Sample some machines and check what getMachineVariations returns
  const sampleMachines = ['BadCats', 'PULP', 'GLizard', 'Getaway', 'BatmanDE'];

  for (const sample of sampleMachines) {
    if (machineCountsInDB[sample]) {
      const vars = getMachineVariations(sample);
      const foundInDB = vars.filter(v => machineCountsInDB[v]);
      console.log(`"${sample}" (${machineCountsInDB[sample]} games):`);
      console.log(`  Variations searched: ${vars.join(', ')}`);
      console.log(`  Found in DB: ${foundInDB.join(', ') || 'NONE'}`);
      console.log('');
    }
  }
}

analyze().catch(console.error);
