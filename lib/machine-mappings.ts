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
  "banzairun": "BanzaiRun",
  "batman (stern)": "Batman Dark Knight",
  "batman dark knight": "Batman Dark Knight",
  "batman dark knight (stern)": "Batman Dark Knight",
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
  "br": "Buck Rogers",
  "bsd": "Bram Stoker's Dracula",
  "buckaneer": "Buccaneer",
  "ca": "Charlie's Angels",
  "cbw": "Cue Ball Wizard",
  "cftbl": "Creature from the Black Lagoon",
  "champpub": "Champion Pub",
  "cv": "Circus Voltaire",
  "dh": "Dirty Harry",
  "dm": "Demolition Man",
  "dnd": "Dungeons and Dragons (Stern)",
  "dp": "Dead Pool",
  "drd": "Dr. Dude",
  "ebb": "Eight Ball Beyond",
  "ebc": "Eight Ball Champ",
  "ebd": "Eight Ball Deluxe",
  "ej": "Elton John",
  "ek": "Evel Knievel",
  "elvira": "Elvira and the Party Monsters",
  "elvirahouseofhorrors": "Elvira's House of Horrors",
  "f-14": "F-14 Tomcat",
  "fg": "Family Guy",
  "fh": "Funhouse",
  "fhrn": "Funhouse Rudy's Nightmare",
  "fish tales": "FishTales",
  "foo": "Foo Fighters",
  "foo fighters": "Foo Fighters",
  "freddy": "Freddy: Nightmare on Elm Street",
  "ft": "FishTales",
  "futurespa": "Future Spa",
  "gama": "Gamatron",
  "getaway hs2": "The Getaway: High Speed II",
  "gf": "Godfather",
  "ghost": "Ghostbusters",
  "glizard": "Grand Lizard",
  "gnr": "Guns and Roses",
  "godzilla (stern)": "Godzilla",
  "goldeneye": "GoldenEye 007",
  "got": "Game of Thrones",
  "gtf": "Galactic Tank Force",
  "guardians": "Guardians of the Galaxy",
  "guardians of the galaxy": "Guardians of the Galaxy",
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
  "james bond": "James Bond 007",
  "james bond '007": "James Bond 007",
  "james bond 007": "James Bond 007",
  "jb60": "James Bond 007 (60th)",
  "jd": "Judge Dredd",
  "jm": "Johnny Mnemonic",
  "jurassic": "Stern Jurassic Park",
  "jw": "John Wick",
  "kiss": "KISS (Stern)",
  "kong": "King Kong",
  "kos": "Kings of Steel",
  "lab": "Labyrinth",
  "lah": "Last Action Hero",
  "lca": "Lights Camera Action",
  "lights camera action": "Lights Camera Action",
  "lostworld": "Lost World Jurassic Park",
  "lotr": "Lord of the Rings",
  "lw": "Lost World (Bally)",
  "lw3": "Lethal Weapon 3",
  "lz": "Led Zeppelin",
  "mandolorian": "Mandalorian",
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
  "party animals": "Party Zone",
  "pbr": "PBR Can Crusher",
  "pf": "Police Force",
  "phar": "Pharaoh",
  "popeye": "Popeye Saves the Earth",
  "potc": "Pirates of the Caribbean (Stern)",
  "potcjj": "Pirates of the Caribbean (JJP)",
  "poto": "Phantom of the Opera",
  "pulp": "Pulp Fiction",
  "PULP": "Pulp Fiction",
  "pulp fiction": "Pulp Fiction",
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
  "scooby doo": "Scooby-Doo",
  "sd": "Scooby-Doo",
  "sdnd": "Dungeons and Dragons (Stern)",
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
  "the mandalorian (premium)": "Mandalorian",
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
  "ven": "Venom",
  "venom (r)": "Venom",
  "venom left": "Venom",
  "venom right": "Venom",
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
  "xmen": "X-Men (Stern)",
  // New mappings from STDmapping.xlsx - ADDITIONS ONLY
  "aerosmith": "Aerosmith",
  "ali": "Ali",
  "alicecooper": "Alice Cooper",
  "alien": "Alien",
  "alienpoker": "Alien Poker",
  "apollo13": "Apollo 13",
  "arena": "Arena",
  "atlantis": "Atlantis",
  "austinpowers": "Austin Powers",
  "avatar": "Avatar",
  "avengers": "Avengers",
  "bmx": "BMX",
  "badcats": "Bad Cats",
  "batmande": "Batman Data East",
  "batmanf": "Batman Forever (SEGA)",
  "baywatch": "Baywatch",
  "beamon": "Beam On",
  "beatclock": "Beat the Clock",
  "beatles": "Beatles",
  "bigbrave": "Big Brave",
  "bigguns": "Big Guns",
  "blackhole": "Black Hole",
  "blackknight": "Black Knight",
  "blackrose": "Black Rose",
  "blackjack": "Blackjack",
  "blackout": "Blackout",
  "breakshot": "Breakshot",
  "csi": "CSI",
  "cactuscanyon": "Cactus Canyon",
  "catacomb": "Catacomb",
  "centaur": "Centaur",
  "checkpoint": "Checkpoint",
  "cheetah": "Cheetah",
  "congo": "Congo",
  "corvette": "Corvette",
  "cyclone": "Cyclone",
  "dialedin": "Dialed In!",
  "diner": "Diner",
  "dollyparton": "Dolly Parton",
  "drwho": "Dr Who",
  "dragon": "Dragon",
  "dragonfist": "Dragonfist",
  "dune": "Dune",
  "earthshaker": "Earthshaker",
  "eldorado": "El Dorado",
  "elektra": "Elektra",
  "elvis": "Elvis",
  "embryon": "Embryon",
  "fathom": "Fathom",
  "fire": "Fire",
  "fireball2": "Fireball II",
  "firepower": "Firepower",
  "flashgordon": "Flash Gordon",
  "flight2000": "Flight 2000",
  "flintstones": "Flintstones",
  "force2": "Force II",
  "frankenstein": "Frankenstein",
  "frontier": "Frontier",
  "fullt": "Full Throttle",
  "galaxy": "Galaxy",
  "gameshow": "Game Show",
  "genesis": "Genesis",
  "genie": "Genie",
  "godzilla": "Godzilla",
  "gorgar": "Gorgar",
  "getaway": "HS2 The Getaway",
  "halloween": "Halloween",
  "hardbody": "Hard Body",
  "highspeed": "High Speed",
  "hollywoodheat": "Hollywood Heat",
  "hook": "Hook",
  "hotdoggin": "Hotdoggin",
  "houdini": "Houdini",
  "hurricane": "Hurricane",
  "ironmaiden": "Iron Maiden",
  "ironman": "Iron Man",
  "jackbot": "Jackbot",
  "jaws": "Jaws",
  "jetsons": "Jetsons",
  "jokerz": "Jokerz",
  "junkyard": "Junkyard",
  "lightning": "Lightning",
  "luckyace": "Lucky Ace",
  "mandalorian": "Mandalorian",
  "maverick": "Maverick",
  "medusa": "Medusa",
  "metallica": "Metallica",
  "meteor": "Meteor",
  "monopoly": "Monopoly",
  "motordome": "Motordome",
  "munsters": "Munsters",
  "mustang": "Mustang",
  "mystic": "Mystic",
  "nascar": "Nascar",
  "nofear": "No Fear",
  "paragon": "Paragon",
  "partyzone": "Party Zone",
  "pinballmagic": "Pinball Magic",
  "pinbot": "Pinbot",
  "pistolpoker": "Pistol Poker",
  "playboy": "Playboy (Bally)",
  "playboyde": "Playboy (Data East)",
  "playboystern": "Playboy (Stern)",
  "radical": "Radical",
  "rickandmorty": "Rick and Morty",
  "robocop": "Robocop",
  "rush": "Rush",
  "scorpion": "Scorpion",
  "scuba": "Scuba",
  "seawitch": "Seawitch",
  "sharpshooter": "Sharpshooter",
  "shrek": "Shrek",
  "skateball": "Skateball",
  "starrace": "Star Race",
  "sterntrek": "Star Trek (Stern)",
  "stargate": "Stargate",
  "stars": "Stars",
  "nba": "Stern NBA",
  "superman": "Superman",
  "supersonic": "Supersonic",
  "targetalpha": "Target Alpha",
  "taxi": "Taxi",
  "toledo": "Toledo",
  "tommy": "Tommy",
  "tron": "Tron",
  "viking": "Viking",
  "waterworld": "Water World",
  "whirlwind": "Whirlwind",
  "xenon": "Xenon"
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
