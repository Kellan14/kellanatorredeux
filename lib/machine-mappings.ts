// Machine name aliases mapped to standardized names
// This is the SINGLE SOURCE OF TRUTH for all machine mappings
// Imported directly into API routes to ensure it's bundled with serverless functions
export const machineMappings: Record<string, string> = {
  // Abbreviations and aliases from STDmappings.csv
  "alice cooper nightmare castle": "Alice Cooper",
  "dr who": "Dr. Who",
  "hard body": "Hardbody",
  "mary shelley's frankenstein": "Frankenstein",
  "the jetsons": "Jetsons",
  "007": "James Bond 007",
  "8ball": "Eight Ball",
  "9ball": "Nine Ball",
  "acdc": "AC/DC",
  "afm": "Attack From Mars",
  "aiq": "Avengers Infinity Quest",
  "amh": "America's Most Haunted",
  "as": "Alien Star",
  "ballytrek": "Star Trek (Bally)",
  "banzairun": "banzai run",
  "batman (stern)": "Batman Dark Knight",
  "batman dark knight": "Batman Dark Knight",
  "batman de": "Batman (Data East)",
  "batman f": "Batman Forever",
  "bdk": "Batman Dark Knight",
  "bdnd": "Dungeons & Dragons (Bally)",
  "beat clock": "Beat the Clock",
  "bk2k": "Black Knight 2000",
  "bkiss": "KISS (Bally)",
  "bksor": "Black Knight Sword of Rage",
  "bm66": "Batman '66",
  "bobby orr power player": "Bobby Orr Power Player",
  "bop": "Bride of Pinbot",
  "bop2": "Bride of Pinbot 2.0",
  "bopp": "Bobby Orr Power Player",
  "br": "buck rogers",
  "bsd": "Bram Stoker's Dracula",
  "buckaneer": "Buccaneer",
  "ca": "Charlie's Angels",
  "cbw": "Cue Ball Wizard",
  "cftbl": "Creature from the Black Lagoon",
  "champpub": "Champion Pub",
  "cv": "Circus Voltaire",
  "dh": "Dirty Harry",
  "dm": "Demolition Man",
  "dnd": "dungeons and dragons stern",
  "dp": "deadpool",
  "drd": "Dr. Dude",
  "ebb": "eight ball beyond",
  "ebc": "Eight Ball Champ",
  "ebd": "Eight Ball Deluxe",
  "ej": "elton john",
  "ek": "Evel Knievel",
  "elvira": "Elvira and the Party Monsters",
  "elvirahouseofhorrors": "Elvira's House of Horrors",
  "f-14": "F-14 Tomcat",
  "fg": "Family Guy",
  "fh": "Funhouse",
  "fhrn": "Funhouse Rudy's Nightmare",
  "fish tales": "FishTales",
  "foo": "Foo Fighters",
  "foo fighters": "FOO",
  "freddy": "Freddy: Nightmare on Elm Street",
  "ft": "FishTales",
  "futurespa": "Future Spa",
  "gama": "Gamatron",
  "getaway hs2": "The Getaway: High Speed II",
  "gf": "Godfather",
  "ghost": "ghostbusters",
  "glizard": "Grand Lizard",
  "gnr": "Guns and Roses",
  "godzilla (stern)": "godzilla",
  "goldeneye": "GoldenEye 007",
  "got": "Game of Thrones",
  "gtf": "Galactic Tank Force",
  "guardians": "Guardians of the Galaxy",
  "guardians of the galaxy": "guardians",
  "harlem": "Harlem Globetrotters",
  "hh": "Haunted House",
  "hobbit": "The Hobbit",
  "hrc": "High Roller Casino",
  "hulk": "Incredible Hulk",
  "hw": "Hot Wheels",
  "id": "Independence Day",
  "indy": "Indiana Jones (Williams)",
  "indy500": "Indianapolis 500",
  "jackbox": "Jack in the Box",
  "james bond": "007",
  "james bond '007": "007",
  "james bond 007": "007",
  "jb60": "James Bond 007 (60th)",
  "jd": "Judge Dredd",
  "jm": "Johnny Mnemonic",
  "jurassic": "sternpark",
  "jw": "John Wick",
  "kiss": "KISS (Stern)",
  "kong": "King Kong",
  "kos": "Kings of Steel",
  "lab": "Labyrinth",
  "lah": "Last Action Hero",
  "lca": "Lights Camera Action",
  "lights camera action": "lights camera action!",
  "lostworld": "Lost World Jurassic Park",
  "lotr": "Lord of the Rings",
  "lw": "Lost World (Bally)",
  "lw3": "Lethal Weapon 3",
  "lz": "Led Zeppelin",
  "mandolorian": "mandalorian",
  "mario": "Mario Brothers",
  "mariomushroom": "Super Mario Mushroom World",
  "marstrek": "Mars Trek",
  "mb": "Monster Bash",
  "mc": "Mystery Castle",
  "metrem": "Metallica Remastered",
  "mh": "Mata Hari",
  "mm": "Medieval Madness",
  "mnf": "Monday Night Football",
  "mousin": "Mousin' Around",
  "msf": "Frankenstein",
  "nba stern": "NBA (Stern)",
  "nbafb": "NBA Fastbreak",
  "ngg": "No Good Gofers",
  "nitro": "Nitro Groundshaker",
  "nr": "Night Rider",
  "outerspace": "Outer Space",
  "party animals": "party animal",
  "pbr": "PBR Can Crusher",
  "pf": "Police Force",
  "phar": "Pharaoh",
  "popeye": "Popeye Saves the Earth",
  "potc": "Pirates of the Caribbean (Stern)",
  "potcjj": "Pirates of the Caribbean (JJP)",
  "poto": "Phantom of the Opera",
  "pulp": "PULP",
  "qs": "Quicksilver",
  "rb": "Rocky and Bullwinkle",
  "rbion": "Ripley's Believe It or Not!",
  "rfm": "Revenge From Mars",
  "rollercoaster": "Roller Coaster Tycoon",
  "rollergames": "Roller Games",
  "rr": "Royal Rumble",
  "rs": "Road Show",
  "rz": "Rob Zombie's Spookshow",
  "sb": "Sinbad",
  "sc": "Safe Cracker",
  "scooby doo": "scooby-doo",
  "sd": "Scooby-Doo",
  "sdnd": "dungeons and dragons stern",
  "segagod": "Godzilla (Sega)",
  "sf2": "Street Fighter 2",
  "sg": "Star Gazer",
  "shadow": "The Shadow",
  "simpsons": "The Simpsons (Data East)",
  "sixmil": "Six Million Dollar Man",
  "skindy": "Stern Indiana Jones",
  "sm": "Silverball Mania",
  "sns": "Strikes and Spares",
  "sof": "Swords Of Fury",
  "sopranos": "The Sopranos",
  "southpark": "South Park",
  "spaceinvaders": "Space Invaders",
  "spacejam": "Space Jam",
  "spaceshuttle": "Space Shuttle",
  "spacestation": "Space Station",
  "speakeasy": "Speak Easy",
  "specialforce": "Special Force",
  "spiderman": "Spider-Man",
  "spyhunter": "Spy Hunter",
  "ss": "Scared Stiff",
  "startrek": "Star Trek (Stern)",
  "startrip": "Star Trip",
  "starwars": "Star Wars (Data East)",
  "starwarse1": "Star Wars Episode I",
  "starwarssega": "Star Wars (Sega)",
  "stellarwars": "Stellar Wars",
  "sternpark": "Stern Jurassic Park",
  "sternwars": "Star Wars (Stern)",
  "stmnt": "Teenage Mutant Ninja Turtles (Stern)",
  "strangerthings": "Stranger Things",
  "strangescience": "Strange Science",
  "sttng": "Star Trek: The Next Generation",
  "surfchamp": "Surf Champ",
  "surfnsafari": "Surf 'n Safari",
  "swfote": "Star Wars: Fall of the Empire",
  "t2": "Terminator 2",
  "t3": "Terminator 3",
  "taf": "The Addams Family",
  "tagteam": "Tag Team",
  "tbl": "The Big Lebowski",
  "tcm": "Texas Chainsaw Massacre",
  "tf": "Transformers",
  "tftc": "Tales From the Crypt",
  "the beatles": "Beatles",
  "the mandalorian (premium)": "mandalorian",
  "tmnt": "Teenage Mutant Ninja Turtles (Data East)",
  "tna": "Total Nuclear Annihilation",
  "tom": "Theatre of Magic",
  "torpedo": "Torpedo Alley",
  "totan": "Tales of the Arabian Nights",
  "transporter": "Transporter The Rescue",
  "troopers": "Starship Troopers",
  "truckstop": "Truck Stop",
  "ts": "Toy Story",
  "tspp": "The Simpsons Pinball Party",
  "tw": "Time Warp",
  "twd": "The Walking Dead",
  "tz": "Twilight Zone",
  "ultra": "Ultraman",
  "uxmen": "Uncanny X-Men",
  "ven": "venom",
  "venom (r)": "venom",
  "venom left": "venom",
  "venom right": "venom",
  "viper": "Viper Night Drivin'",
  "wcs": "World Cup Soccer",
  "whitewater": "White Water",
  "whoanellie": "Whoa Nellie",
  "whodunnit": "Who Dunnit",
  "wildfyre": "Wild Fyre",
  "wof": "Wheel of Fortune",
  "wonka": "Willy Wonka",
  "woz": "Wizard of Oz",
  "wpt": "World Poker Tour",
  "wwe": "WWE Wrestlemania",
  "xfiles": "X-Files",
  "xmen": "X-Men (Stern)"
}

/**
 * Convert a string to Title Case (each word capitalized)
 */
function toTitleCase(str: string): string {
  return str.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
}

/**
 * Remove special characters to create a "database-style" name
 * e.g., "AC/DC" -> "ACDC", "Dr. Who" -> "Dr Who"
 */
function removeSpecialChars(str: string): string {
  return str.replace(/[\/\.\-\']/g, '')
}

/**
 * Get all possible case variations of a machine name for database queries.
 * This handles machines stored with different case conventions (BK2K, Bk2k, bk2k, etc.)
 * Also includes all aliases that map to the same standardized name.
 * Includes versions with special characters removed (AC/DC -> ACDC)
 */
export function getMachineVariations(machineKey: string): string[] {
  const variations = new Set<string>()
  const lowerMachineKey = machineKey.toLowerCase()

  // Helper to add all case variations of a string
  const addAllVariations = (str: string) => {
    variations.add(str)
    variations.add(str.toLowerCase())
    variations.add(str.toUpperCase())
    variations.add(str.charAt(0).toUpperCase() + str.slice(1).toLowerCase())
    variations.add(toTitleCase(str))
    // Also add version without special characters
    const noSpecial = removeSpecialChars(str)
    if (noSpecial !== str) {
      variations.add(noSpecial)
      variations.add(noSpecial.toLowerCase())
      variations.add(noSpecial.toUpperCase())
      variations.add(noSpecial.charAt(0).toUpperCase() + noSpecial.slice(1).toLowerCase())
    }
  }

  // Add variations of the original machine key
  addAllVariations(machineKey)

  // Find all aliases that map to this standardized name
  for (const [alias, standardized] of Object.entries(machineMappings)) {
    if (standardized.toLowerCase() === lowerMachineKey ||
        removeSpecialChars(standardized).toLowerCase() === removeSpecialChars(lowerMachineKey).toLowerCase()) {
      addAllVariations(alias)
      addAllVariations(standardized)
    }
  }

  // Check if the machine key itself is an alias
  const standardizedName = machineMappings[lowerMachineKey]
  if (standardizedName) {
    addAllVariations(standardizedName)
    // Also find other aliases for this standardized name
    for (const [alias, standard] of Object.entries(machineMappings)) {
      if (standard === standardizedName || standard.toLowerCase() === standardizedName.toLowerCase()) {
        addAllVariations(alias)
      }
    }
  }

  return Array.from(variations)
}

/**
 * Get variations for multiple machines at once.
 * Returns a flat array of all variations for all provided machines.
 */
export function getAllMachineVariations(machines: string[]): string[] {
  const allVariations = new Set<string>()
  for (const machine of machines) {
    for (const variation of getMachineVariations(machine)) {
      allVariations.add(variation)
    }
  }
  return Array.from(allVariations)
}
