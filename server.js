const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');
const { validateNumber, validateNumericRecord } = require('./validators');
const registerGmRoutes = require('./routes/gm');
const registerPlayerRoutes = require('./routes/player');
const registerGameplayRoutes = require('./routes/gameplay');

const app = express();
const PORT = process.env.PORT || 5000;
const SAVE_DEBOUNCE_MS = 500;
const PERIODIC_SAVE_MS = Number(process.env.PERIODIC_SAVE_MS || 60000);
const SAVE_BACKUP_LIMIT = Number(process.env.SAVE_BACKUP_LIMIT || 20);
const GAME_STATE_VERSION = 3; // Increment when schema changes
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'game_state';
const SUPABASE_STATE_ID = 'primary';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function canWriteToDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        const probeFile = path.join(dirPath, '.write-test');
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.unlinkSync(probeFile);
        return true;
    } catch {
        return false;
    }
}

function resolveDataDirectory() {
    const candidateDirs = [
        process.env.DATA_VOLUME_PATH,
        process.env.RENDER_DISK_PATH,
        path.join(__dirname, 'data'),
        __dirname,
        os.tmpdir()
    ].filter(Boolean);

    for (const candidate of candidateDirs) {
        if (canWriteToDir(candidate)) {
            return candidate;
        }
    }

    throw new Error('No writable data directory available for save files.');
}

const DATA_DIR = resolveDataDirectory();
const SAVE_FILE_PATH = path.join(DATA_DIR, 'game-state.json');
const BACKUP_DIR = path.join(DATA_DIR, 'save-backups');

let saveTimeout = null;
let periodicSaveTimer = null;
let hasUnsavedChanges = false;
let lastSavedAt = null;
let saveInFlight = false;
let saveQueued = false;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'gm-dashboard.html'));
});

app.get('/healthz', (req, res) => {
    res.status(200).json({
        ok: true,
        storageMode: SUPABASE_ENABLED ? 'supabase' : 'filesystem',
        supabaseEnabled: SUPABASE_ENABLED,
        supabaseTable: SUPABASE_TABLE,
        dataDir: DATA_DIR,
        saveFile: SAVE_FILE_PATH,
        backupDir: BACKUP_DIR,
        lastSavedAt,
        hasUnsavedChanges
    });
});

async function getStorageStatus() {
    const baseStatus = {
        storageMode: SUPABASE_ENABLED ? 'supabase' : 'filesystem',
        supabaseEnabled: SUPABASE_ENABLED,
        supabaseUrlConfigured: Boolean(SUPABASE_URL),
        supabaseKeyConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        supabaseTable: SUPABASE_TABLE,
        saveFile: SAVE_FILE_PATH,
        lastSavedAt,
        hasUnsavedChanges
    };

    if (!SUPABASE_ENABLED) {
        return {
            ok: true,
            ...baseStatus,
            providerHealthy: true,
            providerMessage: 'Filesystem fallback active'
        };
    }

    try {
        const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
        });

        if (!response.ok) {
            const body = await response.text();
            return {
                ok: false,
                ...baseStatus,
                providerHealthy: false,
                providerMessage: `Supabase check failed (${response.status})`,
                providerError: body
            };
        }

        return {
            ok: true,
            ...baseStatus,
            providerHealthy: true,
            providerMessage: 'Supabase reachable'
        };
    } catch (error) {
        return {
            ok: false,
            ...baseStatus,
            providerHealthy: false,
            providerMessage: 'Supabase unreachable',
            providerError: error.message
        };
    }
}

// Game state with version tracking for migration
const BASE_GAME_STATE = {
    version: GAME_STATE_VERSION,
    players: {
        logan: {
            name: 'Logan',
            level: 1,
            xp: 0,
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
            pendingPerks: 0,
            craftedGear: [],
            purchasedUpgrades: [],
            activeEffects: []
        },
        rylyn: {
            name: 'Rylyn',
            level: 1,
            xp: 0,
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
            pendingPerks: 0,
            craftedGear: [],
            purchasedUpgrades: [],
            activeEffects: []
        }
    },
    perks: [
        { id: 'p1', name: "IRON CALVES", desc: "Climbing Jacob's Ladder no longer causes HP loss.", tier: 1 },
        { id: 'p2', name: "AQUA-BLUENOSER", desc: "Immune to Radiation while at the shoreline.", tier: 1 },
        { id: 'p3', name: "THRIFTY TOWNIE", desc: "Gain 2 extra Pop Tabs from every quest.", tier: 2 },
        { id: 'p4', name: "DONAIR DIGESTION", desc: "Healing items (snacks) restore double HP.", tier: 1 },
        { id: 'p5', name: "SCRAPPER", desc: "50% chance to find double scrap items.", tier: 2 },
        { id: 'p6', name: "LEAD BELLY", desc: "Eating 'Red Mud' food causes 0 Radiation.", tier: 1 },
        { id: 'p7', name: "WASTELAND WAND", desc: "+1 Agility on trails and outdoor areas.", tier: 2 },
        { id: 'p8', name: "SCAVENGER'S EYE", desc: "+1 Perception for finding hidden items.", tier: 3 },
        { id: 'p9', name: "PLAID PRIDE", desc: "+2 Charisma with faction members.", tier: 2 },
        { id: 'p10', name: "QUICK-HANDS", desc: "+10% attack speed with melee weapons.", tier: 3 },
        { id: 'p11', name: "TIDAL MASTER", desc: "Predict Tidal Bore patterns; cross safely at any time.", tier: 2 },
        { id: 'p12', name: "FOG WALKER", desc: "Move freely through radioactive fog without vision penalty.", tier: 3 },
        { id: 'p13', name: "COVE CLIMBER", desc: "Scaling any cliff or rock formation grants +1 to next action.", tier: 2 },
        { id: 'p14', name: "KITCHEN PARTY", desc: "Social encounters grant +15% charm and +10% tabs reward.", tier: 1 },
        { id: 'p15', name: "LOBSTER REFLEXES", desc: "Dodge incoming damage with +2 to agility checks.", tier: 3 },
        { id: 'p16', name: "HIGHLAND HARDNESS", desc: "+3 Max HP. You're built for the brutal Nova Scotia terrain.", tier: 2 },
        { id: 'p17', name: "RADIO TUNER", desc: "Unlock 3 additional radio signals beyond normal broadcasts.", tier: 1 }
    ],
    statusEffects: [
        {
            id: 'se1',
            name: "DONAIR SWEATS",
            desc: "You smell so strongly of garlic and spiced beef that you can't sneak, and people don't want to talk to you.",
            trigger: "Consuming low-quality Mystery Meat",
            type: 'debuff',
            effects: { agility: -1, politeness: -1 },
            recovery: "Drink clean water or wait 30 minutes",
            durationMinutes: 30
        },
        {
            id: 'se2',
            name: "FOG-BRAIN",
            desc: "Your vision is obscured by a thick, glowing pea-soup fog. You might be walking toward a cliff or a Tim Hortons; you can't tell.",
            trigger: "Spending too long in the irradiated coastal mist",
            type: 'debuff',
            effects: { perception: -2 },
            recovery: "Find a campfire or high ground",
            durationMinutes: null
        },
        {
            id: 'se3',
            name: "KITCHEN PARTY HYPE",
            desc: "A surge of local pride makes you feel invincible and incredibly talkative.",
            trigger: "Hearing a fiddle tune or successfully telling a Yarn",
            type: 'buff',
            effects: { charm: 2, hardiness: 1 },
            durationMinutes: 15
        },
        {
            id: 'se4',
            name: "BLACK ROCK SLIP",
            desc: "You didn't stay off the black rocks at Peggy's Cove. The Atlantic Ocean humbled you.",
            trigger: "Rolling a 1 near the coastline",
            type: 'debuff',
            effects: { hp: -3, hardiness: -1 },
            permanent: true
        },
        {
            id: 'se5',
            name: "OVER-POLITE STANDOFF",
            desc: "A classic Nova Scotian deadlock where nobody wants to be the one to go first.",
            trigger: "Encountering another player at a doorway or loot pile",
            type: 'mutual_debuff',
            effects: { skipNextTurn: true },
            durationTurns: 1
        }
    ],
    quests: [
        { id: 'h1', title: "VAULT: Sanitize Quarters", desc: "Set a 10-minute timer. Put toys in bins, books on shelves, and dirty clothes in the hamper. Show the floor is clear.", category: 'vault', rewardTabs: 10, rewardScrap: { syntheticSap: 1 }, xp: 1 },
        { id: 'h2', title: "VAULT: Nutrient Synthesis", desc: "Help with one meal job: wash produce, set the table, or stir with an adult. Finish your job and report back.", category: 'vault', rewardTabs: 15, rewardScrap: { cleanWater: 1, spices: 1 }, xp: 1 },
        { id: 'h3', title: "VAULT: Static Discharge", desc: "Fold 8 pieces of clean laundry (or one small basket) and place them in the correct room or drawer.", category: 'vault', rewardTabs: 10, rewardScrap: { plaidScraps: 1 }, xp: 1 },
        { id: 'q2', title: "The Great Drain", desc: "Take a 15-minute outdoor walk with an adult. Find 3 cool nature things (rock, leaf, stick) and describe them.", category: 'main', rewardTabs: 20, rewardScrap: { maritimeMetal: 2 }, xp: 1 },
        { id: 'q5', title: "Jacob's Ladder Trial", desc: "Do a safe stair or movement challenge: 5 up-and-down stair trips or 30 step-ups. Go slow and keep good balance.", category: 'main', rewardTabs: 45, rewardScrap: { hubCircuitry: 1 }, xp: 2 },
        { id: 'q6', title: "Witches' Cauldron Mystery", desc: "Complete a water mission: fill water bottles for the family and wipe one counter or table area.", category: 'main', rewardTabs: 45, rewardScrap: { radMeat: 1, cleanWater: 1 }, xp: 2 },
        { id: 'q11', title: "Battle for the Bazaar", desc: "Do a teamwork clean-up in a shared room for 15 minutes. Pick up, sort, and put away items in the right spots.", category: 'main', rewardTabs: 100, rewardScrap: { maritimeMetal: 2, hubCircuitry: 2 }, xp: 3 },
        { id: 'q12', title: "The Tidal Bore Race", desc: "Before a 5-minute timer ends, collect 10 scattered items and return them to their homes.", category: 'side', rewardTabs: 50, rewardScrap: { maritimeMetal: 1, syntheticSap: 1 }, xp: 2 },
        { id: 'q13', title: "The Plaid Patch-Up", desc: "Find 3 things out of place in your room and fix them. Then make your bed so it looks mission-ready.", category: 'side', rewardTabs: 35, rewardScrap: { plaidScraps: 2, syntheticSap: 1 }, xp: 1 },
        { id: 'q14', title: "Three-Crows Signal Boost", desc: "Two-player mission: one player holds a balance pose for 30 seconds while the other reads a short message clearly.", category: 'side', rewardTabs: 20, rewardScrap: { hubCircuitry: 1 }, xp: 1 },
        { id: 'q15', title: "The Junk-Jet Prototype", desc: "Collect 5 safe recycle items (paper/plastic/cardboard). Tell what each could become in a new invention.", category: 'side', rewardTabs: 60, rewardScrap: { propaneTank: 1, maritimeMetal: 1 }, xp: 2 },
        { id: 'q16', title: "Five Islands Provincial Park (The Great Drain)", desc: "Do an outdoor obstacle mission with an adult: hop, walk, and climb safely for 10 minutes without quitting.", category: 'main', rewardTabs: 55, rewardScrap: { maritimeMetal: 2, cleanWater: 1 }, xp: 2 },
        { id: 'q17', title: "Shubenacadie Wildlife Park (The Beast Pens)", desc: "Spot and name 3 animals (outside, in books, or in a video). Share one fact about each animal.", category: 'main', rewardTabs: 50, rewardScrap: { radMeat: 1, spices: 1 }, xp: 2 }
    ],
    randomQuests: [
        { id: 'rq1', title: "HOUSE: Tidy the Living Room", desc: "Put away 10 items from the floor, then fluff pillows and fold one blanket.", reward: 5, xp: 1 },
        { id: 'rq2', title: "HOUSE: Wash the Dishes", desc: "With adult help, wash or dry 8 dishes, then place them where they belong.", reward: 5, xp: 1 },
        { id: 'rq3', title: "HOUSE: Make Your Bed", desc: "Straighten sheets, pull blanket flat, and place pillows neatly in 3 minutes.", reward: 5, xp: 1 },
        { id: 'rq4', title: "HOUSE: Sweep the Kitchen", desc: "Sweep one kitchen area and collect crumbs into the dustpan.", reward: 5, xp: 1 },
        { id: 'rq5', title: "CRAFT: Build a Lego Structure", desc: "Build a model with at least 15 pieces and give it a cool name.", reward: 8, xp: 1 },
        { id: 'rq6', title: "CRAFT: Draw or Paint", desc: "Draw or paint a picture with at least 3 colors and show it to the GM.", reward: 8, xp: 1 },
        { id: 'rq7', title: "CRAFT: Assemble a Model", desc: "Complete one model step-by-step and clean up pieces when finished.", reward: 10, xp: 1 },
        { id: 'rq8', title: "SPORT: Play Soccer in the Yard", desc: "Do 20 kicks or passes and 5 goal shots safely with clear space.", reward: 8, xp: 1 },
        { id: 'rq9', title: "SPORT: Go for a Bike Ride", desc: "Ride for 10 minutes with helmet on and follow adult safety rules.", reward: 10, xp: 1 },
        { id: 'rq10', title: "SPORT: Play Catch", desc: "Complete 20 catches with a partner (or wall tosses) without giving up.", reward: 5, xp: 1 },
        { id: 'rq11', title: "CHORE: Fold Laundry", desc: "Fold 8 clothing items and place them in the correct room.", reward: 5, xp: 1 },
        { id: 'rq12', title: "CHORE: Take Out Trash", desc: "Collect one full bin, tie bag safely, and replace it with a new bag.", reward: 5, xp: 1 },
        { id: 'rq13', title: "CHORE: Organize Closet", desc: "Sort one shelf or drawer: keep, put away, and remove 5 out-of-place items.", reward: 8, xp: 1 }
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
        { id: 'b8', title: "UNKNOWN TRANSMISSION", text: "[WHISPERED] ...they're coming... ...prepare the defenses... ...the old ones stir..." },
        { id: 'b9', title: "THE BIG STOP BEACON", text: "Greetings traveler! You are 400 miles from the nearest functioning IRVING Big Stop. Today's special is: Rad-Turkey Club and a side of Glow-Slaw. Please have your Tabs ready. Note: We are currently out of napkins." },
        { id: 'b10', title: "MARITIME AUTOMATED WEATHER", text: "Conditions in the Minas Basin: 100% chance of acid rain, followed by a light dusting of nuclear soot. Wind speeds are currently high enough to throw a Rad-Cow into New Brunswick. Have a pleasant day, and stay off the black rocks." },
        { id: 'b11', title: "EMERGENCY BROADCAST (HERITAGE MINUTE EDITION)", text: "I... I can't find a vein! Dramatic piano music plays. This has been a Maritime Heritage Minute. If you find a pre-war medicinal syringe, please return it to the nearest vault." },
        { id: 'b12', title: "THE BRIDGE TOLL BANDIT", text: "This is a public service announcement for anyone crossing the MacKay. The toll is no longer $1.00. It is now your left boot and a roll of duct tape. Don't make me come down from the rafters, I haven't had my coffee yet." },
        { id: 'b13', title: "THE FIDDLE-HEAD RADIO", text: "[Aggressive, high-speed fiddle music plays for 10 seconds] IF YOU CAN HEAR THIS, THE KITCHEN PARTY AT SECTOR 4 IS STILL GOING. WE HAVE THREE GALLONS OF MOON-MIST AND A RADIATED LOBSTER. NO RAIDERS ALLOWED UNLESS YOU CAN PLAY THE SPOONS." },
        { id: 'b14', title: "PROPAGANDA FROM THE VALLEY", text: "Why settle for the salty ruins of Halifax when you can have the mutated orchards of the Annapolis Valley? Our apples are the size of basketballs and only 20% lethal! Join the Apple-Core today!" },
        { id: 'b15', title: "THE GHOST OF THE BLUENOSE", text: "Can you hear the creaking? She's sailing on the fog again... if you see a schooner made of scrap metal and glowing sails near Lunenburg, do not wave. She doesn't want passengers. She wants your Hub Circuitry." },
        { id: 'b16', title: "THE DOUBLE-DOUBLE LOOP", text: "[A distorted, slow-motion voice over heavy static] Large... double... double... large... double... double... screaming... I SAID LARGE DOUBLE DOUBLE." },
        { id: 'b17', title: "THE OAK ISLAND PING", text: "Entry 4,002. We've dug another ten feet. We found a coconut fiber mat and a single pre-war bottle cap. Could this be the treasure? Or just another trap? Heavy sound of water rushing into a tunnel... Not again!" }
    ],
    questRadioMap: {
        q12: 'r5',
        q13: 'r6',
        q14: 'r7',
        q15: 'r8',
        q16: 'r9',
        q17: 'r10'
    },
    questChains: [
        {
            id: 'chain_tidewatch',
            name: 'TIDEWATCH PROTOCOL',
            questIds: ['q12', 'q13', 'q14'],
            finalReward: {
                tabs: 20,
                xp: 2,
                perkId: 'p17',
                item: 'Tidewatch Signal Decoder'
            }
        },
        {
            id: 'chain_wildfrontier',
            name: 'WILD FRONTIER SWEEP',
            questIds: ['q16', 'q17'],
            finalReward: {
                tabs: 15,
                xp: 1,
                item: 'Park Warden Field Kit'
            }
        }
    ],
    radioConsequences: {
        trapSignalIds: ['b4', 'b5', 'b8', 'b16'],
        verifyDc: 10,
        failure: {
            hpLoss: 1,
            radsGain: 1
        },
        success: {
            tabsGain: 5
        }
    },
    eventCards: [
        {
            id: 'ev_rad_storm',
            name: 'RAD STORM',
            text: 'A toxic rad storm rolls over the zone. All players take +1 RAD.',
            effect: { rads: 1 }
        },
        {
            id: 'ev_merchant_visit',
            name: 'MERCHANT VISIT',
            text: 'A roaming merchant appears. All players gain +10 Tabs.',
            effect: { tabs: 10 }
        },
        {
            id: 'ev_vault_breach',
            name: 'VAULT BREACH',
            text: 'A vault breach causes injuries. All players lose 1 HP.',
            effect: { hp: -1 }
        },
        {
            id: 'ev_ally_rescue',
            name: 'ALLY RESCUE',
            text: 'A rescued ally shares supplies. All players gain +1 random scrap.',
            effect: { randomScrap: 1 }
        }
    ],
    achievements: [
        {
            id: 'ach_first_craft',
            name: 'FIRST CRAFT',
            desc: 'Craft your first item.',
            reward: { tabs: 3, xp: 1 }
        },
        {
            id: 'ach_quest_runner',
            name: 'QUEST RUNNER',
            desc: 'Complete 10 quests.',
            reward: { tabs: 10, xp: 2 }
        },
        {
            id: 'ach_chappy_master',
            name: 'CHAPPY MASTER',
            desc: 'Reach 8 in any C.H.A.P.P.Y. stat.',
            reward: { tabs: 5, xp: 1 }
        }
    ],
    classPassives: {
        scavenger: {
            id: 'scavenger',
            label: 'SCAVENGER',
            desc: 'Gain +1 random scrap after encounters.'
        },
        vanguard: {
            id: 'vanguard',
            label: 'VANGUARD',
            desc: 'Recover +1 HP after encounter resolve (up to max).' 
        },
        signaler: {
            id: 'signaler',
            label: 'SIGNALER',
            desc: 'Get +2 tabs on successful radio verification.'
        },
        diplomat: {
            id: 'diplomat',
            label: 'DIPLOMAT',
            desc: 'Gain +2 tabs when completing quests.'
        }
    },
    teamObjectives: [
        {
            id: 'team_signal_tower',
            name: 'SIGNAL TOWER STABILIZATION',
            desc: 'Both players each complete one task: one tidy mission and one movement mission, then report done.',
            reward: { tabs: 10, xp: 1 }
        },
        {
            id: 'team_convoy_escort',
            name: 'CONVOY ESCORT',
            desc: 'Work together: one player gathers supplies while the other clears a path. Finish both jobs to complete.',
            reward: { tabs: 12, xp: 1 }
        },
        {
            id: 'team_fog_survey',
            name: 'FOG SURVEY',
            desc: 'Each player explores a different room/area, finds 3 things, and reports findings to the GM.',
            reward: { tabs: 8, xp: 1 }
        }
    ],
    activeTeamObjective: null,
    sessionMetrics: {
        startedAt: new Date().toISOString(),
        questCompletions: {
            logan: 0,
            rylyn: 0
        },
        scrapGained: {
            logan: 0,
            rylyn: 0
        },
        funniestRadio: null,
        lastRecap: null
    },
    playerProgress: {
        logan: {
            achievements: [],
            chainProgress: {},
            passiveKey: null
        },
        rylyn: {
            achievements: [],
            chainProgress: {},
            passiveKey: null
        }
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
        },
        {
            id: 'r7',
            name: 'PEGGY\'S COVE CLEATS',
            desc: 'Studded shoreline boots. +1 Agility and +1 Hardiness when crafted (one-time).',
            ingredients: [{ type: 'maritimeMetal', amount: 2 }, { type: 'plaidScraps', amount: 1 }],
            output: { item: 'Peggy\'s Cove Cleats', qty: 1 }
        },
        {
            id: 'r8',
            name: 'BASIN FOG LENS',
            desc: 'A salvaged monocle tuned for coastal haze. +1 Perception when crafted (one-time).',
            ingredients: [{ type: 'hubCircuitry', amount: 1 }, { type: 'cleanWater', amount: 1 }],
            output: { item: 'Basin Fog Lens', qty: 1 }
        },
        {
            id: 'r9',
            name: 'APPLE-CORE SASH',
            desc: 'A Valley propaganda sash that boosts confidence. +1 Charm and +1 Politeness when crafted (one-time).',
            ingredients: [{ type: 'plaidScraps', amount: 2 }, { type: 'spices', amount: 1 }],
            output: { item: 'Apple-Core Sash', qty: 1 }
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
    trades: [],
    overseerInbox: []
};

function createInitialGameState() {
    return JSON.parse(JSON.stringify(BASE_GAME_STATE));
}

function mergeMissingDefaults(target, defaults) {
    if (Array.isArray(defaults)) {
        return Array.isArray(target) ? target : JSON.parse(JSON.stringify(defaults));
    }

    if (defaults && typeof defaults === 'object') {
        const source = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
        const merged = { ...source };

        Object.entries(defaults).forEach(([key, defaultValue]) => {
            merged[key] = mergeMissingDefaults(source[key], defaultValue);
        });

        return merged;
    }

    return target === undefined ? defaults : target;
}

let gameState = createInitialGameState();

function ensureSaveDirectories() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function rotateBackups() {
    try {
        const backupFiles = fs.readdirSync(BACKUP_DIR)
            .filter(name => name.endsWith('.json'))
            .map(name => ({
                name,
                fullPath: path.join(BACKUP_DIR, name),
                mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        const removable = backupFiles.slice(Math.max(0, SAVE_BACKUP_LIMIT));
        removable.forEach(file => fs.unlinkSync(file.fullPath));
    } catch (error) {
        console.error('Backup rotation failed:', error.message);
    }
}

function writeBackupSnapshot() {
    try {
        const stamp = new Date().toISOString().replace(/[.:]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `game-state-${stamp}.json`);
        fs.copyFileSync(SAVE_FILE_PATH, backupFile);
        rotateBackups();
    } catch (error) {
        console.error('Backup snapshot failed:', error.message);
    }
}

function parseLoadedState(candidateState, sourceLabel) {
    if (!candidateState || typeof candidateState !== 'object' || !candidateState.players) {
        return false;
    }

    const oldVer = candidateState.version || 1;
    const migratedState = migrateGameState(candidateState);
    if (!migratedState) {
        return false;
    }

    gameState = migratedState;
    console.log(`Loaded game state (${oldVer} -> ${GAME_STATE_VERSION}) from ${sourceLabel}`);
    return true;
}

async function persistGameStateToSupabase(reason = 'autosave') {
    const timestamp = new Date().toISOString();
    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
    const payload = [{
        id: SUPABASE_STATE_ID,
        state: gameState,
        updated_at: timestamp
    }];

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase save failed (${response.status}): ${body}`);
    }

    lastSavedAt = timestamp;
    if (reason !== 'debounced') {
        console.log(`Game state persisted to Supabase (${reason}) at ${lastSavedAt}`);
    }
}

function persistGameStateToDisk(reason = 'autosave') {
    ensureSaveDirectories();
    const tempPath = `${SAVE_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(gameState, null, 2), 'utf8');
    fs.renameSync(tempPath, SAVE_FILE_PATH);
    writeBackupSnapshot();
    lastSavedAt = new Date().toISOString();
    if (reason !== 'debounced') {
        console.log(`Game state persisted (${reason}) at ${lastSavedAt}`);
    }
}

async function persistGameState(reason = 'autosave', force = false) {
    if (!force && !hasUnsavedChanges) {
        return;
    }

    if (saveInFlight) {
        saveQueued = true;
        return;
    }

    saveInFlight = true;

    do {
        saveQueued = false;
        try {
            gameState.version = GAME_STATE_VERSION;
            if (SUPABASE_ENABLED) {
                await persistGameStateToSupabase(reason);
            } else {
                persistGameStateToDisk(reason);
            }
            hasUnsavedChanges = false;
        } catch (error) {
            console.error(`Save failed (${reason}):`, error.message);
        }
    } while (saveQueued && (force || hasUnsavedChanges));

    saveInFlight = false;
}

function scheduleAutoSave() {
    hasUnsavedChanges = true;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
        persistGameState('debounced').catch(error => {
            console.error('Debounced save failed:', error.message);
        });
    }, SAVE_DEBOUNCE_MS);
}

function startPeriodicAutoSave() {
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
    }

    periodicSaveTimer = setInterval(() => {
        persistGameState('periodic').catch(error => {
            console.error('Periodic save failed:', error.message);
        });
    }, PERIODIC_SAVE_MS);
}

function migrateGameState(loadedState) {
    if (!loadedState) return null;

    const mergedState = mergeMissingDefaults(loadedState, BASE_GAME_STATE);

    if (mergedState.players) {
        Object.values(mergedState.players).forEach((playerData) => {
            ensurePlayerProgressFields(playerData);
        });
    }

    // Always update version to current
    mergedState.version = GAME_STATE_VERSION;

    return mergedState;
}

function loadGameStateFromDisk() {
    ensureSaveDirectories();

    const parseSaveFile = (filePath) => {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const loadedState = JSON.parse(fileContent);
        return parseLoadedState(loadedState, filePath);
    };

    if (fs.existsSync(SAVE_FILE_PATH)) {
        try {
            if (parseSaveFile(SAVE_FILE_PATH)) {
                return;
            }
        } catch (error) {
            console.error('Primary save load failed, trying backup:', error.message);
        }
    }

    try {
        const backupFiles = fs.readdirSync(BACKUP_DIR)
            .filter(name => name.endsWith('.json'))
            .map(name => ({
                name,
                fullPath: path.join(BACKUP_DIR, name),
                mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        for (const backup of backupFiles) {
            try {
                if (parseSaveFile(backup.fullPath)) {
                    persistGameState('restore-from-backup', true);
                    return;
                }
            } catch {
                continue;
            }
        }
    } catch (error) {
        console.error('Backup restore scan failed:', error.message);
    }

    console.log('No valid save found; starting with fresh game state.');
}

async function loadGameStateFromSupabase() {
    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${SUPABASE_STATE_ID}&select=state,updated_at&limit=1`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase load failed (${response.status}): ${body}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        console.log('No Supabase save row found; starting with fresh game state.');
        return;
    }

    const loaded = rows[0]?.state;
    if (parseLoadedState(loaded, 'Supabase')) {
        lastSavedAt = rows[0]?.updated_at || null;
        return;
    }

    console.log('Supabase row found but invalid; starting with fresh game state.');
}

async function initializeGameState() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        if (SUPABASE_URL || SUPABASE_SERVICE_ROLE_KEY) {
            console.warn('Supabase env is partially configured; using filesystem persistence fallback.');
        }
        loadGameStateFromDisk();
        return;
    }

    try {
        await loadGameStateFromSupabase();
    } catch (error) {
        console.error('Supabase load unavailable, falling back to filesystem:', error.message);
        loadGameStateFromDisk();
    }
}

function flushSaveOnExit() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
        periodicSaveTimer = null;
    }
    return persistGameState('shutdown', true);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getXpRequiredForLevel(level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    return 5 + ((safeLevel - 1) * 3);
}

function ensurePlayerProgressFields(playerData) {
    if (!playerData || typeof playerData !== 'object') {
        return;
    }

    if (!Number.isFinite(playerData.level) || playerData.level < 1) {
        playerData.level = 1;
    }

    if (!Number.isFinite(playerData.xp) || playerData.xp < 0) {
        playerData.xp = 0;
    }

    playerData.xpToNext = getXpRequiredForLevel(playerData.level);
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

function addInventoryItem(player, name) {
    const item = {
        id: `item-${Date.now()}`,
        name: name,
        qty: 1
    };
    gameState.players[player].inventory.push(item);
}

function applyEncounterOutcome(player) {
    const outcomes = [
        { id: 'lose_hp', text: 'LOSE 2 HEALTH', apply: (p) => { p.hp = clamp((p.hp || 0) - 2, 0, p.maxHp || 10); } },
        { id: 'gain_rads_2', text: 'GAIN 2 RADS', apply: (p) => { p.rads = clamp((p.rads || 0) + 2, 0, 10); } },
        { id: 'gain_rads_4', text: 'GAIN 4 RADS', apply: (p) => { p.rads = clamp((p.rads || 0) + 4, 0, 10); } },
        { id: 'gain_tabs_2', text: 'GAIN 2 TABS', apply: (p) => { p.tabs = (p.tabs || 0) + 2; } },
        { id: 'gain_resource', text: 'GAIN RANDOM RESOURCE', apply: (p) => {
            const scrapType = getRandomScrapType(player);
            if (scrapType) {
                p.scrap[scrapType] = (p.scrap[scrapType] || 0) + 1;
                return `${scrapType} +1`;
            }
            return 'NO SCRAP AVAILABLE';
        } },
        { id: 'gain_stimpak', text: 'GAIN STIMPAK', apply: (p) => { addInventoryItem(player, 'Stimpak'); } },
        { id: 'gain_radaway', text: 'GAIN RAD-AWAY', apply: (p) => { addInventoryItem(player, 'Rad-Away'); } }
    ];

    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    const extra = outcome.apply(gameState.players[player]);
    return {
        id: outcome.id,
        text: outcome.text,
        extra: extra || null
    };
}

registerGmRoutes(app, {
    getStorageStatus,
    persistGameState,
    getLastSavedAt: () => lastSavedAt
});

registerPlayerRoutes(app, {
    getGameState: () => gameState,
    ensurePlayerProgressFields,
    getXpRequiredForLevel,
    scheduleAutoSave
});

registerGameplayRoutes(app, {
    getGameState: () => gameState,
    setGameState: (nextState) => {
        gameState = nextState;
    },
    createInitialGameState,
    migrateGameState,
    persistGameState,
    scheduleAutoSave,
    ensurePlayerProgressFields,
    getXpRequiredForLevel,
    validateNumber,
    validateNumericRecord,
    clamp,
    applyEncounterOutcome,
    getGameStateVersion: () => GAME_STATE_VERSION
});

// --- SERVER START ---
async function startServer() {
    await initializeGameState();
    startPeriodicAutoSave();

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
}

startServer().catch(error => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
});


// Graceful shutdown handlers to save game state
process.on('SIGINT', () => {
    console.log('\nServer shutting down. Saving game state...');
    flushSaveOnExit().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('\nServer terminating. Saving game state...');
    flushSaveOnExit().finally(() => process.exit(0));
});
