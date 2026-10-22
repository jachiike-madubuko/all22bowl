// Gen 1–9 (#1–1025), index = National Dex number - 1
const POKEMON_NAMES = [
  "Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard", "Squirtle", "Wartortle", "Blastoise", "Caterpie",
  "Metapod", "Butterfree", "Weedle", "Kakuna", "Beedrill", "Pidgey", "Pidgeotto", "Pidgeot", "Rattata", "Raticate",
  "Spearow", "Fearow", "Ekans", "Arbok", "Pikachu", "Raichu", "Sandshrew", "Sandslash", "Nidoran♀", "Nidorina",
  "Nidoqueen", "Nidoran♂", "Nidorino", "Nidoking", "Clefairy", "Clefable", "Vulpix", "Ninetales", "Jigglypuff", "Wigglytuff",
  "Zubat", "Golbat", "Oddish", "Gloom", "Vileplume", "Paras", "Parasect", "Venonat", "Venomoth", "Diglett",
  "Dugtrio", "Meowth", "Persian", "Psyduck", "Golduck", "Mankey", "Primeape", "Growlithe", "Arcanine", "Poliwag",
  "Poliwhirl", "Poliwrath", "Abra", "Kadabra", "Alakazam", "Machop", "Machoke", "Machamp", "Bellsprout", "Weepinbell",
  "Victreebel", "Tentacool", "Tentacruel", "Geodude", "Graveler", "Golem", "Ponyta", "Rapidash", "Slowpoke", "Slowbro",
  "Magnemite", "Magneton", "Farfetch'd", "Doduo", "Dodrio", "Seel", "Dewgong", "Grimer", "Muk", "Shellder",
  "Cloyster", "Gastly", "Haunter", "Gengar", "Onix", "Drowzee", "Hypno", "Krabby", "Kingler", "Voltorb",
  "Electrode", "Exeggcute", "Exeggutor", "Cubone", "Marowak", "Hitmonlee", "Hitmonchan", "Lickitung", "Koffing", "Weezing",
  "Rhyhorn", "Rhydon", "Chansey", "Tangela", "Kangaskhan", "Horsea", "Seadra", "Goldeen", "Seaking", "Staryu",
  "Starmie", "Mr. Mime", "Scyther", "Jynx", "Electabuzz", "Magmar", "Pinsir", "Tauros", "Magikarp", "Gyarados",
  "Lapras", "Ditto", "Eevee", "Vaporeon", "Jolteon", "Flareon", "Porygon", "Omanyte", "Omastar", "Kabuto",
  "Kabutops", "Aerodactyl", "Snorlax", "Articuno", "Zapdos", "Moltres", "Dratini", "Dragonair", "Dragonite", "Mewtwo",
  "Mew",
  // Gen 2
  "Chikorita", "Bayleef", "Meganium", "Cyndaquil", "Quilava", "Typhlosion", "Totodile", "Croconaw", "Feraligatr", "Sentret",
  "Furret", "Hoothoot", "Noctowl", "Ledyba", "Ledian", "Spinarak", "Ariados", "Crobat", "Chinchou", "Lanturn",
  "Pichu", "Cleffa", "Igglybuff", "Togepi", "Togetic", "Natu", "Xatu", "Mareep", "Flaaffy", "Ampharos",
  "Bellossom", "Marill", "Azumarill", "Sudowoodo", "Politoed", "Hoppip", "Skiploom", "Jumpluff", "Aipom", "Sunkern",
  "Sunflora", "Yanma", "Wooper", "Quagsire", "Espeon", "Umbreon", "Murkrow", "Slowking", "Misdreavus", "Unown",
  "Wobbuffet", "Girafarig", "Pineco", "Forretress", "Dunsparce", "Gligar", "Steelix", "Snubbull", "Granbull", "Qwilfish",
  "Scizor", "Shuckle", "Heracross", "Sneasel", "Teddiursa", "Ursaring", "Slugma", "Magcargo", "Swinub", "Piloswine",
  "Corsola", "Remoraid", "Octillery", "Delibird", "Mantine", "Skarmory", "Houndour", "Houndoom", "Kingdra", "Phanpy",
  "Donphan", "Porygon2", "Stantler", "Smeargle", "Tyrogue", "Hitmontop", "Smoochum", "Elekid", "Magby", "Miltank",
  "Blissey", "Raikou", "Entei", "Suicune", "Larvitar", "Pupitar", "Tyranitar", "Lugia", "Ho-Oh", "Celebi",
  // Gen 3
  "Treecko", "Grovyle", "Sceptile", "Torchic", "Combusken", "Blaziken", "Mudkip", "Marshtomp", "Swampert", "Poochyena",
  "Mightyena", "Zigzagoon", "Linoone", "Wurmple", "Silcoon", "Beautifly", "Cascoon", "Dustox", "Lotad", "Lombre",
  "Ludicolo", "Seedot", "Nuzleaf", "Shiftry", "Taillow", "Swellow", "Wingull", "Pelipper", "Ralts", "Kirlia",
  "Gardevoir", "Surskit", "Masquerain", "Shroomish", "Breloom", "Slakoth", "Vigoroth", "Slaking", "Nincada", "Ninjask",
  "Shedinja", "Whismur", "Loudred", "Exploud", "Makuhita", "Hariyama", "Azurill", "Nosepass", "Skitty", "Delcatty",
  "Sableye", "Mawile", "Aron", "Lairon", "Aggron", "Meditite", "Medicham", "Electrike", "Manectric", "Plusle",
  "Minun", "Volbeat", "Illumise", "Roselia", "Gulpin", "Swalot", "Carvanha", "Sharpedo", "Wailmer", "Wailord",
  "Numel", "Camerupt", "Torkoal", "Spoink", "Grumpig", "Spinda", "Trapinch", "Vibrava", "Flygon", "Cacnea",
  "Cacturne", "Swablu", "Altaria", "Zangoose", "Seviper", "Lunatone", "Solrock", "Barboach", "Whiscash", "Corphish",
  "Crawdaunt", "Baltoy", "Claydol", "Lileep", "Cradily", "Anorith", "Armaldo", "Feebas", "Milotic", "Castform",
  "Kecleon", "Shuppet", "Banette", "Duskull", "Dusclops", "Tropius", "Chimecho", "Absol", "Wynaut", "Snorunt",
  "Glalie", "Spheal", "Sealeo", "Walrein", "Clamperl", "Huntail", "Gorebyss", "Relicanth", "Luvdisc", "Bagon",
  "Shelgon", "Salamence", "Beldum", "Metang", "Metagross", "Regirock", "Regice", "Registeel", "Latias", "Latios",
  "Kyogre", "Groudon", "Rayquaza", "Jirachi", "Deoxys",
  // Gen 4
  "Turtwig", "Grotle", "Torterra", "Chimchar", "Monferno", "Infernape", "Piplup", "Prinplup", "Empoleon", "Starly",
  "Staravia", "Staraptor", "Bidoof", "Bibarel", "Kricketot", "Kricketune", "Shinx", "Luxio", "Luxray", "Budew",
  "Roserade", "Cranidos", "Rampardos", "Shieldon", "Bastiodon", "Burmy", "Wormadam", "Mothim", "Combee", "Vespiquen",
  "Pachirisu", "Buizel", "Floatzel", "Cherubi", "Cherrim", "Shellos", "Gastrodon", "Ambipom", "Drifloon", "Drifblim",
  "Buneary", "Lopunny", "Mismagius", "Honchkrow", "Glameow", "Purugly", "Chingling", "Stunky", "Skuntank", "Bronzor",
  "Bronzong", "Bonsly", "Mime Jr.", "Happiny", "Chatot", "Spiritomb", "Gible", "Gabite", "Garchomp", "Munchlax",
  "Riolu", "Lucario", "Hippopotas", "Hippowdon", "Skorupi", "Drapion", "Croagunk", "Toxicroak", "Carnivine", "Finneon",
  "Lumineon", "Mantyke", "Snover", "Abomasnow", "Weavile", "Magnezone", "Lickilicky", "Rhyperior", "Tangrowth", "Electivire",
  "Magmortar", "Togekiss", "Yanmega", "Leafeon", "Glaceon", "Gliscor", "Mamoswine", "Porygon-Z", "Gallade", "Probopass",
  "Dusknoir", "Froslass", "Rotom", "Uxie", "Mesprit", "Azelf", "Dialga", "Palkia", "Heatran", "Regigigas",
  "Giratina", "Cresselia", "Phione", "Manaphy", "Darkrai", "Shaymin", "Arceus",
  // Gen 5 (Unova)
  "Victini", "Snivy", "Servine", "Serperior", "Tepig", "Pignite", "Emboar", "Oshawott", "Dewott", "Samurott",
  "Patrat", "Watchog", "Lillipup", "Herdier", "Stoutland", "Purrloin", "Liepard", "Pansage", "Simisage", "Pansear",
  "Simisear", "Panpour", "Simipour", "Munna", "Musharna", "Pidove", "Tranquill", "Unfezant", "Blitzle", "Zebstrika",
  "Roggenrola", "Boldore", "Gigalith", "Woobat", "Swoobat", "Drilbur", "Excadrill", "Audino", "Timburr", "Gurdurr",
  "Conkeldurr", "Tympole", "Palpitoad", "Seismitoad", "Throh", "Sawk", "Sewaddle", "Swadloon", "Leavanny", "Venipede",
  "Whirlipede", "Scolipede", "Cottonee", "Whimsicott", "Petilil", "Lilligant", "Basculin", "Sandile", "Krokorok", "Krookodile",
  "Darumaka", "Darmanitan", "Maractus", "Dwebble", "Crustle", "Scraggy", "Scrafty", "Sigilyph", "Yamask", "Cofagrigus",
  "Tirtouga", "Carracosta", "Archen", "Archeops", "Trubbish", "Garbodor", "Zorua", "Zoroark", "Minccino", "Cinccino",
  "Gothita", "Gothorita", "Gothitelle", "Solosis", "Duosion", "Reuniclus", "Ducklett", "Swanna", "Vanillite", "Vanillish",
  "Vanilluxe", "Deerling", "Sawsbuck", "Emolga", "Karrablast", "Escavalier", "Foongus", "Amoonguss", "Frillish", "Jellicent",
  "Alomomola", "Joltik", "Galvantula", "Ferroseed", "Ferrothorn", "Klink", "Klang", "Klinklang", "Tynamo", "Eelektrik",
  "Eelektross", "Elgyem", "Beheeyem", "Litwick", "Lampent", "Chandelure", "Axew", "Fraxure", "Haxorus", "Cubchoo",
  "Beartic", "Cryogonal", "Shelmet", "Accelgor", "Stunfisk", "Mienfoo", "Mienshao", "Druddigon", "Golett", "Golurk",
  "Pawniard", "Bisharp", "Bouffalant", "Rufflet", "Braviary", "Vullaby", "Mandibuzz", "Heatmor", "Durant", "Deino",
  "Zweilous", "Hydreigon", "Larvesta", "Volcarona", "Cobalion", "Terrakion", "Virizion", "Tornadus", "Thundurus", "Reshiram",
  "Zekrom", "Landorus", "Kyurem", "Keldeo", "Meloetta", "Genesect",
  // Gen 6 (Kalos)
  "Chespin", "Quilladin", "Chesnaught", "Fennekin", "Braixen", "Delphox", "Froakie", "Frogadier", "Greninja", "Bunnelby",
  "Diggersby", "Fletchling", "Fletchinder", "Talonflame", "Scatterbug", "Spewpa", "Vivillon", "Litleo", "Pyroar", "Flabébé",
  "Floette", "Florges", "Skiddo", "Gogoat", "Pancham", "Pangoro", "Furfrou", "Espurr", "Meowstic", "Honedge",
  "Doublade", "Aegislash", "Spritzee", "Aromatisse", "Swirlix", "Slurpuff", "Inkay", "Malamar", "Binacle", "Barbaracle",
  "Skrelp", "Dragalge", "Clauncher", "Clawitzer", "Helioptile", "Heliolisk", "Tyrunt", "Tyrantrum", "Amaura", "Aurorus",
  "Sylveon", "Hawlucha", "Dedenne", "Carbink", "Goomy", "Sliggoo", "Goodra", "Klefki", "Phantump", "Trevenant",
  "Pumpkaboo", "Gourgeist", "Bergmite", "Avalugg", "Noibat", "Noivern", "Xerneas", "Yveltal", "Zygarde", "Diancie",
  "Hoopa", "Volcanion",
  // Gen 7 (Alola)
  "Rowlet", "Dartrix", "Decidueye", "Litten", "Torracat", "Incineroar", "Popplio", "Brionne", "Primarina", "Pikipek",
  "Trumbeak", "Toucannon", "Yungoos", "Gumshoos", "Grubbin", "Charjabug", "Vikavolt", "Crabrawler", "Crabominable", "Oricorio",
  "Cutiefly", "Ribombee", "Rockruff", "Lycanroc", "Wishiwashi", "Mareanie", "Toxapex", "Mudbray", "Mudsdale", "Dewpider",
  "Araquanid", "Fomantis", "Lurantis", "Morelull", "Shiinotic", "Salandit", "Salazzle", "Stufful", "Bewear", "Bounsweet",
  "Steenee", "Tsareena", "Comfey", "Oranguru", "Passimian", "Wimpod", "Golisopod", "Sandygast", "Palossand", "Pyukumuku",
  "Type: Null", "Silvally", "Minior", "Komala", "Turtonator", "Togedemaru", "Mimikyu", "Bruxish", "Drampa", "Dhelmise",
  "Jangmo-o", "Hakamo-o", "Kommo-o", "Tapu Koko", "Tapu Lele", "Tapu Bulu", "Tapu Fini", "Cosmog", "Cosmoem", "Solgaleo",
  "Lunala", "Nihilego", "Buzzwole", "Pheromosa", "Xurkitree", "Celesteela", "Kartana", "Guzzlord", "Necrozma", "Magearna",
  "Marshadow", "Poipole", "Naganadel", "Stakataka", "Blacephalon", "Zeraora", "Meltan", "Melmetal",
  // Gen 8 (Galar)
  "Grookey", "Thwackey", "Rillaboom", "Scorbunny", "Raboot", "Cinderace", "Sobble", "Drizzile", "Inteleon", "Skwovet",
  "Greedent", "Rookidee", "Corvisquire", "Corviknight", "Blipbug", "Dottler", "Orbeetle", "Nickit", "Thievul", "Gossifleur",
  "Eldegoss", "Wooloo", "Dubwool", "Chewtle", "Drednaw", "Yamper", "Boltund", "Rolycoly", "Carkol", "Coalossal",
  "Applin", "Flapple", "Appletun", "Silicobra", "Sandaconda", "Cramorant", "Arrokuda", "Barraskewda", "Toxel", "Toxtricity",
  "Sizzlipede", "Centiskorch", "Clobbopus", "Grapploct", "Sinistea", "Polteageist", "Hatenna", "Hattrem", "Hatterene", "Impidimp",
  "Morgrem", "Grimmsnarl", "Obstagoon", "Perrserker", "Cursola", "Sirfetch’d", "Mr. Rime", "Runerigus", "Milcery", "Alcremie",
  "Falinks", "Pincurchin", "Snom", "Frosmoth", "Stonjourner", "Eiscue", "Indeedee", "Morpeko", "Cufant", "Copperajah",
  "Dracozolt", "Arctozolt", "Dracovish", "Arctovish", "Duraludon", "Dreepy", "Drakloak", "Dragapult", "Zacian", "Zamazenta",
  "Eternatus", "Kubfu", "Urshifu", "Zarude", "Regieleki", "Regidrago", "Glastrier", "Spectrier", "Calyrex", "Wyrdeer",
  "Kleavor", "Ursaluna", "Basculegion", "Sneasler", "Overqwil", "Enamorus",
  // Gen 9 (Paldea)
  "Sprigatito", "Floragato", "Meowscarada", "Fuecoco", "Crocalor", "Skeledirge", "Quaxly", "Quaxwell", "Quaquaval", "Lechonk",
  "Oinkologne", "Tarountula", "Spidops", "Nymble", "Lokix", "Pawmi", "Pawmo", "Pawmot", "Tandemaus", "Maushold",
  "Fidough", "Dachsbun", "Smoliv", "Dolliv", "Arboliva", "Squawkabilly", "Nacli", "Naclstack", "Garganacl", "Charcadet",
  "Armarouge", "Ceruledge", "Tadbulb", "Bellibolt", "Wattrel", "Kilowattrel", "Maschiff", "Mabosstiff", "Shroodle", "Grafaiai",
  "Bramblin", "Brambleghast", "Toedscool", "Toedscruel", "Klawf", "Capsakid", "Scovillain", "Rellor", "Rabsca", "Flittle",
  "Espathra", "Tinkatink", "Tinkatuff", "Tinkaton", "Wiglett", "Wugtrio", "Bombirdier", "Finizen", "Palafin", "Varoom",
  "Revavroom", "Cyclizar", "Orthworm", "Glimmet", "Glimmora", "Greavard", "Houndstone", "Flamigo", "Cetoddle", "Cetitan",
  "Veluza", "Dondozo", "Tatsugiri", "Annihilape", "Clodsire", "Farigiraf", "Dudunsparce", "Kingambit", "Great Tusk", "Scream Tail",
  "Brute Bonnet", "Flutter Mane", "Slither Wing", "Sandy Shocks", "Iron Treads", "Iron Bundle", "Iron Hands", "Iron Jugulis", "Iron Moth", "Iron Thorns",
  "Frigibax", "Arctibax", "Baxcalibur", "Gimmighoul", "Gholdengo", "Wo-Chien", "Chien-Pao", "Ting-Lu", "Chi-Yu", "Roaring Moon",
  "Iron Valiant", "Koraidon", "Miraidon", "Walking Wake", "Iron Leaves", "Dipplin", "Poltchageist", "Sinistcha", "Okidogi", "Munkidori",
  "Fezandipiti", "Ogerpon", "Archaludon", "Hydrapple", "Gouging Fire", "Raging Bolt", "Iron Boulder", "Iron Crown", "Terapagos", "Pecharunt",
];

// Legendary and mythical Pokémon are left out of every pool.
// Gen 1: Articuno, Zapdos, Moltres, Mewtwo, Mew. Gen 2: Raikou, Entei, Suicune, Lugia, Ho-Oh, Celebi.
// Gen 3: Regirock, Regice, Registeel, Latias, Latios, Kyogre, Groudon, Rayquaza, Jirachi, Deoxys.
// Gen 4: Uxie, Mesprit, Azelf, Dialga, Palkia, Heatran, Regigigas, Giratina, Cresselia, Phione,
//        Manaphy, Darkrai, Shaymin, Arceus. Gen 5–9: every species PokéAPI marks legendary or mythical.
const LEGENDARIES = new Set([
  144, 145, 146, 150, 151,
  243, 244, 245, 249, 250, 251,
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493,
  // Gen 5–9
  494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648,
  649, 716, 717, 718, 719, 720, 721, 772, 773, 785, 786, 787,
  788, 789, 790, 791, 792, 800, 801, 802, 807, 808, 809, 888,
  889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905, 1001,
  1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017, 1024, 1025,
]);

// Draft pools. Each generation is drafted on its own; "all" mixes every generation.
const GENERATIONS = {
  1: { pool: "the original 150 Pokémon", poolLegends: "all 151 original Pokémon" },
  2: { pool: "the 100 Gen 2 Pokémon" },
  3: { pool: "the 135 Gen 3 Pokémon" },
  4: { pool: "the 107 Gen 4 Pokémon" },
  5: { pool: "the 156 Gen 5 Pokémon" },
  6: { pool: "the 72 Gen 6 Pokémon" },
  7: { pool: "the 88 Gen 7 Pokémon" },
  8: { pool: "the 96 Gen 8 Pokémon" },
  9: { pool: "the 120 Gen 9 Pokémon" },
  all: { pool: "every Pokémon from Gen 1–9" },
};
const DEFAULT_GEN = "1";
// Last National Dex number of each generation.
const GEN_ENDS = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
const genOf = (id) => String(GEN_ENDS.findIndex((end) => id <= end) + 1);

// Every species, flagged when Legendary or Mythical. The builder leaves those out unless they're
// switched on; the 17–0 Challenge always has them.
const ALL_POKEMON = POKEMON_NAMES.map((name, i) => ({ id: i + 1, name, gen: genOf(i + 1), legendary: LEGENDARIES.has(i + 1) }));
const nameOf = (id) => POKEMON_NAMES[id - 1];
const POKEMON_BY_ID = new Map(ALL_POKEMON.map((p) => [p.id, p]));

// Builder pools by generation ("1"–"9" and "all"): POOLS.plain leaves Legendaries out, POOLS.legends
// has everyone.
const POOLS = { plain: { all: ALL_POKEMON.filter((p) => !p.legendary) }, legends: { all: ALL_POKEMON } };
for (let g = 1; g <= GEN_ENDS.length; g++) {
  for (const kind of ["plain", "legends"]) POOLS[kind][g] = POOLS[kind].all.filter((p) => p.gen === String(g));
}

// Sprites are served from this site (copied from the PokéAPI sprites repo):
//   pixel/  versions/generation-iii/firered-leafgreen/ (Gen 1–3), versions/generation-iv/platinum/ (Gen 4),
//           versions/generation-v/black-white/ (Gen 5–9, Black/White-style)
//   retro/  versions/generation-ii/crystal/transparent/ (Gen 1–2 only)
//   art/    other/official-artwork/
//   icons/  default front sprites (picker thumbnails in Artwork mode)
const SPRITE_BASE = "sprites";

const SPRITE_STYLES = {
  pixel: { label: "Pixel", pixelated: true },
  retro: { label: "Retro", pixelated: true, gens: ["1", "2"] }, // Crystal sprites stop at Gen 2
  art: { label: "Artwork", pixelated: false },
};
const DEFAULT_STYLE = "pixel";
// Styles without a `gens` list cover every pool.
const styleCovers = (style, gen) => !SPRITE_STYLES[style].gens || SPRITE_STYLES[style].gens.includes(gen);

// Which way each sprite faces as drawn: one character per dex number (1–1025; Retro 1–251)
// (L = toward the image's left, R = toward its right, F = straight ahead).
const SPRITE_FACING = {
  pixel:
    "LLFLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFLLFFLLLLLLLLLLLLLLFLLLLLLFLLLLLLFLLRLLFFLFLLLLLLLFLLRLLLFLFFLLLRLLFLLLLLLLLLLFFRLLLLFLLLLFLLLLLLLFLLLLLLLLLLLLLLLLLLLLLLLLLLFLLLLLLLLLLLLLLFLLFLLLLFLLLLLLLLLRFLLLLLFLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLRLLLLLLLLLLLLLLLLLLLLLLLLLLLRLLLRLLLLFRRLLLLLLLLLLLLLLLLLLLLRLLLFLLRLLLFLLLLLLLLLLLLLLLLFFLLLLLLLLLLLFFLLLLLLLLLLLLLLLFLLLLFLLLLLLLLLFFFFRLLLLFFLLLLLLLLLRLLLLRRLLLFRLLLLFLLLLLLLLFLLLLLLLLLLLFLRFFLLLLFLLLLLLLLFLRLLLLLLLRLLLLLLLLLLLLLRRLRLRFLLLFFFLLFFLLRLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFLLLLLLLFLLLLLLLLLLRLLFFFLLRLLLFLLLLFRLLLLLFFLLLLRFFLLFLLFFFLLLFLFFLLLLLLFFFFLLLLLFFFLLLLLFLLLLLLLFLLLLLLRLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFLLLLLLLRLLFLFFFLLLLLFFFLLLLLLLLLLLLLFLLLFLFLFLLFLLLLLLLLFLLLLLLLLLLLLLLLLFLLLLLLLFLLLLFLFLLLLLLLLLLLLLLLLLLFLRLLLLFLLLLLFLLFLFFLFFFFFLLLLLLFLLLLLLLLLLLLLLLLLLLLLLLFLLLLLLLLLFLLLLLLLLLLLLLFLLLLLLLLLFLLLLLLLLLFLLLLLLLLLLLLLLLLLLLFLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFLLLLRLFLLLLLLLLLLLFLLLLFLLLLLLLLLLRLLLLLLLLLRLLLLLLLLLLLLLFLLLLFLLLLLFLRLLLRLLLLFFLLLLLLLLLLLLL",
  retro:
    "LLLLLLLLLLRLLRLLLLLLLLLFLLLLLLLLLLLLLLLLFFFFFFLFLLLLFLLFLLLLFFLFFLLFLLLLRLLLLLLLFFLLLLLLLLLFLFLLLLLLFRFLLRLLLLLLFLLLLLLFFLLLLLLFLLLFFLLLLLLLLLLLLLLLLFLLLRLRLLLLLLLFLLLLFFLLLFFLLLLLLFLLFLLFFFLFLLLLRLFRFFLFFLFLLFFLLLLLFLLLLLLLLLLLLLLLLLLLFFLLLLLLLRLLLFL",
  art:
    "LRFLLLLLRLRFLLLLLRLLLLLLLFLRLLLLLLLFLLFFFLLFFLLRFLFFLLLFLLLLRFLRFRLLLLLLFFFLLLLFFFLFLLLLLLLLLLLRLFFRFFLLLRLLFFLLFFLLLRLFFLLFLLFLLLLFLFLLLRFLLLFLFRRLLFFLLLRRLLLLLLFLLLLLRLLFRLLLLLLLLLRFFLLLLLLLLRLLRLLRLFLFFLFLFRRRRLLLLLLLLRLLLLLLRLLLRLLLRLLLRRLLLLRLLRLLLLLLRLRLLLLLLLLRRLRLLLLLLLLLLLFLLLLLLLLLRLLLRLRLLLRLLLLFLLLLLFLRRLLLLLLLLLLRLLLLLLLLLLLLLLLFFLFLLLLLLFLLLLLLFLLRLLLLLLLLLLFFFFFLLLRLFFLLLLLLRLLLLLLLLFRLLFLRRLLLFLLFLLLLFLFFLLLLLLLFLLLFFLLLLFLLLRLLLLFLLLFLLLLFFLLLFFLLLLRFLLLLRLRLFRRLFFFRFFFLLLLRLRLLLLLLLLLLLLFFLFRRLLLLLRLLFLFLLRFRLLFFFRLLLLLRLLFFFLLRLLLLLLFLFFFLLLLLFLLLFLRLLLFRLLFLLLLFLLLLRLLLLLFFFLLLRLFFLLLLLLFLRLLLLFFRLLLLLRLLLLLLLLLRLRRLFLLLLLLFLLLFLLLFLLLLLFLFLFLLLLLLFRFFFLRLFFLFFLLLLLLRLLLLLFFLRLFFFLFLLLLRLLFFLLFFLLLRRLLLLLRLLFFFRLLLLLFFLRFRFLLFLRLFFFFLLLRLFLLRLFLRFFLLFLLLFFLRFFRFFLFFFFFLLFLLFFLRRRLLLRFLLLFFRLRLRLRLFFRRLLRLLRLFLLLRRLLLLRLLLRFLFFLLLRRFLRLFFLLRRFLFFRLLLLLLLLLRLLFLRLFLLLLRRLLLRFLLLLLFRRLRLRLLFLLFFLLFRLLLLLLRLLLLLLLLLFFLLLLFLFRLLLLLFLLLLLRLRRLLLLLLLRFLRLFLLLLLLRFFLLLLLLFFLRRLLFRLLLFLLLFRLRLLLRRLL",
};
const spriteFacing = (style, id) => (SPRITE_FACING[style] || "")[id - 1] || "F";

// Official Pokédex heights in decimeters, index = dex number - 1 (source: PokéAPI data).
const HEIGHT_DM = [7,10,20,6,11,17,5,10,16,3,7,11,3,6,10,3,11,15,3,7,3,12,20,35,4,8,6,10,4,8,13,5,9,14,6,13,6,11,5,10,8,16,5,8,12,3,10,10,15,2,7,4,10,8,17,5,10,7,19,6,10,13,9,13,15,8,15,16,7,10,17,9,16,4,10,14,10,17,12,16,3,10,8,14,18,11,17,9,12,3,15,13,16,15,88,10,16,4,13,5,12,4,20,4,10,15,14,12,6,12,10,19,11,10,22,4,12,6,13,8,11,13,15,14,11,13,15,14,9,65,25,3,3,10,8,9,8,4,10,5,13,18,21,17,16,20,18,40,22,20,4,
  9,12,18,5,9,17,6,11,23,8,18,7,16,10,14,5,11,18,5,12,3,3,3,3,6,2,15,6,8,14,4,4,8,12,11,4,6,8,8,3,8,12,4,14,9,10,5,20,7,5,13,15,6,12,15,11,92,6,14,5,18,6,15,9,6,18,7,8,4,11,6,6,9,9,21,17,6,14,18,5,11,6,14,12,7,14,4,6,7,12,15,19,21,20,6,12,20,52,38,6,
  5,9,17,4,9,19,4,7,15,5,10,4,5,3,6,10,7,12,5,12,15,5,10,13,3,7,6,12,4,8,16,5,8,4,12,8,14,20,5,8,8,6,10,15,10,23,2,10,6,11,5,6,4,9,21,6,13,6,15,4,4,7,6,3,4,17,8,18,20,145,7,19,5,7,9,11,7,11,20,4,13,4,11,13,27,10,12,4,9,6,11,5,15,10,15,7,15,6,62,3,10,6,11,8,16,20,6,12,6,7,15,8,11,14,4,17,18,10,6,6,11,15,6,12,16,17,18,19,14,20,45,35,70,3,17,4,11,22,5,9,12,4,8,17,3,6,12,5,10,3,10,5,9,14,2,9,9,16,5,13,2,5,9,3,12,4,7,11,4,5,3,9,12,4,12,4,12,9,9,5,10,2,4,10,5,13,5,6,6,5,10,7,14,19,6,7,12,8,20,8,13,7,13,14,4,12,10,10,22,11,12,17,24,20,18,16,15,19,10,8,20,25,9,16,14,22,13,3,3,3,3,54,42,17,37,45,15,4,3,15,2,32,
  4,6,8,33,5,10,16,5,8,15,5,11,4,9,12,4,11,6,11,6,10,6,10,6,11,3,6,12,8,16,4,9,17,4,9,3,7,11,6,12,14,5,8,15,13,14,3,5,12,4,12,25,3,7,5,11,10,7,10,15,6,13,10,3,14,6,11,14,5,17,7,12,5,14,6,19,7,16,4,5,4,7,15,3,6,10,5,13,4,11,13,6,19,4,5,10,2,6,12,22,12,1,8,6,10,3,6,6,2,12,21,5,10,3,6,10,6,10,18,5,26,11,4,8,7,9,14,16,10,28,5,16,16,5,15,5,12,14,3,8,14,18,11,16,21,19,20,15,15,32,29,15,30,14,6,15,4,7,16,4,10,15,3,6,15,4,10,3,7,12,3,3,12,6,15,1,2,11,9,17,6,21,12,3,6,8,8,17,2,8,4,8,4,15,5,13,5,18,5,13,5,10,8,25,13,27,10,8,2,3,3,8,20,2,4,15,4,9,10,20,5,15,30,58,50,7,5,17,3,7,16,4,7,18,4,6,18,3,6,11,4,7,4,5,15,6,17,6,1,2,5,8,2,4,7,10,25,3,18,3,9,2,10,6,12,5,21,3,7,12,1,15,20,5,20,5,13,3,19,23,3,4,20,3,2,9,30,39,6,12,16,18,12,19,13,2,1,34,40,12,24,18,38,92,3,55,24,10,7,6,36,55,18,15,2,25,3,7,21,3,6,14,3,7,19,3,6,2,8,22,4,4,4,6,12,4,5,6,13,3,10,3,10,3,11,28,2,3,4,22,38,8,5,13,4,16,7,30,6,16,1,2,4,6,21,4,8,15,16,8,10,8,15,16,2,3,30,3,3,13,25,14,9,3,12,30,18,23,23,20,18,5,14,30,28,29,200,6,19,18,12,21,22,20,11,18,18,24,30,13,25,16,4,9,15,4,10,16,5,12,18,5,10,3,10,2,10,3,4,9,3,3,3,5,3,6,14,6,4,6,23,6,15,16,3,12,4,14,5,11,2,7,6,12,9,19,13,3,9,2,3,2,19,4,7,7,12,12,15,13,13,10,18,16,25,7,15,6,20,16,12,45,25,120,3,12,18,32,36,20,22,12,12,14,32,23,9,6,18,13,12,16,5,8,21,3,12,15,19,27,4,20,14,25,35,35,15,4,1,2,18,10,14,12,20,18,35,52,15,16,2,3];
// How big a Pokémon is drawn relative to its slot: a gentle nod to real height so bigger
// species read as bigger (Kabutops 1.3 m > Metapod 0.7 m) while small ones stay easy to see.
// 1.6 m fills the slot exactly.
const sizeFactor = (id) => Math.min(1.05, Math.max(0.7, (HEIGHT_DM[id - 1] / 16) ** 0.3));

const spriteUrl = (style, id) => `${SPRITE_BASE}/${style}/${id}.png`;
// Picker thumbnails: full artwork is too heavy for 146 tiles, so Artwork mode uses the small default sprites.
const iconUrl = (style, id) => (style === "art" ? `${SPRITE_BASE}/icons/${id}.png` : spriteUrl(style, id));
// Shiny sprites: each set's shiny counterpart from the same sources (their shiny/ folders), id for id, in
// shiny/<style>/; the artwork as WebP.
const shinyUrl = (style, id) => `${SPRITE_BASE}/shiny/${style}/${id}.${style === "art" ? "webp" : "png"}`;
const shinyIconUrl = (style, id) => (style === "art" ? `${SPRITE_BASE}/shiny/icons/${id}.png` : shinyUrl(style, id));

// ---------- This edition ----------
// app.js reads the roster, pictures, starting lineups and these details from this file.
const EDITION = {
  key: "pokemon-all22", // saved-data prefix
  title: "Pokémon All-22 Builder",
  unit: "Pokémon", // "Defense: pick a Pokémon"
  units: "Pokémon", // "No Pokémon match that search."
  fileName: (gen) => (gen === "1" ? "pokemon-all-22.jpg" : gen === "all" ? "pokemon-all-22-all-gens.jpg" : `pokemon-all-22-gen${gen}.jpg`),
};
const ROSTER_BY_ID = POKEMON_BY_ID;

// Starting lineups: Gen 1 is the tweet's lineup; Gen 2–9 are our own take on it; All starts
// from the classic Gen 1 lineup. K is the kicker, shown when the kicker is switched on.
const DEFAULT_LINEUPS = {
  1: {
    S1: 82, S2: 105, CB1: 123, OLB1: 57, ILB1: 24, ILB2: 62, OLB2: 28, CB2: 141,
    DE1: 68, NT: 143, DE2: 67,
    WR1: 135, LT: 9, LG: 76, C: 3, RG: 89, RT: 115, TE: 34, WR2: 85,
    QB: 94, FB: 128, HB: 112, K: 106,
  },
  2: {
    S1: 164, S2: 178, CB1: 212, OLB1: 229, ILB1: 210, ILB2: 181, OLB2: 227, CB2: 215,
    DE1: 214, NT: 248, DE2: 237,
    WR1: 169, LT: 208, LG: 205, C: 154, RG: 202, RT: 217, TE: 160, WR2: 196,
    QB: 157, FB: 241, HB: 232, K: 236,
  },
  3: {
    S1: 344, S2: 373, CB1: 291, OLB1: 335, ILB1: 336, ILB2: 342, OLB2: 359, CB2: 348,
    DE1: 286, NT: 289, DE2: 308,
    WR1: 310, LT: 321, LG: 297, C: 376, RG: 317, RT: 323, TE: 306, WR2: 277,
    QB: 257, FB: 295, HB: 260, K: 256,
  },
  4: {
    S1: 462, S2: 468, CB1: 469, OLB1: 461, ILB1: 472, ILB2: 452, OLB2: 430, CB2: 392,
    DE1: 466, NT: 473, DE2: 467,
    WR1: 405, LT: 450, LG: 411, C: 389, RG: 476, RT: 460, TE: 445, WR2: 398,
    QB: 448, FB: 409, HB: 464, K: 428,
  },
  5: {
    S1: 628, S2: 635, CB1: 510, OLB1: 560, ILB1: 534, ILB2: 553, OLB2: 625, CB2: 617,
    DE1: 612, NT: 526, DE2: 555,
    WR1: 523, LT: 558, LG: 598, C: 623, RG: 565, RT: 614, TE: 503, WR2: 571,
    QB: 497, FB: 500, HB: 530, K: 620,
  },
  6: {
    S1: 655, S2: 700, CB1: 715, OLB1: 687, ILB1: 709, ILB2: 660, OLB2: 691, CB2: 676,
    DE1: 652, NT: 713, DE2: 675,
    WR1: 663, LT: 697, LG: 681, C: 689, RG: 706, RT: 699, TE: 693, WR2: 695,
    QB: 658, FB: 673, HB: 668, K: 701,
  },
  7: {
    S1: 724, S2: 733, CB1: 743, OLB1: 766, ILB1: 794, ILB2: 754, OLB2: 778, CB2: 741,
    DE1: 784, NT: 750, DE2: 768,
    WR1: 758, LT: 781, LG: 776, C: 770, RG: 740, RT: 780, TE: 727, WR2: 795,
    QB: 730, FB: 760, HB: 745, K: 763,
  },
  8: {
    S1: 823, S2: 858, CB1: 847, OLB1: 862, ILB1: 901, ILB2: 870, OLB2: 865, CB2: 828,
    DE1: 900, NT: 874, DE2: 903,
    WR1: 887, LT: 879, LG: 880, C: 839, RG: 882, RT: 881, TE: 861, WR2: 836,
    QB: 818, FB: 834, HB: 812, K: 815,
  },
  9: {
    S1: 956, S2: 962, CB1: 945, OLB1: 943, ILB1: 984, ILB2: 916, OLB2: 920, CB2: 964,
    DE1: 983, NT: 975, DE2: 998,
    WR1: 941, LT: 977, LG: 934, C: 968, RG: 966, RT: 980, TE: 979, WR2: 923,
    QB: 908, FB: 911, HB: 967, K: 914,
  },
};
DEFAULT_LINEUPS.all = { ...DEFAULT_LINEUPS[1] };
