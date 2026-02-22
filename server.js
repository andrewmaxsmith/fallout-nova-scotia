const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;
const SAVE_FILE_PATH = path.join(__dirname, 'game-state.json');
const SAVE_DEBOUNCE_MS = 500;

let saveTimeout = null;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'gm-dashboard.html'));
});

app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true });
});

// Game state
let gameState = {
    players: {
        logan: {
            name: 'Logan',
            level: 1,
            hp: 10,
            maxHp: 10,
            rads: 0,
            tabs: 10,
            stats: { charm: 1, hardiness: 1, agility: 1, perception: 1, politeness: 1, yarns: 1 },
            scrap: { wood: 0, steel: 0, circuit: 0, adhesive: 0 },
            inventory: [],
            activeQuests: [],
            completedQuests: [],
            activeRadio: null,
            activeRadioData: null,
            faction: null,
            class: null,
            unlockedPerks: [],
            purchasedUpgrades: []
        },
        rylyn: {
            name: 'Rylyn',
            level: 1,
            hp: 10,
            maxHp: 10,
            rads: 0,
            tabs: 10,
            stats: { charm: 1, hardiness: 1, agility: 1, perception: 1, politeness: 1, yarns: 1 },
            scrap: { maritimeMetal: 0, syntheticSap: 0, hubCircuitry: 0, plaidScraps: 0, propaneTank: 0, radMeat: 0, spices: 0, cleanWater: 0 },
            inventory: [],
            activeQuests: [],
            completedQuests: [],
            activeRadio: null,
            activeRadioData: null,
            faction: null,
            class: null,
            unlockedPerks: [],
            purchasedUpgrades: []
        }
    },
    perks: [
        { id: 'p1', name: "IRON CALVES", desc: "Climbing Jacob's Ladder no longer causes HP loss.", level: 1 },
        { id: 'p2', name: "AQUA-BLUENOSER", desc: "Immune to Radiation while at the shoreline.", level: 1 },
        { id: 'p3', name: "THRIFTY TOWNIE", desc: "Gain 2 extra Pop Tabs from every quest.", level: 2 },
        { id: 'p4', name: "DONAIR DIGESTION", desc: "Healing items (snacks) restore double HP.", level: 1 },
        { id: 'p5', name: "SCRAPPER", desc: "50% chance to find double scrap items.", level: 2 },
        { id: 'p6', name: "LEAD BELLY", desc: "Eating 'Red Mud' food causes 0 Radiation.", level: 1 },
        { id: 'p7', name: "WASTELAND WAND", desc: "+1 Agility on trails and outdoor areas.", level: 2 },
        { id: 'p8', name: "SCAVENGER'S EYE", desc: "+1 Perception for finding hidden items.", level: 3 },
        { id: 'p9', name: "PLAID PRIDE", desc: "+2 Charisma with faction members.", level: 2 },
        { id: 'p10', name: "QUICK-HANDS", desc: "+10% attack speed with melee weapons.", level: 3 }
    ],
    quests: [
        { id: 'h1', title: "VAULT: Sanitize Quarters", desc: "Clean your room until no scrap remains on the floor.", reward: 10, xp: 1 },
        { id: 'h2', title: "VAULT: Nutrient Synthesis", desc: "Assist the Overseer with preparing a family meal.", reward: 15, xp: 1 },
        { id: 'h3', title: "VAULT: Static Discharge", desc: "Fold and put away a basket of clean laundry.", reward: 10, xp: 1 },
        { id: 'q1', title: "Initiation: Jacob's Ladder", desc: "Climb the stairs at Victoria Park.", reward: 15, xp: 1 },
        { id: 'q2', title: "The Great Drain", desc: "Visit Burncoat Head at low tide.", reward: 20, xp: 1 },
        { id: 'q5', title: "Jacob's Ladder Trial", desc: "Complete the brutal 175 step challenge without falling.", reward: 50, xp: 2 },
        { id: 'q6', title: "Witches' Cauldron Mystery", desc: "Dive into the radioactive pool and retrieve the pre-war crate.", reward: 45, xp: 2 },
        { id: 'q11', title: "Battle for the Bazaar", desc: "Defend Masstown Market from Highway 104 Raiders.", reward: 100, xp: 3 },
        { id: 'q12', title: "The Tidal Bore Race", desc: "Gather all Scrap and Supplies and return to safety before the 5-minute tide rush!", reward: 50, xp: 2 },
        { id: 'q13', title: "The Plaid Patch-Up", desc: "Find Plaid Scrap and use Synthetic Sap to patch the Vault air-lock before the next Rad-Storm.", reward: 35, xp: 1 },
        { id: 'q14', title: "Three-Crows Signal Boost", desc: "One player stands at the Highest Peak for 60 seconds while the other tunes the Pip-Boy. Recite the Wasteland Oath!", reward: 20, xp: 1 },
        { id: 'q15', title: "The Junk-Jet Prototype", desc: "Collect 5 pieces of Scrap from different Biomes and justify each one to the Overseer.", reward: 60, xp: 2 },
        { id: 'q16', title: "Five Islands Provincial Park (The Great Drain)", desc: "Master the Mud-Slog and survive the Tidal Rush at the Great Drain.", reward: 55, xp: 2 },
        { id: 'q17', title: "Shubenacadie Wildlife Park (The Beast Pens)", desc: "Scout the perimeter and photograph three Wasteland Creatures without startling them.", reward: 50, xp: 2 }
    ],
    randomQuests: [
        { id: 'rq1', title: "HOUSE: Tidy the Living Room", desc: "Pick up toys and organize the space.", reward: 5, xp: 0 },
        { id: 'rq2', title: "HOUSE: Wash the Dishes", desc: "Clean and rinse all dishes in the sink.", reward: 5, xp: 0 },
        { id: 'rq3', title: "HOUSE: Make Your Bed", desc: "Pull covers tight and arrange pillows.", reward: 5, xp: 0 },
        { id: 'rq4', title: "HOUSE: Sweep the Kitchen", desc: "Clear crumbs and debris from the floor.", reward: 5, xp: 0 },
        { id: 'rq5', title: "CRAFT: Build a Lego Structure", desc: "Create and complete any Lego model.", reward: 8, xp: 0 },
        { id: 'rq6', title: "CRAFT: Draw or Paint", desc: "Create a piece of art and show it off.", reward: 8, xp: 0 },
        { id: 'rq7', title: "CRAFT: Assemble a Model", desc: "Build something cool from a kit.", reward: 10, xp: 0 },
        { id: 'rq8', title: "SPORT: Play Soccer in the Yard", desc: "Get some exercise kicking the ball.", reward: 8, xp: 0 },
        { id: 'rq9', title: "SPORT: Go for a Bike Ride", desc: "Ride your bike around the neighborhood.", reward: 10, xp: 0 },
        { id: 'rq10', title: "SPORT: Play Catch", desc: "Toss a ball back and forth.", reward: 5, xp: 0 },
        { id: 'rq11', title: "CHORE: Fold Laundry", desc: "Sort and fold clean clothes.", reward: 5, xp: 0 },
        { id: 'rq12', title: "CHORE: Take Out Trash", desc: "Empty the bins and replace bags.", reward: 5, xp: 0 },
        { id: 'rq13', title: "CHORE: Organize Closet", desc: "Sort and arrange your belongings.", reward: 8, xp: 0 }
    ],
    radioSignals: [
        { id: 'r1', title: "ENTERING DEBERT", text: "You're treadin' on ancient ground now, scavengers. Debert awaits." },
        { id: 'r2', title: "THE HERMIT'S LAST WORDS", text: "Eyes like burning pitch... it walks the northern woods..." },
        { id: 'r3', title: "DEBERT NUMBERS STATION", text: "[SYNTHESIZED VOICE] Coordinates: North 45.3471 West 63.2851..." },
        { id: 'r4', title: "THE MASTODON'S CALL", text: "[DEAFENING RUMBLE] The Awakening approaches..." },
        { id: 'r5', title: "TIDAL BORE WARNING", text: "ALERT! The Tidal Bore is moving... 5 minutes until the surge. All units retreat to high ground NOW!" },
        { id: 'r6', title: "PLAID PATCH ALERT", text: "Vault integrity compromised. Air-lock seal has failed. Patch required immediately. Plaid Scrap + Synthetic Sap needed." },
        { id: 'r7', title: "SIGNAL BOOST REQUEST", text: "Three-Crows Radio fading... signal weakening. We need a Signal Flare at the Highest Peak. Someone hold the light!" },
        { id: 'r8', title: "JUNK-JET BROADCAST", text: "Prototype testing in progress. Scrap collectors needed. Bring us 5 pieces from different Biomes for analysis." },
        { id: 'r9', title: "GREAT DRAIN LOCATION", text: "Coordinates locked: Five Islands Provincial Park. Beware the Red Mud. The Tidal Rush is unpredictable. Proceed with caution." },
        { id: 'r10', title: "BEAST PENS SIGHTING", text: "Movement detected at Shubenacadie Wildlife Park. Rad-Moose and Yao Guai variants confirmed. Scout teams deploy. Biological data required." }
    ],
    broadcastSignals: [
        { id: 'b1', title: "THREE-CROWS RADIO: MUSIC HOUR", text: "[STATIC] Now playing: The Atomic Dream by The Pip-Boys..." },
        { id: 'b2', title: "WEATHER ALERT", text: "ATTENTION: High-pressure rad-front moving in from the northeast. Recommend increasing vault shielding." },
        { id: 'b3', title: "SURVIVOR LOG", text: "[CRACKLING VOICE] This is Overseer Sinclair... Day 847... We endure..." },
        { id: 'b4', title: "STRANGE SIGNAL", text: "[MYSTERIOUS BEEPING] ...cannot identify source... ...repeating pattern..." },
        { id: 'b5', title: "DISTRESS CALL", text: "[GARBLED TRANSMISSION] ...anyone... ...need help... ...coordinates unknown..." },
        { id: 'b6', title: "OLD WORLD BROADCAST", text: "[ANCIENT RECORDING] Welcome to Three-Crows Radio, serving Halifax since 1957..." },
        { id: 'b7', title: "VAULT-TEC ANNIVERSARY", text: "Celebrating another year of safety and security! Vault-Tec: Ensuring your family's future!" },
        { id: 'b8', title: "UNKNOWN TRANSMISSION", text: "[WHISPERED] ...they're coming... ...prepare the defenses... ...the old ones stir..." }
    ],
    questRadioMap: {
        q12: 'r5',
        q13: 'r6',
        q14: 'r7',
        q15: 'r8',
        q16: 'r9',
        q17: 'r10'
    },
    randomEncounters: [
        {
            id: 'e1',
            title: 'RAD-MOOSE SIGHTING',
            text: 'WARNING: A glowing Rad-Moose has been spotted near your sector. Keep your distance or prepare for a fight.'
        },
        {
            id: 'e2',
            title: 'HIGHWAY 104 AMBUSH',
            text: 'ALERT: Raiders have set up a scrap-metal barricade. They are demanding 5 Tabs for safe passage.'
        },
        {
            id: 'e3',
            title: 'FERAL GHOUL PACK',
            text: 'RADIO STATIC: ...they are coming out of the basement! Feral pack moving fast through the ruins!'
        },
        {
            id: 'e4',
            title: 'ABANDONED SLOCUMS JOE',
            text: 'LUCK: You have found a preserved Slocums Joe. It is dusty, but there might be some useful scrap or a snack inside.'
        },
        {
            id: 'e5',
            title: 'CRASHED VERTIBIRD',
            text: 'SIGNAL: Emergency beacon detected. A Pre-War transport has crashed nearby. High chance of finding Steel and Circuits.'
        },
        {
            id: 'e6',
            title: 'TRAVELING MERCHANT',
            text: "TRADER: 'Hey there! Name is Halifax. I have got the best Adhesive in the Maritimes if you have got the Tabs!'"
        },
        {
            id: 'e7',
            title: 'ACID RAIN MIST',
            text: 'WEATHER: Yellow clouds are rolling in from the coast. Seek shelter or take +2 RADS.'
        },
        {
            id: 'e8',
            title: 'MYSTERIOUS RADIO SIGNAL',
            text: 'SIGNAL: A strange, upbeat fiddle tune is playing on a loop. It fills you with Nova Scotian pride. (+1 Politeness temporarily).'
        },
        {
            id: 'e9',
            title: 'KITCHEN PARTY NOISE',
            text: 'SOUND: You hear the faint sound of a kitchen party in the distance. Following the noise might lead to a safe settlement.'
        }
    ],
    tradeOffers: [
        { id: 't1', vendor: 'Masstown Merchant', offers: [{ item: 'Stimpak', cost: 20 }] },
        { id: 't2', vendor: 'Vault Overseer', offers: [{ item: 'Pop Tabs', cost: 10 }] }
    ],
    recipes: [
        {
            id: 'r1',
            name: 'BLUENOSE BAYONET',
            desc: 'A reach weapon that deals extra damage to Rad-Skeeters.',
            ingredients: [{ type: 'maritimeMetal', amount: 2 }],
            output: { item: 'Bluenose Bayonet', qty: 1 }
        },
        {
            id: 'r2',
            name: 'TRAPPER\'S PLATE',
            desc: 'High-resistance armor that makes the wearer immune to the Red Mud agility penalty.',
            ingredients: [{ type: 'maritimeMetal', amount: 4 }, { type: 'plaidScraps', amount: 2 }],
            output: { item: 'Trapper\'s Plate', qty: 1 }
        },
        {
            id: 'r3',
            name: 'PROPANE POPPER',
            desc: 'A makeshift grenade that causes a massive fire AOE, perfect for clearing out swarms.',
            ingredients: [{ type: 'propaneTank', amount: 1 }, { type: 'syntheticSap', amount: 2 }],
            output: { item: 'Propane Popper', qty: 1 }
        },
        {
            id: 'r4',
            name: 'DONAIR-DAB KIT',
            desc: 'A powerful healing item (50% HP) but adds +10 RADS unless you have LEAD BELLY perk.',
            ingredients: [{ type: 'radMeat', amount: 1 }, { type: 'spices', amount: 1 }, { type: 'cleanWater', amount: 1 }],
            output: { item: 'Donair-Dab Kit', qty: 1 }
        },
        {
            id: 'r5',
            name: 'STIMPAK',
            desc: 'Restores 4 HP.',
            ingredients: [{ type: 'syntheticSap', amount: 1 }],
            output: { item: 'Stimpak', qty: 1 }
        },
        {
            id: 'r6',
            name: 'RAD-AWAY',
            desc: 'Removes 2 Rads.',
            ingredients: [{ type: 'syntheticSap', amount: 2 }],
            output: { item: 'Rad-Away', qty: 1 }
        }
    ],
    quarterUpgrades: [
        {
            id: 'qupg1',
            name: 'STRUCTURAL REINFORCEMENT',
            desc: 'Clothespins and binder clips reinforce tent walls against Room-Draft Rad-storms.',
            tier: 1,
            cost: 50,
            stat: 'hardiness',
            statBoost: 1,
            effect: 'Vault walls are now taut and resistant to radiation storms.'
        },
        {
            id: 'qupg2',
            name: 'TACTICAL LUMENS',
            desc: 'Battery-powered fairy lights illuminate the Vault at night.',
            tier: 1,
            cost: 75,
            stat: 'perception',
            statBoost: 1,
            effect: 'Lights prevent stubbed toes and improve nighttime visibility.'
        },
        {
            id: 'qupg3',
            name: 'SOFT-FLOOR PROTOCOL',
            desc: 'Extra yoga mats and rugs create cushioned flooring.',
            tier: 1,
            cost: 100,
            stat: null,
            hpRecovery: 'full',
            effect: 'Sleeping in the Vault now fully restores Health.'
        },
        {
            id: 'qupg4',
            name: 'SALVAGED SUPPLY BIN',
            desc: 'A plastic bin or cardboard crate inside the Vault for storage.',
            tier: 1,
            cost: 60,
            stat: null,
            inventorySlots: 3,
            effect: 'Store up to 3 extra pieces of scrap without carry weight penalties.'
        },
        {
            id: 'qupg5',
            name: 'DELTA MASCOT POSTER',
            desc: 'A drawing or photo of the Company mascot pinned to the Vault wall.',
            tier: 1,
            cost: 45,
            stat: 'charm',
            statBoost: 1,
            effect: 'Familiar face boosts morale and negotiation with factions.'
        },
        {
            id: 'qupg6',
            name: 'AIR-LOCK SEALANT',
            desc: 'Duct tape and masking tape seal the blanket fort seams.',
            tier: 1,
            cost: 40,
            stat: null,
            specialEffect: 'skeeterImmunity',
            effect: 'Immune to Rad-Skeeter Swarm encounters while inside the Vault.'
        },
        {
            id: 'qupg7',
            name: 'RATION DISPENSER',
            desc: 'A dedicated bowl or container for session snacks inside the Vault.',
            tier: 1,
            cost: 80,
            stat: null,
            specialEffect: 'fortifiedRecovery',
            effect: '+1 Hardiness for the duration of the next Wasteland Encounter.'
        },
        {
            id: 'qupg8',
            name: 'SCRAP-COMMS LINK',
            desc: 'Tin can phone, toy walkie-talkie, or colored string between Vaults.',
            tier: 1,
            cost: 100,
            stat: null,
            specialEffect: 'assistBonus',
            effect: 'Once per session, call the other survivor for +1 to any C.H.A.P.P.Y. roll.'
        }
    ],
    trades: []
};

function scheduleAutoSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
        fs.writeFile(SAVE_FILE_PATH, JSON.stringify(gameState, null, 2), 'utf8', (error) => {
            if (error) {
                console.error('Auto-save failed:', error.message);
            }
        });
    }, SAVE_DEBOUNCE_MS);
}

function loadGameStateFromDisk() {
    if (!fs.existsSync(SAVE_FILE_PATH)) {
        return;
    }

    try {
        const fileContent = fs.readFileSync(SAVE_FILE_PATH, 'utf8');
        const loadedState = JSON.parse(fileContent);
        if (loadedState && typeof loadedState === 'object' && loadedState.players) {
            gameState = loadedState;
            console.log('Loaded saved game state from disk.');
        }
    } catch (error) {
        console.error('Failed to load saved game state:', error.message);
    }
}

function flushSaveOnExit() {
    try {
        fs.writeFileSync(SAVE_FILE_PATH, JSON.stringify(gameState, null, 2), 'utf8');
    } catch (error) {
        console.error('Final save failed:', error.message);
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getRandomScrapType(player) {
    const scrap = gameState.players[player].scrap || {};
    const keys = Object.keys(scrap);
    if (keys.length === 0) {
        return null;
    }
    return keys[Math.floor(Math.random() * keys.length)];
}

function resolveEncounterOutcome(player, encounter) {
    const roll = Math.floor(Math.random() * 20) + 1;
    let hpDelta = 0;
    let radDelta = 0;
    let tabsDelta = 0;
    let scrapType = null;
    let scrapDelta = 0;
    let label = 'MIXED';

    if (roll <= 5) {
        hpDelta = -2;
        radDelta = 2;
        label = 'DANGER';
    } else if (roll <= 10) {
        hpDelta = -1;
        radDelta = 1;
        tabsDelta = 5;
        label = 'ROUGH';
    } else if (roll <= 15) {
        tabsDelta = 10;
        scrapDelta = 1;
        label = 'CLEAR';
    } else {
        hpDelta = 1;
        tabsDelta = 15;
        scrapDelta = 2;
        label = 'LUCKY';
    }

    if (scrapDelta > 0) {
        scrapType = getRandomScrapType(player);
    }

    const playerData = gameState.players[player];
    playerData.hp = clamp((playerData.hp || 0) + hpDelta, 0, playerData.maxHp || 10);
    playerData.rads = clamp((playerData.rads || 0) + radDelta, 0, 10);
    playerData.tabs = Math.max(0, (playerData.tabs || 0) + tabsDelta);
    if (scrapType) {
        playerData.scrap[scrapType] = (playerData.scrap[scrapType] || 0) + scrapDelta;
    }

    const effects = [];
    if (hpDelta !== 0) {
        effects.push(`HP ${hpDelta > 0 ? '+' : ''}${hpDelta}`);
    }
    if (radDelta !== 0) {
        effects.push(`RADS ${radDelta > 0 ? '+' : ''}${radDelta}`);
    }
    if (tabsDelta !== 0) {
        effects.push(`TABS +${tabsDelta}`);
    }
    if (scrapType && scrapDelta > 0) {
        effects.push(`${scrapType} +${scrapDelta}`);
    }

    return {
        roll,
        label,
        effects: effects.length > 0 ? effects.join(', ') : 'NO CHANGE'
    };
}

loadGameStateFromDisk();

process.on('SIGINT', () => {
    flushSaveOnExit();
    process.exit(0);
});

process.on('SIGTERM', () => {
    flushSaveOnExit();
    process.exit(0);
});

// --- GM ENDPOINTS ---

// GET game state for GM dashboard
app.get('/api/game-state', (req, res) => {
    res.json(gameState);
});

// Update player stat
app.post('/api/player/:player/stat/:stat', (req, res) => {
    const { player, stat } = req.params;
    const { value } = req.body;
    if (gameState.players[player] && gameState.players[player][stat] !== undefined) {
        gameState.players[player][stat] = value;
        scheduleAutoSave();
        res.json({ success: true, message: `Updated ${player} ${stat}` });
    } else {
        res.status(404).json({ error: 'Player or stat not found' });
    }
});

// Update player stats object (for character creation)
app.post('/api/player/:player/stats', (req, res) => {
    const { player } = req.params;
    const { stats } = req.body;
    if (gameState.players[player] && stats && typeof stats === 'object') {
        gameState.players[player].stats = stats;
        scheduleAutoSave();
        res.json({ success: true, message: `Updated ${player} stats`, stats: stats });
    } else {
        res.status(400).json({ error: 'Invalid stats object' });
    }
});

// Send quest to player
app.post('/api/player/:player/quest', (req, res) => {
    const { player } = req.params;
    const { questId } = req.body;
    if (gameState.players[player] && questId) {
        const quest = gameState.quests.find(q => q.id === questId);
        if (quest && !gameState.players[player].activeQuests.includes(questId)) {
            gameState.players[player].activeQuests.push(questId);
            
            // Auto-send corresponding radio signal if mapped
            const radioId = gameState.questRadioMap[questId];
            if (radioId) {
                gameState.players[player].activeRadio = radioId;
                gameState.players[player].activeRadioData = null;
            }
            
            scheduleAutoSave();
            res.json({ success: true, message: `Quest sent to ${player}` });
        } else {
            res.status(400).json({ error: 'Quest already active or not found' });
        }
    }
});

// Send radio signal to player
app.post('/api/player/:player/radio', (req, res) => {
    const { player } = req.params;
    const { radioId } = req.body;
    if (gameState.players[player]) {
        gameState.players[player].activeRadio = radioId;
        gameState.players[player].activeRadioData = null;
        scheduleAutoSave();
        res.json({ success: true, message: `Radio signal sent to ${player}` });
    }
});

// Modify player scrap/inventory
app.post('/api/player/:player/scrap/:type', (req, res) => {
    const { player, type } = req.params;
    const { amount } = req.body;
    if (gameState.players[player] && gameState.players[player].scrap[type] !== undefined) {
        gameState.players[player].scrap[type] += amount;
        scheduleAutoSave();
        res.json({ success: true, amount: gameState.players[player].scrap[type] });
    }
});

// Complete quest for player
app.post('/api/player/:player/complete-quest', (req, res) => {
    const { player } = req.params;
    const { questId } = req.body;
    const playerData = gameState.players[player];
    if (playerData) {
        const quest = gameState.quests.find(q => q.id === questId);
        if (quest) {
            playerData.activeQuests = playerData.activeQuests.filter(q => q !== questId);
            playerData.completedQuests.push(questId);
            playerData.tabs += quest.reward;
            playerData.level += quest.xp;
            scheduleAutoSave();
            res.json({ success: true, message: `${player} completed ${quest.title}` });
        }
    }
});

// --- PLAYER ENDPOINTS ---

// GET player data
app.get('/api/player/:player', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        res.json(gameState.players[player]);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// GET all quests
app.get('/api/quests', (req, res) => {
    res.json(gameState.quests);
});

// GET random household quest
app.get('/api/random-quest', (req, res) => {
    if (gameState.randomQuests && gameState.randomQuests.length > 0) {
        const randomQuest = gameState.randomQuests[Math.floor(Math.random() * gameState.randomQuests.length)];
        res.json(randomQuest);
    } else {
        res.status(404).json({ error: 'No random quests available' });
    }
});

// GET all radio signals
app.get('/api/radio', (req, res) => {
    res.json(gameState.radioSignals);
});

// GET all perks
app.get('/api/perks', (req, res) => {
    res.json(gameState.perks);
});

// GET all recipes
app.get('/api/recipes', (req, res) => {
    res.json(gameState.recipes);
});

// GET player perks
app.get('/api/player/:player/perks', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        const playerPerks = gameState.players[player].unlockedPerks.map(perkId => 
            gameState.perks.find(p => p.id === perkId)
        ).filter(p => p);
        res.json(playerPerks);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Add perk to player
app.post('/api/player/:player/perk/:perkId', (req, res) => {
    const { player, perkId } = req.params;
    if (gameState.players[player] && gameState.perks.find(p => p.id === perkId)) {
        if (!gameState.players[player].unlockedPerks.includes(perkId)) {
            gameState.players[player].unlockedPerks.push(perkId);
            scheduleAutoSave();
            res.json({ success: true, message: `Perk added to ${player}` });
        } else {
            res.status(400).json({ error: 'Perk already unlocked' });
        }
    } else {
        res.status(404).json({ error: 'Player or perk not found' });
    }
});

// Remove perk from player
app.delete('/api/player/:player/perk/:perkId', (req, res) => {
    const { player, perkId } = req.params;
    if (gameState.players[player]) {
        gameState.players[player].unlockedPerks = gameState.players[player].unlockedPerks.filter(p => p !== perkId);
        scheduleAutoSave();
        res.json({ success: true, message: `Perk removed from ${player}` });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Craft an item
app.post('/api/player/:player/craft/:recipeId', (req, res) => {
    const { player, recipeId } = req.params;
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    const recipe = gameState.recipes.find(r => r.id === recipeId);
    if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
    }
    
    // Check if player has all required ingredients
    const playerScrap = gameState.players[player].scrap;
    for (let ingredient of recipe.ingredients) {
        if (ingredient.type === 'propaneTank' || ingredient.type === 'syntheticSap' || 
            ingredient.type === 'maritimeMetal' || ingredient.type === 'plaidScraps' ||
            ingredient.type === 'radMeat' || ingredient.type === 'spices' || 
            ingredient.type === 'cleanWater' || ingredient.type === 'hubCircuitry') {
            if (!playerScrap[ingredient.type] || playerScrap[ingredient.type] < ingredient.amount) {
                return res.status(400).json({ error: `Not enough ${ingredient.type}` });
            }
        }
    }
    
    // Consume ingredients
    for (let ingredient of recipe.ingredients) {
        if (ingredient.type !== 'inventory') {
            playerScrap[ingredient.type] -= ingredient.amount;
        }
    }
    
    // Add crafted item to inventory
    const newItem = {
        id: `item-${Date.now()}`,
        name: recipe.output.item,
        recipeId: recipeId,
        qty: recipe.output.qty
    };
    gameState.players[player].inventory.push(newItem);
    scheduleAutoSave();
    
    res.json({ 
        success: true, 
        message: `Crafted ${recipe.output.item}!`,
        item: newItem
    });
});

// GET all quarters upgrades
app.get('/api/quarters-shop', (req, res) => {
    res.json(gameState.quarterUpgrades);
});

// GET player's purchased quarters upgrades
app.get('/api/player/:player/quarters', (req, res) => {
    const { player } = req.params;
    if (gameState.players[player]) {
        const playerUpgrades = gameState.players[player].purchasedUpgrades.map(upgradeId => 
            gameState.quarterUpgrades.find(u => u.id === upgradeId)
        ).filter(u => u);
        res.json(playerUpgrades);
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Purchase a quarters upgrade
app.post('/api/player/:player/quarters/:upgradeId', (req, res) => {
    const { player, upgradeId } = req.params;
    if (!gameState.players[player]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    const upgrade = gameState.quarterUpgrades.find(u => u.id === upgradeId);
    if (!upgrade) {
        return res.status(404).json({ error: 'Upgrade not found' });
    }
    
    // Check if already purchased
    if (gameState.players[player].purchasedUpgrades.includes(upgradeId)) {
        return res.status(400).json({ error: 'Upgrade already purchased' });
    }
    
    // Check if player has enough tabs
    if (gameState.players[player].tabs < upgrade.cost) {
        return res.status(400).json({ error: `Need ${upgrade.cost} tabs, only have ${gameState.players[player].tabs}` });
    }
    
    // Deduct tabs and purchase
    gameState.players[player].tabs -= upgrade.cost;
    gameState.players[player].purchasedUpgrades.push(upgradeId);
    
    // Apply stat boosts if applicable
    if (upgrade.stat && upgrade.statBoost) {
        gameState.players[player].stats[upgrade.stat] += upgrade.statBoost;
    }
    scheduleAutoSave();
    
    res.json({ 
        success: true, 
        message: `Purchased ${upgrade.name}!`,
        upgrade: upgrade,
        remainingTabs: gameState.players[player].tabs
    });
});

// GET all radio signals
app.get('/api/radio', (req, res) => {
    const allSignals = [...gameState.radioSignals, ...gameState.broadcastSignals];
    res.json(allSignals);
});

// GET all broadcast signals
app.get('/api/broadcast-signals', (req, res) => {
    res.json(gameState.broadcastSignals);
});

// Send random broadcast to both players
app.post('/api/broadcast/random', (req, res) => {
    if (!gameState.broadcastSignals || gameState.broadcastSignals.length === 0) {
        return res.status(400).json({ error: 'No broadcast signals available' });
    }
    
    const randomSignal = gameState.broadcastSignals[Math.floor(Math.random() * gameState.broadcastSignals.length)];
    
    // Send to both players
    for (let player in gameState.players) {
        gameState.players[player].activeRadio = randomSignal.id;
        gameState.players[player].activeRadioData = null;
    }
    
    scheduleAutoSave();
    res.json({ success: true, message: 'Broadcast sent to all players', signal: randomSignal });
});

// Send random encounter to both players with D20 outcomes
app.post('/api/encounter/random', (req, res) => {
    if (!gameState.randomEncounters || gameState.randomEncounters.length === 0) {
        return res.status(400).json({ error: 'No random encounters available' });
    }

    const encounter = gameState.randomEncounters[Math.floor(Math.random() * gameState.randomEncounters.length)];
    const results = {};

    for (let player in gameState.players) {
        const outcome = resolveEncounterOutcome(player, encounter);
        results[player] = outcome;
        gameState.players[player].activeRadio = null;
        gameState.players[player].activeRadioData = {
            title: encounter.title,
            text: `${encounter.text}\n\nD20 ROLL: ${outcome.roll} (${outcome.label})\nOUTCOME: ${outcome.effects}`
        };
    }

    scheduleAutoSave();
    res.json({ success: true, message: 'Encounter sent to all players', encounter: encounter, results: results });
});

// Get trade offers

// --- TRADING SYSTEM ---

// GET all pending trades
app.get('/api/trades/pending', (req, res) => {
    res.json(gameState.trades);
});

// GET trades for a specific player (both sent and received)
app.get('/api/player/:player/trades', (req, res) => {
    const { player } = req.params;
    const playerTrades = gameState.trades.filter(t => t.from === player || t.to === player);
    res.json(playerTrades);
});

// Initiate a trade offer
app.post('/api/player/:player/trade/offer', (req, res) => {
    const { player } = req.params;
    const { toPlayer, offeringScrap, requestingScrap } = req.body;
    
    if (!gameState.players[player] || !gameState.players[toPlayer]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    if (player === toPlayer) {
        return res.status(400).json({ error: 'Cannot trade with yourself' });
    }
    
    // Verify player has offering scrap
    for (let [scrapType, amount] of Object.entries(offeringScrap)) {
        if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Not enough ${scrapType}` });
        }
    }
    
    // Create trade offer
    const trade = {
        id: `trade-${Date.now()}`,
        from: player,
        to: toPlayer,
        offeringScrap: offeringScrap,
        requestingScrap: requestingScrap,
        status: 'pending',
        createdAt: Date.now()
    };
    
    gameState.trades.push(trade);
    scheduleAutoSave();
    
    res.json({ success: true, message: `Trade offer sent to ${toPlayer}!`, trade: trade });
});

// Accept a trade offer
app.post('/api/trade/:tradeId/accept', (req, res) => {
    const { tradeId } = req.params;
    const { player } = req.body;
    
    const trade = gameState.trades.find(t => t.id === tradeId);
    if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
    }
    
    if (trade.to !== player) {
        return res.status(400).json({ error: 'You cannot accept this trade' });
    }
    
    if (trade.status !== 'pending') {
        return res.status(400).json({ error: 'Trade is no longer pending' });
    }
    
    // Verify receiving player has requesting scrap
    for (let [scrapType, amount] of Object.entries(trade.requestingScrap)) {
        if (!gameState.players[player].scrap[scrapType] || gameState.players[player].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Not enough ${scrapType} to complete trade` });
        }
    }
    
    // Verify offering player still has offering scrap
    for (let [scrapType, amount] of Object.entries(trade.offeringScrap)) {
        if (!gameState.players[trade.from].scrap[scrapType] || gameState.players[trade.from].scrap[scrapType] < amount) {
            return res.status(400).json({ error: `Offering player no longer has required scrap` });
        }
    }
    
    // Transfer scrap - FROM gives to TO
    for (let [scrapType, amount] of Object.entries(trade.offeringScrap)) {
        gameState.players[trade.from].scrap[scrapType] -= amount;
        gameState.players[player].scrap[scrapType] += amount;
    }
    
    // Transfer scrap - TO gives to FROM
    for (let [scrapType, amount] of Object.entries(trade.requestingScrap)) {
        gameState.players[player].scrap[scrapType] -= amount;
        gameState.players[trade.from].scrap[scrapType] += amount;
    }
    
    trade.status = 'accepted';
    trade.acceptedAt = Date.now();
    scheduleAutoSave();
    
    res.json({ success: true, message: 'Trade accepted!', trade: trade });
});

// Reject a trade offer
app.post('/api/trade/:tradeId/reject', (req, res) => {
    const { tradeId } = req.params;
    const { player } = req.body;
    
    const trade = gameState.trades.find(t => t.id === tradeId);
    if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
    }
    
    if (trade.to !== player) {
        return res.status(400).json({ error: 'You cannot reject this trade' });
    }
    
    if (trade.status !== 'pending') {
        return res.status(400).json({ error: 'Trade is no longer pending' });
    }
    
    trade.status = 'rejected';
    trade.rejectedAt = Date.now();
    scheduleAutoSave();
    
    res.json({ success: true, message: 'Trade rejected', trade: trade });
});

// --- SERVER START ---
app.listen(PORT, () => {
    const hostname = os.hostname();
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
    }
    
    const gmUrl = `http://${localIP}:${PORT}/gm-dashboard.html`;
    const loganUrl = `http://${localIP}:${PORT}/player.html?player=logan`;
    const rylynUrl = `http://${localIP}:${PORT}/player.html?player=rylyn`;
    
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  FALLOUT: NEW NOVA SCOTIA - GAME MASTER SERVER STARTED    ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  📊 GM DASHBOARD:                                          ║
║  ${gmUrl}
║                                                            ║
║  👤 LOGAN:                                                 ║
║  ${loganUrl}
║                                                            ║
║  👤 RYLYN:                                                 ║
║  ${rylynUrl}
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
